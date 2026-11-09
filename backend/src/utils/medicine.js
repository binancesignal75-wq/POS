/**
 * AI se aaya data saaf karna — jo bhi model ne likha ho, form mein hamesha ek hi shakal mein jaye.
 * Jo pakka nahi (ghalat barcode checksum, ajeeb expiry) wo khali chhor dete hain: ghalat data se khali behtar.
 */
const FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'sachet', 'other'];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const str = (v, max = 150) => (v === undefined || v === null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const blank = (s) => !s || /^(null|none|n\/?a|unknown|not (visible|available|found)|-+)$/i.test(s);
const clean = (v, max) => { const s = str(v, max); return blank(s) ? '' : s; };

/** "PANADOL EXTRA" -> "Panadol Extra"; numbers wale hisse (CAC-1000) waise hi */
function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.split(' ').map((w) => (/\d/.test(w) || w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase())).join(' ');
}

const FORM_WORDS = /\b(tablets?|tabs?|capsules?|caps?|syrup|suspension|injection|inj|cream|ointment|gel|drops?|sachets?|film[- ]coated|oral)\b\.?/gi;

function normName(v) {
  let s = clean(v, 150).replace(/[®™©]/g, ' ');
  if (!s) return '';
  const withoutForm = s.replace(FORM_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (withoutForm.length >= 2) s = withoutForm;              // "Panadol Tablets" -> "Panadol"
  s = s.replace(/\b\d+(?:[.,]\d+)?\s?(mg|mcg|µg|ug|gm?|ml|iu)\b(\s?\/\s?\d*\s?(ml|g))?/gi, ' ').replace(/\s+/g, ' ').trim(); // MG alag khane mein
  return titleCase(s.replace(/^[\s\-+.,]+|[\s\-+.,]+$/g, ''));
}

/** "500MG" -> "500 mg", "120mg/5ml" -> "120 mg/5ml", "500mg+125mg" -> "500 mg + 125 mg" */
function normStrength(v) {
  const s = clean(v, 60);
  if (!s) return '';
  return s
    .replace(/(\d)\s*,\s*(\d{3})\b/g, '$1$2')
    .replace(/µg|ug\b/gi, 'mcg')
    .replace(/(\d)\s*(mcg|mg|gm|g|ml|iu|%)/gi, (m, d, u) => `${d} ${u.toLowerCase().replace('gm', 'g')}`.replace(' %', '%'))
    .replace(/\s*\/\s*/g, '/')
    .replace(/\/(\d+) (ml|g)\b/g, '/$1$2')
    .replace(/\s*\+\s*/g, ' + ')
    .slice(0, 60);
}

function normForm(v) {
  const t = str(v, 40).toLowerCase();
  if (FORMS.includes(t)) return t;
  if (/cap/.test(t)) return 'capsule';
  if (/syr|susp|elixir|linctus/.test(t)) return 'syrup';
  if (/inj|vial|amp/.test(t)) return 'injection';
  if (/cream|oint|gel|lotion/.test(t)) return 'cream';
  if (/drop/.test(t)) return 'drops';
  if (/sachet|powder/.test(t)) return 'sachet';
  if (/tab/.test(t)) return 'tablet';
  return '';
}

/** Jo bhi shakal ho -> MM/YYYY. Samajh na aaye to khali. */
function normExpiry(v) {
  const s = clean(v, 30).toLowerCase();
  if (!s) return '';
  const year = (y) => (y.length === 2 ? `20${y}` : y);
  const ok = (m, y) => {
    const mm = Number(m), yy = Number(y);
    return mm >= 1 && mm <= 12 && yy >= 2000 && yy <= 2099 ? `${String(mm).padStart(2, '0')}/${yy}` : '';
  };
  let m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-./,]*(\d{4}|\d{2})\b/);
  if (m) return ok(MONTHS[m[1]], year(m[2]));
  m = s.match(/\b(\d{4})[\-/.](\d{1,2})(?:[\-/.]\d{1,2})?\b/);                 // 2028-08(-31)
  if (m) return ok(m[2], m[1]);
  m = s.match(/\b\d{1,2}[\-/.](\d{1,2})[\-/.](\d{4}|\d{2})\b/);                // 31/08/2028
  if (m) return ok(m[1], year(m[2]));
  m = s.match(/\b(\d{1,2})[\-/.\s](\d{4}|\d{2})\b/);                           // 08/2028, 08-28
  if (m) return ok(m[1], year(m[2]));
  return '';
}

/** "Rs. 1,250.00" -> "1250" */
function normMrp(v) {
  const s = clean(v, 30);
  if (!s) return '';
  const m = s.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/);
  if (!m) return '';
  const n = Number(m[0]);
  return n > 0 && n < 1000000 ? String(Number(n.toFixed(2))) : '';
}

/** EAN/UPC ka aakhri digit check digit hota hai — AI ek digit bhi ghalat parhe to pakra jata hai */
function checkDigitOk(d) {
  const a = d.split('').reverse().map(Number);
  const sum = a.slice(1).reduce((t, x, i) => t + (i % 2 === 0 ? x * 3 : x), 0);
  return (10 - (sum % 10)) % 10 === a[0];
}

function normBarcode(v) {
  const s = clean(v, 64);
  if (!s) return '';
  const d = s.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d)) return /^[A-Za-z0-9.\-_/+]{4,64}$/.test(d) ? d : '';
  if ([8, 12, 13, 14].includes(d.length)) return checkDigitOk(d) ? d : '';
  return d.length >= 6 ? d : '';
}

function normalizeMedicine(raw = {}) {
  return {
    name: normName(raw.name),
    strength: normStrength(raw.strength),
    form: normForm(raw.form),
    pack_size: clean(raw.pack_size, 60).replace(/(\d)\s*[x×*]\s*(\d)/gi, '$1x$2'),
    company: titleCase(clean(raw.company, 100)),
    mrp: normMrp(raw.mrp),
    batch_no: clean(raw.batch_no, 40).toUpperCase(),
    expiry_date: normExpiry(raw.expiry_date),
    barcode: normBarcode(raw.barcode)
  };
}

module.exports = { normalizeMedicine, normName, normStrength, normForm, normExpiry, normMrp, normBarcode };
