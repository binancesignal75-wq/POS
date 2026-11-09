/**
 * Wholesale Customers & Ledger Module
 * Independent from retail POS sales.
 */
const router = require('express').Router();
const { one, query, tx } = require('../db');
const { ah, HttpError, round2 } = require('../utils/helpers');

// Helper to format 2 decimals
const r2 = (v) => round2(Number(v) || 0);

/**
 * Record wholesale payment into sales table so it immediately reflects in:
 *  - Dashboard: Aaj ki sale, Aaj ka profit, Aaj ke bills count, Month sale & profit, Recent bills
 *  - Monthly Records: Month sale, profit, bills
 */
async function recordWholesaleSale(conn, {
  storeId,
  customerName,
  paymentId,
  paymentDate,
  amount,
  method,
  refNo,
  allocations = [],
  unallocated = 0
}) {
  let totalProfit = 0;
  for (const alloc of allocations) {
    const [[costRow]] = await conn.query(
      `SELECT COALESCE(SUM(qty * purchase_cost), 0) AS total_cost
       FROM customer_delivery_items WHERE delivery_id = ?`,
      [alloc.deliveryId]
    );
    const deliveryCost = Number(costRow?.total_cost || 0);
    const deliveryTotal = Number(alloc.deliveryTotal || 0);
    const deliveryProfit = Math.max(0, deliveryTotal - deliveryCost);
    const marginRatio = deliveryTotal > 0 ? (deliveryProfit / deliveryTotal) : 0.15;
    const profitOnThis = r2(alloc.paidAmount * marginRatio);
    totalProfit = r2(totalProfit + profitOnThis);
  }

  if (unallocated > 0) {
    const [[avgRow]] = await conn.query(
      `SELECT COALESCE(AVG(CASE WHEN mrp > 0 THEN ((mrp - tp) / mrp) END), 0.15) AS avg_ratio
       FROM products WHERE store_id = ? AND is_active = 1`,
      [storeId]
    );
    const avgRatio = Number(avgRow?.avg_ratio || 0.15);
    const unallocatedProfit = r2(unallocated * Math.max(0, Math.min(0.5, avgRatio)));
    totalProfit = r2(totalProfit + unallocatedProfit);
  }

  const costTotal = Math.max(0, r2(amount - totalProfit));

  const [[st]] = await conn.query('SELECT last_bill_no FROM stores WHERE id = ? FOR UPDATE', [storeId]);
  const billNo = (st?.last_bill_no || 10000) + 1;

  const todayStr = new Date().toISOString().slice(0, 10);
  const createdAtVal = paymentDate === todayStr
    ? new Date().toISOString().slice(0, 19).replace('T', ' ')
    : `${paymentDate} 12:00:00`;

  const payMethod = method === 'bank' || method === 'other' ? 'cash' : (method || 'cash');

  const [saleInsert] = await conn.query(
    `INSERT INTO sales 
      (store_id, bill_no, subtotal, discount_pct, total, cost_total, profit, payment_method, customer_name, paid, change_due, items_count, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      storeId,
      billNo,
      amount,
      0,
      amount,
      costTotal,
      totalProfit,
      payMethod,
      `${customerName} (Wholesale Wasooli)`,
      amount,
      0,
      allocations.length || 1,
      createdAtVal
    ]
  );
  const saleId = saleInsert.insertId;

  await conn.query('UPDATE stores SET last_bill_no = ? WHERE id = ?', [billNo, storeId]);
  try {
    await conn.query('UPDATE customer_payments SET sale_id = ? WHERE id = ?', [saleId, paymentId]);
  } catch (cpErr) {
    // sale_id column might not be present if auto-migration has not run yet
  }

  await conn.query(
    `INSERT INTO sale_items 
      (sale_id, store_id, product_id, name, qty, price, tp, total)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      saleId,
      storeId,
      null,
      `Wholesale Wasooli — ${customerName}${refNo ? ` (Ref: ${refNo})` : ''}`,
      1,
      amount,
      costTotal,
      amount
    ]
  );

  return saleId;
}

