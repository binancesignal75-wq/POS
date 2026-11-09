/**
 * Scanner — 2 mode
 *  ADD : "Naam parhein" (server AI, internet na ho to ML Kit) + "Barcode parhein" -> naam, MG, type, pack, MRP, expiry, barcode
 *        dono mil jayein to khud counter par chala jata hai (Auto send)
 *  SALE: barcode scan karte jayein -> har dawai POS bill mein
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, Vibration } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { connectSocket, sendScan, assetUrl, readMedicine } from '../api';
import { parseMedicine } from '../parse';
import { C, FORMS, FORM_LABEL } from '../theme';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'qr', 'datamatrix'];
const EMPTY = { name: '', strength: '', form: '', pack_size: '', company: '', mrp: '', batch_no: '', expiry_date: '', barcode: '' };

export default function ScannerScreen({ session, onLogout }) {
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef(null);
  const sock = useRef(null);
  const [online, setOnline] = useState(false);
  const [mode, setMode] = useState('add');
  const [f, setF] = useState(EMPTY);
  const [readingName, setReadingName] = useState(false);
  const [readingCode, setReadingCode] = useState(false);
  const [autoSend, setAutoSend] = useState(true);
  const [msg, setMsg] = useState(null); // {type, text}
  const [sending, setSending] = useState(false);
  const [saleLog, setSaleLog] = useState([]);
  const lastCode = useRef({ code: '', at: 0 });
  const store = session.store;

  useEffect(() => {
    sock.current = connectSocket(session, {
      onStatus: setOnline,
      onKicked: () => onLogout('Ye phone counter se hata diya gaya ya license band hai. Dobara connect karein.')
    });
    return () => sock.current?.disconnect();
  }, [session]); // eslint-disable-line

  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm]); // eslint-disable-line

  const flash = (type, text) => { setMsg({ type, text }); if (type !== 'err') setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 3000); };
  const reset = () => { setF(EMPTY); setMsg(null); };

  /** Pehle AI (naam, MG, MRP, expiry sab); AI na mile to phone ka apna text reader */
  const readBox = async (uri) => {
    try {
      const small = await manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.82, format: SaveFormat.JPEG, base64: true });
      const r = await readMedicine(session, `data:image/jpeg;base64,${small.base64}`);
      if (r.found) return r.medicine;
    } catch { /* neeche ML Kit */ }
    return parseMedicine(await TextRecognition.recognize(uri));
  };

  // ---------- ADD: naam parhna ----------
  const readName = async () => {
    if (!cam.current || readingName) return;
    setReadingName(true); setMsg(null);
    try {
      const photo = await cam.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      const p = await readBox(photo.uri);
      if (!p.name) { flash('err', 'Naam nahi parha gaya. Dabbi ko qareeb aur seedha rakhein.'); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const next = { ...f };
      for (const k of Object.keys(EMPTY)) if (p[k]) next[k] = p[k];
      setF(next);
      if (autoSend && next.barcode) send(next);
      else flash('ok', next.barcode ? 'Naam mil gaya' : 'Naam mil gaya — ab "Barcode parhein" dabayein (code na ho to bhej dein)');
    } catch (e) {
      flash('err', 'Camera/Text error: ' + (e.message || e));
    } finally { setReadingName(false); }
  };

  // ---------- barcode (dono mode) ----------
  const onBarcode = ({ data }) => {
    const code = String(data || '').trim();
    if (!code) return;
    const now = Date.now();
    if (lastCode.current.code === code && now - lastCode.current.at < 2500) return; // ek hi code bar bar nahi
    lastCode.current = { code, at: now };
    Vibration.vibrate(60);
    if (mode === 'sale') { sale(code); return; }
    if (!readingCode) return;
    setReadingCode(false);
    const next = { ...f, barcode: code };
    setF(next);
    if (autoSend && next.name) send(next);
    else flash('ok', next.name ? 'Barcode mil gaya' : 'Barcode mil gaya — ab "Naam parhein" dabayein');
  };

  // ---------- bhejna ----------
  const send = async (data = f) => {
    if (!data.name && !data.barcode) return;
    setSending(true);
    const ack = await sendScan(sock.current, { mode: 'add', ...data });
    setSending(false);
    if (!ack.ok) return flash('err', ack.error);
    if (!ack.delivered) return flash('err', 'Counter par TYPOS khula nahi hai');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    flash('ok', ack.product ? `"${ack.product.name}" pehle se hai — counter par khul gayi` : 'Counter ke Add Product form mein aa gaya ✓');
    setF(EMPTY);
  };

  const sale = async (code) => {
    const ack = await sendScan(sock.current, { mode: 'sale', barcode: code });
    const row = { id: Date.now(), code, ok: !!ack.product, name: ack.product ? `${ack.product.name} ${ack.product.strength || ''}` : (ack.error || 'Ye dawai system mein nahi'), price: ack.product?.mrp };
    if (!ack.product) Vibration.vibrate([0, 80, 80, 80]);
    setSaleLog((l) => [row, ...l].slice(0, 20));
  };

  const ready = !!(f.name || f.barcode);
  const logo = assetUrl(session.server, store?.logo_url);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      {/* header: dukan ka logo/naam */}
      <View style={s.top}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          {logo ? <Image source={{ uri: logo }} style={s.logo} /> : <Image source={require('../../assets/logo.png')} style={s.logo} />}
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={s.store} numberOfLines={1}>{store?.name || 'TYPOS'}</Text>
            <Text style={s.small}>{mode === 'add' ? 'Product add' : 'Sale scan'}</Text>
          </View>
        </View>
        <View style={[s.pill, { backgroundColor: online ? C.pr50 : C.rd50, borderColor: online ? C.pr100 : '#fecaca' }]}>
          <View style={[s.dot, { backgroundColor: online ? '#5cc624' : C.rd }]} />
          <Text style={{ color: online ? C.prD : '#b91c1c', fontWeight: '700', fontSize: 12 }}>{online ? 'Counter' : 'Offline'}</Text>
        </View>
      </View>

      {/* mode */}
      <View style={s.seg}>
        {[['add', 'Product add'], ['sale', 'Sale']].map(([v, l]) => (
          <Pressable key={v} style={[s.segB, mode === v && s.segOn]} onPress={() => { setMode(v); setReadingCode(false); setMsg(null); }}>
            <Text style={[s.segT, mode === v && { color: C.t1 }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {/* camera */}
      <View style={[s.cam, mode === 'sale' && { height: 260 }]}>
        {perm?.granted ? (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" autofocus="on"
            barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={mode === 'sale' || readingCode ? onBarcode : undefined} />
        ) : (
          <Pressable style={s.permBox} onPress={requestPerm}><Text style={{ color: '#fff', fontWeight: '700' }}>Camera ki ijazat dein</Text></Pressable>
        )}
        <View pointerEvents="none" style={[s.corner, { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 }]} />
        <View pointerEvents="none" style={[s.corner, { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 }]} />
        <View pointerEvents="none" style={[s.corner, { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 }]} />
        <View pointerEvents="none" style={[s.corner, { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 }]} />
        {(mode === 'sale' || readingCode) && <View pointerEvents="none" style={s.laser} />}
        <View pointerEvents="none" style={s.hintWrap}>
          <Text style={s.hint}>
            {mode === 'sale' ? 'Barcode frame mein rakhein — khud bill mein jayega'
              : readingName ? 'Naam parh raha hai…' : readingCode ? 'Barcode dhoond raha hai…' : 'Dabbi ko frame mein rakhein'}
          </Text>
        </View>
      </View>

      {mode === 'add' ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
          <View style={s.btns}>
            <Pressable style={[s.readBtn, s.rbN, f.name && s.rbNDone]} onPress={readName} disabled={readingName}>
              {readingName ? <ActivityIndicator color={f.name ? '#fff' : C.prD} /> : <Text style={[s.rbT, { color: f.name ? '#fff' : C.prD }]}>{f.name ? '✓ Naam' : 'Naam parhein'}</Text>}
            </Pressable>
            <Pressable style={[s.readBtn, s.rbB, f.barcode && s.rbBDone, readingCode && { borderColor: C.bl }]} onPress={() => { setReadingCode((r) => !r); lastCode.current = { code: '', at: 0 }; }}>
              <Text style={[s.rbT, { color: f.barcode ? '#fff' : C.bl }]}>{readingCode ? 'Ruk jayein' : f.barcode ? '✓ Barcode' : 'Barcode parhein'}</Text>
            </Pressable>
          </View>

          <View style={s.res}>
            <Row label="Naam" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
            <Row label="Strength (MG)" value={f.strength} onChange={(v) => setF({ ...f, strength: v })} />
            <View style={s.row}>
              <Text style={s.rowL}>Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ justifyContent: 'flex-end', flexGrow: 1 }}>
                {FORMS.slice(0, 6).map((x) => (
                  <Pressable key={x} onPress={() => setF({ ...f, form: x })} style={[s.chip, f.form === x && s.chipOn]}><Text style={[s.chipT, f.form === x && { color: C.prD }]}>{FORM_LABEL[x]}</Text></Pressable>
                ))}
              </ScrollView>
            </View>
            <Row label="Pack" value={f.pack_size} onChange={(v) => setF({ ...f, pack_size: v })} />
            <Row label="MRP" value={f.mrp} onChange={(v) => setF({ ...f, mrp: v })} />
            <Row label="Expiry" value={f.expiry_date} onChange={(v) => setF({ ...f, expiry_date: v })} />
            <Row label="Barcode" value={f.barcode} onChange={(v) => setF({ ...f, barcode: v })} mono last />
          </View>

          <View style={s.autoRow}>
            <Text style={{ color: C.t2, fontSize: 13, flex: 1 }}>Naam + barcode dono milte hi khud bhejein</Text>
            <Switch value={autoSend} onValueChange={setAutoSend} trackColor={{ true: C.pr100 }} thumbColor={autoSend ? C.pr : '#ccc'} />
          </View>
          {msg && <Text style={[s.msg, msg.type === 'err' ? s.msgErr : s.msgOk]}>{msg.text}</Text>}
          <Pressable style={[s.send, !ready && { backgroundColor: C.bd }]} disabled={!ready || sending} onPress={() => send()}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={[s.sendT, !ready && { color: C.t3 }]}>
              {!ready ? 'Pehle naam ya barcode parhein' : f.name && !f.barcode ? 'Sirf naam bhejein (bina code)' : 'System mein bhejein'}</Text>}
          </Pressable>
          {ready && <Pressable onPress={reset}><Text style={s.clear}>Saaf karein</Text></Pressable>}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 20 }}>
          {saleLog.length === 0 && <Text style={{ textAlign: 'center', color: C.t3, marginTop: 20 }}>Scan ki hui dawaiyan yahan dikhengi</Text>}
          {saleLog.map((r) => (
            <View key={r.id} style={[s.saleRow, !r.ok && { borderColor: '#fecaca', backgroundColor: C.rd50 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: r.ok ? C.t1 : '#b91c1c' }} numberOfLines={1}>{r.name}</Text>
                <Text style={{ color: C.t3, fontSize: 12 }}>{r.ok ? `Bill mein add · Rs ${r.price}` : r.code}</Text>
              </View>
              <Text style={{ fontSize: 18, color: r.ok ? C.pr : C.rd }}>{r.ok ? '✓' : '!'}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable onPress={() => onLogout('')} style={{ paddingVertical: 10 }}><Text style={{ textAlign: 'center', color: C.t3, fontSize: 12.5 }}>Counter se disconnect</Text></Pressable>
    </SafeAreaView>
  );
}

function Row({ label, value, onChange, mono, last }) {
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <Text style={s.rowL}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder="—" placeholderTextColor="#d0d5dd"
        style={[s.rowV, mono && { fontFamily: 'monospace' }]} />
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  logo: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff' },
  store: { fontSize: 15, fontWeight: '800', color: C.t1 },
  small: { fontSize: 12, color: C.t3 },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  seg: { flexDirection: 'row', backgroundColor: '#eceef2', borderRadius: 12, padding: 3, marginHorizontal: 12, marginBottom: 10 },
  segB: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segOn: { backgroundColor: '#fff', elevation: 1 },
  segT: { fontWeight: '700', fontSize: 13, color: C.t3 },
  cam: { height: 300, marginHorizontal: 12, borderRadius: 22, overflow: 'hidden', backgroundColor: '#1b2530' },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 30, height: 30, borderColor: '#fff', borderWidth: 3, opacity: 0.9 },
  laser: { position: 'absolute', left: 30, right: 30, top: '50%', height: 2, backgroundColor: '#f87171' },
  hintWrap: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' },
  hint: { backgroundColor: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: 'hidden' },
  btns: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  readBtn: { flex: 1, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  rbN: { backgroundColor: C.pr50, borderColor: C.pr100 },
  rbNDone: { backgroundColor: C.pr, borderColor: C.pr },
  rbB: { backgroundColor: C.bl50, borderColor: C.bl100 },
  rbBDone: { backgroundColor: C.bl, borderColor: C.bl },
  rbT: { fontWeight: '800', fontSize: 14 },
  res: { marginHorizontal: 12, marginTop: 10, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: C.bd, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f2f4f7', minHeight: 44 },
  rowL: { width: 104, color: C.t3, fontWeight: '600', fontSize: 12.5 },
  rowV: { flex: 1, textAlign: 'right', fontWeight: '700', fontSize: 14, color: C.t1, paddingVertical: 8 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.bd, marginLeft: 5 },
  chipOn: { borderColor: C.pr, backgroundColor: C.pr50 },
  chipT: { fontSize: 11.5, fontWeight: '700', color: C.t2 },
  autoRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10 },
  msg: { marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 12, fontSize: 13, fontWeight: '600', overflow: 'hidden' },
  msgOk: { backgroundColor: C.pr50, color: C.prD },
  msgErr: { backgroundColor: C.rd50, color: '#b91c1c' },
  send: { marginHorizontal: 12, marginTop: 10, height: 52, borderRadius: 16, backgroundColor: C.pr, alignItems: 'center', justifyContent: 'center' },
  sendT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  clear: { textAlign: 'center', color: C.t2, marginTop: 12, fontWeight: '600' },
  saleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.bd, borderRadius: 14, padding: 12, marginBottom: 8 }
});
