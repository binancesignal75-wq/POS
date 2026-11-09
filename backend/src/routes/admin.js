/**
 * Super Admin — sirf itna:
 *   store banana (naam, shehar, phone, logo), license key + plan (monthly/yearly),
 *   renew, key dobara banana, PIN reset, band/chalu karna.
 */
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { one, query, tx } = require('../db');
const { sign, adminAuth } = require('../middleware/auth');
const { ah, HttpError, generateLicenseKey, extendExpiry, daysLeft } = require('../utils/helpers');

const LOGO_DIR = path.join(__dirname, '..', '..', 'uploads', 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: LOGO_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype] || '.png';
      cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'Logo sirf PNG, JPG ya WEBP ho'));
  }
});

function removeLogo(file) {
  if (!file) return;
  fs.unlink(path.join(LOGO_DIR, path.basename(file)), () => {});
}

function adminStore(s) {
  return {
    id: s.id, name: s.name, city: s.city, phone: s.phone, address: s.address,
    logo_url: s.logo_path ? `/uploads/logos/${s.logo_path}` : null,
    license_key: s.license_key, plan: s.plan, expires_at: s.expires_at,
    days_left: daysLeft(s.expires_at), is_active: !!s.is_active, has_pin: !!s.pin_hash,
    created_at: s.created_at,
    status: !s.is_active ? 'inactive' : daysLeft(s.expires_at) <= 0 ? 'expired' : daysLeft(s.expires_at) <= 7 ? 'expiring' : 'active'
  };
}

async function uniqueKey(conn) {
  for (let i = 0; i < 10; i++) {
    const k = generateLicenseKey();
    const [r] = await conn.query('SELECT id FROM stores WHERE license_key = ?', [k]);
    if (!r.length) return k;
  }
  throw new Error('Key generate nahi hui');
}

// ---------- login ----------
// Admin login = sirf 6-digit PIN (.env mein ADMIN_PIN). 5 ghalat → 5 minute lock (har IP).
const failed = new Map(); // ip -> { count, until }

