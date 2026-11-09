const jwt = require('jsonwebtoken');
const { one } = require('../db');
const { fromSql } = require('../utils/helpers');

const SECRET = () => process.env.JWT_SECRET;

function sign(payload, days) {
  return jwt.sign(payload, SECRET(), { expiresIn: `${days}d` });
}

/** PIN hash ka aakhri hissa — PIN badle to purane tokens band */
function pinVersion(store) {
  return store.pin_hash ? store.pin_hash.slice(-10) : '';
}

function readToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function verify(token) {
  try { return jwt.verify(token, SECRET()); } catch { return null; }
}

/** Super admin only */
function adminAuth(req, res, next) {
  const p = verify(readToken(req));
  if (!p || p.role !== 'admin') return res.status(401).json({ error: 'Admin login zaroori hai' });
  req.admin = p;
  next();
}

/**
 * Store user (desktop/web) aur Paired Mobile Devices. License expire ho to 402 bhejta hai.
 * Token mein pin_v hota hai — PIN badalne par purane tokens khud band.
 */
async function storeAuth(req, res, next) {
  try {
    const p = verify(readToken(req));
    if (!p || !['store', 'device'].includes(p.role)) return res.status(401).json({ error: 'Login zaroori hai' });
    const store = await one('SELECT * FROM stores WHERE id = ?', [p.store_id]);
    if (!store) return res.status(401).json({ error: 'Store nahi mila' });
    if (p.key !== store.license_key) {
      return res.status(401).json({ error: 'License key badal gayi hai, dobara login karein' });
    }
    if (p.role === 'store' && p.pv !== pinVersion(store)) {
      return res.status(401).json({ error: 'PIN badal gaya hai, dobara login karein' });
    }
    if (p.role === 'device') {
      const device = await one('SELECT * FROM devices WHERE id = ? AND store_id = ? AND is_revoked = 0', [p.device_id, store.id]);
      if (!device) return res.status(401).json({ error: 'Ye phone counter se hata diya gaya hai. Dobara connect karein.' });
      req.device = device;
    }
    if (!store.is_active) return res.status(403).json({ error: 'Store band kar diya gaya hai', code: 'INACTIVE' });
    if (fromSql(store.expires_at) < new Date()) {
      return res.status(402).json({ error: 'License expire ho gaya hai. Renew karwayein.', code: 'EXPIRED' });
    }
    req.store = store;
    req.storeId = store.id;
    next();
  } catch (e) { next(e); }
}

module.exports = { sign, verify, adminAuth, storeAuth, pinVersion };
