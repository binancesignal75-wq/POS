/**
 * Demo store + dawaiyan + pichle 6 mahine ki sales (testing ke liye)
 *   npm run seed-demo
 * Demo key: TYPS-DEMO-DEMO-DEMO   (PIN pehli dafa login par banayein)
 * Live server par na chalayein.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../src/db');

const KEY = 'TYPS-DEMO-DEMO-DEMO';
const MEDS = [
  ['Panadol', '500 mg', 'tablet', '10x10 tablets', 'GSK', '8964000123457', 85, 3, 10, '2028-03-31'],
  ['Panadol Extra', '500 mg + 65 mg', 'tablet', '10x10 tablets', 'GSK', '8964000123464', 250, 24, 10, '2028-08-31'],
  ['Augmentin', '625 mg', 'tablet', '6 tablets', 'GSK', '8964000771230', 630, 22, 8, null],
  ['Risek', '20 mg', 'capsule', '14 capsules', 'Getz Pharma', '8961101210045', 550, 4, 8, null],
  ['Brufen', '400 mg', 'tablet', '20 tablets', 'Abbott', '8964001100212', 110, 41, 10, '2027-11-30'],
  ['Calpol Syrup', '120 mg/5ml', 'syrup', '90 ml', 'GSK', '8964000450081', 145, 0, 6, '2027-06-30'],
  ['Flagyl', '400 mg', 'tablet', '20 tablets', 'Sanofi', null, 95, 2, 10, '2028-01-31'],
  ['Arinac', '200 mg', 'tablet', '20 tablets', 'Abbott', '8964001100519', 160, 36, 10, '2027-09-30'],
  ['Ceftriaxone Inj', '1 g', 'injection', '1 vial', 'Bosch', '8964009988101', 320, 5, 10, '2027-02-28'],
  ['Polyfax Cream', '20 g', 'cream', '1 tube', 'GSK', null, 210, 12, 5, null],
  ['Gravinate', '50 mg', 'tablet', '10 tablets', 'Searle', '8964003300114', 60, 1, 8, '2028-07-31'],
  ['ORS Sachet', '20.5 g', 'sachet', '1 sachet', 'Searle', '8964003300220', 30, 120, 30, '2028-06-30'],
  ['Disprin', '300 mg', 'tablet', '10x10 tablets', 'Reckitt', '8964005500017', 40, 80, 20, '2028-05-31'],
  ['Ventolin Inhaler', '100 mcg', 'other', '200 doses', 'GSK', '8964000990012', 520, 9, 4, '2027-12-31']
];

const pad = (n) => String(n).padStart(2, '0');
const sqlDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const conn = await pool.getConnection();
  await conn.query("SET time_zone = '+00:00'");
  await conn.query('DELETE FROM stores WHERE license_key = ?', [KEY]);
  const exp = new Date(); exp.setUTCFullYear(exp.getUTCFullYear() + 1);
  const [s] = await conn.query(
    'INSERT INTO stores (name, city, phone, address, license_key, plan, expires_at) VALUES (?,?,?,?,?,?,?)',
    ['Al-Shifa Medical Store', 'D.I. Khan', '0300-0000000', 'Circular Road', KEY, 'yearly', sqlDate(exp)]
  );
  const sid = s.insertId;

  // expiry jo 90 din ke andar ho (alert dikhane ke liye)
  const soon = (days) => { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 10); };
  const prods = [];
  for (const [i, m] of MEDS.entries()) {
    const [name, strength, form, pack, company, barcode, mrp, stock, lvl, expiry] = m;
    const tp = r2(mrp * 0.85);
    const exd = expiry || soon([12, 45, 70][i % 3]);
    const [r] = await conn.query(
      `INSERT INTO products (store_id, name, strength, form, pack_size, company, barcode, rack, mrp, tp, stock, low_stock_level, batch_no, expiry_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sid, name, strength, form, pack, company, barcode, `A-${(i % 6) + 1}`, mrp, tp, stock, lvl, `B${2600 + i * 7}`, exd]
    );
    prods.push({ id: r.insertId, name: `${name} ${strength}`, mrp, tp });
  }

  // 6 mahine ki purchases + sales
  let bill = 10000;
  const now = new Date();
  for (let mAgo = 5; mAgo >= 0; mAgo--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - mAgo, 1));
    const lastDay = mAgo === 0 ? now.getUTCDate() : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    for (const p of prods) {
      const q = 20 + Math.floor(Math.random() * 60);
      const d = new Date(start); d.setUTCDate(1 + Math.floor(Math.random() * Math.max(1, lastDay - 1))); d.setUTCHours(6);
      await conn.query('INSERT INTO purchases (store_id, product_id, qty, tp, total, supplier, created_at) VALUES (?,?,?,?,?,?,?)',
        [sid, p.id, q, p.tp, r2(q * p.tp), ['Muller & Phipps', 'IBL', 'Premier Agency', 'United Distributors'][p.id % 4], sqlDate(d)]);
    }
    for (let day = 1; day <= lastDay; day++) {
      const bills = 6 + Math.floor(Math.random() * 8);
      for (let b = 0; b < bills; b++) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day, 3 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60)));
        if (d > now) continue;
        const lines = [];
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const p = prods[Math.floor(Math.random() * prods.length)];
          if (!lines.find((l) => l.p.id === p.id)) lines.push({ p, qty: 1 + Math.floor(Math.random() * 3) });
        }
        const subtotal = r2(lines.reduce((a, l) => a + l.p.mrp * l.qty, 0));
        const cost = r2(lines.reduce((a, l) => a + l.p.tp * l.qty, 0));
        const pay = ['cash', 'cash', 'cash', 'jazzcash', 'udhaar'][Math.floor(Math.random() * 5)];
        bill++;
        const [sr] = await conn.query(
          `INSERT INTO sales (store_id, bill_no, subtotal, discount_pct, total, cost_total, profit, payment_method, paid, change_due, items_count, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [sid, bill, subtotal, 0, subtotal, cost, r2(subtotal - cost), pay, subtotal, 0, lines.reduce((a, l) => a + l.qty, 0), sqlDate(d)]
        );
        for (const l of lines) {
          await conn.query('INSERT INTO sale_items (sale_id, store_id, product_id, name, qty, price, tp, total) VALUES (?,?,?,?,?,?,?,?)',
            [sr.insertId, sid, l.p.id, l.p.name, l.qty, l.p.mrp, l.p.tp, r2(l.p.mrp * l.qty)]);
        }
      }
    }
  }
  await conn.query('UPDATE stores SET last_bill_no = ? WHERE id = ?', [bill, sid]);
  conn.release();
  console.log(`Demo store tayyar. Key: ${KEY}  (pehli dafa login par PIN banayein)`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