router.post('/login', ah(async (req, res) => {
  const ADMIN_PIN = String(process.env.ADMIN_PIN || '');
  if (!/^\d{6}$/.test(ADMIN_PIN)) throw new HttpError(500, '.env mein ADMIN_PIN (6 digit) set karein');

  const ip = req.ip;
  const f = failed.get(ip);
  if (f && f.until > Date.now()) {
    throw new HttpError(429, `Bohat ghalat PIN. ${Math.ceil((f.until - Date.now()) / 60000)} minute baad try karein`);
  }

  const pin = Buffer.from(String(req.body.pin || ''));
  const ok = pin.length === 6 && crypto.timingSafeEqual(pin, Buffer.from(ADMIN_PIN));
  if (!ok) {
    const count = (f && f.until <= Date.now() && f.count >= 5 ? 0 : f?.count || 0) + 1;
    failed.set(ip, { count, until: count >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
    throw new HttpError(401, 'PIN ghalat hai');
  }
  failed.delete(ip);
  res.json({ token: sign({ role: 'admin', username: 'admin' }, 7), username: 'admin' });
}));

router.use(adminAuth);

// ---------- stats ----------
router.get('/stats', ah(async (req, res) => {
  const r = await one(`
    SELECT COUNT(*) total,
      SUM(is_active = 1 AND expires_at > UTC_TIMESTAMP()) active,
      SUM(is_active = 1 AND expires_at > UTC_TIMESTAMP() AND expires_at <= UTC_TIMESTAMP() + INTERVAL 7 DAY) expiring,
      SUM(expires_at <= UTC_TIMESTAMP()) expired
    FROM stores`);
  res.json({ total: +r.total || 0, active: +r.active || 0, expiring: +r.expiring || 0, expired: +r.expired || 0 });
}));

// ---------- list ----------
router.get('/stores', ah(async (req, res) => {
  const { q = '', status = 'all' } = req.query;
  const where = ['1=1'];
  const params = [];
  if (q) { where.push('(name LIKE ? OR city LIKE ? OR license_key LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status === 'active') where.push('is_active = 1 AND expires_at > UTC_TIMESTAMP()');
  if (status === 'expiring') where.push('is_active = 1 AND expires_at > UTC_TIMESTAMP() AND expires_at <= UTC_TIMESTAMP() + INTERVAL 7 DAY');
  if (status === 'expired') where.push('expires_at <= UTC_TIMESTAMP()');
  if (status === 'inactive') where.push('is_active = 0');
  const rows = await query(`SELECT * FROM stores WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params);
  res.json({ stores: rows.map(adminStore) });
}));

// ---------- create ----------
router.post('/stores', upload.single('logo'), ah(async (req, res) => {
  const { name, city, phone, address, plan = 'monthly' } = req.body;
  if (!String(name || '').trim()) { removeLogo(req.file?.filename); throw new HttpError(400, 'Store ka naam zaroori hai'); }
  if (!['monthly', 'yearly'].includes(plan)) throw new HttpError(400, 'Plan monthly ya yearly ho');
  const store = await tx(async (conn) => {
    const key = await uniqueKey(conn);
    const exp = extendExpiry(null, plan);
    const [r] = await conn.query(
      'INSERT INTO stores (name, city, phone, address, logo_path, license_key, plan, expires_at) VALUES (?,?,?,?,?,?,?,?)',
      [name.trim(), city || null, phone || null, address || null, req.file?.filename || null, key, plan, exp]
    );
    await conn.query('INSERT INTO license_history (store_id, action, plan, new_expires_at) VALUES (?,?,?,?)', [r.insertId, 'created', plan, exp]);
    const [[s]] = await conn.query('SELECT * FROM stores WHERE id = ?', [r.insertId]);
    return s;
  });
  res.status(201).json({ store: adminStore(store) });
}));

async function getStore(id) {
  const s = await one('SELECT * FROM stores WHERE id = ?', [id]);
  if (!s) throw new HttpError(404, 'Store nahi mila');
  return s;
}

// ---------- update (naam / logo) ----------
router.put('/stores/:id', upload.single('logo'), ah(async (req, res) => {
  const s = await getStore(req.params.id);
  const { name, city, phone, address, remove_logo } = req.body;
  let logo = s.logo_path;
  if (req.file) { removeLogo(s.logo_path); logo = req.file.filename; }
  else if (remove_logo === '1' || remove_logo === 'true') { removeLogo(s.logo_path); logo = null; }
  await query('UPDATE stores SET name = ?, city = ?, phone = ?, address = ?, logo_path = ? WHERE id = ?', [
    String(name ?? s.name).trim() || s.name, city ?? s.city, phone ?? s.phone, address ?? s.address, logo, s.id
  ]);
  res.json({ store: adminStore(await getStore(s.id)) });
}));

// ---------- renew ----------
router.post('/stores/:id/renew', ah(async (req, res) => {
  const s = await getStore(req.params.id);
  const plan = ['monthly', 'yearly'].includes(req.body.plan) ? req.body.plan : s.plan;
  const exp = extendExpiry(s.expires_at, plan);
  await query('UPDATE stores SET plan = ?, expires_at = ? WHERE id = ?', [plan, exp, s.id]);
  await query('INSERT INTO license_history (store_id, action, plan, old_expires_at, new_expires_at) VALUES (?,?,?,?,?)', [s.id, 'renewed', plan, s.expires_at, exp]);
  res.json({ store: adminStore(await getStore(s.id)) });
}));

// ---------- new key (purani key band) ----------
router.post('/stores/:id/regenerate-key', ah(async (req, res) => {
  const s = await getStore(req.params.id);
  await tx(async (conn) => {
    const key = await uniqueKey(conn);
    await conn.query('UPDATE stores SET license_key = ? WHERE id = ?', [key, s.id]);
    await conn.query('UPDATE devices SET is_revoked = 1 WHERE store_id = ?', [s.id]);
    await conn.query('INSERT INTO license_history (store_id, action) VALUES (?,?)', [s.id, 'key_regenerated']);
  });
  res.json({ store: adminStore(await getStore(s.id)) });
}));

// ---------- PIN reset (store agli dafa naya PIN banayega) ----------
router.post('/stores/:id/reset-pin', ah(async (req, res) => {
  const s = await getStore(req.params.id);
  await query('UPDATE stores SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL WHERE id = ?', [s.id]);
  res.json({ store: adminStore(await getStore(s.id)) });
}));

// ---------- band / chalu ----------
router.post('/stores/:id/toggle', ah(async (req, res) => {
  const s = await getStore(req.params.id);
  const next = s.is_active ? 0 : 1;
  await query('UPDATE stores SET is_active = ? WHERE id = ?', [next, s.id]);
  await query('INSERT INTO license_history (store_id, action) VALUES (?,?)', [s.id, next ? 'activated' : 'deactivated']);
  res.json({ store: adminStore(await getStore(s.id)) });
}));

router.get('/stores/:id/history', ah(async (req, res) => {
  res.json({ history: await query('SELECT * FROM license_history WHERE store_id = ? ORDER BY id DESC', [req.params.id]) });
}));

// ---------- delete (sara data khatam) ----------
router.delete('/stores/:id', ah(async (req, res) => {
  const s = await getStore(req.params.id);
  if (req.body?.confirm !== s.name) throw new HttpError(400, 'Delete ke liye store ka poora naam likhein');
  await query('DELETE FROM stores WHERE id = ?', [s.id]);
  removeLogo(s.logo_path);
  res.json({ ok: true });
}));

// ---------- System Settings (Groq API Key etc.) ----------
const { getApiKey, getAllKeysQuota } = require('../utils/groq');
const KEY_FILE = path.join(__dirname, '..', '..', '.groq_key');

router.get('/settings', ah(async (req, res) => {
  const currentKey = await getApiKey();
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const keysStatus = await getAllKeysQuota(currentKey, force);

  res.json({
    groq_api_key: currentKey || '',
    masked_key: currentKey ? `${currentKey.slice(0, 6)}...${currentKey.slice(-4)}` : 'Set nahi hai',
    keys_status: keysStatus
  });
}));

router.post('/settings/check-keys', ah(async (req, res) => {
  const keysStr = String(req.body.keys || '').trim();
  const keysStatus = await getAllKeysQuota(keysStr, true);
  res.json({ keys_status: keysStatus });
}));

// Recalculate TP for existing products using the sequential formula
router.post('/sync-tp', ah(async (req, res) => {
  const result = await query(`
    UPDATE products 
    SET tp = ROUND(mrp * (1 - COALESCE(tp_pct, 14.50) / 100) * (1 - COALESCE(extra_discount_pct, 0.00) / 100), 2)
    WHERE mrp > 0 AND extra_discount_pct > 0
  `);
  res.json({
    ok: true,
    affectedRows: result.affectedRows || 0,
    message: `${result.affectedRows || 0} products ka TP sequential formula ke mutabiq update ho gaya`
  });
}));

router.post('/settings', ah(async (req, res) => {
  const keyVal = String(req.body.groq_api_key || '').trim();

  // 1. In-memory override for instant effect across the running process
  global.__GROQ_KEY__ = keyVal;

  // 2. Write to persistent .groq_key file
  try {
    fs.writeFileSync(KEY_FILE, keyVal, 'utf8');
  } catch (fsErr) {
    console.error('[admin] Failed to write .groq_key:', fsErr.message);
  }

  // 3. Save to database table supporting both schema column variants
  try {
    await query(`
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

    // Try setting_key / setting_value first
    await query(
      `INSERT INTO system_settings (setting_key, setting_value) 
       VALUES ('groq_api_key', ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [keyVal, keyVal]
    ).catch(async () => {
      // Fallback to key / value
      await query(
        `INSERT INTO system_settings (\`key\`, \`value\`) 
         VALUES ('groq_api_key', ?) 
         ON DUPLICATE KEY UPDATE \`value\` = ?`,
        [keyVal, keyVal]
      );
    });
  } catch (dbErr) {
    console.error('[admin] Could not write to system_settings table:', dbErr.message);
  }

  const keysStatus = await getAllKeysQuota(keyVal, true);

  res.json({
    ok: true,
    message: 'Groq API Key kamyabi se update ho gayi',
    masked_key: keyVal ? `${keyVal.slice(0, 6)}...${keyVal.slice(-4)}` : 'Set nahi hai',
    keys_status: keysStatus
  });
}));

module.exports = router;
