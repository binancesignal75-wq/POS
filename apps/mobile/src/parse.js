/**
 * ML Kit text -> dawai ka naam, strength (MG), type, pack
 *
 * Naam = dabbi par sab se bara likha hua word/line (font height se),
 * jo generic words (tablets, composition, mfg …) na ho.
 */

const SKIP = /\b(tablets?|capsules?|caps?|tabs?|syrup|suspension|injection|cream|ointment|drops?|rx|only|each|contains?|composition|mfg|mfd|manufactured|exp(iry)?|batch|b\.?\s?no|reg(istration)?|drap|price|rs\.?|retail|keep|store|below|protect|light|children|dosage|directions?|warning|use|film|coated|oral|for|by|ltd|pvt|limited|pakistan|karachi|lahore|ingredients?|each\s+tablet)\b/i;

const STRENGTH_RE = /(\d+(?:[.,]\d+)?)\s?(mg|mcg|µg|ug|g|gm|ml|iu|%)(?:\s?\/\s?(\d+(?:[.,]\d+)?)?\s?(ml|g|tab))?/gi;

function lineHeight(l) {
  const f = l.frame || l.boundingBox || l.rect;
  if (!f) return 0;
  if (typeof f.height === 'number') return f.height;
  if (typeof f.bottom === 'number' && typeof f.top === 'number') return f.bottom - f.top;
  return 0;
}

function clean(s) {
  return s.replace(/[®™©*•|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function parseMedicine(result) {
  const text = result?.text || '';
  const lines = [];
  for (const b of result?.blocks || []) {
    for (const l of b.lines || [{ text: b.text, frame: b.frame }]) lines.push({ text: clean(l.text || ''), h: lineHeight(l) });
  }
  if (!lines.length) text.split('\n').forEach((t) => lines.push({ text: clean(t), h: 0 }));

  // ---- naam ----
  const candidates = lines
    .map((l) => {
      const letters = (l.text.match(/[A-Za-z]/g) || []).length;
      const withoutStrength = l.text.replace(STRENGTH_RE, '').trim();
      return { ...l, letters, base: withoutStrength };
    })
    .filter((l) => l.letters >= 3 && l.base.length >= 3 && l.base.length <= 32 && !SKIP.test(l.base) && !/^\d/.test(l.base));
  const hasHeights = candidates.some((c) => c.h > 0);
  candidates.sort((a, b) => (hasHeights ? b.h - a.h : 0) || a.base.length - b.base.length);
  let name = candidates[0]?.base || '';
  name = titleCase(name.replace(/[^A-Za-z0-9\s\-+]/g, '').trim());

  // ---- strength ----
  const found = [];
  let m;
  STRENGTH_RE.lastIndex = 0;
  while ((m = STRENGTH_RE.exec(text)) && found.length < 3) {
    const unit = m[2].toLowerCase().replace('µg', 'mcg').replace('ug', 'mcg').replace('gm', 'g');
    let s = `${m[1].replace(',', '.')} ${unit}`;
    if (m[4]) s += `/${m[3] || ''}${m[4].toLowerCase()}`;
    if (!found.includes(s) && !/^\d+ (ml)$/.test(s)) found.push(s);
  }
  // syrup: 120 mg/5ml + 90 ml pack
  const strength = found.slice(0, 2).join(' + ');

  // ---- type ----
  const t = text.toLowerCase();
  let form = null;
  if (/capsule|\bcaps?\b/.test(t)) form = 'capsule';
  else if (/syrup|suspension|elixir/.test(t)) form = 'syrup';
  else if (/injection|\bvial|ampoule|\bi\.?v\b|\bi\.?m\b/.test(t)) form = 'injection';
  else if (/cream|ointment|\bgel\b/.test(t)) form = 'cream';
  else if (/drops/.test(t)) form = 'drops';
  else if (/sachet/.test(t)) form = 'sachet';
  else if (/tablet|\btabs?\b/.test(t)) form = 'tablet';

  // ---- pack ----
  let pack = '';
  const p1 = text.match(/(\d+)\s*[x×]\s*(\d+)\s*(tablets?|tabs?|capsules?|caps?)?/i);
  const p2 = text.match(/(\d+)\s*(tablets|tabs|capsules|caps|sachets)\b/i);
  // sab "NN ml" jo "/" ke baad na hon — sab se bara pack size hai
  const mls = [...text.matchAll(/(^|[^\/\d])(\d+)\s*ml\b/gi)].map((x) => Number(x[2]));
  const p3 = mls.length ? [null, String(Math.max(...mls))] : null;
  if (p1) pack = `${p1[1]}x${p1[2]} ${p1[3] ? p1[3].toLowerCase() : (form === 'capsule' ? 'capsules' : 'tablets')}`;
  else if (p2) pack = `${p2[1]} ${p2[2].toLowerCase()}`;
  else if (p3 && (form === 'syrup' || form === 'drops')) pack = `${p3[1]} ml`;

  return { name, strength, form, pack_size: pack, raw: text };
}