// ---------- 1. List Customers with Search & Summary ----------
router.get('/', ah(async (req, res) => {
  const sid = req.storeId;
  const { q = '', filter = 'all' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const where = ['store_id = ?', 'is_active = 1'];
  const params = [sid];

  if (q) {
    where.push('(name LIKE ? OR phone LIKE ? OR city LIKE ? OR owner_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (filter === 'outstanding') {
    where.push('current_balance > 0');
  } else if (filter === 'zero') {
    where.push('current_balance = 0');
  } else if (filter === 'advance') {
    where.push('current_balance < 0');
  }

  const w = where.join(' AND ');
  const [{ total }] = await query(`SELECT COUNT(*) total FROM wholesale_customers WHERE ${w}`, params);

  const customers = await query(
    `SELECT wc.*,
       COALESCE(del_sum.total_supplied, 0) AS total_supplied,
       COALESCE(pay_sum.total_paid, 0) AS total_paid,
       GREATEST(COALESCE(del_sum.last_del, '2000-01-01'), COALESCE(pay_sum.last_pay, '2000-01-01'), COALESCE(wc.created_at, '2000-01-01')) AS last_activity
     FROM wholesale_customers wc
     LEFT JOIN (
       SELECT customer_id, SUM(total_amount) AS total_supplied, MAX(delivery_date) AS last_del
       FROM customer_deliveries WHERE store_id = ? GROUP BY customer_id
     ) del_sum ON del_sum.customer_id = wc.id
     LEFT JOIN (
       SELECT customer_id, SUM(amount) AS total_paid, MAX(payment_date) AS last_pay
       FROM customer_payments WHERE store_id = ? GROUP BY customer_id
     ) pay_sum ON pay_sum.customer_id = wc.id
     WHERE ${w}
     ORDER BY wc.current_balance DESC, wc.name ASC
     LIMIT ? OFFSET ?`,
    [sid, sid, ...params, limit, (page - 1) * limit]
  );

  // Overall summary for top cards
  const [summary] = await query(
    `SELECT 
      COUNT(*) AS total_customers,
      COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0) AS total_receivable,
      COALESCE(SUM(CASE WHEN current_balance < 0 THEN ABS(current_balance) ELSE 0 END), 0) AS total_advance
     FROM wholesale_customers 
     WHERE store_id = ? AND is_active = 1`,
    [sid]
  );

  const [deliveryTotal] = await query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total_supplied FROM customer_deliveries WHERE store_id = ?`,
    [sid]
  );

  const [paymentTotal] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_payments FROM customer_payments WHERE store_id = ?`,
    [sid]
  );

  // Actual Wholesale Profit = Selling price of delivered items minus inventory purchase cost (TP)
  const [profitRow] = await query(
    `SELECT 
      COALESCE(SUM((cdi.unit_price - cdi.purchase_cost) * (cdi.qty - cdi.returned_qty)), 0) AS total_profit
     FROM customer_deliveries cd
     JOIN customer_delivery_items cdi ON cdi.delivery_id = cd.id
     WHERE cd.store_id = ?`,
    [sid]
  );

  res.json({
    customers,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    summary: {
      total_customers: +summary.total_customers || 0,
      total_receivable: r2(summary.total_receivable),
      total_advance: r2(summary.total_advance),
      total_supplied: r2(deliveryTotal.total_supplied),
      total_payments: r2(paymentTotal.total_payments),
      total_profit: r2(profitRow.total_profit),
    },
  });
}));

// ---------- 2. Create New Customer ----------
router.post('/', ah(async (req, res) => {
  const sid = req.storeId;
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const ownerName = String(req.body.owner_name || '').trim() || null;
  const address = String(req.body.address || '').trim() || null;
  const city = String(req.body.city || '').trim() || null;
  const openingBalance = r2(req.body.opening_balance);
  const notes = String(req.body.notes || '').trim() || null;

  if (!name) throw new HttpError(400, 'Medical Store ka naam zaroori hai');
  if (!phone) throw new HttpError(400, 'Phone number zaroori hai');

  const customerId = await tx(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO wholesale_customers 
        (store_id, name, owner_name, phone, address, city, opening_balance, current_balance, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [sid, name, ownerName, phone, address, city, openingBalance, openingBalance, notes]
    );

    const newId = r.insertId;

    // Record opening balance in ledger if non-zero
    if (openingBalance !== 0) {
      const isDebit = openingBalance > 0;
      await conn.query(
        `INSERT INTO customer_ledger 
          (store_id, customer_id, date, type, ref_no, description, debit, credit, running_balance)
         VALUES (?,?,CURDATE(),'opening',?,'Opening Balance',?,?,?)`,
        [
          sid,
          newId,
          `OPN-${newId}`,
          isDebit ? openingBalance : 0,
          isDebit ? 0 : Math.abs(openingBalance),
          openingBalance,
        ]
      );
    }

    return newId;
  });

  const created = await one('SELECT * FROM wholesale_customers WHERE id = ?', [customerId]);
  res.status(201).json({ customer: created });
}));

