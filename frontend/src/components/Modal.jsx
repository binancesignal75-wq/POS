import { useEffect } from 'react';
import Icon from './Icon';

export default function Modal({ title, subtitle, children, footer, onClose, width = 520 }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="ov on" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width, maxWidth: 'calc(100vw - 24px)' }}>
        <div className="m-h">
          <div><h3>{title}</h3>{subtitle && <p className="t2" style={{ fontSize: 13, marginTop: 2 }}>{subtitle}</p>}</div>
          <button className="kebab" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="m-b">{children}</div>
        {footer && <div className="m-f">{footer}</div>}
      </div>
    </div>
  );
}
