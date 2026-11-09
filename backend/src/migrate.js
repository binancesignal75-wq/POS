const { pool } = require('./db');

async function runAutoMigrations() {
  console.log('[TYPOS DB] Checking database schema & migrations...');
  try {
    // 1. Table system_settings (Groq API Key etc.) - Supports both key/value and setting_key/setting_value
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        store_id         INT UNSIGNED NULL,
        \`key\`          VARCHAR(80)  NULL,
        \`value\`        TEXT         NULL,
        setting_key      VARCHAR(80)  NULL,
        setting_value    TEXT         NULL,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Ensure columns setting_key / setting_value exist on system_settings
    try {
      const [ssCols] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings'"
      );
      const ssColSet = new Set((ssCols || []).map((c) => c.COLUMN_NAME.toLowerCase()));
      if (!ssColSet.has('setting_key')) {
        await pool.query('ALTER TABLE system_settings ADD COLUMN setting_key VARCHAR(80) NULL AFTER `key`');
      }
      if (!ssColSet.has('setting_value')) {
        await pool.query('ALTER TABLE system_settings ADD COLUMN setting_value TEXT NULL AFTER setting_key');
      }
      if (!ssColSet.has('key')) {
        await pool.query('ALTER TABLE system_settings ADD COLUMN `key` VARCHAR(80) NULL AFTER store_id');
      }
      if (!ssColSet.has('value')) {
        await pool.query('ALTER TABLE system_settings ADD COLUMN `value` TEXT NULL AFTER `key`');
      }
    } catch (_) {}

    // 2. Ensure tp_pct and extra_discount_pct exist on products
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'"
    );
    const colSet = new Set((cols || []).map((c) => c.COLUMN_NAME.toLowerCase()));
    if (!colSet.has('tp_pct')) {
      console.log('[TYPOS DB] Adding tp_pct column to products table...');
      await pool.query('ALTER TABLE products ADD COLUMN tp_pct DECIMAL(5,2) NOT NULL DEFAULT 14.50 AFTER mrp');
    }
    if (!colSet.has('extra_discount_pct')) {
      console.log('[TYPOS DB] Adding extra_discount_pct column to products table...');
      await pool.query('ALTER TABLE products ADD COLUMN extra_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER tp_pct');
    }

    // Auto-update any existing products that have extra_discount_pct > 0 to the sequential multiplicative formula:
    // Final TP = MRP * (1 - TP% / 100) * (1 - Extra% / 100)
    try {
      await pool.query(`
        UPDATE products 
        SET tp = ROUND(mrp * (1 - COALESCE(tp_pct, 14.50) / 100) * (1 - COALESCE(extra_discount_pct, 0.00) / 100), 2)
        WHERE mrp > 0 AND extra_discount_pct > 0
      `);
      console.log('[TYPOS DB] Auto-synced existing products TP to sequential formula.');
    } catch (tpErr) {
      console.warn('[TYPOS DB] Existing products TP sync notice:', tpErr.message);
    }
    if (!colSet.has('barcode_strip')) {
      console.log('[TYPOS DB] Adding barcode_strip column to products table...');
      await pool.query('ALTER TABLE products ADD COLUMN barcode_strip VARCHAR(64) NULL AFTER barcode');
      try {
        await pool.query('CREATE INDEX idx_products_barcode_strip ON products (store_id, barcode_strip)');
      } catch (idxErr) {
        /* index might already exist */
      }
    }
    if (!colSet.has('barcode_alt')) {
      console.log('[TYPOS DB] Adding barcode_alt column to products table...');
      await pool.query('ALTER TABLE products ADD COLUMN barcode_alt VARCHAR(64) NULL AFTER barcode_strip');
      try {
        await pool.query('CREATE INDEX idx_products_barcode_alt ON products (store_id, barcode_alt)');
      } catch (idxErr) {
        /* index might already exist */
      }
    }
    if (!colSet.has('strips_per_box')) {
      console.log('[TYPOS DB] Adding strips_per_box column to products table...');
      await pool.query('ALTER TABLE products ADD COLUMN strips_per_box INT UNSIGNED NOT NULL DEFAULT 1 AFTER pack_size');
    }
    // Ensure stock column supports 4-decimal precision (for exact strip sales across any strips_per_box)
    try {
      await pool.query('ALTER TABLE products MODIFY COLUMN stock DECIMAL(10,4) NOT NULL DEFAULT 0.0000');
    } catch (_) {}

    // 2c. Ensure discount_amount on sales and unit on sale_items
    try {
      const [salesCols] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales'"
      );
      const salesColSet = new Set((salesCols || []).map((c) => c.COLUMN_NAME.toLowerCase()));
      if (!salesColSet.has('discount_amount')) {
        console.log('[TYPOS DB] Adding discount_amount column to sales table...');
        await pool.query('ALTER TABLE sales ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER discount_pct');
      }
    } catch (_) {}

    try {
      const [itemCols] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_items'"
      );
      const itemColSet = new Set((itemCols || []).map((c) => c.COLUMN_NAME.toLowerCase()));
      if (!itemColSet.has('unit')) {
        console.log('[TYPOS DB] Adding unit column to sale_items table...');
        await pool.query("ALTER TABLE sale_items ADD COLUMN unit VARCHAR(20) NOT NULL DEFAULT 'box' AFTER name");
      }
    } catch (_) {}

    // 3. Wholesale Customers & Ledger Tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wholesale_customers (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        store_id         INT UNSIGNED NOT NULL,
        name             VARCHAR(150) NOT NULL,
        owner_name       VARCHAR(120) NULL,
        phone            VARCHAR(40)  NOT NULL,
        address          TEXT         NULL,
        city             VARCHAR(80)  NULL,
        opening_balance  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        current_balance  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        notes            TEXT         NULL,
        is_active        TINYINT(1)   NOT NULL DEFAULT 1,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_wc_store (store_id, is_active, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_deliveries (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        store_id         INT UNSIGNED NOT NULL,
        customer_id      INT UNSIGNED NOT NULL,
        delivery_no      VARCHAR(50)  NOT NULL,
        delivery_date    DATE         NOT NULL,
        subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        discount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        paid_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        status           ENUM('unpaid', 'partially_paid', 'paid') NOT NULL DEFAULT 'unpaid',
        notes            TEXT         NULL,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_cd_cust (store_id, customer_id, delivery_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_delivery_items (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        delivery_id      INT UNSIGNED NOT NULL,
        product_id       INT UNSIGNED NOT NULL,
        medicine_name    VARCHAR(150) NOT NULL,
        strength         VARCHAR(60)  NULL,
        batch_no         VARCHAR(40)  NULL,
        expiry_date      DATE         NULL,
        qty              INT          NOT NULL,
        returned_qty     INT          NOT NULL DEFAULT 0,
        unit_price       DECIMAL(10,2) NOT NULL,
        purchase_cost    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        line_total       DECIMAL(12,2) NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_cdi_del (delivery_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_payments (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        store_id         INT UNSIGNED NOT NULL,
        customer_id      INT UNSIGNED NOT NULL,
        delivery_id      INT UNSIGNED NULL,
        payment_no       VARCHAR(50)  NOT NULL,
        payment_date     DATE         NOT NULL,
        amount           DECIMAL(12,2) NOT NULL,
        payment_method   VARCHAR(40)  NOT NULL DEFAULT 'cash',
        reference_no     VARCHAR(80)  NULL,
        notes            TEXT         NULL,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_cp_cust (store_id, customer_id, payment_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_returns (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        store_id         INT UNSIGNED NOT NULL,
        customer_id      INT UNSIGNED NOT NULL,
        delivery_id      INT UNSIGNED NOT NULL,
        delivery_item_id INT UNSIGNED NOT NULL,
        product_id       INT UNSIGNED NOT NULL,
        return_no        VARCHAR(50)  NOT NULL,
        return_date      DATE         NOT NULL,
        qty              INT          NOT NULL,
        unit_price       DECIMAL(10,2) NOT NULL,
        total_amount     DECIMAL(12,2) NOT NULL,
        reason           TEXT         NULL,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_cr_cust (store_id, customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_ledger (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
        store_id         INT UNSIGNED NOT NULL,
        customer_id      INT UNSIGNED NOT NULL,
        date             DATE         NOT NULL,
        type             ENUM('opening', 'delivery', 'payment', 'return') NOT NULL,
        ref_id           INT UNSIGNED NULL,
        ref_no           VARCHAR(50)  NULL,
        description      VARCHAR(255) NOT NULL,
        debit            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        credit           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        running_balance  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_cl_cust (store_id, customer_id, date, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4. Ensure customer_payments table has sale_id column
    const [cpCols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_payments'"
    );
    const cpColSet = new Set((cpCols || []).map((c) => c.COLUMN_NAME.toLowerCase()));
    if (!cpColSet.has('sale_id')) {
      console.log('[TYPOS DB] Adding sale_id column to customer_payments table...');
      await pool.query('ALTER TABLE customer_payments ADD COLUMN sale_id INT UNSIGNED NULL AFTER delivery_id');
    }

    // 5. Backfill any existing customer_payments into sales & sale_items so they immediately show in Dashboard & Monthly Records
    try {
      const [unlinked] = await pool.query(`
        SELECT cp.*, wc.name AS customer_name
        FROM customer_payments cp
        JOIN wholesale_customers wc ON wc.id = cp.customer_id
        WHERE cp.sale_id IS NULL
        ORDER BY cp.id ASC
      `);

      if (unlinked && unlinked.length > 0) {
        console.log(`[TYPOS DB] Syncing ${unlinked.length} wholesale customer payment(s) into sales records...`);
        for (const pay of unlinked) {
          const sid = pay.store_id;
          const amount = Number(pay.amount) || 0;
          if (amount <= 0) continue;

          let totalProfit = 0;
          if (pay.delivery_id) {
            const [[costRow]] = await pool.query(
              'SELECT COALESCE(SUM(qty * purchase_cost), 0) AS cost FROM customer_delivery_items WHERE delivery_id = ?',
              [pay.delivery_id]
            );
            const [[delRow]] = await pool.query(
              'SELECT total_amount FROM customer_deliveries WHERE id = ?',
              [pay.delivery_id]
            );
            const dCost = Number(costRow?.cost || 0);
            const dTotal = Number(delRow?.total_amount || 0);
            const dProfit = Math.max(0, dTotal - dCost);
            const margin = dTotal > 0 ? dProfit / dTotal : 0.15;
            totalProfit = Math.round(amount * margin * 100) / 100;
          } else {
            totalProfit = Math.round(amount * 0.15 * 100) / 100;
          }
          const costTotal = Math.max(0, Math.round((amount - totalProfit) * 100) / 100);

          const [[st]] = await pool.query('SELECT last_bill_no FROM stores WHERE id = ?', [sid]);
          const billNo = (st?.last_bill_no || 10000) + 1;

          const pDate = pay.payment_date
            ? (typeof pay.payment_date === 'string' ? pay.payment_date.slice(0, 10) : pay.payment_date.toISOString().slice(0, 10))
            : new Date().toISOString().slice(0, 10);
          const createdAtVal = `${pDate} 12:00:00`;

          const [sIns] = await pool.query(
            `INSERT INTO sales 
              (store_id, bill_no, subtotal, discount_pct, total, cost_total, profit, payment_method, customer_name, paid, change_due, items_count, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              sid,
              billNo,
              amount,
              0,
              amount,
              costTotal,
              totalProfit,
              pay.payment_method === 'bank' || pay.payment_method === 'other' ? 'cash' : pay.payment_method,
              `${pay.customer_name} (Wholesale Wasooli)`,
              amount,
              0,
              1,
              createdAtVal
            ]
          );
          const saleId = sIns.insertId;
          await pool.query('UPDATE stores SET last_bill_no = ? WHERE id = ?', [billNo, sid]);
          await pool.query('UPDATE customer_payments SET sale_id = ? WHERE id = ?', [saleId, pay.id]);

          await pool.query(
            `INSERT INTO sale_items (sale_id, store_id, product_id, name, qty, price, tp, total)
             VALUES (?,?,?,?,?,?,?,?)`,
            [
              saleId,
              sid,
              null,
              `Wholesale Wasooli — ${pay.customer_name}${pay.reference_no ? ` (Ref: ${pay.reference_no})` : ''}`,
              1,
              amount,
              costTotal,
              amount
            ]
          );
        }
        console.log('[TYPOS DB] Wholesale payments sync completed successfully.');
      }
    } catch (syncErr) {
      console.error('[TYPOS DB] Wholesale payment sync notice:', syncErr.message);
    }

    console.log('[TYPOS DB] Database schema check & auto-migrations completed successfully.');
  } catch (err) {
    console.error('[TYPOS DB] Auto-migration error:', err.message);
  }
}

module.exports = { runAutoMigrations };

