/**
 * POST /api/scan/read  { image: "data:image/jpeg;base64,..." }
 * Phone (device token) ya counter (store token) dono se. Jawab: { medicine, found }
 *
 * Data sirf parha jata hai — DB mein kuch save nahi hota. Counter par Save dabane se hi dawai banti hai.
 */
const express = require('express');
const router = express.Router();
const { one } = require('../db');
const { verify, pinVersion } = require('../middleware/auth');
const { ah, HttpError, fromSql } = require('../utils/helpers');
const { limiter } = require('../utils/rateLimit');
const { readMedicine } = require('../utils/groq');

const MAX_BYTES = 3 * 1024 * 1024; // Groq base64 limit 4 MB hai
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

// Sab stores ek hi Groq key use karte hain, is liye har store ki had
const perMinute = limiter({ max: Number(process.env.SCAN_PER_MINUTE || 20), windowMs: 60000 });
const perDay = limiter({ max: Number(process.env.SCAN_PER_DAY || 300), windowMs: 86400000 });

async function scanAuth(req, res, next) {
  try {
    const p = verify((req.headers.authorization || '').replace('Bearer ', ''));
    if (!p || !['store', 'device'].includes(p.role)) throw new HttpError(401, 'Dobara connect karein');
    const s = await one('SELECT id, license_key, pin_hash, is_active, expires_at FROM stores WHERE id = ?', [p.store_id]);
    if (!s || s.license_key !== p.key) throw new HttpError(401, 'Dobara connect karein');
    if (p.role === 'store' && p.pv !== pinVersion(s)) throw new HttpError(401, 'Dobara login karein');
    if (p.role === 'device') {
      const d = await one('SELECT id FROM devices WHERE id = ? AND store_id = ? AND is_revoked = 0', [p.device_id, s.id]);
      if (!d) throw new HttpError(401, 'Ye phone hata diya gaya hai. Dobara connect karein.');
    }
    if (!s.is_active || fromSql(s.expires_at) < new Date()) throw new HttpError(402, 'Store ka license active nahi');
    req.storeId = s.id;
    next();
  } catch (e) { next(e); }
}

function readImage(body) {
  const m = String(body?.image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'Tasveer sahi nahi (JPG, PNG ya WEBP bhejein)');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'Tasveer bohat bari hai');
  if (!MAGIC[m[1]].every((b, i) => bytes[i] === b)) throw new HttpError(400, 'Ye tasveer ki file nahi');
  return String(body.image);
}

router.post('/read', scanAuth, express.json({ limit: '6mb' }), ah(async (req, res) => {
  const image = readImage(req.body);
  if (!perMinute.hit(req.storeId)) throw new HttpError(429, 'Thora ruk kar scan karein (1 minute mein bohat zyada photos)');
  if (!perDay.hit(req.storeId)) throw new HttpError(429, 'Aaj ki AI scan limit poori ho gayi. Kal dobara, ya form khud bharein.');
  const { medicine, is_medicine, model } = await readMedicine(image);
  res.json({ medicine, found: is_medicine && !!medicine.name, model });
}));

module.exports = router;
