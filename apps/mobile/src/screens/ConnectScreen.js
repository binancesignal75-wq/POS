/**
 * Counter se connect: desktop par "Phone connect karein" ka QR scan karein
 * ya server address + 6-digit code khud likhein.
 */
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { claim } from '../api';
import { C } from '../theme';

export default function ConnectScreen({ onConnected, notice }) {
  const [perm, requestPerm] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [server, setServer] = useState('https://api.vexoraplay.site');
  const [code, setCode] = useState('');
  const [name, setName] = useState('Counter phone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(notice || '');

  const connect = async (srv, c) => {
    setErr(''); setBusy(true);
    try { onConnected(await claim(srv, c, name.trim() || 'Counter phone')); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onQr = ({ data }) => {
    if (!scanning) return;
    setScanning(false);
    try {
      const raw = String(data || '').trim();
      // 1. Agar JSON hai: {"app":"typos","s":"...","c":"..."}
      if (raw.startsWith('{')) {
        const j = JSON.parse(raw);
        if (j.app === 'typos' && j.c) {
          const srv = j.s || server;
          setServer(srv);
          setCode(j.c);
          connect(srv, j.c);
          return;
        }
      }
      // 2. Agar Web URL hai: https://vexoraplay.site/scan?code=123456&s=...
      if (raw.includes('code=') || raw.includes('/scan')) {
        const urlMatch = raw.match(/[?&]code=(\d{6})/i) || raw.match(/[?&]c=(\d{6})/i);
        const serverMatch = raw.match(/[?&]s=([^&]+)/i);
        if (urlMatch && urlMatch[1]) {
          const c = urlMatch[1];
          const srv = serverMatch ? decodeURIComponent(serverMatch[1]) : server;
          setServer(srv);
          setCode(c);
          connect(srv, c);
          return;
        }
      }
      // 3. Agar seedha 6-digit code hai
      if (/^\d{6}$/.test(raw)) {
        setCode(raw);
        connect(server, raw);
        return;
      }
      throw new Error();
    } catch { setErr('Ye TYPOS ka QR nahi hai. Desktop par "Phone connect karein" wala QR scan karein.'); }
  };

  const openScanner = async () => {
    if (!perm?.granted) { const r = await requestPerm(); if (!r.granted) { setErr('Camera ki ijazat dein'); return; } }
    setErr(''); setScanning(true);
  };

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onQr} />
        <SafeAreaView style={{ flex: 1, justifyContent: 'space-between' }}>
          <Text style={s.camHint}>Desktop wala QR frame mein rakhein</Text>
          <View style={s.frame} />
          <Pressable style={[s.btn, { margin: 20, backgroundColor: '#fff' }]} onPress={() => setScanning(false)}><Text style={[s.btnT, { color: C.t1 }]}>Wapas</Text></Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <Image source={require('../../assets/logo.png')} style={{ width: 120, height: 120, borderRadius: 28 }} />
            <Text style={s.h1}>TYPOS Scanner</Text>
            <Text style={s.sub}>Dawai ka naam aur barcode scan karke seedha counter par bhejein</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardT}>Counter se connect karein</Text>
            <Text style={s.cardS}>Desktop app mein "Phone connect karein" kholein aur wahan wala QR scan karein</Text>
            <Pressable style={s.btn} onPress={openScanner} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>QR scan karein</Text>}
            </Pressable>
          </View>

          <View style={s.card}>
            <Text style={s.cardT}>Ya khud likhein</Text>
            <Text style={s.lbl}>Server address</Text>
            <TextInput style={s.inp} value={server} onChangeText={setServer} placeholder="typos.yourdomain.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Text style={s.lbl}>6-digit code</Text>
            <TextInput style={[s.inp, { letterSpacing: 6, fontSize: 20, fontWeight: '700' }]} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="000000" />
            <Text style={s.lbl}>Is phone ka naam</Text>
            <TextInput style={s.inp} value={name} onChangeText={setName} />
            <Pressable style={[s.btn, s.btnOut, (code.length !== 6 || !server) && { opacity: 0.5 }]} disabled={busy || code.length !== 6 || !server} onPress={() => connect(server, code)}>
              <Text style={[s.btnT, { color: C.prD }]}>Connect</Text>
            </Pressable>
          </View>
          {!!err && <Text style={s.err}>{err}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '800', color: C.t1, marginTop: 16 },
  sub: { fontSize: 14, color: C.t2, textAlign: 'center', marginTop: 6, maxWidth: 300 },
  card: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.bd, padding: 18, marginTop: 18 },
  cardT: { fontSize: 16, fontWeight: '700', color: C.t1 },
  cardS: { fontSize: 13, color: C.t2, marginTop: 4, marginBottom: 14 },
  lbl: { fontSize: 12.5, fontWeight: '600', color: C.t2, marginTop: 12, marginBottom: 6 },
  inp: { height: 48, borderWidth: 1, borderColor: C.bd, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, color: C.t1, backgroundColor: '#fff' },
  btn: { height: 52, borderRadius: 14, backgroundColor: C.pr, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnOut: { backgroundColor: C.pr50, borderWidth: 1.5, borderColor: C.pr100, marginTop: 16 },
  btnT: { color: '#fff', fontWeight: '700', fontSize: 15.5 },
  err: { marginTop: 16, color: '#b91c1c', backgroundColor: C.rd50, padding: 12, borderRadius: 12, fontSize: 13.5 },
  camHint: { color: '#fff', textAlign: 'center', marginTop: 20, fontWeight: '700', fontSize: 15, backgroundColor: 'rgba(0,0,0,.45)', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  frame: { width: 250, height: 250, alignSelf: 'center', borderWidth: 3, borderColor: '#fff', borderRadius: 24 }
});
