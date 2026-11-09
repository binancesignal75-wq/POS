export const rs = (v) => 'Rs ' + Math.round(Number(v) || 0).toLocaleString('en-PK');
export const rs2 = (v) => 'Rs ' + (Number(v) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1,42,380 -> "Rs 1.42 L" */
export const lakh = (v) => {
  const n = Number(v) || 0;
  if (n >= 10000000) return `Rs ${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `Rs ${(n / 100000).toFixed(2)} L`;
  return rs(n);
};

export const num = (v) => (Number(v) || 0).toLocaleString('en-PK');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
export const monthShort = (ym) => MONTHS[+ym.split('-')[1] - 1].slice(0, 3);

/** DB UTC "2026-11-03 02:14:00" -> local Date */
export const fromUtc = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z') : null);

export const time = (s) => fromUtc(s)?.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) || '';
export const dateTime = (s) => fromUtc(s)?.toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '';
export const dateOnly = (s) => fromUtc(s)?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) || '';

/** "2028-08-31" -> "08/2028" */
export const expiryShort = (d) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const daysUntil = (d) => (d ? Math.ceil((new Date(d + 'T23:59:59') - Date.now()) / 86400000) : null);

export const todayLong = () => new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const initials = (n = '') =>
  n.split(/[\s-]+/).filter((w) => w && !/^(medical|store|pharmacy|the|and|&)$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'MS';

export const FORMS = {
  tablet: { short: 'TAB', label: 'Tablet', icon: 'tablet', cls: 'f-tab', colorCls: 'med-icon-tab' },
  capsule: { short: 'CAP', label: 'Capsule', icon: 'capsule', cls: 'f-cap', colorCls: 'med-icon-cap' },
  syrup: { short: 'SYP', label: 'Syrup', icon: 'syrup', cls: 'f-syp', colorCls: 'med-icon-syp' },
  injection: { short: 'INJ', label: 'Injection', icon: 'injection', cls: 'f-inj', colorCls: 'med-icon-inj' },
  cream: { short: 'CRM', label: 'Cream', icon: 'cream', cls: 'f-crm', colorCls: 'med-icon-crm' },
  drops: { short: 'DRP', label: 'Drops', icon: 'droplet', cls: 'f-cap', colorCls: 'med-icon-drp' },
  sachet: { short: 'SCH', label: 'Sachet', icon: 'box', cls: 'f-syp', colorCls: 'med-icon-sch' },
  other: { short: 'OTH', label: 'Other', icon: 'pill', cls: 'f-inj', colorCls: 'med-icon-oth' }
};

export const getForm = (key = '') => {
  if (!key) return FORMS.other;
  const k = String(key).toLowerCase().trim();
  if (FORMS[k]) return FORMS[k];
  if (k === 'syp' || k === 'syr' || k === 'syrup' || k === 'susp' || k.includes('syrup') || k.includes('susp')) return FORMS.syrup;
  if (k === 'tab' || k === 'tablet' || k.includes('tablet')) return FORMS.tablet;
  if (k === 'cap' || k === 'capsule' || k.includes('capsule')) return FORMS.capsule;
  if (k === 'inj' || k === 'injection' || k === 'vial' || k.includes('inj')) return FORMS.injection;
  if (k === 'crm' || k === 'cream' || k === 'gel' || k.includes('cream')) return FORMS.cream;
  if (k === 'drp' || k === 'drops' || k === 'drop' || k.includes('drop')) return FORMS.drops;
  if (k === 'sch' || k === 'sachet' || k.includes('sachet')) return FORMS.sachet;
  return FORMS.other;
};

export const PAYMENTS = { cash: 'Cash', jazzcash: 'JazzCash', card: 'Card', udhaar: 'Udhaar' };

/**
 * Resolve strips_per_box from product record.
 * Uses saved strips_per_box (> 1), or infers from pack_size (e.g. "4 strips", "4x10") if strips_per_box is 1.
 */
export const getStripsPerBox = (p) => {
  if (!p) return 1;
  const explicit = parseInt(p.strips_per_box, 10);
  if (explicit > 1) return explicit;
  const ps = String(p.pack_size || '').trim();
  if (ps) {
    const mStrip = ps.match(/^(\d+)\s*(?:strips?|patt(?:a|ay|i|e))\b/i);
    if (mStrip && parseInt(mStrip[1], 10) > 1) return parseInt(mStrip[1], 10);
    const mGrid = ps.match(/^(\d+)\s*[xX*×]\s*\d+/);
    if (mGrid && parseInt(mGrid[1], 10) > 1 && parseInt(mGrid[1], 10) <= 100) return parseInt(mGrid[1], 10);
  }
  return 1;
};

/**
 * Format stock accurately in boxes and strips (e.g. "9 boxes, 2 strips (38 strips)").
 */
export const formatBoxStripStock = (stockBoxes, stripsPerBox = 1, compact = false) => {
  const spb = Math.max(1, parseInt(stripsPerBox, 10) || 1);
  const raw = Math.max(0, Number(stockBoxes) || 0);
  if (spb <= 1) {
    const boxes = Math.round(raw * 100) / 100;
    return `${boxes} ${boxes === 1 ? 'box' : 'boxes'}`;
  }
  const totalStrips = Math.max(0, Math.round(raw * spb));
  const fullBoxes = Math.floor(totalStrips / spb);
  const remStrips = totalStrips % spb;
  if (compact) {
    if (remStrips === 0) return `${fullBoxes} ${fullBoxes === 1 ? 'box' : 'boxes'} (${totalStrips} strips)`;
    return `${fullBoxes}b + ${remStrips}s (${totalStrips} strips)`;
  }
  if (remStrips === 0) {
    return `${fullBoxes} ${fullBoxes === 1 ? 'box' : 'boxes'} (${totalStrips} strips)`;
  }
  return `${fullBoxes} ${fullBoxes === 1 ? 'box' : 'boxes'}, ${remStrips} ${remStrips === 1 ? 'strip' : 'strips'} (${totalStrips} strips)`;
};

