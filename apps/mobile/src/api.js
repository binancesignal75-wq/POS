import * as SecureStore from 'expo-secure-store';
import { io } from 'socket.io-client';

const KEY = 'typos_session';

export async function loadSession() {
  try { const s = await SecureStore.getItemAsync(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export async function saveSession(s) {
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
}

export const cleanServer = (s) => {
  let u = String(s || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
};

async function req(server, path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${server}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    const e = new Error('Server se rabta nahi hua. Internet ya server address check karein.');
    e.network = true;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Kuch ghalat ho gaya'); e.status = res.status; throw e; }
  return data;
}

/** QR / code se counter ke saath jorna */
export async function claim(server, code, deviceName) {
  const s = cleanServer(server);
  const r = await req(s, '/pair/claim', { method: 'POST', body: { code, device_name: deviceName } });
  return { server: s, token: r.token, store: r.store };
}

/** Dabbi ki tasveer server ke AI ko (Groq key sirf server par hai) */
export const readMedicine = (session, dataUrl) =>
  req(session.server, '/scan/read', { method: 'POST', token: session.token, body: { image: dataUrl } });

export const me = (session) => req(session.server, '/pair/device/me', { token: session.token });

export function connectSocket(session, handlers) {
  const s = io(session.server, { auth: { token: session.token }, transports: ['websocket', 'polling'], reconnectionDelay: 1500 });
  s.on('connect', () => handlers.onStatus?.(true));
  s.on('disconnect', () => handlers.onStatus?.(false));
  s.on('connect_error', (e) => { handlers.onStatus?.(false); if (['revoked', 'license', 'unauthorized'].includes(e.message)) handlers.onKicked?.(e.message); });
  s.on('revoked', () => handlers.onKicked?.('revoked'));
  return s;
}

/** scan bhejna (ack ke saath, 6 second timeout) */
export function sendScan(socket, payload) {
  return new Promise((resolve) => {
    if (!socket?.connected) { resolve({ ok: false, error: 'Counter se connection nahi' }); return; }
    socket.timeout(6000).emit('scan', payload, (err, ack) => {
      if (err) resolve({ ok: false, error: 'Jawab nahi aaya — dobara koshish karein' });
      else resolve(ack || { ok: true });
    });
  });
}

export const assetUrl = (server, p) => (!p ? null : /^https?:/.test(p) ? p : `${server}${p}`);
