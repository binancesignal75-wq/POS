/**
 * Dashboard + Monthly Records
 *
 * "Har mahine dashboard 0" — dashboard sirf is mahine ka data dikhata hai,
 * is liye 1 tareekh ko khud 0 se shuru hota hai. Pichle mahine ka record
 * sales/purchases tables se seedha nikalta hai, kuch delete nahi hota.
 */
const router = require('express').Router();
const { one, query, TZ } = require('../db');
const { ah } = require('../utils/helpers');

const LOCAL = (col) => `CONVERT_TZ(${col}, '+00:00', ?)`;
const NOW_LOCAL = `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)`;

const n = (v) => Number(v) || 0;

router.get('/dashboard', ah(async (req, res) => {
  const sid = req.storeId;
  const tz = TZ();
  const dateParam = req.query.date;
  const hasCustomDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);

  const dayTarget = hasCustomDate
    ? one(
        `SELECT COALESCE(SUM(total),0) sale, COALESCE(SUM(profit),0) profit, COUNT(*) bills
         FROM sales WHERE store_id = ? AND DATE(${LOCAL('created_at')}) = ?`,
        [sid, tz, dateParam])
    : one(
        `SELECT COALESCE(SUM(total),0) sale, COALESCE(SUM(profit),0) profit, COUNT(*) bills
         FROM sales WHERE store_id = ? AND DATE(${LOCAL('created_at')}) = DATE(${NOW_LOCAL})`,
        [sid, tz, tz]);

  const prevDayTarget = hasCustomDate
    ? one(
        `SELECT COALESCE(SUM(total),0) sale, COALESCE(SUM(profit),0) profit, COUNT(*) bills
         FROM sales WHERE store_id = ? AND DATE(${LOCAL('created_at')}) = DATE(?) - INTERVAL 1 DAY`,
        [sid, tz, dateParam])
    : one(
        `SELECT COALESCE(SUM(total),0) sale, COALESCE(SUM(profit),0) profit, COUNT(*) bills
         FROM sales WHERE store_id = ? AND DATE(${LOCAL('created_at')}) = DATE(${NOW_LOCAL}) - INTERVAL 1 DAY`,
        [sid, tz, tz]);

  // is mahina, aur pichle mahine ke utne hi din (comparison ke liye)
  const monthSales = one(
    `SELECT COALESCE(SUM(total),0) sale, COALESCE(SUM(profit),0) profit, COUNT(*) bills, COALESCE(SUM(items_count),0) items
     FROM sales WHERE store_id = ? AND DATE_FORMAT(${LOCAL('created_at')}, '%Y-%m') = DATE_FORMAT(${NOW_LOCAL}, '%Y-%m')`,
    [sid, tz, tz]);
  const prevSamePeriod = one(
    `SELECT COALESCE(SUM(total),0) sale FROM sales WHERE store_id = ?
       AND DATE_FORMAT(${LOCAL('created_at')}, '%Y-%m') = DATE_FORMAT(${NOW_LOCAL} - INTERVAL 1 MONTH, '%Y-%m')
       AND DAY(${LOCAL('created_at')}) <= DAY(${NOW_LOCAL})`,
    [sid, tz, tz, tz, tz]);
  const monthIn = one(
    `SELECT COALESCE(SUM(total),0) value, COALESCE(SUM(qty),0) qty, COUNT(DISTINCT supplier) suppliers
     FROM purchases WHERE store_id = ? AND DATE_FORMAT(${LOCAL('created_at')}, '%Y-%m') = DATE_FORMAT(${NOW_LOCAL}, '%Y-%m')`,
    [sid, tz, tz]);
  const expiring = one(
    `SELECT COUNT(*) cnt, COALESCE(SUM(stock * tp),0) value FROM products
     WHERE store_id = ? AND is_active = 1 AND stock > 0 AND expiry_date IS NOT NULL
       AND expiry_date <= DATE(${NOW_LOCAL}) + INTERVAL 90 DAY`, [sid, tz]);
  const low = one('SELECT COUNT(*) cnt FROM products WHERE store_id = ? AND is_active = 1 AND stock <= low_stock_level', [sid]);

  const chart = query(
    `SELECT DATE_FORMAT(${LOCAL('created_at')}, '%Y-%m') ym, SUM(total) sale, SUM(profit) profit
     FROM sales WHERE store_id = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 MONTH
     GROUP BY ym ORDER BY ym`, [tz, sid]);
  const recent = query('SELECT * FROM sales WHERE store_id = ? ORDER BY id DESC LIMIT 8', [sid]);
  const lowList = query(
    `SELECT id, name, strength, stock, low_stock_level FROM products
     WHERE store_id = ? AND is_active = 1 AND stock <= low_stock_level ORDER BY stock ASC LIMIT 5`, [sid]);
  const expList = query(
    `SELECT id, name, strength, stock, batch_no, expiry_date, DATEDIFF(expiry_date, DATE(${NOW_LOCAL})) days
     FROM products WHERE store_id = ? AND is_active = 1 AND stock > 0 AND expiry_date IS NOT NULL
       AND expiry_date <= DATE(${NOW_LOCAL}) + INTERVAL 90 DAY ORDER BY expiry_date ASC LIMIT 5`, [tz, sid, tz]);
  const nowLocal = one(`SELECT DATE_FORMAT(${NOW_LOCAL}, '%Y-%m-%d') d, DAY(LAST_DAY(${NOW_LOCAL})) days_in_month`, [tz, tz]);

  const [t, y, m, pm, mi, ex, lo, ch, rc, ll, el, nl] = await Promise.all(
    [dayTarget, prevDayTarget, monthSales, prevSamePeriod, monthIn, expiring, low, chart, recent, lowList, expList, nowLocal]);

  // pichle 6 mahine (khali mahine bhi 0 ke saath)
  const months = [];
  const [cy, cm] = nl.d.split('-').map(Number);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(cy, cm - 1 - i, 1));
    const ym = d.toISOString().slice(0, 7);
    const row = ch.find((r) => r.ym === ym);
    months.push({ ym, sale: n(row?.sale), profit: n(row?.profit) });
  }

  res.json({
    date: nl.d,
    day_of_month: Number(nl.d.slice(8)),
    days_in_month: nl.days_in_month,
    today: { sale: n(t.sale), profit: n(t.profit), bills: n(t.bills), avg_bill: t.bills ? n(t.sale) / t.bills : 0, yesterday_sale: n(y.sale) },
    month: {
      sale: n(m.sale), profit: n(m.profit), bills: n(m.bills), items_sold: n(m.items),
      prev_same_period_sale: n(pm.sale),
      stock_in_value: n(mi.value), stock_in_qty: n(mi.qty), suppliers: n(mi.suppliers)
    },
    expiring: { count: n(ex.cnt), value: n(ex.value), list: el },
    low_stock: { count: n(lo.cnt), list: ll },
    chart: months,
    recent_sales: rc
  });
}));

