const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

async function runTest() {
  console.log('=== TYPOS POS Box/Strip Packaging End-to-End Test ===\n');

  // Connect to local MariaDB on 127.0.0.1:3307
  const adminConn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: '',
    multipleStatements: true,
  });

  const TEST_DB = 'typos_workflow_test';
  console.log(`1. Setting up fresh test database "${TEST_DB}"...`);
  await adminConn.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await adminConn.query(`CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await adminConn.end();

  const schemaSql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');

  // Connect to test database
  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: '',
    database: TEST_DB,
    multipleStatements: true,
    decimalNumbers: true,
    dateStrings: true,
    timezone: 'Z'
  });

  // Load schema
  await pool.query(schemaSql);

  // Run auto migrations
  const { runAutoMigrations } = require('../src/migrate');
  // Temporarily stub db.pool to test pool
  const db = require('../src/db');
  const originalPool = db.pool;
  db.pool = pool;

  await runAutoMigrations();

  // Create a test store
  const [storeRes] = await pool.query(
    `INSERT INTO stores (name, city, phone, license_key, plan, expires_at, last_bill_no) 
     VALUES ('Test Pharmacy', 'Lahore', '0300-1234567', 'TEST-KEY-1234-5678', 'yearly', '2028-12-31 23:59:59', 10000)`
  );
  const storeId = storeRes.insertId;
  console.log(`✓ Test store created (ID: ${storeId})\n`);

  // --- Step 1: Add a medicine with 4 strips per box & sequential discount ---
  console.log('2. Step 1 & 2: Add medicine Panadol (4 strips per box, MRP Rs. 100, Stock 10 boxes)');
  const mrp = 100.00;
  const stripsPerBox = 4;
  const tpPct = 14.5;
  const extraPct = 5.0;
  const initialStock = 10.0;

  // Formula: Final Purchase Cost per Box = MRP * (1 - TP% / 100) * (1 - Extra Discount% / 100)
  const amountAfterTp = mrp * (1 - tpPct / 100); // 85.50
  const finalPurchaseCost = Math.round(amountAfterTp * (1 - extraPct / 100) * 100) / 100; // 81.23
  const costPerStrip = Math.round((finalPurchaseCost / stripsPerBox) * 100) / 100; // 20.31
  const sellingPricePerStrip = Math.round((mrp / stripsPerBox) * 100) / 100; // 25.00

  const [prodRes] = await pool.query(
    `INSERT INTO products (store_id, name, strength, form, pack_size, strips_per_box, company, barcode, barcode_strip, mrp, tp_pct, extra_discount_pct, tp, stock, low_stock_level, batch_no, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [storeId, 'Panadol', '500 mg', 'tablet', '4 strips', stripsPerBox, 'GSK', '896400010001', '896400010002', mrp, tpPct, extraPct, finalPurchaseCost, initialStock, 5, 'B901', '2028-12-31']
  );
  const productId = prodRes.insertId;

  const [[savedProduct]] = await pool.query('SELECT * FROM products WHERE id = ?', [productId]);
  console.log('   Saved Product:', {
    name: savedProduct.name,
    mrp: savedProduct.mrp,
    strips_per_box: savedProduct.strips_per_box,
    tp: savedProduct.tp,
    stock: savedProduct.stock
  });

  if (savedProduct.strips_per_box !== 4) throw new Error(`Expected strips_per_box = 4, got ${savedProduct.strips_per_box}`);
  if (savedProduct.tp !== finalPurchaseCost) throw new Error(`Expected TP = ${finalPurchaseCost}, got ${savedProduct.tp}`);
  console.log(`   ✓ Strips per box = ${savedProduct.strips_per_box}`);
  console.log(`   ✓ MRP per box = Rs. ${savedProduct.mrp}`);
  console.log(`   ✓ Selling price per strip = Rs. ${sellingPricePerStrip}`);
  console.log(`   ✓ Purchase cost per box = Rs. ${finalPurchaseCost}`);
  console.log(`   ✓ Purchase cost per strip = Rs. ${costPerStrip}\n`);

  // --- Step 2: Barcode & Search Integration ---
  console.log('3. Step 3, 4 & 5: Test Search and Barcode Lookup');
  // Box Barcode Search
  const [[boxScan]] = await pool.query(
    'SELECT * FROM products WHERE store_id = ? AND is_active = 1 AND (barcode = ? OR barcode_strip = ?)',
    [storeId, '896400010001', '896400010001']
  );
  console.log(`   ✓ Box barcode scan matched: ${boxScan.name} (Matched unit: ${boxScan.barcode === '896400010001' ? 'box' : 'strip'})`);

  // Strip Barcode Search
  const [[stripScan]] = await pool.query(
    'SELECT * FROM products WHERE store_id = ? AND is_active = 1 AND (barcode = ? OR barcode_strip = ?)',
    [storeId, '896400010002', '896400010002']
  );
  const stripMatchedUnit = stripScan.barcode_strip === '896400010002' && stripScan.strips_per_box > 1 ? 'strip' : 'box';
  console.log(`   ✓ Strip barcode scan matched: ${stripScan.name} (Matched unit: ${stripMatchedUnit})`);
  if (stripMatchedUnit !== 'strip') throw new Error(`Expected matched unit 'strip', got ${stripMatchedUnit}`);
  console.log('\n');

  // Helper to execute sale logic directly as implemented in routes/sales.js
  async function executeSale(items, discountPct = 0) {
    const [[st]] = await pool.query('SELECT last_bill_no FROM stores WHERE id = ?', [storeId]);
    const billNo = st.last_bill_no + 1;

    // Check stock demand in strips
    let totalNeededStrips = 0;
    const lines = [];
    let subtotal = 0;
    let cost = 0;
    let count = 0;

    for (const it of items) {
      const [[p]] = await pool.query('SELECT * FROM products WHERE id = ? AND store_id = ?', [it.product_id, storeId]);
      const spb = p.strips_per_box || 1;
      const isStrip = it.unit === 'strip' && spb > 1;
      const unitPrice = isStrip ? Math.round((p.mrp / spb) * 100) / 100 : p.mrp;
      const unitTp = isStrip ? Math.round((p.tp / spb) * 100) / 100 : p.tp;
      const lineTotal = Math.round(unitPrice * it.qty * 100) / 100;
      const lineCost = Math.round(unitTp * it.qty * 100) / 100;
      const neededStrips = isStrip ? it.qty : it.qty * spb;

      totalNeededStrips += neededStrips;
      subtotal += lineTotal;
      cost += lineCost;
      count += it.qty;

      lines.push({ p, unit: it.unit, qty: it.qty, price: unitPrice, tp: unitTp, total: lineTotal, neededStrips });
    }

    const [[prodStock]] = await pool.query('SELECT stock, strips_per_box, name FROM products WHERE id = ?', [items[0].product_id]);
    const availStrips = Math.round(Number(prodStock.stock) * prodStock.strips_per_box);
    if (availStrips < totalNeededStrips) {
      throw new Error(`409 Insufficient stock: Available ${availStrips} strips, needed ${totalNeededStrips} strips`);
    }

    subtotal = Math.round(subtotal * 100) / 100;
    cost = Math.round(cost * 100) / 100;
    const discountAmount = Math.round(subtotal * (discountPct / 100) * 100) / 100;
    const total = Math.round((subtotal - discountAmount) * 100) / 100;
    const profit = Math.round((total - cost) * 100) / 100;

    const [saleIns] = await pool.query(
      `INSERT INTO sales (store_id, bill_no, subtotal, discount_pct, discount_amount, total, cost_total, profit, payment_method, paid, change_due, items_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cash', ?, 0, ?)`,
      [storeId, billNo, subtotal, discountPct, discountAmount, total, cost, profit, total, count]
    );
    const saleId = saleIns.insertId;

    for (const l of lines) {
      await pool.query(
        `INSERT INTO sale_items (sale_id, store_id, product_id, name, unit, qty, price, tp, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleId, storeId, l.p.id, `${l.p.name} ${l.p.strength}`, l.unit, l.qty, l.price, l.tp, l.total]
      );
    }

    // Deduct stock in strip equivalents
    const newStrips = availStrips - totalNeededStrips;
    const newStock = Math.round((newStrips / prodStock.strips_per_box) * 10000) / 10000;
    await pool.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, items[0].product_id]);
    await pool.query('UPDATE stores SET last_bill_no = ? WHERE id = ?', [billNo, storeId]);

    const [savedItems] = await pool.query('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]);
    const [[savedSale]] = await pool.query('SELECT * FROM sales WHERE id = ?', [saleId]);

    return { sale: savedSale, items: savedItems, remainingStock: newStock, remainingStrips: newStrips };
  }

  // --- Step 6: Sell 1 Box ---
  console.log('4. Step 6: Sell 1 Box of Panadol');
  const sale1 = await executeSale([{ product_id: productId, qty: 1, unit: 'box' }]);
  console.log(`   Bill #${sale1.sale.bill_no}: Unit = ${sale1.items[0].unit}, Qty = ${sale1.items[0].qty}, Price = Rs. ${sale1.items[0].price}, Total = Rs. ${sale1.sale.total}`);
  console.log(`   Remaining stock: ${sale1.remainingStock} boxes (${sale1.remainingStrips} strips)`);
  if (sale1.sale.total !== 100.00) throw new Error(`Expected total 100, got ${sale1.sale.total}`);
  if (sale1.remainingStrips !== 36) throw new Error(`Expected remaining 36 strips, got ${sale1.remainingStrips}`);
  if (sale1.remainingStock !== 9.00) throw new Error(`Expected remaining 9 boxes, got ${sale1.remainingStock}`);
  console.log('   ✓ 1 Box sale verified: deducted 4 strips, 9 boxes remaining.\n');

  // --- Step 7: Sell 2 Strips ---
  console.log('5. Step 7: Sell 2 Strips of Panadol');
  const sale2 = await executeSale([{ product_id: productId, qty: 2, unit: 'strip' }]);
  console.log(`   Bill #${sale2.sale.bill_no}: Unit = ${sale2.items[0].unit}, Qty = ${sale2.items[0].qty}, Price = Rs. ${sale2.items[0].price}, Total = Rs. ${sale2.sale.total}`);
  console.log(`   Remaining stock: ${sale2.remainingStock} boxes (${sale2.remainingStrips} strips) -> 8 boxes + 2 strips`);
  if (sale2.sale.total !== 50.00) throw new Error(`Expected total 50, got ${sale2.sale.total}`);
  if (sale2.remainingStrips !== 34) throw new Error(`Expected remaining 34 strips, got ${sale2.remainingStrips}`);
  if (sale2.remainingStock !== 8.5) throw new Error(`Expected remaining 8.5 boxes, got ${sale2.remainingStock}`);
  console.log('   ✓ 2 Strips sale verified: deducted 2 strips, 34 strips (8 boxes + 2 strips) remaining.\n');

  // --- Step 8: Sell 2 more strips with 10% Bill Discount ---
  console.log('6. Step 8: Sell 2 more strips with 10% Bill Discount');
  const sale3 = await executeSale([{ product_id: productId, qty: 2, unit: 'strip' }], 10);
  console.log(`   Bill #${sale3.sale.bill_no}: Subtotal = Rs. ${sale3.sale.subtotal}, Discount = ${sale3.sale.discount_pct}% (-Rs. ${sale3.sale.discount_amount}), Final Payable = Rs. ${sale3.sale.total}`);
  console.log(`   Remaining stock: ${sale3.remainingStock} boxes (${sale3.remainingStrips} strips) -> 8 boxes flat`);
  if (sale3.sale.subtotal !== 50.00) throw new Error(`Expected subtotal 50, got ${sale3.sale.subtotal}`);
  if (sale3.sale.discount_amount !== 5.00) throw new Error(`Expected discount 5, got ${sale3.sale.discount_amount}`);
  if (sale3.sale.total !== 45.00) throw new Error(`Expected total 45, got ${sale3.sale.total}`);
  if (sale3.remainingStrips !== 32) throw new Error(`Expected remaining 32 strips, got ${sale3.remainingStrips}`);
  if (sale3.remainingStock !== 8.0) throw new Error(`Expected remaining 8.0 boxes, got ${sale3.remainingStock}`);
  console.log('   ✓ Bill discount verified and stock accurately reduced to exactly 8 boxes (32 strips).\n');

  // --- Step 9: Prevent Over-Selling ---
  console.log('7. Step 9: Verify Over-Selling Prevention');
  try {
    // Attempt to sell 9 boxes (36 strips) when only 8 boxes (32 strips) exist
    await executeSale([{ product_id: productId, qty: 9, unit: 'box' }]);
    throw new Error('Should have thrown insufficient stock error');
  } catch (err) {
    if (err.message.includes('409 Insufficient stock')) {
      console.log(`   ✓ Correctly blocked over-selling: ${err.message}`);
    } else {
      throw err;
    }
  }
  console.log('\n');

  // --- Step 10: Verify Invoice History & Units ---
  console.log('8. Step 10: Verify Sales History & Invoice Items Units');
  const [historyItems] = await pool.query(
    `SELECT s.bill_no, s.total, s.discount_pct, si.name, si.unit, si.qty, si.price, si.total AS line_total
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     WHERE s.store_id = ?
     ORDER BY s.id ASC`,
    [storeId]
  );
  console.table(historyItems);

  if (historyItems[0].unit !== 'box' || historyItems[0].qty !== 1) throw new Error('History line 0 mismatch');
  if (historyItems[1].unit !== 'strip' || historyItems[1].qty !== 2) throw new Error('History line 1 mismatch');
  if (historyItems[2].unit !== 'strip' || historyItems[2].qty !== 2) throw new Error('History line 2 mismatch');

  console.log('✓ All 10 verification steps PASSED with 100% accuracy!');

  // Cleanup test database
  await pool.query(`DROP DATABASE ${TEST_DB}`);
  await pool.end();
  db.pool = originalPool;
  console.log('=== Test Suite Completed Successfully ===');
}

runTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});

