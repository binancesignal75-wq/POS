/**
 * Sales (bills). Bill banate waqt:
 *  - stock kam hota hai
 *  - TP ke hisaab se cost aur profit save hota hai
 *  - har store ka apna bill number (10001, 10002 …)
 */
const router = require('express').Router();
const { one, query, tx, TZ } = require('../db');
const { ah, HttpError, round2 } = require('../utils/helpers');

const PAY = ['cash', 'jazzcash', 'card', 'udhaar'];
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

function resolveStripsPerBox(p) {
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
}

router.post('/', ah(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new HttpError(400, 'Bill mein koi dawai nahi');
  const discount = Math.min(100, Math.max(0, Number(req.body.discount_pct) || 0));
  const method = PAY.includes(req.body.payment_method) ? req.body.payment_method : 'cash';
  const paid = round2(req.body.paid);

  // Group lines by product_id and unit ('box' | 'strip')
  const merged = new Map();
  for (const it of items) {
    const id = parseInt(it.product_id, 10);
    const qty = parseInt(it.qty, 10);
    const unit = it.unit === 'strip' ? 'strip' : 'box';
    if (!id || !qty || qty < 1) throw new HttpError(400, 'Bill ki line ghalat hai');
    const key = `${id}_${unit}`;
    const prev = merged.get(key) || { product_id: id, unit, qty: 0 };
    prev.qty += qty;
    merged.set(key, prev);
  }

  const saleId = await tx(async (conn) => {
    const [[st]] = await conn.query('SELECT last_bill_no FROM stores WHERE id = ? FOR UPDATE', [req.storeId]);
    const billNo = st.last_bill_no + 1;

    const uniqueProductIds = [...new Set([...merged.values()].map((m) => m.product_id))];
    const [prods] = await conn.query(
      `SELECT * FROM products WHERE store_id = ? AND is_active = 1 AND id IN (${uniqueProductIds.map(() => '?').join(',')}) FOR UPDATE`,
      [req.storeId, ...uniqueProductIds]
    );
    const byId = new Map(prods.map((p) => [p.id, p]));

    // Check total stock demand per product in strip equivalents
    const demandStrips = new Map();
    for (const m of merged.values()) {
      const p = byId.get(m.product_id);
      if (!p) throw new HttpError(404, 'Bill ki koi dawai mili nahi');
      const spb = resolveStripsPerBox(p);
      const stripsNeeded = (m.unit === 'strip' && spb > 1) ? m.qty : (m.qty * spb);
      demandStrips.set(p.id, (demandStrips.get(p.id) || 0) + stripsNeeded);
    }

    for (const [pid, needed] of demandStrips.entries()) {
      const p = byId.get(pid);
      const spb = resolveStripsPerBox(p);
      const availableStrips = Math.max(0, Math.round(Number(p.stock) * spb));
      if (availableStrips < needed) {
        if (spb > 1) {
          const fullBoxes = Math.floor(availableStrips / spb);
          const remStrips = availableStrips % spb;
          const boxText = remStrips > 0 ? `${fullBoxes} boxes, ${remStrips} strips` : `${fullBoxes} boxes`;
          throw new HttpError(409, `${p.name}: stock sirf ${boxText} (${availableStrips} strips) hai`);
        } else {
          throw new HttpError(409, `${p.name}: stock sirf ${Math.round(Number(p.stock) * 100) / 100} boxes hai`);
        }
      }
    }

    let subtotal = 0, cost = 0, count = 0;
    const lines = [];
    for (const m of merged.values()) {
      const p = byId.get(m.product_id);
      const spb = resolveStripsPerBox(p);
      const isStrip = m.unit === 'strip' && spb > 1;

      const unitPrice = isStrip ? round2(p.mrp / spb) : round2(p.mrp);
      const unitTp = isStrip ? round2(p.tp / spb) : round2(p.tp);
      const lineTotal = round2(unitPrice * m.qty);
      const lineCost = round2(unitTp * m.qty);

      subtotal += lineTotal;
      cost += lineCost;
      count += m.qty;

      lines.push({
        p,
        unit: isStrip ? 'strip' : 'box',
        qty: m.qty,
        price: unitPrice,
        tp: unitTp,
        total: lineTotal
      });
    }

    subtotal = round2(subtotal);
    cost = round2(cost);
    const discountAmount = round2(subtotal * (discount / 100));
    const total = round2(subtotal - discountAmount);
    const profit = round2(total - cost);
    const change = method === 'cash' ? Math.max(0, round2(paid - total)) : 0;

    let r;
    try {
      [r] = await conn.query(
        `INSERT INTO sales (store_id, bill_no, subtotal, discount_pct, discount_amount, total, cost_total, profit, payment_method, customer_name, paid, change_due, items_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.storeId, billNo, subtotal, discount, discountAmount, total, cost, profit, method,
          String(req.body.customer_name || '').trim().slice(0, 100) || null, paid, change, count]
      );
    } catch (err) {
      if (err.code === 'ER_BAD_FIELD_ERROR') {
        [r] = await conn.query(
          `INSERT INTO sales (store_id, bill_no, subtotal, discount_pct, total, cost_total, profit, payment_method, customer_name, paid, change_due, items_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [req.storeId, billNo, subtotal, discount, total, cost, profit, method,
            String(req.body.customer_name || '').trim().slice(0, 100) || null, paid, change, count]
        );
      } else {
        throw err;
      }
    }

    for (const l of lines) {
      const nm = [l.p.name, l.p.strength].filter(Boolean).join(' ');
      try {
        await conn.query(
          'INSERT INTO sale_items (sale_id, store_id, product_id, name, unit, qty, price, tp, total) VALUES (?,?,?,?,?,?,?,?,?)',
          [r.insertId, req.storeId, l.p.id, nm, l.unit, l.qty, l.price, l.tp, l.total]
        );
      } catch (itemErr) {
        if (itemErr.code === 'ER_BAD_FIELD_ERROR') {
          await conn.query(
            'INSERT INTO sale_items (sale_id, store_id, product_id, name, qty, price, tp, total) VALUES (?,?,?,?,?,?,?,?)',
            [r.insertId, req.storeId, l.p.id, nm, l.qty, l.price, l.tp, l.total]
          );
        } else {
          throw itemErr;
        }
      }
    }

    // Deduct stock accurately in strip equivalents to eliminate decimal drift
    for (const [pid, neededStrips] of demandStrips.entries()) {
      const p = byId.get(pid);
      const spb = resolveStripsPerBox(p);
      const currentStrips = Math.max(0, Math.round(Number(p.stock) * spb));
      const remainingStrips = Math.max(0, currentStrips - neededStrips);
      const newStock = round4(remainingStrips / spb);

      await conn.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, pid]);
    }

    await conn.query('UPDATE stores SET last_bill_no = ? WHERE id = ?', [billNo, req.storeId]);
    return r.insertId;
  });

  res.status(201).json(await loadSale(req.storeId, saleId));
}));

