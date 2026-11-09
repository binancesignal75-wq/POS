/**
 * Mobile scanner ko counter (store) se jorna
 *  Desktop:  POST /api/pair/code         -> 6-digit code + QR data
 *  Mobile :  POST /api/pair/claim {code} -> device token (1 saal)
 */
const router = require('express').Router();
const { one, query, tx } = require('../db');
const { sign, storeAuth, verify } = require('../middleware/auth');
const { ah, HttpError, sixDigitCode, toSqlDate, fromSql } = require('../utils/helpers');
const { storePublic } = require('../utils/store');
const { limiter } = require('../utils/rateLimit');

const CODE_MINUTES = 10;
// 6-digit code andaze se na lagaya ja sake
const claimLimit = limiter({ max: 10, windowMs: 60000 });

router.post('/code', storeAuth, ah(async (req, res) => {
  await query('DELETE FROM pair_codes WHERE expires_at < UTC_TIMESTAMP() OR store_id = ?', [req.storeId]);
  let code;
  for (let i = 0; i < 10; i++) {
    code = sixDigitCode();
    if (!(await one('SELECT code FROM pair_codes WHERE code = ?', [code]))) break;
  }
  const exp = toSqlDate(new Date(Date.now() + CODE_MINUTES * 60000));
  await query('INSERT INTO pair_codes (code, store_id, expires_at) VALUES (?,?,?)', [code, req.storeId, exp]);
  const server = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const webUrl = (process.env.FRONTEND_URL || (req.get('origin') || `${req.protocol}://${req.get('host')}`)).replace(/\/$/, '');
  const scanUrl = `${webUrl}/scan?code=${code}&s=${encodeURIComponent(server)}`;
  res.json({
    code,
    server,
    web_url: scanUrl,
    expires_in: CODE_MINUTES * 60,
    qr: scanUrl,
    raw_payload: JSON.stringify({ app: 'typos', s: server, c: code })
  });
}));

router.post('/claim', ah(async (req, res) => {
  if (!claimLimit.hit(req.ip)) throw new HttpError(429, 'Bohat zyada koshishein. 1 minute baad dobara karein.');
  const code = String(req.body.code || '').trim();
  const name = String(req.body.device_name || 'Android phone').slice(0, 80);
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, '6 numbers ka code daalein');
  const out = await tx(async (conn) => {
    const [[pc]] = await conn.query('SELECT * FROM pair_codes WHERE code = ? FOR UPDATE', [code]);
    if (!pc || fromSql(pc.expires_at) < new Date()) throw new HttpError(404, 'Code ghalat ya purana hai. Desktop par naya code banayein.');
    const [[store]] = await conn.query('SELECT * FROM stores WHERE id = ?', [pc.store_id]);
    if (!store.is_active || fromSql(store.expires_at) < new Date()) throw new HttpError(402, 'Store ka license active nahi');
    const [r] = await conn.query('INSERT INTO devices (store_id, name, last_seen) VALUES (?,?,UTC_TIMESTAMP())', [store.id, name]);
    await conn.query('DELETE FROM pair_codes WHERE code = ?', [code]);
    return { store, deviceId: r.insertId };
  });
  const token = sign({ role: 'device', store_id: out.store.id, device_id: out.deviceId, key: out.store.license_key }, 365);
  res.json({ token, device_id: out.deviceId, store: storePublic(out.store) });
}));

/** Mobile app khulte waqt check: abhi bhi jura hua hai? */
router.get('/device/me', ah(async (req, res) => {
  const p = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!p || p.role !== 'device') throw new HttpError(401, 'Dobara connect karein');
  const d = await one('SELECT * FROM devices WHERE id = ? AND store_id = ?', [p.device_id, p.store_id]);
  const s = await one('SELECT * FROM stores WHERE id = ?', [p.store_id]);
  if (!d || d.is_revoked || !s || s.license_key !== p.key) throw new HttpError(401, 'Ye phone hata diya gaya hai. Dobara connect karein.');
  if (!s.is_active || fromSql(s.expires_at) < new Date()) throw new HttpError(402, 'Store ka license active nahi');
  res.json({ store: storePublic(s), device: { id: d.id, name: d.name } });
}));

router.get('/devices', storeAuth, ah(async (req, res) => {
  const online = req.app.get('onlineDevices')(req.storeId);
  const rows = await query('SELECT id, name, last_seen, created_at FROM devices WHERE store_id = ? AND is_revoked = 0 ORDER BY id DESC', [req.storeId]);
  res.json({ devices: rows.map((d) => ({ ...d, online: online.includes(d.id) })) });
}));

router.delete('/devices/:id', storeAuth, ah(async (req, res) => {
  await query('UPDATE devices SET is_revoked = 1 WHERE id = ? AND store_id = ?', [req.params.id, req.storeId]);
  req.app.get('kickDevice')(req.storeId, Number(req.params.id));
  res.json({ ok: true });
}));

module.exports = router;
