/**
 * Mobile Medicine Entry System & Scanner (/scan)
 * - 3 Independent Medicine Scanners (Box, Strip/Pack, Alternate)
 * - Complete Mobile Medicine Entry Form (Name, Strength, Form, Pack, Company, Batch, Expiry, MRP, TP%, Extra Disc%, Qty, Low Stock)
 * - Dynamic Additive Purchase Cost & Profit Calculations
 * - Persistent Mobile Login (License Key + PIN or 6-digit Pair Code) — login once, persists across restarts
 * - Direct Central Database Synchronization (no desktop required)
 * - Offline Queue & Auto-Sync
 * - Separate Single POS Sales Scanner
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { API_BASE, api, storage } from '../api';
import Icon from '../components/Icon';
import InstallApp from '../components/InstallApp';
import { Spinner } from '../components/ui';
import { FORMS, rs2 } from '../utils/format';
import { beep, closeCamera, createBarcodeReader, grabFrame, openCamera, setTorch, fileToImage } from '../utils/scanCamera';

const SESSION_KEY = 'typos_web_scanner_session';
const CLAIMED_KEY = 'typos_web_scanner_code';
const OFFLINE_QUEUE_KEY = 'typos_mobile_pending_queue';

const EMPTY_FORM = {
  name: '',
  strength: '',
  form: 'tablet',
  pack_size: '',
  strips_per_box: '1',
  company: '',
  barcode: '',
  mrp: '',
  tp_pct: '14.5',
  extra_discount_pct: '0',
  stock: '',
  low_stock_level: '5',
  batch_no: '',
  expiry_date: '',
};

const digits = (v) => String(v ?? '').replace(/[^\d.]/g, '');

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const getSavedSession = () => {
  try {
    return JSON.parse(ls.get(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
};

const getOfflineQueue = () => {
  try {
    return JSON.parse(ls.get(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
};

const setOfflineQueue = (q) => {
  ls.set(OFFLINE_QUEUE_KEY, JSON.stringify(q));
};

export default function WebScanner() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const urlCode = params.get('code') || params.get('c') || '';

  // Auth & Session state
  const [session, setSession] = useState(getSavedSession);
  const [authMode, setAuthMode] = useState('pin'); // 'pin' | 'pair'
  const [loginKey, setLoginKey] = useState(storage.licenseKey() || '');
  const [loginPin, setLoginPin] = useState('');
  const [pairCode, setPairCode] = useState(urlCode);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  // App mode: 'add' (Full Mobile Entry + 3 Scanners) | 'sale' (Single POS Sales Scanner)
  const [tab, setTab] = useState('add');

  // Network & Sync status
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [socketOnline, setSocketOnline] = useState(false);
  const [offlineCount, setOfflineCount] = useState(() => getOfflineQueue().length);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  // Medicine Form State
  const [f, setF] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [savedSuccessBanner, setSavedSuccessBanner] = useState('');

  // Scanner & Camera State (Default Open Camera View)
  const [medScanMode, setMedScanMode] = useState('image'); // 'image' | 'barcode'
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState('');
  const [torch, setTorchState] = useState(null);

  // Medicine Image Scanner (AI OCR & Auto-Fill - In-Memory only, no storage load)
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const fileInputRef = useRef(null);

  // Sale Scanner specific state
  const [analyzingSale, setAnalyzingSale] = useState(false);
  const [saleManualCode, setSaleManualCode] = useState('');
  const [saleLogs, setSaleLogs] = useState([]);

  // Refs
  const socketRef = useRef(null);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const loopRef = useRef(null);
  const claiming = useRef('');

  // Active token for all requests
  const activeToken = session?.token || storage.token() || null;

  const showToast = useCallback((type, text) => {
    setToastMsg({ type, text });
    setTimeout(() => {
      setToastMsg((cur) => (cur?.text === text ? null : cur));
    }, 4000);
  }, []);

  // Monitor online / offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('ok', 'Internet connection wapas aa gayi');
      syncPendingQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('err', 'Aap offline hain. Dawaiyan phone mein mehfooz hongi.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]); // eslint-disable-line

  // Persistent Socket connection for real-time counter communication
  useEffect(() => {
    if (!activeToken) return undefined;
    const s = io(API_BASE || undefined, {
      auth: { token: activeToken },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
    });
    s.on('connect', () => setSocketOnline(true));
    s.on('disconnect', () => setSocketOnline(false));
    s.on('revoked', () => logout('Ye phone counter se hata diya gaya.'));
    s.on('connect_error', (e) => {
      setSocketOnline(false);
      if (['revoked', 'license', 'unauthorized'].includes(e.message)) {
        logout('Session khatam ho gaya. Dobara login karein.');
      }
    });
    socketRef.current = s;
    return () => {
      s.disconnect();
      socketRef.current = null;
      setSocketOnline(false);
    };
  }, [activeToken]); // eslint-disable-line

  // Logout handler
  const logout = (msg = '') => {
    ls.set(SESSION_KEY, null);
    ls.set(CLAIMED_KEY, null);
    storage.setToken(null);
    setSession(null);
    setAuthError(msg);
  };

  /* ------------------ Persistent Authentication ------------------ */
  const handleStoreLogin = async (e) => {
    e?.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: { key: loginKey.trim(), pin: loginPin.trim() },
      });
      storage.setToken(res.token);
      storage.setLicenseKey(loginKey.trim());
      const sess = { token: res.token, store: res.store };
      ls.set(SESSION_KEY, JSON.stringify(sess));
      setSession(sess);
      showToast('ok', `Store connect ho gaya: ${res.store?.name || ''}`);
    } catch (err) {
      setAuthError(err.message || 'Login fail ho gaya. Key aur PIN check karein.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handlePairClaim = useCallback(async (rawCode) => {
    const c = String(rawCode || '').trim();
    if (!/^\d{6}$/.test(c)) {
      setAuthError('6 numbers ka sahi pairing code likhein');
      return;
    }
    if (claiming.current === c) return;
    claiming.current = c;
    setAuthBusy(true);
    setAuthError('');
    try {
      const u = navigator.userAgent;
      const deviceName = /iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android Phone' : 'Mobile Phone';
      const res = await api('/pair/claim', {
        method: 'POST',
        body: { code: c, device_name: `${deviceName} Scanner` },
      });
      ls.set(SESSION_KEY, JSON.stringify(res));
      ls.set(CLAIMED_KEY, c);
      storage.setToken(res.token);
      setSession(res);
      setParams({}, { replace: true });
      showToast('ok', `Counter connect ho gaya: ${res.store?.name || ''}`);
    } catch (e) {
      claiming.current = '';
      setAuthError(e.message || 'Counter connect nahi ho saka. Naya code banayein.');
    } finally {
      setAuthBusy(false);
    }
  }, [setParams, showToast]);

  useEffect(() => {
    if (/^\d{6}$/.test(urlCode)) {
      if (getSavedSession() && ls.get(CLAIMED_KEY) === urlCode) {
        setParams({}, { replace: true });
        return;
      }
      handlePairClaim(urlCode);
    }
  }, [urlCode, handlePairClaim, setParams]);

  /* ------------------ Offline Queue Synchronization ------------------ */
  const syncPendingQueue = useCallback(async () => {
    const queue = getOfflineQueue();
    if (!queue.length || syncingQueue) return;
    setSyncingQueue(true);
    let synced = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        await api('/products', {
          method: 'POST',
          token: activeToken,
          body: item.payload,
        });
        synced++;
      } catch (err) {
        if (err.message && /pehle se/i.test(err.message)) {
          // Already saved, treat as success
          synced++;
        } else {
          remaining.push(item);
        }
      }
    }

    setOfflineQueue(remaining);
    setOfflineCount(remaining.length);
    setSyncingQueue(false);
    if (synced > 0) {
      showToast('ok', `✅ ${synced} offline dawaiyan central database mein sync ho gayin!`);
    }
  }, [activeToken, syncingQueue, showToast]);

  /* ------------------ Camera Scanner Engine (Default Open) ------------------ */
  const stopCameraScanner = useCallback(() => {
    loopRef.current?.();
    loopRef.current = null;
    closeCamera(videoRef.current);
    trackRef.current = null;
    setCamOn(false);
    setTorchState(null);
  }, []);

  const startCameraScanner = useCallback(async (target) => {
    stopCameraScanner();
    setCamError('');

    // Wait a tick for video element to mount
    setTimeout(async () => {
      const v = videoRef.current;
      if (!v) return;
      try {
        const { track, torch: hasTorch } = await openCamera(v);
        trackRef.current = track;
        setTorchState(hasTorch ? false : null);
        setCamOn(true);
      } catch (e) {
        setCamError(
          e.name === 'NotAllowedError'
            ? 'Camera permission nahi mili. Browser settings mein allow karein.'
            : `${e.message || 'Camera start nahi ho saka'}`
        );
        return;
      }

      // If user is taking a picture of medicine packaging, we don't need the continuous barcode scanner
      if (target === 'image') return;

      let stop = false;
      let timer;
      loopRef.current = () => {
        stop = true;
        clearTimeout(timer);
      };

      const reader = await createBarcodeReader().catch(() => null);
      let lastScanned = { code: '', time: 0 };

      const tick = async () => {
        if (stop) return;
        if (v.readyState >= 2 && reader) {
          const found = await reader(v).catch(() => null);
          const now = Date.now();
          if (found && (found !== lastScanned.code || now - lastScanned.time > 2000)) {
            lastScanned = { code: found, time: now };
            beep(1900, 0.08);

            if (target === 'sale') {
              handleSaleScan(found);
            } else {
              handleBarcodeScan(found);
            }
          }
        }
        timer = setTimeout(tick, 220);
      };
      tick();
    }, 80);
  }, [stopCameraScanner]); // eslint-disable-line

  // Automatically start camera on load / tab / mode change
  useEffect(() => {
    if (!session?.token && !activeToken) return;
    const target = tab === 'sale' ? 'sale' : medScanMode;
    startCameraScanner(target);
    return () => {
      stopCameraScanner();
    };
  }, [tab, medScanMode, activeToken]); // eslint-disable-line

  const toggleTorch = () => {
    if (!trackRef.current || torch === null) return;
    setTorch(trackRef.current, !torch)
      .then(() => setTorchState(!torch))
      .catch(() => setTorchState(null));
  };

  /* ------------------ Scanner 1: In-Memory AI Image Read (No DB Storage) ------------------ */
  const runImageAnalysis = async (dataUrl) => {
    if (!dataUrl) return;
    setAnalyzingImage(true);
    try {
      const res = await api('/scan/read', {
        method: 'POST',
        token: activeToken,
        body: { image: dataUrl },
      });

      if (res.medicine) {
        const med = res.medicine;
        setF((prev) => ({
          ...prev,
          name: med.name ? String(med.name).trim() : prev.name,
          strength: med.strength ? String(med.strength).trim() : prev.strength,
          form: med.form && FORMS[med.form] ? med.form : prev.form,
          pack_size: med.pack_size ? String(med.pack_size).trim() : prev.pack_size,
          company: med.company ? String(med.company).trim() : prev.company,
          batch_no: med.batch_no ? String(med.batch_no).trim() : prev.batch_no,
          expiry_date: med.expiry_date ? String(med.expiry_date).trim() : prev.expiry_date,
          mrp: med.mrp ? String(med.mrp).trim() : prev.mrp,
          barcode: med.barcode ? String(med.barcode).trim() : prev.barcode,
        }));

        beep(2200, 0.12);
        showToast('ok', `✅ "${med.name || 'Dawai'}" ki maloomat form mein auto-fill ho gayi!`);
      } else {
        throw new Error('Dawai ki packaging se maloomat nahi parhi ja saki. Kripya wazeh aur roshan photo lein.');
      }
    } catch (err) {
      showToast('err', err.message || 'Image analysis fail ho gaya.');
    } finally {
      setAnalyzingImage(false);
    }
  };

  const handleCaptureAndAnalyze = () => {
    const v = videoRef.current;
    if (!v) return;
    const dataUrl = grabFrame(v);
    if (!dataUrl) {
      showToast('err', 'Tasveer capture nahi ho saki. Dobara koshish karein.');
      return;
    }
    runImageAnalysis(dataUrl);
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { dataUrl } = await fileToImage(file);
      await runImageAnalysis(dataUrl);
    } catch (err) {
      showToast('err', err.message || 'Tasveer open nahi ho saki');
    } finally {
      e.target.value = '';
    }
  };

  /* ------------------ Scanner 2: QR / Barcode Scan Handling ------------------ */
  const handleBarcodeScan = async (code) => {
    setF((prev) => ({ ...prev, barcode: code }));
    beep(2100, 0.08);
    showToast('ok', `✅ Barcode: ${code} shamil ho gaya`);
  };

  const handleManualBarcodeScan = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const reader = await createBarcodeReader().catch(() => null);
      if (reader) {
        const found = await reader(v).catch(() => null);
        if (found) {
          beep(1900, 0.08);
          handleBarcodeScan(found);
          return;
        }
      }
      showToast('err', 'Barcode scan nahi hua. Barcode ko red line ke darmiyan layein.');
    } catch (err) {
      showToast('err', err.message || 'Scan error');
    }
  };

  /* ------------------ Sales Scanner: Photo or Code Read ------------------ */
  const handleSalePhotoOrCode = async () => {
    const v = videoRef.current;
    if (!v) return;
    setAnalyzingSale(true);
    try {
      // 1. Check if barcode is readable in current frame
      const reader = await createBarcodeReader().catch(() => null);
      if (reader) {
        const code = await reader(v).catch(() => null);
        if (code) {
          beep(1900, 0.08);
          await handleSaleScan(code);
          setAnalyzingSale(false);
          return;
        }
      }

      // 2. If no barcode, grab frame and read medicine packaging via AI
      const dataUrl = grabFrame(v);
      if (!dataUrl) throw new Error('Tasveer capture nahi ho saki');

      const res = await api('/scan/read', {
        method: 'POST',
        token: activeToken,
        body: { image: dataUrl },
      });

      if (res.medicine?.name) {
        beep(2200, 0.12);
        const medName = res.medicine.name;
        // Search in local store catalog
        const sRes = await api(`/products/search?q=${encodeURIComponent(medName)}`, { token: activeToken }).catch(() => null);
        if (sRes?.products?.length) {
          const prod = sRes.products[0];
          if (socketRef.current?.connected) {
            socketRef.current.emit('scan', { mode: 'sale', barcode: prod.barcode || prod.name, product: prod, name: prod.name });
          }
          setSaleLogs((logs) => [
            {
              id: Date.now() + Math.random(),
              code: prod.barcode || 'AI_NAME',
              name: `${prod.name} ${prod.strength || ''}`.trim(),
              price: prod.mrp,
              time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            },
            ...logs,
          ].slice(0, 25));
          showToast('ok', `✅ "${prod.name}" counter bill mein add ho gayi!`);
        } else {
          if (socketRef.current?.connected) {
            socketRef.current.emit('scan', { mode: 'sale', name: medName });
          }
          showToast('ok', `Dawai: "${medName}" counter search mein bhej di gayi`);
        }
      } else {
        throw new Error('Dawai ka naam ya barcode nahi parha ja saka. Kripya packaging saaf dikhayein.');
      }
    } catch (err) {
      showToast('err', err.message || 'Scan error');
    } finally {
      setAnalyzingSale(false);
    }
  };

  const handleSaleScan = async (code) => {
    // Send to POS via socket or API lookup
    let productName = 'Dawai dhoondi ja rahi hai...';
    let productPrice = null;
    try {
      const res = await api(`/products/search?q=${encodeURIComponent(code)}`, { token: activeToken });
      if (res.exact && res.products?.length) {
        const p = res.products[0];
        productName = `${p.name} ${p.strength || ''}`.trim();
        productPrice = p.mrp;
      } else {
        productName = 'Ye dawai system mein nahi hai';
      }
    } catch {
      productName = 'Product lookup nahi ho saka';
    }

    if (socketRef.current?.connected) {
      socketRef.current.emit('scan', { mode: 'sale', barcode: code });
    }

    setSaleLogs((logs) => [
      {
        id: Date.now() + Math.random(),
        code,
        name: productName,
        price: productPrice,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      },
      ...logs,
    ].slice(0, 25));

    showToast('ok', `POS Sale Scan: ${code}`);
  };

  /* ------------------ Form Helpers & Calculations ------------------ */
  const setField = (k) => (e) => {
    const v = e.target.value;
    setF((prev) => ({ ...prev, [k]: v }));
    if (formErr) setFormErr('');
  };

  // Sequential Multiplicative Discount Model
  const mrpN = Number(digits(f.mrp)) || 0;
  const tpPctN = Number(digits(f.tp_pct)) || 0;
  const extraPctN = Number(digits(f.extra_discount_pct)) || 0;

  // Step 1: TP Discount on MRP
  const tpDiscountAmount = Math.round(mrpN * (tpPctN / 100) * 100) / 100;
  const amountAfterTp = Math.round((mrpN - tpDiscountAmount) * 100) / 100;

  // Step 2: Extra Discount on Amount After TP
  const extraDiscountAmount = Math.round(amountAfterTp * (extraPctN / 100) * 100) / 100;

  // Step 3: Final Purchase Cost
  const purchaseCostPerPack = mrpN > 0 ? Math.max(0, Math.round((amountAfterTp - extraDiscountAmount) * 100) / 100) : 0;

  // Profit calculations
  const profitPerPack = mrpN > 0 ? Math.max(0, Math.round((mrpN - purchaseCostPerPack) * 100) / 100) : 0;
  const marginPct = mrpN > 0 ? (profitPerPack / mrpN) * 100 : 0;
  const markupPct = purchaseCostPerPack > 0 ? (profitPerPack / purchaseCostPerPack) * 100 : 0;
  const effectiveDiscountPct = mrpN > 0 ? Math.round(((mrpN - purchaseCostPerPack) / mrpN) * 10000) / 100 : 0;

  const qtyN = Math.max(0, parseFloat(digits(f.stock)) || 0);
  const totalStockCost = Math.round(purchaseCostPerPack * qtyN * 100) / 100;
  const totalStockProfit = Math.round(profitPerPack * qtyN * 100) / 100;

  const stripsPerBoxN = Math.max(1, parseInt(digits(f.strips_per_box), 10) || 1);
  const sellingPricePerStrip = mrpN > 0 ? Math.round((mrpN / stripsPerBoxN) * 100) / 100 : 0;
  const purchaseCostPerStrip = purchaseCostPerPack > 0 ? Math.round((purchaseCostPerPack / stripsPerBoxN) * 100) / 100 : 0;
  const profitPerStrip = sellingPricePerStrip > 0 ? Math.max(0, Math.round((sellingPricePerStrip - purchaseCostPerStrip) * 100) / 100) : 0;
  const totalStripsInStock = Math.round(qtyN * stripsPerBoxN);

  /* ------------------ Save Actions ------------------ */
  const validateForm = () => {
    if (!String(f.name).trim()) {
      setFormErr('Dawai ka naam likhna zaroori hai');
      return false;
    }
    if (!(mrpN > 0)) {
      setFormErr('MRP (0 se zyada) likhein');
      return false;
    }
    if (tpPctN < 0 || tpPctN > 100) {
      setFormErr('TP Discount 0% aur 100% ke darmiyan ho');
      return false;
    }
    if (extraPctN < 0 || extraPctN > 100) {
      setFormErr('Extra Discount 0% aur 100% ke darmiyan ho');
      return false;
    }
    return true;
  };

  const saveProduct = async (addNext = false) => {
    if (!validateForm()) return;
    setSaving(true);
    setFormErr('');

    const calculatedTp = purchaseCostPerPack.toFixed(2);
    const payload = {
      name: f.name.trim(),
      strength: f.strength.trim(),
      form: f.form,
      pack_size: f.pack_size.trim(),
      strips_per_box: stripsPerBoxN,
      company: f.company.trim(),
      barcode: f.barcode.trim(),
      barcode_strip: f.barcode_strip ? f.barcode_strip.trim() : '',
      barcode_alt: f.barcode_alt ? f.barcode_alt.trim() : '',
      mrp: mrpN,
      tp_pct: tpPctN,
      extra_discount_pct: extraPctN,
      tp: calculatedTp,
      stock: qtyN,
      low_stock_level: parseInt(f.low_stock_level, 10) || 5,
      batch_no: f.batch_no.trim(),
      expiry_date: f.expiry_date.trim(),
    };

    // If offline, store in local pending queue
    if (!navigator.onLine) {
      const q = getOfflineQueue();
      q.push({
        id: Date.now() + Math.random(),
        client_id: `client_${Date.now()}`,
        payload,
        created_at: new Date().toISOString(),
      });
      setOfflineQueue(q);
      setOfflineCount(q.length);
      setSaving(false);
      showToast('ok', `Offline: "${payload.name}" phone mein mehfooz ho gayi. Internet aane par sync hogi.`);

      if (addNext) {
        setF({
          ...EMPTY_FORM,
          low_stock_level: f.low_stock_level || '5',
          tp_pct: '14.5',
          extra_discount_pct: '0',
        });
      }
      return;
    }

    try {
      const res = await api('/products', {
        method: 'POST',
        token: activeToken,
        body: payload,
      });

      beep(2100, 0.1);
      const savedName = res.product?.name || payload.name;
      setSavedSuccessBanner(`"${savedName}" kamyabi se Central Database mein save ho gayi!`);
      showToast('ok', `"${savedName}" Central Database mein save ho gayi!`);

      if (addNext) {
        // Reset form for next medicine, preserving defaults
        setF({
          ...EMPTY_FORM,
          low_stock_level: f.low_stock_level || '5',
          tp_pct: '14.5',
          extra_discount_pct: '0',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Stay on form or show clear status
        setTimeout(() => setSavedSuccessBanner(''), 6000);
      }
    } catch (e) {
      // If network failure during request, enqueue
      if (e.code === 'NETWORK' || !navigator.onLine) {
        const q = getOfflineQueue();
        q.push({ id: Date.now(), payload, created_at: new Date().toISOString() });
        setOfflineQueue(q);
        setOfflineCount(q.length);
        showToast('ok', `Offline: "${payload.name}" phone mein mehfooz ho gayi.`);
      } else {
        setFormErr(e.message || 'Dawai save nahi ho saki');
        showToast('err', e.message || 'Save error');
      }
    } finally {
      setSaving(false);
    }
  };

  /* ------------------ Render: Login Screen (If Not Authenticated) ------------------ */
  if (!activeToken) {
    return (
      <div className="sc sc-connect">
        <div className="sc-brand">
          <img src="/typos-mark.png" alt="TYPOS" />
          <div>
            <b>TYPOS Mobile POS</b>
            <small>Direct Medicine Entry &amp; 3 Scanners</small>
          </div>
        </div>

        <div className="card sc-pair" style={{ padding: '20px 18px' }}>
          {/* Tab Selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
            <button
              className={`btn ${authMode === 'pin' ? 'btn-pr' : 'btn-sc'}`}
              style={{ height: 38, fontSize: 13 }}
              onClick={() => { setAuthMode('pin'); setAuthError(''); }}
            >
              Direct Store Login
            </button>
            <button
              className={`btn ${authMode === 'pair' ? 'btn-pr' : 'btn-sc'}`}
              style={{ height: 38, fontSize: 13 }}
              onClick={() => { setAuthMode('pair'); setAuthError(''); }}
            >
              Counter Pair Code
            </button>
          </div>

          {authMode === 'pin' ? (
            <form onSubmit={handleStoreLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'left' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', display: 'block', marginBottom: 4 }}>
                  License Key
                </label>
                <input
                  className="inp"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}
                  placeholder="TYP-XXXX-XXXX"
                  value={loginKey}
                  onChange={(e) => setLoginKey(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div style={{ textAlign: 'left' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', display: 'block', marginBottom: 4 }}>
                  4-Digit Store PIN
                </label>
                <input
                  className="inp"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: 20, fontWeight: 700 }}
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>

              {authError && <div className="err" style={{ textAlign: 'left', marginTop: 4 }}>{authError}</div>}

              <button
                type="submit"
                className="btn btn-pr btn-lg w100"
                style={{ height: 48, fontSize: 15, marginTop: 6 }}
                disabled={authBusy || !loginKey || loginPin.length !== 4}
              >
                {authBusy ? <Spinner /> : 'Login Karein (Session Mehfooz Rahega)'}
              </button>
              <small style={{ color: 'var(--t3)', fontSize: 11.5 }}>
                Ek dafa login hone ke baad phone par session hamesha mehfooz rehta hai.
              </small>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); handlePairClaim(pairCode); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ color: 'var(--t2)', fontSize: 13, margin: '0 0 10px' }}>
                Desktop par <b>Phone &amp; Settings</b> se 6-digit pairing code likhein:
              </p>
              <input
                className="sc-code"
                type="tel"
                inputMode="numeric"
                maxLength={6}
                value={pairCode}
                placeholder="000000"
                autoFocus
                onChange={(e) => setPairCode(e.target.value.replace(/\D/g, ''))}
              />
              {authError && <div className="err">{authError}</div>}
              <button
                type="submit"
                className="btn btn-pr btn-lg w100"
                style={{ height: 48, fontSize: 15 }}
                disabled={authBusy || pairCode.length !== 6}
              >
                {authBusy ? <Spinner /> : 'Connect Karein'}
              </button>
            </form>
          )}
        </div>

        <InstallApp className="btn btn-sc btn-lg w100" />
        <Link to="/login" className="sc-link">Full Desktop POS View</Link>
      </div>
    );
  }

  /* ------------------ Render: Main Mobile Medicine Entry & Scanner View ------------------ */
  return (
    <div className="sc">
      {/* Header with Store Info, Network Status, Offline Queue Badge & Logout */}
      <header className="sc-top">
        <div className="sc-store">
          <b>{session?.store?.name || 'Medical Store POS'}</b>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <small className={isOnline ? 'on' : 'off'}>
              <i />
              {isOnline ? (socketOnline ? 'Cloud Synced' : 'Online') : 'Offline Mode'}
            </small>
            {offlineCount > 0 && (
              <span
                className="sc-sync-pill"
                onClick={syncPendingQueue}
                style={{ cursor: 'pointer' }}
                title="Pending sync entries"
              >
                🔄 {offlineCount} Pending {syncingQueue ? '...' : ''}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="sc-out" onClick={() => logout('Aap logout ho gaye hain.')}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Tabs: Medicine Entry vs Sales Scanner */}
      <div className="sc-seg" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'add'}
          className={tab === 'add' ? 'on' : ''}
          onClick={() => { setTab('add'); stopCameraScanner(); }}
        >
          <Icon name="plus" className="ic-sm" />
          Nayi Dawai
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sale'}
          className={tab === 'sale' ? 'on' : ''}
          onClick={() => { setTab('sale'); stopCameraScanner(); }}
        >
          <Icon name="cart" className="ic-sm" />
          Sales Scanner
        </button>
      </div>

      {/* Toast Notification Banner */}
      {toastMsg && (
        <div
          className={toastMsg.type === 'err' ? 'err' : 'ok-box'}
          style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Icon name={toastMsg.type === 'err' ? 'alert' : 'check'} className="ic-sm" />
          <span style={{ flex: 1, fontSize: 13 }}>{toastMsg.text}</span>
        </div>
      )}

      {/* Success Banner when medicine saved */}
      {savedSuccessBanner && (
        <div className="ok-box" style={{ marginBottom: 12, padding: '12px 14px' }}>
          <b style={{ display: 'block', fontSize: 13.5 }}>{savedSuccessBanner}</b>
          <div style={{ fontSize: 12, marginTop: 2, opacity: 0.9 }}>
            Desktop app aur inventory mein foran update ho gayi hai.
          </div>
        </div>
      )}

      {/* ---------------- TAB 1: Mobile Medicine Entry (2 Scanner Options) ---------------- */}
      {tab === 'add' && (
        <>
          {/* ---------------- 2 Scanner Options (Default Open Camera View) ---------------- */}
          <div className="sc-sec-title">
            <Icon name="scan" className="ic-sm" />
            <span>Medicine Scanners</span>
          </div>

          {/* 2-Scanner Mode Switcher */}
          <div className="sc-seg" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={medScanMode === 'image' ? 'on' : ''}
              onClick={() => setMedScanMode('image')}
            >
              <Icon name="camera" className="ic-sm" />
              Scan Image
            </button>
            <button
              type="button"
              className={medScanMode === 'barcode' ? 'on' : ''}
              onClick={() => setMedScanMode('barcode')}
            >
              <Icon name="scan" className="ic-sm" />
              Scan QR
            </button>
          </div>

          {/* Embedded Camera Viewfinder (Open by Default) */}
          <div className="sc-cam" style={{ position: 'relative', marginBottom: 12 }}>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {camOn && medScanMode === 'barcode' && <div className="sc-frame" />}
            {camOn && medScanMode === 'barcode' && <div className="sc-laser" />}
            {camOn && medScanMode === 'image' && (
              <div className="sc-frame" style={{ inset: '12% 6%', borderRadius: 16 }} />
            )}
            {torch !== null && (
              <div className="sc-tools">
                <button type="button" className={torch ? 'on' : ''} onClick={toggleTorch}>
                  {torch ? 'Torch ON' : 'Torch'}
                </button>
              </div>
            )}
            {camError && (
              <div className="sc-off">
                <p>{camError}</p>
                <button
                  type="button"
                  className="btn btn-pr btn-sm"
                  onClick={() => startCameraScanner(medScanMode)}
                >
                  Camera Kholein
                </button>
              </div>
            )}
            <div className="sc-hint">
              {medScanMode === 'image'
                ? 'Dawai packaging samne rakhein aur Shutter dabayein'
                : 'Barcode ya QR code ko red line ke darmiyan layein'}
            </div>
          </div>

          {/* Action Buttons Directly Under Camera */}
          <div style={{ marginBottom: 16 }}>
            {medScanMode === 'image' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-pr"
                  style={{ width: '100%', height: 50, fontSize: 15, fontWeight: 700, borderRadius: 12 }}
                  disabled={analyzingImage || !camOn}
                  onClick={handleCaptureAndAnalyze}
                >
                  {analyzingImage ? (
                    <>
                      <Spinner />
                      <span>AI Packaging Parh Raha Hai...</span>
                    </>
                  ) : (
                    <>
                      <Icon name="camera" className="ic-sm" />
                      <span>Take Picture &amp; Auto-Fill Details</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-sc"
                  style={{ height: 38, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="upload" className="ic-sm" />
                  <span>Photo Upload / Gallery Se Chunein</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleFileSelected}
                />
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="btn btn-pr"
                  style={{ width: '100%', height: 50, fontSize: 15, fontWeight: 700, borderRadius: 12, background: '#2563eb', borderColor: '#1d4ed8' }}
                  onClick={handleManualBarcodeScan}
                >
                  <Icon name="scan" className="ic-sm" />
                  <span>Scan / Read Barcode Now</span>
                </button>
              </div>
            )}
          </div>

          {/* STEP 2: Medicine Information Form */}
          <div className="sc-sec-title">
            <Icon name="pill" className="ic-sm" />
            <span>Medicine Information Form</span>
          </div>

          <div className="sc-mobile-form">
            <div className="sc-field">
              <label>Dawai Ka Naam *</label>
              <input
                className="inp"
                value={f.name}
                onChange={setField('name')}
                placeholder="e.g. Panadol, Augmentin, Brufen"
                required
              />
            </div>

            <div className="sc-grid-2">
              <div className="sc-field">
                <label>Strength / MG</label>
                <input
                  className="inp"
                  value={f.strength}
                  onChange={setField('strength')}
                  placeholder="500 mg"
                />
              </div>
              <div className="sc-field">
                <label>Type / Form</label>
                <select className="inp" value={f.form} onChange={setField('form')}>
                  {Object.entries(FORMS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sc-field">
              <label>Barcode / QR Code</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="inp"
                  value={f.barcode}
                  onChange={setField('barcode')}
                  placeholder="Scan karein ya number likhein..."
                />
                <button
                  type="button"
                  className="btn btn-pr"
                  style={{ height: 46, padding: '0 14px', flex: 'none', background: '#2563eb', borderColor: '#1d4ed8' }}
                  onClick={() => startCameraScanner('barcode')}
                  title="Camera Barcode Scanner"
                >
                  <Icon name="scan" className="ic-sm" />
                  Scan
                </button>
                {f.barcode && (
                  <button
                    type="button"
                    className="btn btn-sc"
                    style={{ height: 46, padding: '0 10px', flex: 'none', color: '#dc2626' }}
                    onClick={() => setF((p) => ({ ...p, barcode: '' }))}
                    title="Clear"
                  >
                    <Icon name="x" className="ic-sm" />
                  </button>
                )}
              </div>
            </div>

            <div className="sc-grid-2">
              <div className="sc-field">
                <label>Pack Size</label>
                <input
                  className="inp"
                  value={f.pack_size}
                  onChange={setField('pack_size')}
                  placeholder="10x10 tablets"
                />
              </div>
              <div className="sc-field">
                <label>Company</label>
                <input
                  className="inp"
                  value={f.company}
                  onChange={setField('company')}
                  placeholder="GSK, Abbott, etc."
                />
              </div>
            </div>

            <div className="sc-grid-2">
              <div className="sc-field">
                <label>Batch #</label>
                <input
                  className="inp"
                  value={f.batch_no}
                  onChange={setField('batch_no')}
                  placeholder="Batch #"
                />
              </div>
              <div className="sc-field">
                <label>Expiry (MM/YYYY)</label>
                <input
                  className="inp"
                  value={f.expiry_date}
                  onChange={setField('expiry_date')}
                  placeholder="08/2028"
                />
              </div>
            </div>
          </div>

          {/* STEP 3: Pricing & Stock (with Live Additive Calculations) */}
          <div className="sc-sec-title">
            <Icon name="tag" className="ic-sm" />
            <span>Step 3: Price aur Stock</span>
          </div>

          <div className="sc-mobile-form">
            <div className="sc-field">
              <label>MRP (Per Pack) *</label>
              <input
                className="inp"
                inputMode="decimal"
                value={f.mrp}
                onChange={setField('mrp')}
                placeholder="Retail Price (e.g. 100)"
                required
              />
            </div>

            <div className="sc-grid-2">
              <div className="sc-field sc-field-yellow">
                <label style={{ color: '#854d0e', fontWeight: 600 }}>TP (%)</label>
                <input
                  className="inp"
                  inputMode="decimal"
                  value={f.tp_pct}
                  onChange={setField('tp_pct')}
                  placeholder="14.5"
                />
              </div>
              <div className="sc-field sc-field-orange">
                <label style={{ color: '#9a3412', fontWeight: 600 }}>Extra Discount (%)</label>
                <input
                  className="inp"
                  inputMode="decimal"
                  value={f.extra_discount_pct}
                  onChange={setField('extra_discount_pct')}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="sc-grid-2">
              <div className="sc-field">
                <label>Strips per Box (Pattay)</label>
                <input
                  className="inp"
                  inputMode="numeric"
                  value={f.strips_per_box}
                  onChange={setField('strips_per_box')}
                  placeholder="1"
                />
              </div>
              <div className="sc-field">
                <label>Quantity (Boxes)</label>
                <input
                  className="inp"
                  inputMode="decimal"
                  value={f.stock}
                  onChange={setField('stock')}
                  placeholder="0"
                />
              </div>
              <div className="sc-field" style={{ gridColumn: '1 / -1' }}>
                <label>Low Stock Level (Boxes)</label>
                <input
                  className="inp"
                  inputMode="numeric"
                  value={f.low_stock_level}
                  onChange={setField('low_stock_level')}
                  placeholder="5"
                />
              </div>
            </div>

            {/* Live Profit & Purchase Cost Calculation Panel */}
            {mrpN > 0 && (
              <div className="sc-calc-panel">
                <div className="sc-calc-head">
                  <span>Hisaab Kitab &amp; Profit (Live)</span>
                  <span style={{ color: '#047857', fontWeight: 700 }}>
                    Eff Disc: {effectiveDiscountPct}%
                  </span>
                </div>
                <div className="sc-calc-grid">
                  <div className="sc-calc-tile">
                    <div className="sc-calc-lbl">TP Discount Amount</div>
                    <div className="sc-calc-val">{rs2(tpDiscountAmount)}</div>
                    <div className="sc-calc-sub">{tpPctN}% of MRP</div>
                  </div>

                  <div className="sc-calc-tile">
                    <div className="sc-calc-lbl">Amount After TP</div>
                    <div className="sc-calc-val">{rs2(amountAfterTp)}</div>
                    <div className="sc-calc-sub">MRP − TP Discount</div>
                  </div>

                  <div className="sc-calc-tile">
                    <div className="sc-calc-lbl">Extra Discount Amount</div>
                    <div className="sc-calc-val">{rs2(extraDiscountAmount)}</div>
                    <div className="sc-calc-sub">{extraPctN}% of After-TP</div>
                  </div>

                  <div className="sc-calc-tile amber">
                    <div className="sc-calc-lbl">Final Purchase Cost</div>
                    <div className="sc-calc-val" style={{ color: '#854d0e' }}>
                      {rs2(purchaseCostPerPack)}
                    </div>
                    <div className="sc-calc-sub">Asal khareed qeemat</div>
                  </div>

                  <div className="sc-calc-tile green">
                    <div className="sc-calc-lbl">Profit / Pack</div>
                    <div className="sc-calc-val" style={{ color: '#15803d' }}>
                      {rs2(profitPerPack)}
                    </div>
                    <div className="sc-calc-sub">
                      Margin {marginPct.toFixed(1)}% · Markup {markupPct.toFixed(1)}%
                    </div>
                  </div>

                  <div className="sc-calc-tile">
                    <div className="sc-calc-lbl">Total Stock Cost</div>
                    <div className="sc-calc-val">
                      {rs2(totalStockCost)}
                    </div>
                    <div className="sc-calc-sub">{qtyN} packs ki lagat</div>
                  </div>

                  <div className="sc-calc-tile green">
                    <div className="sc-calc-lbl">Expected Total Profit</div>
                    <div className="sc-calc-val" style={{ color: '#047857' }}>
                      {rs2(totalStockProfit)}
                    </div>
                    <div className="sc-calc-sub">Poora stock bikne par</div>
                  </div>

                  {stripsPerBoxN > 1 && (
                    <div className="sc-calc-tile" style={{ gridColumn: '1 / -1', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                      <div className="sc-calc-lbl" style={{ color: '#1e40af', fontWeight: 700 }}>
                        Strip / Patta Packaging ({stripsPerBoxN} strips/box)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6, fontSize: 12 }}>
                        <div>Sale/Strip: <b style={{ color: '#1d4ed8' }}>{rs2(sellingPricePerStrip)}</b></div>
                        <div>Cost/Strip: <b style={{ color: '#475569' }}>{rs2(purchaseCostPerStrip)}</b></div>
                        <div>Munafa/Strip: <b style={{ color: '#15803d' }}>{rs2(profitPerStrip)}</b></div>
                        <div>Total Strips: <b>{totalStripsInStock}</b></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {formErr && <div className="err" style={{ marginTop: 12 }}>{formErr}</div>}

          {/* STEP 4: Save Actions (Single Full-Width Mobile Responsive Button) */}
          <div className="sc-sticky-footer">
            <button
              type="button"
              className="btn btn-pr sc-btn-next"
              disabled={saving}
              onClick={() => saveProduct(true)}
            >
              {saving ? <Spinner /> : <Icon name="plus" className="ic-sm" />}
              <span>Save &amp; Add Next</span>
            </button>
          </div>
        </>
      )}

      {/* ---------------- TAB 2: Separate POS Sales Scanner (Default Open Camera) ---------------- */}
      {tab === 'sale' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ marginBottom: 10 }}>
              <b style={{ fontSize: 15, display: 'block' }}>POS Sales Scanner</b>
              <small style={{ color: 'var(--t2)', fontSize: 12 }}>
                Dawai ka barcode dikhayein ya packaging ki photo lein, counter ke bill mein foran add hoga
              </small>
            </div>

            {/* Embedded Live Camera for Sales (Open by Default) */}
            <div className="sc-cam" style={{ position: 'relative', marginBottom: 12 }}>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {camOn && <div className="sc-frame" />}
              {camOn && <div className="sc-laser" />}
              {torch !== null && (
                <div className="sc-tools">
                  <button type="button" className={torch ? 'on' : ''} onClick={toggleTorch}>
                    {torch ? 'Torch ON' : 'Torch'}
                  </button>
                </div>
              )}
              {camError && (
                <div className="sc-off">
                  <p>{camError}</p>
                  <button
                    type="button"
                    className="btn btn-pr btn-sm"
                    onClick={() => startCameraScanner('sale')}
                  >
                    Camera Dobara Kholein
                  </button>
                </div>
              )}
              <div className="sc-hint">Barcode dikhayein ya Take Picture dabayein</div>
            </div>

            {/* Take Picture / Scan Button Under Camera */}
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-pr"
                style={{ width: '100%', height: 50, fontSize: 15, fontWeight: 700, borderRadius: 12 }}
                disabled={analyzingSale || !camOn}
                onClick={handleSalePhotoOrCode}
              >
                {analyzingSale ? (
                  <>
                    <Spinner />
                    <span>Dawai Check Ho Rahi Hai...</span>
                  </>
                ) : (
                  <>
                    <Icon name="camera" className="ic-sm" />
                    <span>Take Picture / Scan (Code ya Naam)</span>
                  </>
                )}
              </button>
            </div>

            {/* Manual sale entry input */}
            <form
              className="sc-manual"
              onSubmit={(e) => {
                e.preventDefault();
                const c = saleManualCode.trim();
                if (c) handleSaleScan(c);
                setSaleManualCode('');
              }}
            >
              <input
                className="inp"
                value={saleManualCode}
                onChange={(e) => setSaleManualCode(e.target.value)}
                placeholder="Barcode number likhein..."
              />
              <button className="btn btn-pr" disabled={!saleManualCode.trim()}>
                Sale Mein Bhejein
              </button>
            </form>
          </div>

          {/* Recent Scanned Log */}
          <div className="card sc-log">
            <div className="sc-log-h">
              <b>Abhi Scan Hui Dawaiyan ({saleLogs.length})</b>
              {saleLogs.length > 0 && <button onClick={() => setSaleLogs([])}>Saaf Karein</button>}
            </div>
            {saleLogs.length === 0 ? (
              <p>Scan ki hui dawaiyan yahan nazar aayengi</p>
            ) : (
              saleLogs.map((r) => (
                <div key={r.id} className="sc-row">
                  <div>
                    <b>{r.name}</b>
                    <small>{r.code}</small>
                  </div>
                  <div className="r">
                    {r.price ? <b>Rs {r.price}</b> : null}
                    <small>{r.time}</small>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
