import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useUi } from '../context/UiContext';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { StockBar, StatusBadge, Expiry, Pagination, RowMenu, Seg, Spinner, Empty, Field } from '../components/ui';
import { rs, rs2, FORMS, getForm, daysUntil, getStripsPerBox, formatBoxStripStock } from '../utils/format';

export default function Products() {
  const { counts, reloadCounts } = useOutletContext();
  const { toast, confirm } = useUi();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get('f') || 'all';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [stockFor, setStockFor] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);
  const [actionsFor, setActionsFor] = useState(null);
  const t = useRef(null);

  const load = (opts = {}) => {
    api('/products', { query: { q: opts.q ?? q, filter, page: opts.page ?? page, limit: 20 } })
      .then(setData).catch((e) => toast(e.message, 'err'));
  };
  useEffect(() => { load(); }, [filter, page]); // eslint-disable-line

  const onSearch = (v) => {
    setQ(v);
    clearTimeout(t.current);
    t.current = setTimeout(() => { setPage(1); load({ q: v, page: 1 }); }, 300);
  };

  const del = async (p) => {
    if (!(await confirm({ title: 'Dawai delete karein?', text: `"${p.name}" list se hat jayegi. Purane bills ka record rahega.`, okText: 'Delete', danger: true }))) return;
    try { await api(`/products/${p.id}`, { method: 'DELETE' }); toast('Delete ho gayi'); load(); reloadCounts(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="ph">
        <div><h1>Products</h1><p>{counts ? `${counts.total} dawaiyan · ${rs(counts.stock_value)} ka stock (TP)` : ' '}</p></div>
        <div className="acts">
          <button
            type="button"
            className="btn btn-sc"
            title="Products list refresh karein"
            onClick={() => {
              load();
              reloadCounts();
              toast('Products refresh ho gayi');
            }}
          >
            <Icon name="refresh" className="ic-sm" />
            Refresh
          </button>
          <Link className="btn btn-pr" to="/app/products/new"><Icon name="plus" className="ic-sm" />Add product</Link>
        </div>
      </div>
      <div className="card tbl-card" style={{ overflow: 'visible' }}>
        <div className="tbl-bar">
          <Seg value={filter} onChange={(v) => { setPage(1); setSp(v === 'all' ? {} : { f: v }); }} options={[
            { value: 'all', label: 'Sab', count: counts?.total },
            { value: 'low', label: 'Low stock', count: counts?.low },
            { value: 'expiring', label: 'Expiry soon', count: counts?.expiring },
            { value: 'nocode', label: 'Bina code', count: counts?.nocode }
          ]} />
          <div className="tsearch tsearch-lg">
            <Icon name="search" className="ic" />
            <input
              placeholder="Dawai ka naam, barcode ya company dhoondein…"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
            />
            {q && (
              <button
                type="button"
                onClick={() => onSearch('')}
                title="Search saaf karein"
                style={{ color: 'var(--t3)', padding: 4, display: 'flex', alignItems: 'center' }}
              >
                <Icon name="x" className="ic-sm" />
              </button>
            )}
          </div>
        </div>
        {!data ? <div className="empty"><Spinner /></div> : data.products.length === 0 ? (
          <Empty title="Koi dawai nahi mili" text={q ? 'Search badal kar dekhein' : 'Pehli dawai add karein'}>
            <Link className="btn btn-pr" to="/app/products/new"><Icon name="plus" className="ic-sm" />Add product</Link>
          </Empty>
        ) : (
          <div className="product-cards-grid">
            {data.products.map((p) => {
              const f = getForm(p.form);
              const profit = p.mrp - p.tp;
              const margin = p.mrp > 0 ? (profit / p.mrp) * 100 : 0;
              const expDays = daysUntil(p.expiry_date);
              const isExpired = expDays !== null && expDays < 0;
              const spb = getStripsPerBox(p);
              const totalStrips = Math.round(Number(p.stock) * spb);
              const fullBoxes = Math.floor(totalStrips / spb);
              const remStrips = totalStrips % spb;
              const stripPrice = Math.round((p.mrp / spb) * 100) / 100;
              const stripCost = Math.round((p.tp / spb) * 100) / 100;

              return (
                <div className="product-card" key={p.id}>
                  {/* SECTION A: Medicine Header */}
                  <div className="pcard-header">
                    <div className="pcard-title-group">
                      <div className={`pcard-type-icon ${f.colorCls || 'med-icon-oth'}`}>
                        <Icon name={f.icon || 'pill'} className="pcard-type-svg" size={20} />
                      </div>
                      <div className="pcard-name-wrap">
                        <h4
                          className="pcard-name"
                          title={`${p.name}${p.strength ? ` ${p.strength}` : ''} (Click karke edit karein)`}
                          onClick={() => nav(`/app/products/${p.id}/edit`)}
                        >
                          {p.name}{p.strength ? ` ${p.strength}` : ''}
                        </h4>
                        <div className="pcard-sub" title={[p.company, p.pack_size].filter(Boolean).join(' · ') || f.label}>
                          {[p.company, p.pack_size, spb > 1 ? `${spb} strips/box` : null].filter(Boolean).join(' · ') || f.label}
                        </div>
                      </div>
                    </div>
                    <div className="pcard-badges">
                      {isExpired ? (
                        <span className="badge b-rd"><i />Expired</span>
                      ) : (
                        <StatusBadge p={p} />
                      )}
                      {p.barcode ? (
                        <span className="badge b-gr" title={`Barcode: ${p.barcode}`}><i />Active</span>
                      ) : (
                        <span className="badge b-gy">Non Active</span>
                      )}
                    </div>
                  </div>

                  {/* 1px Solid Divider */}
                  <div className="pcard-solid-divider" />

                  {/* SECTION B: Stock Quantity Panel */}
                  <div className="pcard-stock-panel">
                    <div className="pcard-stock-row">
                      <span className="pcard-stock-label">Stock Quantity</span>
                      <span className="pcard-stock-val">
                        {spb > 1 ? (
                          <>
                            <b>
                              {fullBoxes} {fullBoxes === 1 ? 'box' : 'boxes'}
                              {remStrips > 0 ? `, ${remStrips} ${remStrips === 1 ? 'strip' : 'strips'}` : ''}
                            </b>
                            <span style={{ marginLeft: 4, color: '#1d4ed8', fontWeight: 600 }}>({totalStrips} strips)</span>
                          </>
                        ) : (
                          <b>{Math.round(Number(p.stock) * 100) / 100} boxes</b>
                        )}
                        <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>(min {p.low_stock_level})</span>
                      </span>
                    </div>
                    <div className="pcard-stock-bar">
                      <div
                        className="pcard-stock-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(p.stock > 0 ? (p.stock / Math.max(1, p.low_stock_level * 3)) * 100 : 0, 4))}%`,
                          background: p.stock <= 0 ? '#dc2626' : p.stock <= p.low_stock_level ? '#f59e0b' : '#22c55e'
                        }}
                      />
                    </div>
                  </div>

                  {/* 1px Solid Divider */}
                  <div className="pcard-solid-divider" />

                  {/* SECTION C: 2-Column Pricing and Profit Grid */}
                  <div className="pcard-pricing-grid">
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">MRP (BOX)</span>
                      <span className="pcard-price-val t-num">{rs2(p.mrp)}</span>
                    </div>
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">TP (COST)</span>
                      <span className="pcard-price-val t-num" style={{ color: '#475569' }}>{rs2(p.tp)}</span>
                    </div>
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">PROFIT / BOX</span>
                      <span className="pcard-price-val" style={{ color: '#16a34a' }}>
                        {rs2(profit)}
                        <small style={{ fontSize: 11, marginLeft: 4, fontWeight: 600, color: '#16a34a' }}>
                          ({margin.toFixed(0)}%)
                        </small>
                      </span>
                    </div>
                    <div className="pcard-price-col">
                      <span className="pcard-price-lbl">EXPIRY DATE</span>
                      <span className={`pcard-price-val ${isExpired ? 'expired-text' : ''}`}>
                        <Expiry d={p.expiry_date} />
                      </span>
                    </div>
                  </div>

                  {/* Strip Pricing Strip if Strip Packaging Enabled */}
                  {spb > 1 && (
                    <div style={{ background: '#f8fafc', padding: '7px 12px', fontSize: 11.5, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ color: '#334155' }}>
                        Strip Rate ({spb}/box): <b style={{ color: '#1d4ed8' }}>{rs2(stripPrice)}</b>
                      </span>
                      <span style={{ color: '#64748b' }}>
                        Cost: <b>{rs2(stripCost)}</b> · Munafa: <b style={{ color: '#16a34a' }}>{rs2(stripPrice - stripCost)}</b>
                      </span>
                    </div>
                  )}

                  {/* 1px Solid Divider */}
                  <div className="pcard-solid-divider" />

                  {/* SECTION D: Footer Actions */}
                  <div className="pcard-footer">
                    <div className="pcard-footer-meta">
                      {p.batch_no ? (
                        <span className="pcard-batch-pill" title={`Batch: ${p.batch_no}`}>
                          Batch: {p.batch_no}
                        </span>
                      ) : p.rack ? (
                        <span className="pcard-batch-pill" title={`Rack: ${p.rack}`}>
                          Rack: {p.rack}
                        </span>
                      ) : (
                        <span />
                      )}
                    </div>
                    <div className="pcard-footer-actions">
                      <button
                        type="button"
                        className="btn btn-pr btn-sm pcard-btn-stock"
                        title="Stock Aaya (Purchase)"
                        onClick={() => setStockFor(p)}
                      >
                        <Icon name="plus" className="ic-sm" />
                        <span>Stock</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sc btn-sm"
                        title="Edit details"
                        onClick={() => nav(`/app/products/${p.id}/edit`)}
                        style={{ padding: '0 8px', height: 32 }}
                      >
                        <Icon name="edit" className="ic-sm" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sc btn-sm"
                        title="Dawai actions"
                        onClick={() => setActionsFor(p)}
                        style={{ padding: '0 8px', height: 32 }}
                      >
                        <Icon name="dots" className="ic-sm" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} shown={data.products.length} onPage={setPage} />}
      </div>
      {actionsFor && (
        <ProductActionsModal
          product={actionsFor}
          onClose={() => setActionsFor(null)}
          onStockIn={() => { const p = actionsFor; setActionsFor(null); setStockFor(p); }}
          onEdit={() => { nav(`/app/products/${actionsFor.id}/edit`); setActionsFor(null); }}
          onAdjust={() => { const p = actionsFor; setActionsFor(null); setAdjustFor(p); }}
          onDelete={() => { const p = actionsFor; setActionsFor(null); del(p); }}
        />
      )}
      {stockFor && <StockInModal product={stockFor} onClose={() => setStockFor(null)} onDone={() => { setStockFor(null); load(); reloadCounts(); }} />}
      {adjustFor && <AdjustModal product={adjustFor} onClose={() => setAdjustFor(null)} onDone={() => { setAdjustFor(null); load(); reloadCounts(); }} />}
    </>
  );
}

/** 3-Dot Actions Modal Popup */
function ProductActionsModal({ product, onClose, onStockIn, onEdit, onAdjust, onDelete }) {
  const f = getForm(product.form);
  return (
    <Modal
      title={product.name}
      subtitle={`${[product.strength, product.company, product.pack_size].filter(Boolean).join(' · ') || f.label} · Abhi Stock: ${product.stock} packs`}
      onClose={onClose}
      width={460}
      footer={<button className="btn btn-sc" style={{ width: '100%' }} onClick={onClose}>Band karein</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Action 1: Stock Aaya */}
        <button
          type="button"
          onClick={onStockIn}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            borderRadius: 12,
            border: '1px solid #bbf7d0',
            background: '#f0fdf4',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--pr)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="truck" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 15, color: '#14532d', display: 'block' }}>Stock Aaya (Purchase)</b>
            <span style={{ fontSize: 12.5, color: '#166534' }}>Naye packs dukan mein add karein</span>
          </div>
          <Icon name="right" className="ic-sm" style={{ color: '#16a34a' }} />
        </button>

        {/* Action 2: Edit Dawai Details */}
        <button
          type="button"
          onClick={onEdit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ width: 42, height: 42, borderRadius: 10, background: '#f1f5f9', color: '#334155', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="edit" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 15, color: '#0f172a', display: 'block' }}>Edit Dawai</b>
            <span style={{ fontSize: 12.5, color: '#64748b' }}>Price, barcode, company, expiry tabdeel karein</span>
          </div>
          <Icon name="right" className="ic-sm" style={{ color: '#94a3b8' }} />
        </button>

        {/* Action 3: Stock Ginti Theek Karein */}
        <button
          type="button"
          onClick={onAdjust}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            borderRadius: 12,
            border: '1px solid #fef3c7',
            background: '#fffbeb',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ width: 42, height: 42, borderRadius: 10, background: '#fef3c7', color: '#b45309', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="refresh" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 15, color: '#78350f', display: 'block' }}>Stock Ginti Theek Karein</b>
            <span style={{ fontSize: 12.5, color: '#92400e' }}>Ginti ke baad asal stock barabar karein</span>
          </div>
          <Icon name="right" className="ic-sm" style={{ color: '#d97706' }} />
        </button>

        {/* Action 4: Delete */}
        <button
          type="button"
          onClick={onDelete}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            borderRadius: 12,
            border: '1px solid #fecaca',
            background: '#fff1f2',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <div style={{ width: 42, height: 42, borderRadius: 10, background: '#fee2e2', color: '#dc2626', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="trash" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 15, color: '#991b1b', display: 'block' }}>Delete Dawai</b>
            <span style={{ fontSize: 12.5, color: '#b91c1c' }}>Is dawai ko list se mita dein</span>
          </div>
          <Icon name="right" className="ic-sm" style={{ color: '#ef4444' }} />
        </button>
      </div>
    </Modal>
  );
}

