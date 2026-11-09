/**
 * Products (dawaiyan) — har query store_id se filter
 */
const router = require('express').Router();
const { one, query, tx } = require('../db');
const { ah, HttpError, round2 } = require('../utils/helpers');
const { normExpiry } = require('../utils/medicine');

const FORMS = ['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'sachet', 'other'];

const clean = (v) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const cut = (v, max) => { const s = clean(v); return s === null ? null : s.slice(0, max); }; // DB column ki lambai
const BAD_DATE = 'Expiry date ghalat hai (MM/YYYY likhein)';
const ymd = (y, mo, d) => {
  const last = Number(lastDay(y, mo));
  if (+mo < 1 || +mo > 12 || (d !== undefined && (+d < 1 || +d > last))) throw new HttpError(400, BAD_DATE);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d ?? last).padStart(2, '0')}`;
};
const toDate = (v) => {
  const s = clean(v);
  if (!s) return null;
  // "2028-08", "08/2028", "2028-08-31" sab chalein
  const m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (m) return ymd(m[1], m[2], m[3]);
  const my = normExpiry(s); // 08/2028, 08-28, Aug 2028 ...
  if (my) return ymd(my.slice(3), my.slice(0, 2));
  throw new HttpError(400, BAD_DATE);
};
const lastDay = (y, m) => String(new Date(Date.UTC(+y, +m, 0)).getUTCDate());
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

function inferStripsPerBox(rawSpb, packSize) {
  const explicit = parseInt(rawSpb, 10);
  if (explicit > 1) return explicit;
  const ps = String(packSize || '').trim();
  if (ps) {
    const mStrip = ps.match(/^(\d+)\s*(?:strips?|patt(?:a|ay|i|e))\b/i);
    if (mStrip && parseInt(mStrip[1], 10) > 1) return parseInt(mStrip[1], 10);
    const mGrid = ps.match(/^(\d+)\s*[xX*×]\s*\d+/);
    if (mGrid && parseInt(mGrid[1], 10) > 1 && parseInt(mGrid[1], 10) <= 100) return parseInt(mGrid[1], 10);
  }
  return explicit === 1 ? 1 : 1;
}

function readBody(b, partial = false) {
  const out = {};
  const set = (k, v) => { if (!partial || b[k] !== undefined) out[k] = v; };
  set('name', cut(b.name, 150));
  set('strength', cut(b.strength, 60));
  set('form', FORMS.includes(b.form) ? b.form : 'other');
  set('pack_size', cut(b.pack_size, 60));
  const spbProvided = b.strips_per_box !== undefined && b.strips_per_box !== '';
  const spb = spbProvided
    ? inferStripsPerBox(b.strips_per_box, b.pack_size)
    : (partial ? (b.pack_size !== undefined ? inferStripsPerBox(1, b.pack_size) : undefined) : inferStripsPerBox(1, b.pack_size));
  if (spb !== undefined) out.strips_per_box = spb;
  set('company', cut(b.company, 100));
  set('barcode', cut(b.barcode, 64));
  set('barcode_strip', cut(b.barcode_strip, 64));
  set('barcode_alt', cut(b.barcode_alt, 64));
  set('mrp', round2(b.mrp));

  // TP and Extra discount percentage
  const tpPctProvided = b.tp_pct !== undefined && b.tp_pct !== '';
  const extraPctProvided = b.extra_discount_pct !== undefined && b.extra_discount_pct !== '';
  const tpPct = tpPctProvided ? Math.max(0, Math.min(100, Number(b.tp_pct) || 0)) : (partial ? undefined : 14.5);
  const extraPct = extraPctProvided ? Math.max(0, Math.min(100, Number(b.extra_discount_pct) || 0)) : (partial ? undefined : 0);

  if (tpPct !== undefined) {
    if (tpPct < 0 || tpPct > 100) throw new HttpError(400, 'TP Discount 0% se 100% ke darmiyan hona chahiye');
    set('tp_pct', round2(tpPct));
  }
  if (extraPct !== undefined) {
    if (extraPct < 0 || extraPct > 100) throw new HttpError(400, 'Extra Discount 0% se 100% ke darmiyan hona chahiye');
    set('extra_discount_pct', round2(extraPct));
  }

  // Calculate purchase cost (tp) per pack using sequential discount logic:
  // Step 1: TP Discount on MRP -> Amount After TP
  // Step 2 & 3: Extra Discount on Amount After TP -> Final Purchase Cost
  if (out.mrp !== undefined && out.mrp > 0) {
    if (b.tp !== undefined && b.tp !== '' && !tpPctProvided && !extraPctProvided) {
      set('tp', round2(b.tp));
    } else {
      const tpVal = tpPct !== undefined ? tpPct : 14.5;
      const extraVal = extraPct !== undefined ? extraPct : 0;
      const amountAfterTp = out.mrp * (1 - tpVal / 100);
      const calculatedTp = round2(amountAfterTp * (1 - extraVal / 100));
      set('tp', calculatedTp);
    }
  } else if (b.tp !== undefined && b.tp !== '') {
    set('tp', round2(b.tp));
  } else if (!partial) {
    set('tp', 0);
  }

  set('low_stock_level', Math.max(0, parseInt(b.low_stock_level, 10) || 0));
  set('batch_no', cut(b.batch_no, 40));
  if (!partial || b.expiry_date !== undefined) out.expiry_date = toDate(b.expiry_date);
  if (out.name === null) throw new HttpError(400, 'Dawai ka naam zaroori hai');
  if (out.mrp !== undefined && out.mrp <= 0) throw new HttpError(400, 'MRP 0 se zyada honi chahiye');
  if (out.tp !== undefined && out.tp < 0) throw new HttpError(400, 'TP ghalat hai');
  return out;
}

async function barcodeTaken(storeId, barcode, exceptId = 0) {
  if (!barcode) return null;
  return one(
    `SELECT id, name, strength, form, pack_size, strips_per_box, mrp, tp, tp_pct, extra_discount_pct, stock, barcode, barcode_strip, barcode_alt FROM products 
     WHERE store_id = ? AND is_active = 1 AND id <> ? 
       AND (barcode = ? OR barcode_strip = ? OR barcode_alt = ?) LIMIT 1`,
    [storeId, exceptId, barcode, barcode, barcode]
  );
}

// ---------- check barcode availability & lookup ----------
router.get('/check-barcode', ah(async (req, res) => {
  const code = String(req.query.code || '').trim();
  const exceptId = parseInt(req.query.exceptId, 10) || 0;

  if (code) {
    const p = await barcodeTaken(req.storeId, code, exceptId);
    if (p) return res.json({ found: true, product: p, reason: 'barcode' });
  }
  res.json({ found: false, product: null });
}));

// ---------- list ----------
router.get('/', ah(async (req, res) => {
  const sid = req.storeId;
  const { q = '', filter = 'all' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const where = ['store_id = ?', 'is_active = 1'];
  const params = [sid];
  if (q) {
    where.push('(name LIKE ? OR barcode LIKE ? OR barcode_strip LIKE ? OR barcode_alt LIKE ? OR company LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (filter === 'low') where.push('stock <= low_stock_level');
  if (filter === 'out') where.push('stock <= 0');
  if (filter === 'expiring') where.push('expiry_date IS NOT NULL AND expiry_date <= CURDATE() + INTERVAL 90 DAY');
  if (filter === 'nocode') where.push('barcode IS NULL AND barcode_strip IS NULL AND barcode_alt IS NULL');
  const w = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) total FROM products WHERE ${w}`, params);
  const rows = await query(
    `SELECT * FROM products WHERE ${w} ORDER BY name ASC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ products: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// ---------- counts for tabs ----------
router.get('/counts', ah(async (req, res) => {
  const r = await one(`
    SELECT COUNT(*) total,
      SUM(stock <= low_stock_level) low,
      SUM(expiry_date IS NOT NULL AND expiry_date <= CURDATE() + INTERVAL 90 DAY) expiring,
      SUM(barcode IS NULL AND barcode_strip IS NULL AND barcode_alt IS NULL) nocode,
      COALESCE(SUM(stock * tp), 0) stock_value
    FROM products WHERE store_id = ? AND is_active = 1`, [req.storeId]);
  res.json({ total: +r.total || 0, low: +r.low || 0, expiring: +r.expiring || 0, nocode: +r.nocode || 0, stock_value: +r.stock_value || 0 });
}));

// ---------- quick search for POS (naam ya barcode) ----------
router.get('/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ products: [] });
  const exact = await query(
    `SELECT * FROM products WHERE store_id = ? AND is_active = 1 
     AND (barcode = ? OR barcode_strip = ? OR barcode_alt = ?) LIMIT 1`,
    [req.storeId, q, q, q]
  );
  if (exact.length) {
    const p = exact[0];
    const spb = inferStripsPerBox(p.strips_per_box, p.pack_size);
    p.strips_per_box = spb;
    p.matched_unit = (p.barcode_strip && p.barcode_strip === q && spb > 1) ? 'strip' : 'box';
    return res.json({ products: [p], exact: true });
  }
  const rows = await query(
    `SELECT * FROM products WHERE store_id = ? AND is_active = 1 AND name LIKE ?
     ORDER BY (name LIKE ?) DESC, name LIMIT 10`,
    [req.storeId, `%${q}%`, `${q}%`]
  );
  for (const r of rows) {
    r.strips_per_box = inferStripsPerBox(r.strips_per_box, r.pack_size);
  }
  res.json({ products: rows, exact: false });
}));

// ---------- low stock list (PDF ke liye) ----------
router.get('/low-stock', ah(async (req, res) => {
  const rows = await query(
    `SELECT *, GREATEST(low_stock_level * 2 - stock, 1) AS suggested_qty
     FROM products WHERE store_id = ? AND is_active = 1 AND stock <= low_stock_level
     ORDER BY stock ASC, name ASC`, [req.storeId]);
  res.json({ products: rows });
}));

router.get('/barcode/:code', ah(async (req, res) => {
  const code = String(req.params.code || '').trim();
  const p = await one(
    `SELECT * FROM products WHERE store_id = ? AND is_active = 1 
     AND (barcode = ? OR barcode_strip = ? OR barcode_alt = ?)`,
    [req.storeId, code, code, code]
  );
  if (!p) throw new HttpError(404, 'Is barcode ki dawai nahi mili');
  const spb = inferStripsPerBox(p.strips_per_box, p.pack_size);
  p.strips_per_box = spb;
  p.matched_unit = (p.barcode_strip && p.barcode_strip === code && spb > 1) ? 'strip' : 'box';
  res.json({ product: p });
}));

router.get('/:id', ah(async (req, res) => {
  const p = await one('SELECT * FROM products WHERE id = ? AND store_id = ?', [req.params.id, req.storeId]);
  if (!p) throw new HttpError(404, 'Dawai nahi mili');
  res.json({ product: p });
}));

// ---------- create (stock > 0 ho to purchase bhi ban jati hai) ----------
router.post('/', ah(async (req, res) => {
  const d = readBody(req.body);
  const stock = Math.max(0, round4(parseFloat(req.body.stock) || 0));

  // 1. Check duplicates across all 3 barcode locations
  const checks = [
    { label: 'Barcode', val: d.barcode },
    { label: 'Strip Barcode', val: d.barcode_strip },
    { label: 'Alternate Barcode', val: d.barcode_alt },
  ];
  for (const b of checks) {
    if (b.val) {
      const dup = await barcodeTaken(req.storeId, b.val);
      if (dup) {
        throw new HttpError(
          409,
          `Ye dawai already added hai! Barcode "${b.val}" pehle se "${dup.name}${dup.strength ? ' ' + dup.strength : ''}" par laga hai. Naya stock daalne ke liye dawai ki list mein "+ Stock" use karein.`
        );
      }
    }
  }

  const id = await tx(async (conn) => {
    let r;
    try {
      [r] = await conn.query(
        `INSERT INTO products (store_id, name, strength, form, pack_size, strips_per_box, company, barcode, barcode_strip, barcode_alt, mrp, tp_pct, extra_discount_pct, tp, stock, low_stock_level, batch_no, expiry_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.storeId, d.name, d.strength, d.form, d.pack_size, d.strips_per_box ?? 1, d.company, d.barcode, d.barcode_strip, d.barcode_alt, d.mrp, d.tp_pct ?? 14.5, d.extra_discount_pct ?? 0, d.tp, stock, d.low_stock_level, d.batch_no, d.expiry_date]
      );
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        [r] = await conn.query(
          `INSERT INTO products (store_id, name, strength, form, pack_size, company, barcode, mrp, tp, stock, low_stock_level, batch_no, expiry_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [req.storeId, d.name, d.strength, d.form, d.pack_size, d.company, d.barcode, d.mrp, d.tp, stock, d.low_stock_level, d.batch_no, d.expiry_date]
        );
      } else {
        throw err;
      }
    }
    if (stock > 0) {
      const totalCost = round2(stock * d.tp);
      const supplierName = cut(req.body.supplier, 120);

      await conn.query(
        `INSERT INTO purchases (store_id, product_id, qty, tp, total, supplier, batch_no, expiry_date)
         VALUES (?,?,?,?,?,?,?,?)`,
        [req.storeId, r.insertId, stock, d.tp, totalCost, supplierName, d.batch_no, d.expiry_date]
      );
    }
    return r.insertId;
  });
  res.status(201).json({ product: await one('SELECT * FROM products WHERE id = ?', [id]) });
}));

// ---------- update (stock yahan se nahi — /stock ya /adjust use karein) ----------
router.put('/:id', ah(async (req, res) => {
  const p = await one('SELECT * FROM products WHERE id = ? AND store_id = ?', [req.params.id, req.storeId]);
  if (!p) throw new HttpError(404, 'Dawai nahi mili');
  const d = readBody(req.body, true);

  const checks = [
    { label: 'Box Barcode', val: d.barcode },
    { label: 'Strip / Pack Barcode', val: d.barcode_strip },
    { label: 'Alternate Barcode', val: d.barcode_alt },
  ];
  for (const b of checks) {
    if (b.val) {
      const dup = await barcodeTaken(req.storeId, b.val, p.id);
      if (dup) throw new HttpError(409, `Ye ${b.label} ("${b.val}") pehle se "${dup.name}" par laga hai`);
    }
  }

  // Allow direct stock edit if provided
  if (req.body.stock !== undefined && req.body.stock !== '') {
    const s = round4(parseFloat(req.body.stock));
    if (!Number.isNaN(s) && s >= 0) {
      d.stock = s;
    }
  }

  // Ensure tp is recalculated if mrp, tp_pct, or extra_discount_pct are updated without explicit tp
  if ((d.mrp !== undefined || d.tp_pct !== undefined || d.extra_discount_pct !== undefined) && (req.body.tp === undefined || req.body.tp === '')) {
    const effectiveMrp = d.mrp !== undefined ? d.mrp : p.mrp;
    const effectiveTpPct = d.tp_pct !== undefined ? d.tp_pct : (p.tp_pct ?? 14.5);
    const effectiveExtraPct = d.extra_discount_pct !== undefined ? d.extra_discount_pct : (p.extra_discount_pct ?? 0);
    if (effectiveMrp > 0) {
      const amountAfterTp = effectiveMrp * (1 - effectiveTpPct / 100);
      d.tp = round2(amountAfterTp * (1 - effectiveExtraPct / 100));
    }
  }

  const keys = Object.keys(d);
  if (keys.length) {
    try {
      await query(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND store_id = ?`,
        [...keys.map((k) => d[k]), p.id, req.storeId]);
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        const safeKeys = keys.filter((k) => !['tp_pct', 'extra_discount_pct', 'barcode_strip', 'barcode_alt', 'strips_per_box'].includes(k));
        if (safeKeys.length) {
          await query(`UPDATE products SET ${safeKeys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND store_id = ?`,
            [...safeKeys.map((k) => d[k]), p.id, req.storeId]);
        }
      } else {
        throw err;
      }
    }
  }
  res.json({ product: await one('SELECT * FROM products WHERE id = ?', [p.id]) });
}));