async function loadSale(storeId, id) {
  const sale = await one('SELECT * FROM sales WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!sale) throw new HttpError(404, 'Bill nahi mila');
  const items = await query(
    `SELECT si.*, p.strips_per_box, p.pack_size, p.mrp AS box_mrp
     FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = ?
     ORDER BY si.id`,
    [id]
  );
  return { sale, items };
}

router.get('/next-bill-no', ah(async (req, res) => {
  res.json({ bill_no: req.store.last_bill_no + 1 });
}));

router.get('/', ah(async (req, res) => {
  const range = req.query.range || 'today';
  const dateParam = req.query.date;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const local = `DATE(CONVERT_TZ(created_at, '+00:00', ?))`;
  const today = `DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?))`;
  const tz = TZ();

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const cond = `${local} = ?`;
    const [{ total }] = await query(`SELECT COUNT(*) total FROM sales WHERE store_id = ? AND ${cond}`, [req.storeId, tz, dateParam]);
    const rows = await query(
      `SELECT * FROM sales WHERE store_id = ? AND ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [req.storeId, tz, dateParam, limit, (page - 1) * limit]
    );
    return res.json({ sales: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }

  const conds = {
    today: `${local} = ${today}`,
    yesterday: `${local} = ${today} - INTERVAL 1 DAY`,
    week: `${local} >= ${today} - INTERVAL 6 DAY`,
    month: `DATE_FORMAT(CONVERT_TZ(created_at,'+00:00',?), '%Y-%m') = DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00',?), '%Y-%m')`
  };
  const c = conds[range] || conds.today;
  const [{ total }] = await query(`SELECT COUNT(*) total FROM sales WHERE store_id = ? AND ${c}`, [req.storeId, tz, tz]);
  const rows = await query(
    `SELECT * FROM sales WHERE store_id = ? AND ${c} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [req.storeId, tz, tz, limit, (page - 1) * limit]
  );
  res.json({ sales: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/:id', ah(async (req, res) => {
  res.json(await loadSale(req.storeId, req.params.id));
}));

module.exports = router;