/**
 * Monthly records — har mahine ka card.
 * Naya mahina sab se upar.
 */
router.get('/monthly', ah(async (req, res) => {
  const sid = req.storeId;
  const tz = TZ();
  const year = parseInt(req.query.year, 10) || null;
  const yf = year ? `AND YEAR(${LOCAL('created_at')}) = ?` : '';
  const yp = year ? [tz, year] : [];

  const [sales, items, ins, tops, now, years] = await Promise.all([
    query(`SELECT DATE_FORMAT(${LOCAL('created_at')}, '%Y-%m') ym, SUM(total) sale, SUM(profit) profit, COUNT(*) bills,
             SUM(discount_pct > 0) discounted
           FROM sales WHERE store_id = ? ${yf} GROUP BY ym`, [tz, sid, ...yp]),
    query(`SELECT DATE_FORMAT(${LOCAL('s.created_at')}, '%Y-%m') ym, SUM(i.qty) qty, COUNT(DISTINCT i.product_id) products
           FROM sale_items i JOIN sales s ON s.id = i.sale_id
           WHERE i.store_id = ? ${year ? `AND YEAR(${LOCAL('s.created_at')}) = ?` : ''} GROUP BY ym`, [tz, sid, ...yp]),
    query(`SELECT DATE_FORMAT(${LOCAL('created_at')}, '%Y-%m') ym, SUM(total) value, SUM(qty) qty
           FROM purchases WHERE store_id = ? ${yf} GROUP BY ym`, [tz, sid, ...yp]),
    query(`SELECT ym, name, qty FROM (
             SELECT DATE_FORMAT(${LOCAL('s.created_at')}, '%Y-%m') ym, i.name, SUM(i.qty) qty
             FROM sale_items i JOIN sales s ON s.id = i.sale_id
             WHERE i.store_id = ? ${year ? `AND YEAR(${LOCAL('s.created_at')}) = ?` : ''}
             GROUP BY ym, i.name) t ORDER BY ym, qty DESC`, [tz, sid, ...yp]),
    one(`SELECT DATE_FORMAT(${NOW_LOCAL}, '%Y-%m') ym`, [tz]),
    query(`SELECT DISTINCT YEAR(${LOCAL('created_at')}) y FROM sales WHERE store_id = ?
           UNION SELECT DISTINCT YEAR(${LOCAL('created_at')}) FROM purchases WHERE store_id = ? ORDER BY 1 DESC`, [tz, sid, tz, sid])
  ]);

  const all = new Set([...sales, ...items, ...ins].map((r) => r.ym));
  if (!year || Number(now.ym.slice(0, 4)) === year) all.add(now.ym);
  const top = {};
  for (const t of tops) if (!top[t.ym]) top[t.ym] = t.name;

  const records = [...all].sort().reverse().map((ym) => {
    const s = sales.find((r) => r.ym === ym) || {};
    const it = items.find((r) => r.ym === ym) || {};
    const pi = ins.find((r) => r.ym === ym) || {};
    return {
      ym,
      is_current: ym === now.ym,
      sale: n(s.sale), profit: n(s.profit), bills: n(s.bills),
      items_sold: n(it.qty), products_sold: n(it.products),
      stock_in_value: n(pi.value), stock_in_qty: n(pi.qty),
      top_product: top[ym] || null
    };
  });
  // pichle mahine se comparison
  records.forEach((r, i) => {
    const prev = records[i + 1];
    r.change_pct = !r.is_current && prev && prev.sale ? ((r.sale - prev.sale) / prev.sale) * 100 : null;
  });

  const ys = years.map((r) => Number(r.y)).filter(Boolean);
  const cy = Number(now.ym.slice(0, 4));
  if (!ys.includes(cy)) ys.unshift(cy);
  res.json({ records, years: ys.sort((a, b) => b - a) });
}));

module.exports = router;
