import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Icon from '../components/Icon';
import Modal from '../components/Modal';

const Ctx = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirm] = useState(null);
  const id = useRef(0);

  const toast = useCallback((text, type = 'ok') => {
    const t = { id: ++id.current, text, type };
    setToasts((x) => [...x.slice(-2), t]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), type === 'err' ? 4000 : 2400);
  }, []);

  /** await confirm({ title, text, okText, danger }) -> true/false */
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirm({ ...opts, resolve })), []);
  const close = (v) => { confirmState?.resolve(v); setConfirm(null); };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast-wrap no-print">
        {toasts.map((t) => (
          <div key={t.id} className={`toast2 ${t.type === 'err' ? 'err' : ''}`}>
            <Icon name={t.type === 'err' ? 'alert' : 'check'} className="ic-sm" style={{ color: t.type === 'err' ? '#fecaca' : '#9ad873' }} />
            {t.text}
          </div>
        ))}
      </div>
      {confirmState && (
        <Modal title={confirmState.title || 'Pakka?'} onClose={() => close(false)} width={420}
          footer={<>
            <button className="btn btn-sc" onClick={() => close(false)}>Nahi</button>
            <button className={`btn ${confirmState.danger ? 'btn-dg' : 'btn-pr'}`} onClick={() => close(true)}>{confirmState.okText || 'Haan'}</button>
          </>}>
          <p className="t2">{confirmState.text}</p>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export const useUi = () => useContext(Ctx);