/** Stock aaya — purchase record banta hai (Monthly Records mein "Stock aaya") */
export function StockInModal({ product, onClose, onDone }) {
  const { toast } = useUi();
  const mrp = Number(product.mrp) || 0;
  const defaultTpPct = product.tp_pct !== undefined && product.tp_pct !== null && product.tp_pct !== ''
    ? String(product.tp_pct)
    : '14.5';
  const defaultExtraPct = product.extra_discount_pct !== undefined && product.extra_discount_pct !== null && product.extra_discount_pct !== ''
    ? String(product.extra_discount_pct)
    : '0';

  const [f, setF] = useState({
    qty: '',
    tp_pct: defaultTpPct,
    extra_discount_pct: defaultExtraPct,
    supplier: '',
    batch_no: product.batch_no || '',
    expiry_date: product.expiry_date ? `${product.expiry_date.slice(5, 7)}/${product.expiry_date.slice(0, 4)}` : ''
  });
  const [busy, setBusy] = useState(false);

  const tpVal = Number(f.tp_pct) || 0;
  const extraVal = Number(f.extra_discount_pct) || 0;
  const tpDiscAmount = Math.round(mrp * (tpVal / 100) * 100) / 100;
  const amountAfterTp = Math.round((mrp - tpDiscAmount) * 100) / 100;
  const extraDiscAmount = Math.round(amountAfterTp * (extraVal / 100) * 100) / 100;
  const effectiveTp = mrp > 0
    ? Math.max(0, Math.round((amountAfterTp - extraDiscAmount) * 100) / 100)
    : (Number(product.tp) || 0);

  const setTpPct = (e) => setF({ ...f, tp_pct: e.target.value });
  const setExtraPct = (e) => setF({ ...f, extra_discount_pct: e.target.value });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    try {
      await api(`/products/${product.id}/stock`, {
        method: 'POST',
        body: {
          ...f,
          tp: effectiveTp,
          tp_pct: tpVal,
          extra_discount_pct: extraVal
        }
      });
      toast(`${f.qty} packs add ho gaye`);
      onDone();
    } catch (e) {
      toast(e.message, 'err');
      setBusy(false);
    }
  };

  const totalCost = (Number(f.qty) || 0) * effectiveTp;
  const profitPerPack = mrp > 0 ? Math.max(0, Math.round((mrp - effectiveTp) * 100) / 100) : 0;
  const marginPct = mrp > 0 ? (profitPerPack / mrp) * 100 : 0;

  return (
    <Modal
      title="Stock Aaya (Purchase)"
      subtitle={`${product.name} ${product.strength || ''} · MRP: ${rs2(mrp)} · Abhi Stock: ${product.stock} packs`}
      onClose={onClose}
      width={540}
      footer={
        <>
          <button className="btn btn-sc" onClick={onClose}>Cancel</button>
          <button className="btn btn-pr" disabled={busy || !(+f.qty > 0)} onClick={save}>
            {busy ? <Spinner /> : 'Stock add karein'}
          </button>
        </>
      }
    >
      <div className="grid-form">
        <Field label="Kitne packs aaye *">
          <input className="inp" autoFocus value={f.qty} onChange={set('qty')} inputMode="numeric" placeholder="e.g. 50" />
        </Field>
        <Field label="TP Discount (%)">
          <div style={{ position: 'relative' }}>
            <input
              className="inp mono"
              style={{ background: '#fefce8', borderColor: '#fde047', color: '#854d0e', fontWeight: 600, paddingRight: 28 }}
              value={f.tp_pct}
              onChange={setTpPct}
              placeholder="14.5"
              inputMode="decimal"
            />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#a16207', fontWeight: 600, fontSize: 13, pointerEvents: 'none' }}>%</span>
          </div>
        </Field>
        <Field label="Extra Discount (%)">
          <div style={{ position: 'relative' }}>
            <input
              className="inp mono"
              style={{ background: '#fff7ed', borderColor: '#fdba74', color: '#9a3412', fontWeight: 600, paddingRight: 28 }}
              value={f.extra_discount_pct}
              onChange={setExtraPct}
              placeholder="0"
              inputMode="decimal"
            />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#c2410c', fontWeight: 600, fontSize: 13, pointerEvents: 'none' }}>%</span>
          </div>
        </Field>
        <Field label="Purchase Cost / Pack">
          <input
            className="inp mono"
            readOnly
            value={rs2(effectiveTp)}
            style={{ background: '#f8fafc', fontWeight: 600, color: '#334155' }}
          />
        </Field>
        <Field label="Supplier / distributor" style={{ gridColumn: '1/-1' }}>
          <input className="inp" value={f.supplier} onChange={set('supplier')} placeholder="Distributor name" />
        </Field>
        <Field label="Batch #">
          <input className="inp mono" value={f.batch_no} onChange={set('batch_no')} placeholder="Batch #" />
        </Field>
        <Field label="Expiry (MM/YYYY)">
          <input className="inp" value={f.expiry_date} onChange={set('expiry_date')} placeholder="08/2028" />
        </Field>
      </div>
      {+f.qty > 0 && (
        <div className="ok-box" style={{ marginTop: 14 }}>
          Kul Purchase Cost: <b>{rs2(totalCost)}</b> · Naya stock: <b>{product.stock + Number(f.qty)} packs</b>
          {profitPerPack > 0 && ` · Munafa: ${rs2(profitPerPack)} / pack (${marginPct.toFixed(1)}%)`}
        </div>
      )}
    </Modal>
  );
}

function AdjustModal({ product, onClose, onDone }) {
  const { toast } = useUi();
  const [v, setV] = useState(String(Math.round((Number(product.stock) || 0) * 10000) / 10000));
  const save = async () => {
    try { await api(`/products/${product.id}/adjust`, { method: 'POST', body: { stock: v } }); toast('Stock theek ho gaya'); onDone(); }
    catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Stock ginti theek karein" subtitle="Dukan mein asal kitne packs hain? (Ye purchase mein nahi ginta)" onClose={onClose} width={420}
      footer={<><button className="btn btn-sc" onClick={onClose}>Cancel</button><button className="btn btn-pr" onClick={save}>Save</button></>}>
      <Field label={`${product.name} — asal stock (boxes)`}><input className="inp" autoFocus value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
    </Modal>
  );
}
