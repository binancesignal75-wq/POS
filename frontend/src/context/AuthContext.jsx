import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, storage } from '../api';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(!!storage.token());
  const [sessionMsg, setSessionMsg] = useState(null);

  const refresh = useCallback(async () => {
    if (!storage.token()) { setLoading(false); return; }
    try {
      const { store, token } = await api('/auth/me');
      if (token) storage.setToken(token); // har dafa app kholne par session naya: chalta store kabhi logout nahi hota
      setStore(store);
    } catch (e) {
      // server ki aarzi kharabi (500/502) par logout nahi; sirf jab token waqai band ho
      if ([401, 402, 403].includes(e.status)) { storage.setToken(null); setStore(null); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // license expire / store band / PIN badla -> logout
  useEffect(() => {
    const h = (e) => {
      storage.setToken(null);
      setStore(null);
      setSessionMsg(e.detail?.message || null);
    };
    window.addEventListener('typos:session', h);
    return () => window.removeEventListener('typos:session', h);
  }, []);

  const login = (token, s) => {
    storage.setToken(token);
    setSessionMsg(null);
    setStore(s);
  };
  const logout = () => { storage.setToken(null); setStore(null); };

  return (
    <Ctx.Provider value={{ store, setStore, loading, login, logout, refresh, sessionMsg }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
