/**
 * Low Stock — sirf wo dawaiyan jo low stock level par ya neeche hain.
 * Tick + quantity -> PDF (upar dukan ka logo/naam, neeche list) -> download
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUi } from '../context/UiContext';
import Icon from '../components/Icon';
import { MedCell, StockBar, StatusBadge, StoreLogo, Spinner, Empty } from '../components/ui';
import { lowStockPdf } from '../utils/pdf';
import { rs } from '../utils/format';

export default function LowStock() {
  const { store } = useAuth();
  const { toast } = useUi();
  const [rows, setRows] = useState(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/products/low-stock').then((r) => setRows(r.products.map((p) => ({ ...p, sel: true, order_qty: p.suggested_qty }))))
      .catch((e) => toast(e.message, 'err'));
  }, []); // eslint-disable-line

  const sel = useMemo(() => (rows || []).filter((r) => r.sel), [rows]);
  const upd = (id, patch) => setRows((rs_) => rs_.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const allOn = rows?.length && rows.every((r) => r.sel);

  const download = async () => {
    setBusy(true);
    try { await lowStockPdf(store, sel); toast('PDF download ho rahi hai'); }
    catch (e) { toast('PDF nahi bani: ' + e.message, 'err'); }
    finally { setBusy(false); }
  };

  if (!rows) return <div className="center"><Spinner /></div>;

  return (
    <>
      <div className="ph">
        <div><h1>Low Stock</h1><p>Sirf wo dawaiyan jo apni low stock level par ya us se neeche hain</p></div>
        <div className="acts">
          <button className="btn btn-sc" disabled={!sel.length} onClick={() => setPreview(true)}><Icon name="pdf" className="ic-sm" />Preview</button>
          <button className="btn btn-pr" disabled={!sel.length || busy} onClick={download}>{busy ? <Spinner /> : <Icon name="pdf" className="ic-sm" />}PDF download</button>
        </div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div className="card stat"><div className="l" style={{ margin: 0 }}>Khatam ho chuki</div><div className="v" style={{ color: 'var(--rd)' }}>{rows.filter((r) => r.stock <= 0).length}</div></div>
        <div className="card stat"><div className="l" style={{ margin: 0 }}>Kam reh gayi</div><div className="v" style={{ color: '#b45309' }}>{rows.filter((r) => r.stock > 0).length}</div></div>
        <div className="card stat"><div className="l" style={{ margin: 0 }}>Order ka andaza (TP)</div><div className="v">{rs(sel.reduce((a, r) => a + r.order_qty * r.tp, 0))}</div></div>
      </div>
      <div className="card tbl-card">
        <div className="tbl-bar"><div className="tt">Order list <span className="badge b-rd">{sel.length} selected</span></div><span className="muted" style={{ fontSize: 12.5 }}>Jo tick hain wohi PDF mein jayengi</span></div>
        {rows.length === 0 ? <Empty title="Koi dawai kam nahi" text="Sab dawaiyon ka stock theek hai" /> : (
          <table>
            <thead><tr>
              <th style={{ width: 44 }}><span className={`cb ${allOn ? 'on' : ''}`} onClick={() => setRows((x) => x.map((r) => ({ ...r, sel: !allOn })))} /></th>
              <th>Dawai</th><th>Company</th><th>Stock</th><th className="c">Mangwana</th><th className="r">Andazan cost</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.sel ? 1 : 0.5 }}>
                  <td><span className={`cb ${r.sel ? 'on' : ''}`} onClick={() => upd(r.id, { sel: !r.sel })} /></td>
                  <td><MedCell p={r} /></td>
                  <td>{r.company || '—'}</td>
                  <td><StockBar p={r} /></td>
                  <td className="c"><span className="qty">
                    <button onClick={() => upd(r.id, { order_qty: Math.max(1, r.order_qty - 1) })}>−</button>
                    <span>{r.order_qty}</span>
                    <button onClick={() => upd(r.id, { order_qty: r.order_qty + 1 })}>+</button>
                  </span></td>
                  <td className="r t-num">{rs(r.order_qty * r.tp)}</td>
                  <td><StatusBadge p={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {preview && (
        <div className="ov on" onMouseDown={(e) => e.target === e.currentTarget && setPreview(false)}>
          <div className="pdf-wrap">
            <div className="pdf-tb"><b style={{ fontSize: 14 }}>Low Stock — PDF preview</b>
              <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sc btn-sm" onClick={() => setPreview(false)}>Band karein</button>
                <button className="btn btn-pr btn-sm" onClick={download} disabled={busy}><Icon name="pdf" className="ic-sm" />Download PDF</button></div></div>
            <div className="a4">
              <div className="a4-h">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><StoreLogo store={store} size={48} />
                  <div><b style={{ fontSize: 17, display: 'block' }}>{store.name}</b><small style={{ color: '#64748b', fontSize: 11 }}>{[store.address, store.city, store.phone && `Ph ${store.phone}`].filter(Boolean).join(' · ')}</small></div></div>
                <div style={{ textAlign: 'right' }}><b style={{ fontSize: 13, color: 'var(--pr-d)', display: 'block' }}>LOW STOCK LIST</b><small style={{ color: '#64748b', fontSize: 10.5 }}>{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</small></div>
              </div>
              <p style={{ fontSize: 11, color: '#475569', margin: '14px 0 10px' }}>Neeche di gayi dawaiyan khatam ya kam hain. Barah-e-karam ye quantity bhej dein.</p>
              <table>
                <thead><tr><th>#</th><th>Dawai</th><th>Strength</th><th>Company</th><th style={{ textAlign: 'center' }}>Baqi</th><th style={{ textAlign: 'center' }}>Mangwana</th></tr></thead>
                <tbody>{sel.map((r, i) => (
                  <tr key={r.id}><td>{i + 1}</td><td><b>{r.name}</b></td><td>{r.strength}</td><td>{r.company}</td>
                    <td style={{ textAlign: 'center', color: r.stock <= 0 ? '#dc2626' : '#b45309', fontWeight: 700 }}>{r.stock}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.order_qty}</td></tr>
                ))}</tbody>
              </table>
              <div className="a4-f"><span>Generated by TYPOS POS</span><span>Page 1</span></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