// ---------- stock aaya (purchase) ----------
router.post('/:id/stock', ah(async (req, res) => {
  const qty = parseInt(req.body.qty, 10);
  if (!qty || qty < 1) throw new HttpError(400, 'Quantity daalein');
  const out = await tx(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM products WHERE id = ? AND store_id = ? FOR UPDATE', [req.params.id, req.storeId]);
    if (!p) throw new HttpError(404, 'Dawai nahi mili');

    const tpPct = req.body.tp_pct !== undefined && req.body.tp_pct !== ''
      ? Math.max(0, Math.min(100, Number(req.body.tp_pct) || 0))
      : (p.tp_pct ?? 14.5);
    const extraPct = req.body.extra_discount_pct !== undefined && req.body.extra_discount_pct !== ''
      ? Math.max(0, Math.min(100, Number(req.body.extra_discount_pct) || 0))
      : (p.extra_discount_pct ?? 0);

    let tp;
    if (req.body.tp !== undefined && req.body.tp !== '') {
      tp = round2(req.body.tp);
    } else if (p.mrp > 0) {
      const amountAfterTp = p.mrp * (1 - tpPct / 100);
      tp = round2(amountAfterTp * (1 - extraPct / 100));
    } else {
      tp = p.tp;
    }

    const batch = cut(req.body.batch_no, 40) || p.batch_no;
    const exp = req.body.expiry_date ? toDate(req.body.expiry_date) : p.expiry_date;
    const totalCost = round2(qty * tp);
    const supplierName = cut(req.body.supplier, 120);

    await conn.query(
      `INSERT INTO purchases (store_id, product_id, qty, tp, total, supplier, batch_no, expiry_date)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.storeId, p.id, qty, tp, totalCost, supplierName, batch, exp]
    );

    try {
      await conn.query(
        'UPDATE products SET stock = stock + ?, tp = ?, tp_pct = ?, extra_discount_pct = ?, batch_no = ?, expiry_date = ? WHERE id = ?',
        [qty, tp, tpPct, extraPct, batch, exp, p.id]
      );
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        await conn.query(
          'UPDATE products SET stock = stock + ?, tp = ?, batch_no = ?, expiry_date = ? WHERE id = ?',
          [qty, tp, batch, exp, p.id]
        );
      } else {
        throw err;
      }
    }
    const [[n]] = await conn.query('SELECT * FROM products WHERE id = ?', [p.id]);
    return n;
  });
  res.json({ product: out });
}));

// ---------- stock theek karna (ginti ke baad) — purchase nahi banti ----------
router.post('/:id/adjust', ah(async (req, res) => {
  const stock = round4(parseFloat(req.body.stock));
  if (Number.isNaN(stock) || stock < 0) throw new HttpError(400, 'Sahi stock daalein');
  const r = await query('UPDATE products SET stock = ? WHERE id = ? AND store_id = ?', [stock, req.params.id, req.storeId]);
  if (!r.affectedRows) throw new HttpError(404, 'Dawai nahi mili');
  res.json({ product: await one('SELECT * FROM products WHERE id = ?', [req.params.id]) });
}));

// ---------- delete (purani sales ka record rehta hai) ----------
router.delete('/:id', ah(async (req, res) => {
  const r = await query('UPDATE products SET is_active = 0, barcode = NULL WHERE id = ? AND store_id = ?', [req.params.id, req.storeId]);
  if (!r.affectedRows) throw new HttpError(404, 'Dawai nahi mili');
  res.json({ ok: true });
}));

module.exports = router;
