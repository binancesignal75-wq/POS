-- =====================================================================
--  TYPOS — Medical Store POS
--  MySQL / MariaDB schema  (MySQL 5.7+ / 8.x, MariaDB 10.4+)
--
--  Import:  mysql -u USER -p DATABASE_NAME < schema.sql
--  (Hostinger: hPanel > Databases > phpMyAdmin > Import > schema.sql)
--
--  Multi-tenant: har table mein store_id hai. Har query store_id se filter hoti hai.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Super admin (sirf aap)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS super_admins (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(60)  NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Stores (tenants) + license key + 4-digit PIN
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120) NOT NULL,
  city           VARCHAR(80)  NULL,
  phone          VARCHAR(40)  NULL,
  address        VARCHAR(255) NULL,
  logo_path      VARCHAR(255) NULL,
  license_key    VARCHAR(24)  NOT NULL,
  plan           ENUM('monthly','yearly') NOT NULL DEFAULT 'monthly',
  expires_at     DATETIME     NOT NULL,
  pin_hash       VARCHAR(100) NULL,           -- NULL = PIN abhi set nahi hua
  pin_attempts   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  pin_locked_until DATETIME   NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_bill_no   INT UNSIGNED NOT NULL DEFAULT 10000,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_store_key (license_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- License renew history (kab kitna barhaya)
CREATE TABLE IF NOT EXISTS license_history (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id       INT UNSIGNED NOT NULL,
  action         ENUM('created','renewed','key_regenerated','deactivated','activated') NOT NULL,
  plan           ENUM('monthly','yearly') NULL,
  old_expires_at DATETIME NULL,
  new_expires_at DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_lh_store (store_id),
  CONSTRAINT fk_lh_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Products (dawaiyan)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  name             VARCHAR(150) NOT NULL,
  strength         VARCHAR(60)  NULL,          -- 500 mg, 120 mg/5ml
  form             ENUM('tablet','capsule','syrup','injection','cream','drops','sachet','other') NOT NULL DEFAULT 'tablet',
  pack_size        VARCHAR(60)  NULL,          -- 10x10 tablets
  strips_per_box   INT UNSIGNED NOT NULL DEFAULT 1, -- Pattay per box (default 1)
  company          VARCHAR(100) NULL,
  barcode          VARCHAR(64)  NULL,          -- NULL = bina code (naam se bikegi)
  barcode_strip    VARCHAR(64)  NULL,          -- Strip / pack barcode
  barcode_alt      VARCHAR(64)  NULL,          -- Alternate packaging barcode
  rack             VARCHAR(30)  NULL,
  mrp              DECIMAL(10,2) NOT NULL DEFAULT 0,   -- retail price per pack
  tp_pct           DECIMAL(5,2)  NOT NULL DEFAULT 14.50, -- TP discount %
  extra_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,  -- Extra discount %
  tp               DECIMAL(10,2) NOT NULL DEFAULT 0,   -- purchase cost per pack
  stock            DECIMAL(10,4) NOT NULL DEFAULT 0.0000, -- packs / boxes (decimals support strip-level inventory)
  low_stock_level  INT          NOT NULL DEFAULT 5,
  batch_no         VARCHAR(40)  NULL,
  expiry_date      DATE         NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_barcode (store_id, barcode),
  KEY ix_product_name (store_id, name),
  KEY ix_product_stock (store_id, stock),
  CONSTRAINT fk_product_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Stock aaya (purchase / stock-in)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id     INT UNSIGNED NOT NULL,
  product_id   INT UNSIGNED NOT NULL,
  qty          INT          NOT NULL,
  tp           DECIMAL(10,2) NOT NULL DEFAULT 0,
  total        DECIMAL(12,2) NOT NULL DEFAULT 0,
  supplier     VARCHAR(120) NULL,
  supplier_id  INT UNSIGNED NULL,
  payment_status ENUM('paid','partial','unpaid') NOT NULL DEFAULT 'unpaid',
  paid_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  due_date     DATE         NULL,
  invoice_no   VARCHAR(80)  NULL,
  batch_no     VARCHAR(40)  NULL,
  expiry_date  DATE         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_purchase_store_date (store_id, created_at),
  KEY ix_purchase_product (product_id),
  KEY ix_purchase_supplier (store_id, supplier_id),
  CONSTRAINT fk_purchase_store   FOREIGN KEY (store_id)   REFERENCES stores(id)   ON DELETE CASCADE,
  CONSTRAINT fk_purchase_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Suppliers & Ledgers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  name             VARCHAR(150) NOT NULL,
  contact_person   VARCHAR(100) NULL,
  phone            VARCHAR(40)  NULL,
  whatsapp         VARCHAR(40)  NULL,
  email            VARCHAR(120) NULL,
  address          VARCHAR(255) NULL,
  opening_balance  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  balance_type     ENUM('payable','advance') NOT NULL DEFAULT 'payable',
  credit_days      INT UNSIGNED NOT NULL DEFAULT 0,
  notes            TEXT         NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_supplier_store_active (store_id, is_active),
  KEY ix_supplier_name (store_id, name),
  CONSTRAINT fk_supplier_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_ledgers (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  supplier_id      INT UNSIGNED NOT NULL,
  ref_type         ENUM('opening_balance','purchase','payment','advance','advance_adjustment','purchase_return','refund','manual_adjustment') NOT NULL,
  ref_id           INT UNSIGNED NULL,
  ref_no           VARCHAR(80)  NULL,
  description      VARCHAR(255) NOT NULL,
  debit            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  credit           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  running_balance  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_method   VARCHAR(40)  NULL,
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sledger_supplier (store_id, supplier_id, created_at),
  KEY ix_sledger_ref (store_id, ref_type, ref_id),
  CONSTRAINT fk_sledger_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_sledger_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  supplier_id      INT UNSIGNED NOT NULL,
  receipt_no       VARCHAR(40)  NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,
  payment_type     ENUM('payment','advance','refund') NOT NULL DEFAULT 'payment',
  payment_method   ENUM('cash','bank','jazzcash','easypaisa','cheque','other') NOT NULL DEFAULT 'cash',
  ref_no           VARCHAR(80)  NULL,
  payment_date     DATE         NOT NULL,
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spay_receipt (store_id, receipt_no),
  KEY ix_spay_supplier (store_id, supplier_id, payment_date),
  CONSTRAINT fk_spay_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_spay_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_advances (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  supplier_id      INT UNSIGNED NOT NULL,
  payment_id       INT UNSIGNED NULL,
  original_amount  DECIMAL(12,2) NOT NULL,
  used_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  refunded_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sadv_supplier (store_id, supplier_id),
  CONSTRAINT fk_sadv_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_sadv_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sadv_payment FOREIGN KEY (payment_id) REFERENCES supplier_payments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_advance_adjustments (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  supplier_id      INT UNSIGNED NOT NULL,
  advance_id       INT UNSIGNED NOT NULL,
  purchase_id      INT UNSIGNED NULL,
  amount           DECIMAL(12,2) NOT NULL,
  adjustment_date  DATE         NOT NULL,
  notes            VARCHAR(255) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sadv_adj (store_id, supplier_id, advance_id),
  CONSTRAINT fk_sadj_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_sadj_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sadj_advance FOREIGN KEY (advance_id) REFERENCES supplier_advances(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_audit_logs (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  supplier_id      INT UNSIGNED NULL,
  action           VARCHAR(50)  NOT NULL,
  details          TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_saudit_store (store_id, created_at),
  CONSTRAINT fk_saudit_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payment_invoices (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  payment_id       INT UNSIGNED NOT NULL,
  purchase_id      INT UNSIGNED NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_spi_payment (payment_id),
  KEY ix_spi_purchase (purchase_id),
  CONSTRAINT fk_spi_payment FOREIGN KEY (payment_id) REFERENCES supplier_payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_spi_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Sales (bills) + items
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id        INT UNSIGNED NOT NULL,
  bill_no         INT UNSIGNED NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_total      DECIMAL(12,2) NOT NULL DEFAULT 0,   -- TP ke hisaab se
  profit          DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method  ENUM('cash','jazzcash','card','udhaar') NOT NULL DEFAULT 'cash',
  customer_name   VARCHAR(100) NULL,
  paid            DECIMAL(12,2) NOT NULL DEFAULT 0,
  change_due      DECIMAL(12,2) NOT NULL DEFAULT 0,
  items_count     INT          NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sale_bill (store_id, bill_no),
  KEY ix_sale_store_date (store_id, created_at),
  CONSTRAINT fk_sale_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id     INT UNSIGNED NOT NULL,
  store_id    INT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NULL,
  name        VARCHAR(220) NOT NULL,       -- naam + strength (bill par yahi chhapega)
  unit        VARCHAR(20)  NOT NULL DEFAULT 'box', -- 'box' ya 'strip'
  qty         INT          NOT NULL,
  price       DECIMAL(10,2) NOT NULL,      -- MRP per pack
  tp          DECIMAL(10,2) NOT NULL,      -- cost per pack
  total       DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_item_sale (sale_id),
  KEY ix_item_store_product (store_id, product_id),
  CONSTRAINT fk_item_sale    FOREIGN KEY (sale_id)    REFERENCES sales(id)    ON DELETE CASCADE,
  CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Mobile scanner devices + pairing codes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id    INT UNSIGNED NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  is_revoked  TINYINT(1)   NOT NULL DEFAULT 0,
  last_seen   DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_device_store (store_id),
  CONSTRAINT fk_device_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pair_codes (
  code        CHAR(6)      NOT NULL,
  store_id    INT UNSIGNED NOT NULL,
  expires_at  DATETIME     NOT NULL,
  PRIMARY KEY (code),
  KEY ix_pair_store (store_id),
  CONSTRAINT fk_pair_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Wholesale Customers & Ledger Module
-- ---------------------------------------------------------------------
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
  KEY idx_wc_store (store_id, is_active, name),
  CONSTRAINT fk_wc_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY idx_cd_cust (store_id, customer_id, delivery_date),
  CONSTRAINT fk_cd_customer FOREIGN KEY (customer_id) REFERENCES wholesale_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY idx_cdi_del (delivery_id),
  CONSTRAINT fk_cdi_del FOREIGN KEY (delivery_id) REFERENCES customer_deliveries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_payments (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  store_id         INT UNSIGNED NOT NULL,
  customer_id      INT UNSIGNED NOT NULL,
  delivery_id      INT UNSIGNED NULL,
  sale_id          INT UNSIGNED NULL,
  payment_no       VARCHAR(50)  NOT NULL,
  payment_date     DATE         NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,
  payment_method   VARCHAR(40)  NOT NULL DEFAULT 'cash',
  reference_no     VARCHAR(80)  NULL,
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cp_cust (store_id, customer_id, payment_date),
  CONSTRAINT fk_cp_customer FOREIGN KEY (customer_id) REFERENCES wholesale_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY idx_cr_cust (store_id, customer_id),
  CONSTRAINT fk_cr_customer FOREIGN KEY (customer_id) REFERENCES wholesale_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY idx_cl_cust (store_id, customer_id, date, id),
  CONSTRAINT fk_cl_customer FOREIGN KEY (customer_id) REFERENCES wholesale_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