// ---------- 3. Customer Details & Summary Cards ----------
router.get('/:id', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;

  const customer = await one(
    'SELECT * FROM wholesale_customers WHERE id = ? AND store_id = ?',
    [cid, sid]
  );
  if (!customer) throw new HttpError(404, 'Customer nahi mila');

  // Summary statistics for customer
  const [delStats] = await query(
    `SELECT 
      COALESCE(SUM(total_amount), 0) AS total_charged,
      COUNT(*) AS total_deliveries
     FROM customer_deliveries 
     WHERE store_id = ? AND customer_id = ?`,
    [sid, cid]
  );

  const [itemStats] = await query(
    `SELECT COALESCE(SUM(qty), 0) AS total_medicines_supplied
     FROM customer_delivery_items cdi
     JOIN customer_deliveries cd ON cd.id = cdi.delivery_id
     WHERE cd.store_id = ? AND cd.customer_id = ?`,
    [sid, cid]
  );

  const [payStats] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_payments
     FROM customer_payments 
     WHERE store_id = ? AND customer_id = ?`,
    [sid, cid]
  );

  res.json({
    customer,
    stats: {
      total_medicines_supplied: +itemStats.total_medicines_supplied || 0,
      total_charged: r2(delStats.total_charged),
      total_payments: r2(payStats.total_payments),
      current_balance: r2(customer.current_balance),
      total_deliveries: +delStats.total_deliveries || 0,
    },
  });
}));

// ---------- 4. Update Customer ----------
router.put('/:id', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;

  const customer = await one(
    'SELECT * FROM wholesale_customers WHERE id = ? AND store_id = ?',
    [cid, sid]
  );
  if (!customer) throw new HttpError(404, 'Customer nahi mila');

  const name = String(req.body.name || customer.name).trim();
  const phone = String(req.body.phone || customer.phone).trim();
  const ownerName = req.body.owner_name !== undefined ? (String(req.body.owner_name).trim() || null) : customer.owner_name;
  const address = req.body.address !== undefined ? (String(req.body.address).trim() || null) : customer.address;
  const city = req.body.city !== undefined ? (String(req.body.city).trim() || null) : customer.city;
  const notes = req.body.notes !== undefined ? (String(req.body.notes).trim() || null) : customer.notes;

  if (!name) throw new HttpError(400, 'Medical Store ka naam zaroori hai');
  if (!phone) throw new HttpError(400, 'Phone number zaroori hai');

  await query(
    `UPDATE wholesale_customers 
     SET name = ?, owner_name = ?, phone = ?, address = ?, city = ?, notes = ? 
     WHERE id = ? AND store_id = ?`,
    [name, ownerName, phone, address, city, notes, cid, sid]
  );

  res.json({ customer: await one('SELECT * FROM wholesale_customers WHERE id = ?', [cid]) });
}));

// ---------- 5. Customer Ledger (Chronological Audit Trail) ----------
router.get('/:id/ledger', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;
  const { start_date, end_date } = req.query;

  const where = ['store_id = ?', 'customer_id = ?'];
  const params = [sid, cid];

  if (start_date) {
    where.push('date >= ?');
    params.push(start_date);
  }
  if (end_date) {
    where.push('date <= ?');
    params.push(end_date);
  }

  const w = where.join(' AND ');
  const ledger = await query(
    `SELECT * FROM customer_ledger WHERE ${w} ORDER BY date ASC, id ASC`,
    params
  );

  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of ledger) {
    totalDebit += Number(row.debit) || 0;
    totalCredit += Number(row.credit) || 0;
  }

  const customer = await one('SELECT current_balance, name FROM wholesale_customers WHERE id = ? AND store_id = ?', [cid, sid]);

  res.json({
    ledger,
    total_debit: r2(totalDebit),
    total_credit: r2(totalCredit),
    final_balance: r2(customer?.current_balance ?? 0),
  });
}));

// ---------- 6. Add Medicines / New Delivery (Automatic Stock Deduction) ----------
router.post('/:id/deliveries', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const deliveryDate = req.body.delivery_date || new Date().toISOString().slice(0, 10);
  const discount = r2(req.body.discount);
  const notes = String(req.body.notes || '').trim() || null;

  if (!items.length) throw new HttpError(400, 'Delivery mein koi dawai shamil karein');

  const deliveryResult = await tx(async (conn) => {
    // 1. Lock customer row
    const [[customer]] = await conn.query(
      'SELECT * FROM wholesale_customers WHERE id = ? AND store_id = ? FOR UPDATE',
      [cid, sid]
    );
    if (!customer) throw new HttpError(404, 'Customer nahi mila');

    // 2. Validate items & stock
    let subtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const pid = parseInt(item.product_id, 10);
      const qty = parseInt(item.qty, 10);
      const unitPrice = r2(item.unit_price);

      if (!pid || !qty || qty <= 0) throw new HttpError(400, 'Dawai aur sahi quantity darj karein');
      if (unitPrice < 0) throw new HttpError(400, 'Selling price 0 ya us se zyada ho');

      // Lock product stock
      const [[product]] = await conn.query(
        'SELECT * FROM products WHERE id = ? AND store_id = ? AND is_active = 1 FOR UPDATE',
        [pid, sid]
      );
      if (!product) throw new HttpError(404, `Dawai (ID: ${pid}) inventory mein nahi mili`);

      if (product.stock < qty) {
        throw new HttpError(
          400,
          `"${product.name}" ka stock kam hai! Dastiyab: ${product.stock} packs, Matloob: ${qty} packs`
        );
      }

      // Deduct stock from inventory
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, pid]);

      const lineTotal = r2(qty * unitPrice);
      subtotal += lineTotal;

      processedItems.push({
        product_id: pid,
        medicine_name: product.name,
        strength: product.strength,
        batch_no: product.batch_no,
        expiry_date: product.expiry_date,
        qty,
        unit_price: unitPrice,
        purchase_cost: r2(product.tp),
        line_total: lineTotal,
      });
    }

    subtotal = r2(subtotal);
    const totalAmount = Math.max(0, r2(subtotal - discount));
    const deliveryNo = `DEL-${Date.now().toString().slice(-6)}`;

    // 3. Insert delivery record
    const [delInsert] = await conn.query(
      `INSERT INTO customer_deliveries 
        (store_id, customer_id, delivery_no, delivery_date, subtotal, discount, total_amount, paid_amount, status, notes)
       VALUES (?,?,?,?,?,?,?,0,'unpaid',?)`,
      [sid, cid, deliveryNo, deliveryDate, subtotal, discount, totalAmount, notes]
    );
    const deliveryId = delInsert.insertId;

    // 4. Insert delivery items
    for (const it of processedItems) {
      await conn.query(
        `INSERT INTO customer_delivery_items 
          (delivery_id, product_id, medicine_name, strength, batch_no, expiry_date, qty, unit_price, purchase_cost, line_total)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          deliveryId,
          it.product_id,
          it.medicine_name,
          it.strength,
          it.batch_no,
          it.expiry_date,
          it.qty,
          it.unit_price,
          it.purchase_cost,
          it.line_total,
        ]
      );
    }

    // 5. Update customer balance
    const newBalance = r2(Number(customer.current_balance) + totalAmount);
    await conn.query(
      'UPDATE wholesale_customers SET current_balance = ? WHERE id = ?',
      [newBalance, cid]
    );

    // 6. Record in customer ledger
    await conn.query(
      `INSERT INTO customer_ledger 
        (store_id, customer_id, date, type, ref_id, ref_no, description, debit, credit, running_balance)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        sid,
        cid,
        deliveryDate,
        'delivery',
        deliveryId,
        deliveryNo,
        `Medicines supplied (${processedItems.length} items)`,
        totalAmount,
        0,
        newBalance,
      ]
    );

    // 7. Check if immediate payment was received with delivery
    const paidAmountReq = r2(req.body.paid_amount);
    let finalBalance = newBalance;
    let actualPaid = 0;

    if (paidAmountReq > 0) {
      actualPaid = Math.min(paidAmountReq, totalAmount);
      const deliveryStatus = actualPaid >= totalAmount ? 'paid' : 'partially_paid';
      await conn.query(
        'UPDATE customer_deliveries SET paid_amount = ?, status = ? WHERE id = ?',
        [actualPaid, deliveryStatus, deliveryId]
      );

      const payMethod = String(req.body.payment_method || 'cash').trim().toLowerCase();
      const payNo = `PAY-${Date.now().toString().slice(-6)}`;
      const [delPayIns] = await conn.query(
        `INSERT INTO customer_payments 
          (store_id, customer_id, delivery_id, payment_no, payment_date, amount, payment_method, reference_no, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [sid, cid, deliveryId, payNo, deliveryDate, actualPaid, payMethod, null, `Payment at delivery (${deliveryNo})`]
      );
      const delPaymentId = delPayIns.insertId;

      finalBalance = r2(newBalance - actualPaid);
      await conn.query(
        'UPDATE wholesale_customers SET current_balance = ? WHERE id = ?',
        [finalBalance, cid]
      );

      await conn.query(
        `INSERT INTO customer_ledger 
          (store_id, customer_id, date, type, ref_id, ref_no, description, debit, credit, running_balance)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          sid,
          cid,
          deliveryDate,
          'payment',
          delPaymentId,
          payNo,
          `Payment received at delivery (${payMethod.toUpperCase()})`,
          0,
          actualPaid,
          finalBalance
        ]
      );

      try {
        await recordWholesaleSale(conn, {
          storeId: sid,
          customerName: customer.name,
          paymentId: delPaymentId,
          paymentDate: deliveryDate,
          amount: actualPaid,
          method: payMethod,
          refNo: null,
          allocations: [{ deliveryId, deliveryTotal: totalAmount, paidAmount: actualPaid }],
          unallocated: 0
        });
      } catch (saleErr) {
        console.error('[WholesaleSale Delivery Sync Notice]:', saleErr.message);
      }
    }

    return { deliveryId, deliveryNo, totalAmount, paidAmount: actualPaid, newBalance: finalBalance };
  });

  res.status(201).json(deliveryResult);
}));

// ---------- 7. List Deliveries for Customer ----------
router.get('/:id/deliveries', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;

  const deliveries = await query(
    `SELECT * FROM customer_deliveries 
     WHERE store_id = ? AND customer_id = ? 
     ORDER BY delivery_date DESC, id DESC`,
    [sid, cid]
  );

  // Attach items to each delivery
  for (const del of deliveries) {
    del.items = await query(
      'SELECT * FROM customer_delivery_items WHERE delivery_id = ?',
      [del.id]
    );
  }

  res.json({ deliveries });
}));

// ---------- 8. Single Delivery Invoice Details ----------
router.get('/deliveries/:deliveryId', ah(async (req, res) => {
  const sid = req.storeId;
  const delivery = await one(
    `SELECT cd.*, wc.name AS customer_name, wc.phone AS customer_phone, wc.address AS customer_address, wc.city AS customer_city
     FROM customer_deliveries cd
     JOIN wholesale_customers wc ON wc.id = cd.customer_id
     WHERE cd.id = ? AND cd.store_id = ?`,
    [req.params.deliveryId, sid]
  );
  if (!delivery) throw new HttpError(404, 'Delivery nahi mili');

  delivery.items = await query(
    'SELECT * FROM customer_delivery_items WHERE delivery_id = ?',
    [delivery.id]
  );

  res.json({ delivery });
}));

// ---------- 9. Receive Partial / Full Payment ----------
router.post('/:id/payments', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;
  const amount = r2(req.body.amount);
  const paymentDate = req.body.payment_date || new Date().toISOString().slice(0, 10);
  const method = String(req.body.payment_method || 'cash').trim().toLowerCase();
  const refNo = String(req.body.reference_no || '').trim() || null;
  const specificDeliveryId = req.body.delivery_id ? parseInt(req.body.delivery_id, 10) : null;
  const notes = String(req.body.notes || '').trim() || null;

  if (amount <= 0) throw new HttpError(400, 'Payment raqam 0 se zyada honi chahiye');

  const result = await tx(async (conn) => {
    // 1. Lock customer
    const [[customer]] = await conn.query(
      'SELECT * FROM wholesale_customers WHERE id = ? AND store_id = ? FOR UPDATE',
      [cid, sid]
    );
    if (!customer) throw new HttpError(404, 'Customer nahi mila');

    const paymentNo = `PAY-${Date.now().toString().slice(-6)}`;

    // 2. Insert payment record
    const [payInsert] = await conn.query(
      `INSERT INTO customer_payments 
        (store_id, customer_id, delivery_id, payment_no, payment_date, amount, payment_method, reference_no, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [sid, cid, specificDeliveryId, paymentNo, paymentDate, amount, method, refNo, notes]
    );
    const paymentId = payInsert.insertId;

    // 3. FIFO Allocation across unpaid deliveries or specific delivery
    let unallocated = amount;
    const allocations = [];

    if (specificDeliveryId) {
      const [[del]] = await conn.query(
        'SELECT * FROM customer_deliveries WHERE id = ? AND store_id = ? FOR UPDATE',
        [specificDeliveryId, sid]
      );
      if (del) {
        const due = r2(del.total_amount - del.paid_amount);
        const payForThis = Math.min(unallocated, due);
        if (payForThis > 0) {
          const newPaid = r2(Number(del.paid_amount) + payForThis);
          const status = newPaid >= del.total_amount ? 'paid' : 'partially_paid';
          await conn.query('UPDATE customer_deliveries SET paid_amount = ?, status = ? WHERE id = ?', [newPaid, status, del.id]);
          allocations.push({ deliveryId: del.id, deliveryTotal: del.total_amount, paidAmount: payForThis });
          unallocated = r2(unallocated - payForThis);
        }
      }
    }

    // Allocate remaining to oldest unpaid deliveries (FIFO)
    if (unallocated > 0) {
      const [unpaidDels] = await conn.query(
        `SELECT * FROM customer_deliveries 
         WHERE store_id = ? AND customer_id = ? AND status <> 'paid' 
         ORDER BY delivery_date ASC, id ASC FOR UPDATE`,
        [sid, cid]
      );

      for (const del of unpaidDels) {
        if (unallocated <= 0) break;
        const due = r2(del.total_amount - del.paid_amount);
        if (due <= 0) continue;

        const payForThis = Math.min(unallocated, due);
        const newPaid = r2(Number(del.paid_amount) + payForThis);
        const status = newPaid >= del.total_amount ? 'paid' : 'partially_paid';

        await conn.query(
          'UPDATE customer_deliveries SET paid_amount = ?, status = ? WHERE id = ?',
          [newPaid, status, del.id]
        );

        allocations.push({ deliveryId: del.id, deliveryTotal: del.total_amount, paidAmount: payForThis });
        unallocated = r2(unallocated - payForThis);
      }
    }

    // 4. Update customer balance (Credit reduces outstanding)
    const newBalance = r2(Number(customer.current_balance) - amount);
    await conn.query(
      'UPDATE wholesale_customers SET current_balance = ? WHERE id = ?',
      [newBalance, cid]
    );

    // 5. Record in customer ledger
    await conn.query(
      `INSERT INTO customer_ledger 
        (store_id, customer_id, date, type, ref_id, ref_no, description, debit, credit, running_balance)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        sid,
        cid,
        paymentDate,
        'payment',
        paymentId,
        paymentNo,
        `Payment received (${method.toUpperCase()}${refNo ? ' Ref: ' + refNo : ''})`,
        0,
        amount,
        newBalance,
      ]
    );

    // 6. Record into sales table so it immediately reflects in Dashboard (Today's Sale & Profit) & Monthly Records
    try {
      await recordWholesaleSale(conn, {
        storeId: sid,
        customerName: customer.name,
        paymentId,
        paymentDate,
        amount,
        method,
        refNo,
        allocations,
        unallocated
      });
    } catch (saleErr) {
      console.error('[WholesaleSale Sync Notice]:', saleErr.message);
    }

    return { paymentId, paymentNo, amount, newBalance };
  });

  res.status(201).json(result);
}));

// ---------- 10. List Payments for Customer ----------
router.get('/:id/payments', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;

  const payments = await query(
    `SELECT * FROM customer_payments 
     WHERE store_id = ? AND customer_id = ? 
     ORDER BY payment_date DESC, id DESC`,
    [sid, cid]
  );

  res.json({ payments });
}));

// ---------- 11. Medicine Return / Credit Note (Restores Stock) ----------
router.post('/:id/returns', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;
  const deliveryItemId = parseInt(req.body.delivery_item_id, 10);
  const returnQty = parseInt(req.body.qty, 10);
  const returnDate = req.body.return_date || new Date().toISOString().slice(0, 10);
  const reason = String(req.body.reason || 'Customer return').trim();

  if (!deliveryItemId || !returnQty || returnQty <= 0) {
    throw new HttpError(400, 'Wapas karne ke liye dawai aur quantity select karein');
  }

  const result = await tx(async (conn) => {
    // 1. Lock delivery item
    const [[item]] = await conn.query(
      `SELECT cdi.*, cd.store_id, cd.customer_id, cd.delivery_no 
       FROM customer_delivery_items cdi
       JOIN customer_deliveries cd ON cd.id = cdi.delivery_id
       WHERE cdi.id = ? AND cd.store_id = ? AND cd.customer_id = ? FOR UPDATE`,
      [deliveryItemId, sid, cid]
    );
    if (!item) throw new HttpError(404, 'Delivery item nahi mila');

    const availableToReturn = item.qty - item.returned_qty;
    if (returnQty > availableToReturn) {
      throw new HttpError(
        400,
        `Sirf ${availableToReturn} packs wapas kiye ja sakte hain (Delivered: ${item.qty}, Pehle wapas: ${item.returned_qty})`
      );
    }

    // 2. Lock customer
    const [[customer]] = await conn.query(
      'SELECT * FROM wholesale_customers WHERE id = ? AND store_id = ? FOR UPDATE',
      [cid, sid]
    );

    // 3. Restore stock in inventory
    await conn.query('UPDATE products SET stock = stock + ? WHERE id = ?', [returnQty, item.product_id]);

    // 4. Update returned_qty in delivery item
    await conn.query(
      'UPDATE customer_delivery_items SET returned_qty = returned_qty + ? WHERE id = ?',
      [returnQty, item.id]
    );

    const creditAmount = r2(returnQty * item.unit_price);
    const returnNo = `RET-${Date.now().toString().slice(-6)}`;

    // 5. Insert customer return record
    const [retInsert] = await conn.query(
      `INSERT INTO customer_returns 
        (store_id, customer_id, delivery_id, delivery_item_id, product_id, return_no, return_date, qty, unit_price, total_amount, reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sid,
        cid,
        item.delivery_id,
        item.id,
        item.product_id,
        returnNo,
        returnDate,
        returnQty,
        item.unit_price,
        creditAmount,
        reason,
      ]
    );

    // 6. Reduce customer balance
    const newBalance = r2(Number(customer.current_balance) - creditAmount);
    await conn.query(
      'UPDATE wholesale_customers SET current_balance = ? WHERE id = ?',
      [newBalance, cid]
    );

    // 7. Record credit in ledger
    await conn.query(
      `INSERT INTO customer_ledger 
        (store_id, customer_id, date, type, ref_id, ref_no, description, debit, credit, running_balance)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        sid,
        cid,
        returnDate,
        'return',
        retInsert.insertId,
        returnNo,
        `Medicine Return (${item.medicine_name} x ${returnQty}) - ${reason}`,
        0,
        creditAmount,
        newBalance,
      ]
    );

    return { returnId: retInsert.insertId, returnNo, creditAmount, newBalance };
  });

  res.status(201).json(result);
}));

// ---------- 12. List Returns for Customer ----------
router.get('/:id/returns', ah(async (req, res) => {
  const sid = req.storeId;
  const cid = req.params.id;

  const returns = await query(
    `SELECT cr.*, p.name AS medicine_name, p.strength 
     FROM customer_returns cr
     JOIN products p ON p.id = cr.product_id
     WHERE cr.store_id = ? AND cr.customer_id = ? 
     ORDER BY cr.return_date DESC, cr.id DESC`,
    [sid, cid]
  );

  res.json({ returns });
}));

// ---------- 13. Aging & Outstanding Reports ----------
router.get('/reports/aging', ah(async (req, res) => {
  const sid = req.storeId;

  // Customers with outstanding balances
  const customers = await query(
    `SELECT id, name, owner_name, phone, city, current_balance, created_at
     FROM wholesale_customers 
     WHERE store_id = ? AND is_active = 1 AND current_balance > 0
     ORDER BY current_balance DESC`,
    [sid]
  );

  // Group each customer's unpaid invoices by age
  const rows = [];
  let sum030 = 0, sum3160 = 0, sum6190 = 0, sum90plus = 0;

  for (const c of customers) {
    const dels = await query(
      `SELECT total_amount, paid_amount, delivery_date, DATEDIFF(CURDATE(), delivery_date) AS age_days
       FROM customer_deliveries 
       WHERE store_id = ? AND customer_id = ? AND status <> 'paid'`,
      [sid, c.id]
    );

    let b030 = 0, b3160 = 0, b6190 = 0, b90plus = 0;
    for (const d of dels) {
      const remaining = r2(d.total_amount - d.paid_amount);
      if (remaining <= 0) continue;

      if (d.age_days <= 30) b030 += remaining;
      else if (d.age_days <= 60) b3160 += remaining;
      else if (d.age_days <= 90) b6190 += remaining;
      else b90plus += remaining;
    }

    // If opening balance accounts for any part of current_balance without delivery
    const totalCategorized = b030 + b3160 + b6190 + b90plus;
    const diff = r2(c.current_balance - totalCategorized);
    if (diff > 0) {
      // Put older opening balance into 90+
      b90plus += diff;
    }

    sum030 += b030;
    sum3160 += b3160;
    sum6190 += b6190;
    sum90plus += b90plus;

    rows.push({
      id: c.id,
      name: c.name,
      owner_name: c.owner_name,
      phone: c.phone,
      city: c.city,
      total_balance: r2(c.current_balance),
      age_0_30: r2(b030),
      age_31_60: r2(b3160),
      age_61_90: r2(b6190),
      age_90_plus: r2(b90plus),
    });
  }

  res.json({
    aging: rows,
    totals: {
      age_0_30: r2(sum030),
      age_31_60: r2(sum3160),
      age_61_90: r2(sum6190),
      age_90_plus: r2(sum90plus),
      total_outstanding: r2(sum030 + sum3160 + sum6190 + sum90plus),
    },
  });
}));

module.exports = router;

