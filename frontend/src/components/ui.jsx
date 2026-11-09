import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { asset } from '../api';
import { FORMS, initials, expiryShort, daysUntil, lakh } from '../utils/format';

/** Dukan ka logo — logo na ho to naam ke initials */
export function StoreLogo({ store, size = 38, radius }) {
  const url = asset(store?.logo_url);
  return (
    <div className="b-logo" style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.26), fontSize: Math.round(size * 0.36), background: url ? '#fff' : undefined }}>
      {url ? <img src={url} alt="" /> : initials(store?.name)}
    </div>
  );
}

export function TyposLogo({ size = 34, mark = true }) {
  return <img className="typos-mark" style={{ width: size, height: size }} src={mark ? '/typos-mark.png' : '/typos-logo.png'} alt="TYPOS" />;
}

export function Spinner() { return <span className="spin" />; }

export function MedCell({ p }) {
  const f = FORMS[p.form] || FORMS.other;
  return (
    <div className="med">
      <div className={`mi ${f.cls}`}>{f.short}</div>
      <div style={{ minWidth: 0 }}>
        <b>{p.name}{p.strength ? ` ${p.strength}` : ''}</b>
        <small>{[p.company, p.pack_size].filter(Boolean).join(' · ') || f.label}</small>
      </div>
    </div>
  );
}

export function StockBar({ p }) {
  const lvl = Math.max(1, p.low_stock_level);
  const pct = Math.min(100, (p.stock / (lvl * 3)) * 100);
  const col = p.stock <= 0 ? '#dc2626' : p.stock <= p.low_stock_level ? '#f59e0b' : '#5cc624';
  return (
    <div className="stk">
      <div className="n"><b>{p.stock} packs</b><span className="muted">min {p.low_stock_level}</span></div>
      <div className="bar"><i style={{ width: `${p.stock > 0 ? Math.max(pct, 4) : 0}%`, background: col }} /></div>
    </div>
  );
}

export function StatusBadge({ p }) {
  const d = daysUntil(p.expiry_date);
  if (p.stock <= 0) return <span className="badge b-rd"><i />Khatam</span>;
  if (d !== null && d < 0) return <span className="badge b-rd"><i />Expired</span>;
  if (p.stock <= p.low_stock_level) return <span className="badge b-am"><i />Kam hai</span>;
  if (d !== null && d <= 90) return <span className="badge b-am"><i />Expiry soon</span>;
  return <span className="badge b-gr"><i />Theek</span>;
}

export function Expiry({ d }) {
  const n = daysUntil(d);
  return <span className={n !== null && n <= 90 ? 'dn' : ''}>{expiryShort(d)}</span>;
}

export function Stat({ icon, iconColor, label, value, valueColor, foot, badge, highlight, title }) {
  const [showFull, setShowFull] = useState(false);
  const valStr = typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : '');
  const displayTitle = title || (valStr ? `${label}: ${valStr}` : undefined);
  return (
    <div
      className={`card stat ${highlight ? 'hl' : ''}`}
      title={displayTitle}
      onClick={() => setShowFull((s) => !s)}
      style={{ cursor: 'pointer' }}
    >
      <div className="hd">
        <div className="ico" style={{ color: iconColor, background: highlight ? '#fff' : undefined }}><Icon name={icon} /></div>
        {badge}
      </div>
      <div className="l">{label}</div>
      <div
        className="v"
        style={{
          color: valueColor,
          ...(showFull ? { whiteSpace: 'normal', wordBreak: 'break-word', overflow: 'visible' } : {})
        }}
        title={displayTitle}
      >
        {value}
      </div>
      {foot && <div className="f">{foot}</div>}
    </div>
  );
}

export function Change({ now, prev, label }) {
  if (!prev) return <span>{label}</span>;
  const c = ((now - prev) / prev) * 100;
  return <><span className={c >= 0 ? 'up' : 'dn'}>{c >= 0 ? '↑' : '↓'} {Math.abs(c).toFixed(0)}%</span> {label}</>;
}

/** Sale vs profit bars */
export function BarChart({ data, height = 250 }) {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(1, ...data.map((d) => d.sale)) * 1.1;
  const pad = 46, H = height, bw = (w - pad - 10) / Math.max(1, data.length);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div ref={ref}>
      <svg width="100%" height={H}>
        {[0, 0.5, 1].map((t) => {
          const y = H - 24 - (H - 40) * t;
          return <g key={t}><line x1={pad} x2={w} y1={y} y2={y} stroke="#f2f4f7" /><text x="0" y={y + 4} className="chart-tip">{t ? lakh(max * t).replace('Rs ', '') : '0'}</text></g>;
        })}
        {data.map((d, i) => {
          const x = pad + i * bw + bw * 0.18, bwid = bw * 0.3;
          const hs = ((H - 40) * d.sale) / max, hp = ((H - 40) * Math.max(0, d.profit)) / max;
          return (
            <g key={d.ym}>
              <rect x={x} y={H - 24 - hs} width={bwid} height={hs} rx="5" fill="#c3e9a6"><title>Sale {lakh(d.sale)}</title></rect>
              <rect x={x + bwid + 4} y={H - 24 - hp} width={bwid} height={hp} rx="5" fill="#3c9d14"><title>Profit {lakh(d.profit)}</title></rect>
              <text x={x + bwid + 2} y={H - 6} fontSize="11" fill="#98a2b3" textAnchor="middle">{MONTHS[+d.ym.slice(5) - 1]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Pagination({ page, pages, total, shown, onPage }) {
  if (!total) return null;
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <div className="tbl-foot">
      <span>{shown} of {total} dikha rahe hain</span>
      <div className="pg">
        <button
          type="button"
          className="btn btn-sc btn-sm pg-nav"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        {nums.map((n) => (
          <button
            type="button"
            key={n}
            className={`pg-num ${n === page ? 'on' : ''}`}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-sc btn-sm pg-nav"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** ⋮ menu */
export function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button className="kebab" onClick={() => setOpen((o) => !o)}><Icon name="dots" className="ic-sm" /></button>
      {open && (
        <div className="dd-menu">
          {items.filter(Boolean).map((it) => (
            <button key={it.label} className={it.danger ? 'red' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
              <Icon name={it.icon} className="ic-sm" />{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="muted"> {o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, auto, hint, className, style }) {
  return (
    <div className={className} style={style}>
      <label className="lbl">{label}{auto && <span className="auto-tag">AUTO</span>}{hint && <span className="muted" style={{ fontWeight: 500 }}> {hint}</span>}</label>
      {children}
    </div>
  );
}

export function Empty({ title, text, children }) {
  return <div className="empty"><b>{title}</b>{text}{children && <div style={{ marginTop: 14 }}>{children}</div>}</div>;
}
