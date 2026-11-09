/**
 * Mobile scanner se live data (Socket.io)
 *  - 'add' scan  -> Add Product page khulta hai, form khud bharta hai
 *  - 'sale' scan -> POS mein dawai bill mein add
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { API_BASE, storage } from '../api';
import { beep } from '../utils/scanCamera';
import { useAuth } from './AuthContext';
import { useUi } from './UiContext';

const Ctx = createContext(null);

export function ScannerProvider({ children }) {
  const { store } = useAuth();
  const { toast } = useUi();
  const [devices, setDevices] = useState([]);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set());
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  /** Scan ke hisaab se sahi page */
  const openScan = useCallback((scan) => {
    const nav = navRef.current;
    if (scan.mode === 'sale') {
      nav('/app/pos', { state: { scan } });
    } else if (scan.product) {
      toastRef.current(`${scan.product.name} pehle se hai — stock add karein`);
      nav(`/app/products/${scan.product.id}/edit`, { state: { scan } });
    } else {
      nav('/app/products/new', { state: { scan } });
    }
  }, []);

  useEffect(() => {
    if (!store) return undefined;
    const s = io(API_BASE || undefined, { auth: { token: storage.token() }, transports: ['websocket', 'polling'] });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('devices', setDevices);
    s.on('scan', (scan) => {
      beep();
      // jo page sun raha hai wo khud handle kare; warna sahi page khol do
      const handled = [...listeners.current].some((fn) => fn(scan) === true);
      if (!handled) openScan(scan);
    });
    return () => { s.disconnect(); setDevices([]); setConnected(false); };
  }, [store, openScan]);

  /** page ke andar: useScan(scan => { ...; return true }) */
  const subscribe = useCallback((fn) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; }, []);

  return <Ctx.Provider value={{ devices, connected, subscribe, openScan }}>{children}</Ctx.Provider>;
}

export const useScanner = () => useContext(Ctx);

export function useScan(handler) {
  const { subscribe } = useScanner();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((s) => ref.current(s)), [subscribe]);
}
