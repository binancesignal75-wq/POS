/**
 * POS / New Sale
 *  - USB barcode gun ya keyboard: search box mein scan + Enter
 *  - Mobile scanner (sale mode): khud bill mein add
 *  - Code na ho: naam likh kar list se chunein
 *  - F9 = Save & Print
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUi } from '../context/UiContext';
import { useScan, useScanner } from '../context/ScannerContext';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { MedCell, StoreLogo, Spinner, Expiry } from '../components/ui';
import { printReceipt } from '../utils/receipt';
import { beep } from '../utils/scanCamera';
import { rs, rs2, dateTime, PAYMENTS, daysUntil, FORMS, getStripsPerBox, formatBoxStripStock } from '../utils/format';

const round2 = (n) => Math.round(n * 100) / 100;

export default function Pos() {
  const { store } = useAuth();
  const { toast } = useUi();
  const loc = useLocation();
  const nav = useNavigate();
  const [cart, setCart] = useState([]); // {p, qty}
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [act, setAct] = useState(0);
  const [disc, setDisc] = useState('');
  const [given, setGiven] = useState('');
  const [busy, setBusy] = useState(false);
  const [billNo, setBillNo] = useState(null);
  const [heldScan, setHeldScan] = useState(null); // bill chalte waqt phone se nayi dawai aayi
  const { openScan } = useScanner();
  const inp = useRef(null);
  const timer = useRef(null);
  const lastQ = useRef('');

  useEffect(() => { api('/sales/next-bill-no').then((r) => setBillNo(r.bill_no)).catch(() => {}); }, []);

  const add = (p, qty = 1, unit = null) => {
    if (Number(p.stock) <= 0) { toast(`${p.name} ka stock khatam hai`, 'err'); return false; }
    const spb = getStripsPerBox(p);
    const preferredUnit = unit || (p.matched_unit === 'strip' ? 'strip' : 'box');
    const actualUnit = (preferredUnit === 'strip' && spb > 1) ? 'strip' : 'box';
    const maxStrips = Math.max(0, Math.round(Number(p.stock || 0) * spb));

    let added = false;
    setCart((c) => {
      const currentUsedStrips = c.reduce((acc, x) => {
        if (x.p.id !== p.id) return acc;
        const s = getStripsPerBox(x.p);
        return acc + (x.unit === 'strip' ? x.qty : x.qty * s);
      }, 0);

      const neededStrips = actualUnit === 'strip' ? qty : qty * spb;
      if (currentUsedStrips + neededStrips > maxStrips) {
        const leftStrips = Math.max(0, maxStrips - currentUsedStrips);
        if (spb > 1) {
          toast(`Stock mein sirf ${formatBoxStripStock(leftStrips / spb, spb)} baqi hain`, 'err');
        } else {
          toast(`Stock sirf ${formatBoxStripStock(p.stock, 1)} hai`, 'err');
        }
        return c;
      }

      beep();
      added = true;
      const normalizedP = { ...p, strips_per_box: spb };
      const i = c.findIndex((x) => x.p.id === p.id && x.unit === actualUnit);
      if (i >= 0) {
        const n = [...c];
        n[i] = { ...n[i], p: normalizedP, qty: n[i].qty + qty };
        return n;
      }
      return [...c, { p: normalizedP, qty, unit: actualUnit }];
    });

    const d = daysUntil(p.expiry_date);
    if (d !== null && d < 0) toast(`Dhyan: ${p.name} expire ho chuki hai`, 'err');
    return added;
  };

  // mobile scanner (sale mode)
  const fromScan = async (scan) => {
    if (scan.product) {
      const spb = getStripsPerBox(scan.product);
      const scannedUnit = scan.product.matched_unit || ((scan.barcode && scan.product.barcode_strip === scan.barcode && spb > 1) ? 'strip' : 'box');
      if (add(scan.product, 1, scannedUnit)) {
        toast(`${scan.product.name} (${scannedUnit === 'strip' ? 'Strip' : 'Box'}) bill mein add`);
      }
      return;
    }
    if (scan.barcode) {
      try {
        const r = await api('/products/search', { query: { q: scan.barcode } });
        if (r.exact && r.products?.length) {
          const p = r.products[0];
          const spb = getStripsPerBox(p);
          const scannedUnit = p.matched_unit || ((p.barcode_strip === scan.barcode && spb > 1) ? 'strip' : 'box');
          if (add(p, 1, scannedUnit)) {
            toast(`${p.name} (${scannedUnit === 'strip' ? 'Strip' : 'Box'}) bill mein add (phone)`);
          }
          return;
        }
      } catch { /* ignore */ }
      toast(`Barcode ${scan.barcode} ki dawai nahi mili`, 'err');
      return;
    }
    if (scan.name) { setQ(scan.name); search(scan.name); }
  };
  useScan((scan) => {
    if (scan.mode === 'sale') { fromScan(scan); return true; }
    if (cart.length) { setHeldScan(scan); return true; } // chalta hua bill udne na paye
    return false;
  });
  useEffect(() => {
    if (heldScan && !cart.length) { const s = heldScan; setHeldScan(null); openScan(s); }
  }, [heldScan, cart.length, openScan]);
  useEffect(() => {
    if (loc.state?.scan) { fromScan(loc.state.scan); nav('.', { replace: true, state: null }); }
  }, [loc.state]); // eslint-disable-line

  const search = async (text, enter = false) => {
    const t = text.trim();
    lastQ.current = t;
    if (!t) { setResults(null); return; }
    try {
      const r = await api('/products/search', { query: { q: t } });
      if (lastQ.current !== t) return; // purani search ka jawab baad mein aaya
      if (enter && (r.exact || r.products.length === 1)) {
        const item = r.products[0];
        add(item, 1, item.matched_unit || 'box');
        setQ('');
        setResults(null);
        return;
      }
      if (enter && !r.products.length) { toast('Dawai nahi mili', 'err'); }
      setResults(r.products); setAct(0);
    } catch (e) { toast(e.message, 'err'); }
  };

  const onType = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(v), 250);
  };

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer.current);
      // barcode gun bohat tez likhti hai: list usi text ki ho tabhi list se uthayein
      if (results?.length && results[act] && lastQ.current === q.trim()) {
        const item = results[act];
        add(item, 1, item.matched_unit || 'box');
        setQ('');
        setResults(null);
      }
      else search(q, true);
    }
    if (e.key === 'ArrowDown' && results?.length) { e.preventDefault(); setAct((a) => Math.min(results.length - 1, a + 1)); }
    if (e.key === 'ArrowUp' && results?.length) { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
    if (e.key === 'Escape') { setResults(null); }
  };

  const setQty = (i, qty) => setCart((c) => {
    const item = c[i];
    if (!item) return c;
    const n = [...c];
    if (qty < 1) return n.filter((_, k) => k !== i);

    const p = item.p;
    const spb = getStripsPerBox(p);
    const maxStrips = Math.max(0, Math.round(Number(p.stock || 0) * spb));

    const otherLinesStrips = c.reduce((acc, x, idx) => {
      if (idx === i || x.p.id !== p.id) return acc;
      const s = getStripsPerBox(x.p);
      return acc + (x.unit === 'strip' ? x.qty : x.qty * s);
    }, 0);

    const thisLineStrips = item.unit === 'strip' ? qty : qty * spb;
    if (otherLinesStrips + thisLineStrips > maxStrips) {
      const leftStrips = Math.max(0, maxStrips - otherLinesStrips);
      if (spb > 1) {
        toast(`Stock mein sirf ${formatBoxStripStock(leftStrips / spb, spb)} baqi hain`, 'err');
      } else {
        toast(`Stock sirf ${formatBoxStripStock(p.stock, 1)} hai`, 'err');
      }
      return c;
    }

    n[i] = { ...n[i], qty };
    return n;
  });

  const setLineUnit = (i, unit) => setCart((c) => {
    const item = c[i];
    if (!item || item.unit === unit) return c;
    const p = item.p;
    const spb = getStripsPerBox(p);
    if (unit === 'strip' && spb <= 1) return c;
    const maxStrips = Math.max(0, Math.round(Number(p.stock || 0) * spb));

    // Calculate other lines' strips excluding current line and any target merge line
    const targetIdx = c.findIndex((x, idx) => idx !== i && x.p.id === p.id && x.unit === unit);
    const otherLinesStrips = c.reduce((acc, x, idx) => {
      if (idx === i || idx === targetIdx || x.p.id !== p.id) return acc;
      const s = getStripsPerBox(x.p);
      return acc + (x.unit === 'strip' ? x.qty : x.qty * s);
    }, 0);

    const newTargetQty = (targetIdx >= 0 ? c[targetIdx].qty : 0) + item.qty;
    const targetStrips = unit === 'strip' ? newTargetQty : newTargetQty * spb;

    if (otherLinesStrips + targetStrips > maxStrips) {
      const leftStrips = Math.max(0, maxStrips - otherLinesStrips);
      toast(`Stock mein sirf ${formatBoxStripStock(leftStrips / spb, spb)} baqi hain`, 'err');
      return c;
    }

    const n = [...c];
    if (targetIdx >= 0) {
      n[targetIdx] = { ...n[targetIdx], qty: newTargetQty };
      return n.filter((_, idx) => idx !== i);
    }
    n[i] = { ...item, unit };
    return n;
  });

  const t = useMemo(() => {
    const sub = round2(
      cart.reduce((a, x) => {
        const spb = getStripsPerBox(x.p);
        const rate = (x.unit === 'strip' && spb > 1) ? round2(x.p.mrp / spb) : x.p.mrp;
        return a + rate * x.qty;
      }, 0)
    );
    const cost = round2(
      cart.reduce((a, x) => {
        const spb = getStripsPerBox(x.p);
        const unitCost = (x.unit === 'strip' && spb > 1) ? round2(x.p.tp / spb) : x.p.tp;
        return a + unitCost * x.qty;
      }, 0)
    );
    const discountPct = Math.min(100, Math.max(0, Number(disc) || 0));
    const discountAmount = round2(sub * (discountPct / 100));
    const total = round2(sub - discountAmount);
    const items = cart.reduce((a, x) => a + x.qty, 0);
    const profit = round2(total - cost);
    const givenNum = Number(given) || 0;
    const change = Math.max(0, givenNum > 0 ? round2(givenNum - total) : 0);
    return { sub, cost, total, discountPct, discountAmount, profit, items, change };
  }, [cart, disc, given]);

  const save = async () => {
    if (!cart.length || busy) return;
    if (Number(given) > 0 && Number(given) < t.total - 0.99) {
      toast(`Rs ${given} kam hain. Total ${rs(t.total)} hai`, 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await api('/sales', {
        method: 'POST',
        body: {
          items: cart.map((x) => ({ product_id: x.p.id, qty: x.qty, unit: x.unit || 'box' })),
          discount_pct: Number(disc) || 0,
          payment_method: 'cash',
          paid: Number(given) || t.total
        }
      });
      toast(`Bill #${r.sale.bill_no} save ho gaya — ${rs(r.sale.total)}`);
      setCart([]); setDisc(''); setGiven('');
      setBillNo(r.sale.bill_no + 1);
      inp.current?.focus();
    } catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const k = (e) => { if (e.key === 'F9') { e.preventDefault(); saveRef.current(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { inp.current?.focus(); }, []);

  return (
    <>
      <div className="ph">
        <div><h1>New Sale</h1><p>Bill #{billNo ?? '…'} · {store.name}</p></div>
        <div className="acts"><button className="btn btn-sc" onClick={() => setCart([])} disabled={!cart.length}>Clear</button></div>
      </div>
      {heldScan && (
        <div className="ok-box" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ flex: 1 }}>Phone se nayi dawai aayi{heldScan.name ? ` (${heldScan.name})` : ''}. Bill save hote hi Add Product khul jayega.</span>
          <button className="btn btn-sc btn-sm" onClick={() => setHeldScan(null)}>Chhor dein</button>
        </div>
      )}
      <div className="pos">
        <div className="card tbl-card" style={{ position: 'relative', overflow: 'visible' }}>
          <div className="scan-in">
            <div className="scan-box">
              <Icon name="scan" style={{ color: 'var(--pr)' }} />
              <input ref={inp} value={q} onChange={(e) => onType(e.target.value)} onKeyDown={onKey}
                placeholder="Barcode scan karein ya dawai ka naam likhein…" />
              <span className="kbd">Enter</span>
            </div>
          </div>
          {results && (
            <div className="results">
              {results.length === 0 && <div className="empty" style={{ padding: 20 }}>Koi dawai nahi mili</div>}
              {results.map((p, i) => {
                const spb = getStripsPerBox(p);
                const boxRate = round2(Number(p.mrp) || 0);
                const stripRate = round2(boxRate / spb);
                return (
                  <div key={p.id} className={`pos-search-item ${i === act ? 'act' : ''}`} onMouseEnter={() => setAct(i)}>
                    <button
                      type="button"
                      className="pos-search-btn"
                      onClick={() => { add(p, 1, p.matched_unit || 'box'); setQ(''); setResults(null); inp.current?.focus(); }}
                    >
                      <MedCell p={p} />
                      <span style={{ textAlign: 'right' }}>
                        <b className="t-num" style={{ display: 'block' }}>Box: {rs2(boxRate)}</b>
                        {spb > 1 && (
                          <small style={{ display: 'block', color: 'var(--pr-d)', fontWeight: 600 }}>
                            Strip: {rs2(stripRate)} · (1 Box = {spb} Strips)
                          </small>
                        )}
                        <small className={Number(p.stock) <= 0 ? 'dn' : 'muted'}>
                          {formatBoxStripStock(p.stock, spb)}
                        </small>
                      </span>
                    </button>
                    {spb > 1 && (
                      <div className="pos-search-unit-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-sc"
                          onClick={(e) => { e.stopPropagation(); add(p, 1, 'box'); setQ(''); setResults(null); inp.current?.focus(); }}
                          title="Pura dabba dalein"
                        >
                          + Box
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-pr"
                          onClick={(e) => { e.stopPropagation(); add(p, 1, 'strip'); setQ(''); setResults(null); inp.current?.focus(); }}
                          title="Patta dalein"
                        >
                          + Strip
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="pos-cart-list">
            {cart.length === 0 ? (
              <div className="pos-empty-cart">
                <div className="pos-empty-ico"><Icon name="cart" /></div>
                <b>Bill bilkul khali hai</b>
                <p>Barcode scan karein, phone se scan karein, ya upar dawai ka naam dhoondein</p>
              </div>
            ) : (
              <div className="pos-cart-table-wrap">
                {/* Clear Column Headings */}
                <div className="pos-table-head">
                  <span className="th-med">Dawai / Medicine</span>
                  <span className="th-batch">Batch &amp; Expiry</span>
                  <span className="th-rate">Rate</span>
                  <span className="th-qty">Quantity &amp; Unit</span>
                  <span className="th-total">Total</span>
                  <span className="th-act"></span>
                </div>

                <div className="pos-table-body">
                  {cart.map((x, i) => {
                    const f = FORMS[x.p.form] || FORMS.other;
                    const expDays = daysUntil(x.p.expiry_date);
                    const spb = getStripsPerBox(x.p);
                    const isStrip = x.unit === 'strip' && spb > 1;
                    const boxRate = round2(Number(x.p.mrp) || 0);
                    const stripRate = round2(boxRate / spb);
                    const unitRate = isStrip ? stripRate : boxRate;
                    const rowTotal = round2(unitRate * x.qty);
                    const subMeta = [
                      x.p.company,
                      x.p.pack_size,
                      spb > 1 ? `1 Box = ${spb} Strips` : null,
                      `Stock: ${formatBoxStripStock(x.p.stock, spb, true)}`,
                    ].filter(Boolean).join(' · ') || f.label;

                    return (
                      <div className="pos-row-item" key={`${x.p.id}_${x.unit}`}>
                        {/* Medicine Column */}
                        <div className="td-med">
                          <div className={`mi ${f.cls}`}>{f.short}</div>
                          <div className="td-med-info">
                            <b className="td-med-name" title={`${x.p.name}${x.p.strength ? ` ${x.p.strength}` : ''}`}>
                              {x.p.name}{x.p.strength ? ` ${x.p.strength}` : ''}
                            </b>
                            <span className="td-med-sub" title={subMeta}>
                              {subMeta}
                            </span>
                          </div>
                        </div>

                        {/* Batch & Expiry Column */}
                        <div className="td-batch">
                          {x.p.batch_no ? (
                            <span className="mono td-batch-pill" title={`Batch: ${x.p.batch_no}`}>#{x.p.batch_no}</span>
                          ) : (
                            <span className="muted" style={{ fontSize: 11.5 }}>—</span>
                          )}
                          {x.p.expiry_date ? (
                            <span className={`badge ${expDays !== null && expDays <= 90 ? 'b-am' : 'b-gy'}`} style={{ height: 20, fontSize: 11 }}>
                              <Expiry d={x.p.expiry_date} />
                            </span>
                          ) : null}
                        </div>

                        {/* Unit Rate Column */}
                        <div className="td-rate">
                          <span className="t-num" style={{ fontWeight: 700, fontSize: 13.5 }}>{rs2(unitRate)}</span>
                          <small style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)' }}>
                            {isStrip ? `/ strip` : `/ box`}
                          </small>
                        </div>

                        {/* Quantity & Unit Stepper Column (Unit selector directly below quantity) */}
                        <div className="td-qty">
                          <div className="pos-ic-stepper">
                            <button type="button" onClick={() => setQty(i, x.qty - 1)} title="Kam karein">−</button>
                            <input
                              type="number"
                              min="1"
                              className="pos-qty-inp t-num"
                              value={x.qty}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                if (!Number.isNaN(val) && val >= 1) setQty(i, val);
                              }}
                              title="Quantity likhein"
                            />
                            <button type="button" onClick={() => setQty(i, x.qty + 1)} title="Zyada karein">+</button>
                          </div>

                          {spb > 1 ? (
                            <div className="pos-unit-pills">
                              <button
                                type="button"
                                className={`pos-unit-pill-btn ${x.unit !== 'strip' ? 'active' : ''}`}
                                onClick={() => setLineUnit(i, 'box')}
                                title={`Box: ${rs(boxRate)}`}
                              >
                                Box ({rs(boxRate)})
                              </button>
                              <button
                                type="button"
                                className={`pos-unit-pill-btn ${x.unit === 'strip' ? 'active' : ''}`}
                                onClick={() => setLineUnit(i, 'strip')}
                                title={`Strip: ${rs(stripRate)}`}
                              >
                                Strip ({rs(stripRate)})
                              </button>
                            </div>
                          ) : (
                            <span className="pos-unit-single-badge">Box ({rs(boxRate)})</span>
                          )}
                        </div>

                        {/* Row Total Column */}
                        <div className="td-total">
                          <b className="t-num" style={{ color: 'var(--pr-d)', fontSize: 15 }}>
                            {rs2(rowTotal)}
                          </b>
                        </div>

                        {/* Action Column */}
                        <div className="td-act">
                          <button
                            type="button"
                            className="pos-ic-del"
                            title="Bill se hatayein"
                            onClick={() => setQty(i, 0)}
                          >
                            <Icon name="x" className="ic-sm" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: BILL & PAYMENT (Clean Structured Sections) */}
        <div className="card bill">
          {/* SECTION 1: Customer / Sale Information */}
          <div className="bill-h">
            <StoreLogo store={store} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 14 }}>{store.name}</b>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--pr-d)' }}>
                  Bill #{billNo ?? '…'}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>·</span>
                <small className="muted" style={{ fontSize: 11.5 }}>
                  {new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}
                </small>
              </div>
            </div>
          </div>

          <div className="bill-b">
            {/* SECTION 4: Bill Summary (Subtotal, Bill Discount %, Discount Amount, Final Payable) */}
            <div className="bill-summary-box">
              <div className="brow">
                <span>Subtotal ({t.items} items)</span>
                <b className="t-num">{rs2(t.sub)}</b>
              </div>

              {/* Bill-Level Discount */}
              <div className="brow" style={{ alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Bill Discount (%)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 110 }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    className="inp inp-sm"
                    style={{ textAlign: 'right', fontWeight: 700, padding: '4px 8px', height: 32 }}
                    placeholder="0"
                    value={disc}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || (Number(v) >= 0 && Number(v) <= 100)) {
                        setDisc(v);
                      }
                    }}
                  />
                  <span style={{ fontWeight: 700, color: 'var(--muted)', fontSize: 13 }}>%</span>
                </div>
              </div>

              {t.discountAmount > 0 && (
                <div className="brow" style={{ color: '#b91c1c' }}>
                  <span>Discount Amount ({t.discountPct}%)</span>
                  <b className="t-num">− Rs {rs2(t.discountAmount)}</b>
                </div>
              )}

              <div className="btotal">
                <span>Final Payable</span>
                <b className="t-num" style={{ color: 'var(--pr-d)', fontSize: 26, fontWeight: 800 }}>
                  {rs(t.total)}
                </b>
              </div>
            </div>

            {/* SECTION 5: Payment Information (Cash only) */}
            <div className="bill-payment-box">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="lbl">Customer ne diye</label>
                  <input
                    className="inp"
                    value={given}
                    placeholder={String(Math.round(t.total))}
                    onChange={(e) => setGiven(e.target.value.replace(/[^\d.]/g, ''))}
                  />
                </div>
                <div>
                  <label className="lbl">Wapas (Baqaya)</label>
                  <div className="inp" style={{ display: 'flex', alignItems: 'center', fontWeight: 700, background: 'var(--sub)', color: 'var(--pr-d)' }}>
                    {rs(t.change)}
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 6: Final Sale Actions (Save Sale Only - No Print) */}
            <div className="bill-actions-box">
              <button className="btn btn-pr btn-lg w100" onClick={save} disabled={!cart.length || busy}>
                {busy ? <Spinner /> : <Icon name="check" />}
                Save Sale
                <span className="kbd" style={{ background: 'transparent', color: '#dcf3c9', borderColor: 'rgba(255,255,255,.3)', marginLeft: 6 }}>
                  F9
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Purana bill dekhna / dobara print */
export function BillModal({ id, onClose }) {
  const { store } = useAuth();
  const [d, setD] = useState(null);
  useEffect(() => { api(`/sales/${id}`).then(setD).catch(() => onClose()); }, [id]); // eslint-disable-line
  return (
    <Modal title={d ? `Bill #${d.sale.bill_no}` : 'Bill'} subtitle={d && dateTime(d.sale.created_at)} onClose={onClose}
      footer={d && <><button className="btn btn-sc" onClick={onClose}>Band karein</button><button className="btn btn-pr" onClick={() => printReceipt(store, d.sale, d.items)}><Icon name="print" className="ic-sm" />Dobara print</button></>}>
      {!d ? <div className="empty"><Spinner /></div> : (
        <>
          <table>
            <thead><tr><th>Dawai</th><th className="c">Packing</th><th className="r">Rate</th><th className="c">Qty</th><th className="r">Total</th></tr></thead>
            <tbody>{d.items.map((i) => (
              <tr key={i.id}>
                <td style={{ height: 44 }}>{i.name}</td>
                <td className="c" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                  <span className={`badge ${i.unit === 'strip' ? 'b-am' : 'b-gy'}`}>
                    {i.unit === 'strip' ? 'Strip / Patta' : 'Box'}
                  </span>
                </td>
                <td className="r t-num">{rs2(i.price)}</td>
                <td className="c">{i.qty}</td>
                <td className="r t-num">{rs2(i.total)}</td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <div className="brow"><span>Subtotal</span><b>{rs2(d.sale.subtotal)}</b></div>
            {Number(d.sale.discount_pct) > 0 && (
              <div className="brow" style={{ color: '#b91c1c' }}>
                <span>Bill Discount ({d.sale.discount_pct}%)</span>
                <b>− Rs {rs2(d.sale.discount_amount || (d.sale.subtotal - d.sale.total))}</b>
              </div>
            )}
            <div className="brow"><span>Total</span><b>{rs2(d.sale.total)}</b></div>
            <div className="brow"><span>Profit</span><b style={{ color: 'var(--pr-d)' }}>{rs2(d.sale.profit)}</b></div>
            <div className="brow"><span>Payment</span><b>{PAYMENTS[d.sale.payment_method]}{d.sale.customer_name ? ` · ${d.sale.customer_name}` : ''}</b></div>
          </div>
        </>
      )}
    </Modal>
  );
}
