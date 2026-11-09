/**
 * Add / Edit product
 * Mobile se "add" scan aaye to naam, MG, type, pack, company, MRP, batch, expiry, barcode khud bhar jate hain (AUTO).
 * Dawai tab tak nahi banti jab tak yahan Save na dabayein.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { useUi } from '../context/UiContext';
import { useScan } from '../context/ScannerContext';
import Icon from '../components/Icon';
import { Field, Spinner } from '../components/ui';
import PairCard from '../components/PairCard';
import { StockInModal } from './Products';
import { FORMS, rs2, getStripsPerBox, formatBoxStripStock } from '../utils/format';

const EMPTY = {
  name: '',
  strength: '',
  form: 'tablet',
  pack_size: '',
  strips_per_box: '1',
  company: '',
  barcode: '',
  barcode_strip: '',
  barcode_alt: '',
  mrp: '',
  tp_pct: '14.5',
  extra_discount_pct: '0',
  stock: '',
  low_stock_level: '5',
  batch_no: '',
  expiry_date: '',
};

const digits = (v) => String(v ?? '').replace(/[^\d.]/g, '');

const guessForm = (s = '') => {
  const t = s.toLowerCase();
  if (/cap/.test(t)) return 'capsule';
  if (/syr|susp|ml\b/.test(t)) return 'syrup';
  if (/inj|vial|amp/.test(t)) return 'injection';
  if (/cream|oint|gel/.test(t)) return 'cream';
  if (/drop/.test(t)) return 'drops';
  if (/sachet/.test(t)) return 'sachet';
  if (/tab/.test(t)) return 'tablet';
  return null;
};

export default function ProductForm() {
  const { id } = useParams();
  const edit = !!id;
  const nav = useNavigate();
  const loc = useLocation();
  const { reloadCounts } = useOutletContext();
  const { toast } = useUi();
  const [f, setF] = useState(EMPTY);
  const [orig, setOrig] = useState(null);
  const [auto, setAuto] = useState({});
  const [mode, setMode] = useState('code'); // code | name
  const [incoming, setIncoming] = useState(null);
  const [dup, setDup] = useState(null);
  const [err, setErr] = useState('');
  const [bad, setBad] = useState(''); // jis khane mein ghalti hai
  const [busy, setBusy] = useState(false);
  const [stockModal, setStockModal] = useState(false);

  useEffect(() => {
    if (!edit) {
      setF(EMPTY);
      setOrig(null);
      setAuto({});
      setMode('code');
      setIncoming(null);
      setDup(null);
      return;
    }
    api(`/products/${id}`).then(({ product: p }) => {
      setOrig(p);
      setMode(p.barcode ? 'code' : 'name');
      setF({
        ...EMPTY,
        ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])),
        stock: p.stock !== undefined && p.stock !== null ? String(Math.round(Number(p.stock) * 10000) / 10000) : '',
        tp_pct: p.tp_pct !== undefined && p.tp_pct !== null ? String(p.tp_pct) : '14.5',
        extra_discount_pct: p.extra_discount_pct !== undefined && p.extra_discount_pct !== null ? String(p.extra_discount_pct) : '0',
        strips_per_box: String(getStripsPerBox(p)),
        expiry_date: p.expiry_date ? `${p.expiry_date.slice(5, 7)}/${p.expiry_date.slice(0, 4)}` : '',
      });
    }).catch((e) => toast(e.message, 'err'));
  }, [id, edit]);

  const current = useRef(f);
  current.current = f;

  /** User ko ghalti wahin dikhao jahan hai: form lamba hai, neeche ka message nazar nahi aata */
  const goToField = (k) => setTimeout(() => {
    const el = document.querySelector(`[data-f="${k}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, 60);

  const fail = (message, k) => {
    setErr(message);
    setBad(k || '');
    toast(message, 'err');
    if (k) goToField(k);
  };

  const applyScan = (scan) => {
    const next = {};
    for (const k of ['name', 'strength', 'pack_size', 'company', 'mrp', 'batch_no', 'expiry_date', 'barcode']) {
      if (scan[k]) next[k] = String(scan[k]);
    }
    const form = FORMS[scan.form] ? scan.form : guessForm(`${scan.form || ''} ${scan.pack_size || ''}`);
    if (form) next.form = form;
    // purani dawai edit ho rahi ho to sirf khali khane bharein, save kiya hua data scan se na badle
    if (edit) {
      for (const k of Object.keys(next)) {
        if (k === 'form' || String(current.current[k] ?? '').trim()) delete next[k];
      }
    }
    if (!edit) setMode(scan.barcode ? 'code' : 'name');
    setF((x) => ({ ...x, ...next }));
    setAuto((x) => ({ ...x, ...Object.fromEntries(Object.keys(next).map((k) => [k, 1])) }));
    setIncoming(scan);
    setDup(scan.product && scan.product.id !== orig?.id ? scan.product : null);
    // dabbi par price na mile to seedha MRP wale khane par, taake Save se pehle pata ho
    if (!edit && !scan.mrp && !String(current.current.mrp || '').trim() && (scan.name || scan.barcode)) goToField('mrp');
  };

  useScan((scan) => {
    if (scan.mode === 'sale') return false;
    // doosri dawai ki edit screen par nayi dabbi ka data na chadhe
    if (edit && scan.product?.id !== orig?.id) return false;
    applyScan(scan);
    return true;
  });

  useEffect(() => {
    if (loc.state?.scan) {
      applyScan(loc.state.scan);
      nav('.', { replace: true, state: null });
    }
  }, [loc.state]); // eslint-disable-line

  const set = (k) => (e) => {
    const v = e.target.value;
    setAuto((a) => ({ ...a, [k]: 0 }));
    if (bad === k) { setBad(''); setErr(''); }
    setF((x) => ({ ...x, [k]: v }));
  };

  const save = async (next) => {
    setErr(''); setBad('');
    const mrp = digits(f.mrp);
    if (!String(f.name).trim()) return fail('Dawai ka naam likhein', 'name');
    if (!(Number(mrp) > 0)) return fail('MRP likhein (0 se zyada), is ke baghair dawai bik nahi sakti', 'mrp');

    const tpPct = Number(digits(f.tp_pct));
    if (Number.isNaN(tpPct) || tpPct < 0 || tpPct > 100) {
      return fail('TP Discount 0% se 100% ke darmiyan hona chahiye', 'tp_pct');
    }

    const extraPct = Number(digits(f.extra_discount_pct));
    if (Number.isNaN(extraPct) || extraPct < 0 || extraPct > 100) {
      return fail('Extra Discount 0% se 100% ke darmiyan hona chahiye', 'extra_discount_pct');
    }

    // Sequential Multiplicative Discount Model:
    // Step 1: TP Discount on MRP -> Amount After TP
    const tpDiscAmount = Math.round(Number(mrp) * (tpPct / 100) * 100) / 100;
    const amountAfterTpVal = Math.round((Number(mrp) - tpDiscAmount) * 100) / 100;
    // Step 2 & 3: Extra Discount on Amount After TP -> Final Purchase Cost
    const extraDiscAmount = Math.round(amountAfterTpVal * (extraPct / 100) * 100) / 100;
    const stripsPerBox = Math.max(1, parseInt(digits(f.strips_per_box), 10) || 1);
    const calculatedTp = Math.max(0, Math.round((amountAfterTpVal - extraDiscAmount) * 100) / 100).toFixed(2);
    setBusy(true);
    const body = {
      ...f,
      mrp,
      strips_per_box: stripsPerBox,
      tp_pct: tpPct,
      extra_discount_pct: extraPct,
      tp: calculatedTp,
      barcode: mode === 'code' ? f.barcode : '',
      barcode_strip: mode === 'code' ? f.barcode_strip : '',
      barcode_alt: mode === 'code' ? f.barcode_alt : '',
    };
    try {
      if (edit) await api(`/products/${id}`, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      toast(edit ? 'Dawai update ho gayi' : 'Dawai save ho gayi');
      reloadCounts();
      if (next) {
        setF({ ...EMPTY, low_stock_level: f.low_stock_level });
        setAuto({});
        setIncoming(null);
        setDup(null);
      } else {
        nav('/app/products');
      }
    } catch (e) {
      fail(e.message, /expiry/i.test(e.message) ? 'expiry_date' : /barcode/i.test(e.message) ? 'barcode' : /naam/i.test(e.message) ? 'name' : /mrp/i.test(e.message) ? 'mrp' : '');
    } finally {
      setBusy(false);
    }
  };

  const inp = (k, props = {}) => (
    <input
      data-f={k}
      className={`inp ${auto[k] ? 'filled' : ''} ${bad === k ? 'bad' : ''} ${props.mono ? 'mono' : ''}`}
      value={f[k]}
      onChange={set(k)}
      {...props}
      mono={undefined}
    />
  );

  const saveButtons = (
    <>
      {!edit && <button className="btn btn-sc" disabled={busy} onClick={() => save(true)}>Save &amp; Next</button>}
      <button className="btn btn-pr" disabled={busy} onClick={() => save(false)}>
        {busy ? <Spinner /> : <Icon name="check" className="ic-sm" />}Save product
      </button>
    </>
  );

  const mrpN = Number(digits(f.mrp)) || 0;
  const tpPctN = Number(digits(f.tp_pct)) || 0;
  const extraPctN = Number(digits(f.extra_discount_pct)) || 0;

  // Step 1: TP Discount on MRP
  const tpDiscountAmount = Math.round(mrpN * (tpPctN / 100) * 100) / 100;
  const amountAfterTp = Math.round((mrpN - tpDiscountAmount) * 100) / 100;

  // Step 2: Extra Discount on Amount After TP
  const extraDiscountAmount = Math.round(amountAfterTp * (extraPctN / 100) * 100) / 100;

  // Step 3: Final Purchase Cost
  const purchaseCostPerPack = mrpN > 0 ? Math.max(0, Math.round((amountAfterTp - extraDiscountAmount) * 100) / 100) : 0;

  // Profit Calculations
  const profitPerPack = mrpN > 0 ? Math.max(0, Math.round((mrpN - purchaseCostPerPack) * 100) / 100) : 0;
  const marginPct = mrpN > 0 ? (profitPerPack / mrpN) * 100 : 0;
  const markupPct = purchaseCostPerPack > 0 ? (profitPerPack / purchaseCostPerPack) * 100 : 0;
  const effectiveDiscountPct = mrpN > 0 ? Math.round(((mrpN - purchaseCostPerPack) / mrpN) * 10000) / 100 : 0;

  const qtyN = Math.max(0, parseFloat(digits(f.stock)) || (edit ? (Number(orig?.stock) || 0) : 0));
  const totalStockCost = Math.round(purchaseCostPerPack * qtyN * 100) / 100;
  const totalStockProfit = Math.round(profitPerPack * qtyN * 100) / 100;

  // Box & Strip packaging calculations
  const stripsPerBoxN = Math.max(1, parseInt(digits(f.strips_per_box), 10) || 1);
  const sellingPricePerStrip = mrpN > 0 ? Math.round((mrpN / stripsPerBoxN) * 100) / 100 : 0;
  const purchaseCostPerStrip = purchaseCostPerPack > 0 ? Math.round((purchaseCostPerPack / stripsPerBoxN) * 100) / 100 : 0;
  const profitPerStrip = sellingPricePerStrip > 0 ? Math.max(0, Math.round((sellingPricePerStrip - purchaseCostPerStrip) * 100) / 100) : 0;
  const totalStripsInStock = Math.round(qtyN * stripsPerBoxN);

  return (
    <>
      <div className="ph">
        <div>
          <h1>{edit ? 'Edit Product' : 'Add Product'}</h1>
          <p>{edit ? `${orig?.name || ''} — stock: ${orig ? formatBoxStripStock(orig.stock, getStripsPerBox(orig)) : ''}` : 'Phone se scan karein — naam, MG aur barcode khud aa jayenge'}</p>
        </div>
        <div className="acts">
          <button className="btn btn-sc" onClick={() => nav('/app/products')}>Cancel</button>
          {edit && <button className="btn btn-sc" onClick={() => setStockModal(true)}><Icon name="truck" className="ic-sm" />Stock aaya</button>}
          {saveButtons}
        </div>
      </div>
      <div className="ap">
        <div className="card">
          {incoming && (
            <div className="incoming tag-new" key={incoming.at}>
              <div className="ii"><Icon name="phone" /></div>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13.5 }}>{incoming.device?.name || 'Phone'} se data aaya</b>
                <div className="t2" style={{ fontSize: 12.5 }}>
                  {!edit && !String(f.mrp).trim() ? 'Dabbi par MRP nahi mili: MRP likh kar save karein' : 'Jo khane hare hain wo khud bhare gaye — check karke save karein'}
                </div>
              </div>
              <span className="badge b-gr">Abhi</span>
            </div>
          )}
          {dup && (
            <div className="err" style={{ margin: '14px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>Ye barcode pehle se "{dup.name}" par hai.</span>
              <button className="btn btn-sc btn-sm" onClick={() => nav(`/app/products/${dup.id}/edit`)}>Wo dawai kholein</button>
            </div>
          )}
          <div className="scan-opt" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '16px 18px 0' }}>
            {[['code', 'scan', 'Naam + Code', 'Dabbi par barcode hai'], ['name', 'pill', 'Sirf naam', 'Code nahi — naam se bikegi']].map(([v, ic, t, s]) => (
              <button
                key={v}
                onClick={() => setMode(v)}
                className="card"
                style={{
                  padding: 12,
                  textAlign: 'left',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  borderColor: mode === v ? 'var(--pr)' : undefined,
                  background: mode === v ? 'var(--pr-50)' : undefined,
                  boxShadow: 'none',
                }}
              >
                <Icon name={ic} style={{ color: mode === v ? 'var(--pr)' : 'var(--t3)' }} />
                <span>
                  <b style={{ display: 'block', fontSize: 13.5 }}>{t}</b>
                  <small className="muted">{s}</small>
                </span>
              </button>
            ))}
          </div>

          {/* 1. Medicine Information */}
          <div className="fsec">Dawai ki maloomat</div>
          <div className="fgrid">
            <Field className="s2" label="Dawai ka naam *" auto={auto.name}>{inp('name', { autoFocus: true })}</Field>
            <Field label="Strength / MG" auto={auto.strength}>{inp('strength', { placeholder: '500 mg' })}</Field>
            {mode === 'code' && (
              <>
                <Field label="Box Barcode / QR" auto={auto.barcode}>{inp('barcode', { mono: 1, placeholder: 'Box barcode' })}</Field>
                <Field label="Strip / Pack Barcode" auto={auto.barcode_strip}>{inp('barcode_strip', { mono: 1, placeholder: 'Strip barcode' })}</Field>
                <Field label="Alternate Barcode" auto={auto.barcode_alt}>{inp('barcode_alt', { mono: 1, placeholder: 'Alternate barcode' })}</Field>
              </>
            )}
            <Field label="Type" auto={auto.form}>
              <select className={`inp ${auto.form ? 'filled' : ''}`} value={f.form} onChange={set('form')}>
                {Object.entries(FORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Pack size" auto={auto.pack_size}>{inp('pack_size', { placeholder: '10x10 tablets' })}</Field>
            <Field label="Company" auto={auto.company}>{inp('company')}</Field>
            <Field label="Batch #" auto={auto.batch_no}>{inp('batch_no', { mono: 1, placeholder: 'Batch #' })}</Field>
            <Field label="Expiry (MM/YYYY)" auto={auto.expiry_date}>{inp('expiry_date', { placeholder: '08/2028' })}</Field>
          </div>

          {/* 2. Price aur stock */}
          <div className="fsec" style={{ borderTop: '1px solid var(--bd)', paddingTop: 16 }}>Price aur stock</div>
          <div className="fgrid">
            <Field label="MRP (per pack) *" auto={auto.mrp}>
              {inp('mrp', { inputMode: 'decimal', placeholder: '0.00' })}
            </Field>

            <Field label="TP Discount (%)">
              <div style={{ position: 'relative' }}>
                <input
                  data-f="tp_pct"
                  className={`inp ${auto.tp_pct ? 'filled' : ''} ${bad === 'tp_pct' ? 'bad' : ''} mono`}
                  style={{ background: '#fefce8', borderColor: '#fde047', color: '#854d0e', fontWeight: 600, paddingRight: 28 }}
                  value={f.tp_pct}
                  onChange={set('tp_pct')}
                  placeholder="14.5"
                  inputMode="decimal"
                />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#a16207', fontWeight: 600, fontSize: 13, pointerEvents: 'none' }}>%</span>
              </div>
            </Field>

            <Field label="Extra Discount (%)">
              <div style={{ position: 'relative' }}>
                <input
                  data-f="extra_discount_pct"
                  className={`inp ${auto.extra_discount_pct ? 'filled' : ''} ${bad === 'extra_discount_pct' ? 'bad' : ''} mono`}
                  style={{ background: '#fff7ed', borderColor: '#fdba74', color: '#9a3412', fontWeight: 600, paddingRight: 28 }}
                  value={f.extra_discount_pct}
                  onChange={set('extra_discount_pct')}
                  placeholder="0"
                  inputMode="decimal"
                />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#c2410c', fontWeight: 600, fontSize: 13, pointerEvents: 'none' }}>%</span>
              </div>
            </Field>

            <Field label="Strips per Box (Pattay)">
              <div style={{ position: 'relative' }}>
                <input
                  data-f="strips_per_box"
                  className={`inp mono ${auto.strips_per_box ? 'filled' : ''}`}
                  value={f.strips_per_box}
                  onChange={set('strips_per_box')}
                  placeholder="1"
                  inputMode="numeric"
                />
              </div>
            </Field>

            <Field label="Quantity (packs / boxes)" auto={auto.stock}>
              {inp('stock', { inputMode: 'decimal', placeholder: '0' })}
            </Field>

            <Field label="Low stock level">
              {inp('low_stock_level', { inputMode: 'numeric', placeholder: '5' })}
            </Field>
          </div>

          {/* Dynamic Calculations Summary Box */}
          {mrpN > 0 && (
            <div style={{ margin: '0 18px 18px', padding: '14px 16px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="tag" style={{ width: 16, height: 16, color: 'var(--pr)' }} />
                  <span>Hisaab Kitab &amp; Profit Summary</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  MRP {rs2(mrpN)} · Effective Disc: <b>{effectiveDiscountPct}%</b> ({rs2(mrpN - purchaseCostPerPack)}) · Cost: <b>{rs2(purchaseCostPerPack)}</b>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 10 }}>
                <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>TP Discount Amount</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{rs2(tpDiscountAmount)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{tpPctN}% of MRP</div>
                </div>

                <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Amount After TP</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{rs2(amountAfterTp)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>MRP − TP Discount</div>
                </div>

                <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Extra Discount Amount</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{rs2(extraDiscountAmount)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{extraPctN}% of After-TP</div>
                </div>

                <div style={{ background: '#fefce8', padding: '10px 12px', borderRadius: 8, border: '1px solid #fde047' }}>
                  <div style={{ fontSize: 11, color: '#854d0e', fontWeight: 500 }}>Final Purchase Cost</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#854d0e', marginTop: 2 }}>{rs2(purchaseCostPerPack)}</div>
                  <div style={{ fontSize: 11, color: '#a16207', marginTop: 1 }}>Asal khareed qeemat</div>
                </div>

                <div style={{ background: '#f0fdf4', padding: '10px 12px', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: 11, color: '#166534', fontWeight: 500 }}>Profit / Pack</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#15803d', marginTop: 2 }}>{rs2(profitPerPack)}</div>
                  <div style={{ fontSize: 11, color: '#16a34a', marginTop: 1 }}>Margin {marginPct.toFixed(1)}% · Markup {markupPct.toFixed(1)}%</div>
                </div>

                <div style={{ background: '#fff', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Total Stock Cost</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{rs2(totalStockCost)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{qtyN} packs ki lagat</div>
                </div>

                <div style={{ background: '#ecfdf5', padding: '10px 12px', borderRadius: 8, border: '1px solid #a7f3d0' }}>
                  <div style={{ fontSize: 11, color: '#047857', fontWeight: 500 }}>Expected Total Profit</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#047857', marginTop: 2 }}>{rs2(totalStockProfit)}</div>
                  <div style={{ fontSize: 11, color: '#059669', marginTop: 1 }}>{qtyN} packs bikne par</div>
                </div>

                {stripsPerBoxN > 1 && (
                  <div style={{ gridColumn: '1 / -1', background: '#eff6ff', padding: '10px 14px', borderRadius: 8, border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#1e40af', fontWeight: 600, fontSize: 13 }}>
                      <Icon name="tag" style={{ width: 15, height: 15 }} />
                      <span>Strip / Patta Packaging ({stripsPerBoxN} strips/box):</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12.5, flexWrap: 'wrap' }}>
                      <div>Selling Price / Strip: <b style={{ color: '#1d4ed8' }}>{rs2(sellingPricePerStrip)}</b></div>
                      <div>Cost / Strip: <b style={{ color: '#475569' }}>{rs2(purchaseCostPerStrip)}</b></div>
                      <div>Munafa / Strip: <b style={{ color: '#15803d' }}>{rs2(profitPerStrip)}</b></div>
                      <div>Kul Strips: <b>{totalStripsInStock} strips</b></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {err && <div className="err" role="alert" style={{ margin: '0 18px 12px' }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 18px 18px' }}>{saveButtons}</div>
        </div>
        <PairCard />
      </div>
      {stockModal && orig && (
        <StockInModal
          product={orig}
          onClose={() => setStockModal(false)}
          onDone={() => {
            setStockModal(false);
            api(`/products/${id}`).then((r) => setOrig(r.product));
            reloadCounts();
          }}
        />
      )}
    </>
  );
}
