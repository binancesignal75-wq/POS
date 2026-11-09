import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { loadSession, saveSession, me } from './src/api';
import ConnectScreen from './src/screens/ConnectScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import { C } from './src/theme';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [notice, setNotice] = useState('');

  useEffect(() => {
    (async () => {
      const s = await loadSession();
      if (!s) return setSession(null);
      try {
        const r = await me(s);
        const fresh = { ...s, store: r.store };
        await saveSession(fresh);
        setSession(fresh);
      } catch (e) {
        if (e.network) setSession(s); // offline — purana session rakho, socket khud reconnect karega
        else { await saveSession(null); setNotice(e.message); setSession(null); }
      }
    })();
  }, []);

  const onConnected = async (s) => { await saveSession(s); setNotice(''); setSession(s); };
  const onLogout = async (msg) => { await saveSession(null); setNotice(msg || ''); setSession(null); };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {session === undefined ? (
        <View style={{ flex: 1, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={require('./assets/logo.png')} style={{ width: 160, height: 160, borderRadius: 32 }} />
          <ActivityIndicator color="#7fe03a" style={{ marginTop: 24 }} />
          <Text style={{ color: '#9fb6bf', marginTop: 10 }}>TYPOS Scanner</Text>
        </View>
      ) : session ? (
        <ScannerScreen session={session} onLogout={onLogout} />
      ) : (
        <ConnectScreen onConnected={onConnected} notice={notice} />
      )}
    </SafeAreaProvider>
  );
}
