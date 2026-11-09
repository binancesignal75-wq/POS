/**
 * Store login:  License key  +  4-digit PIN
 *  1) POST /check-key   -> store ka naam/logo dikhao, PIN bana hua hai ya nahi
 *  2) POST /set-pin     -> pehli dafa PIN banao (sirf jab PIN set na ho)
 *  3) POST /login       -> key + PIN se token
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { one, query } = require('../db');
const { sign, storeAuth, pinVersion } = require('../middleware/auth');
const { ah, HttpError, normalizeKey, fromSql, toSqlDate } = require('../utils/helpers');
const { storePublic } = require('../utils/store');

const PIN_RE = /^\d{4}$/;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

async function loadValidStore(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) throw new HttpError(400, 'License key daalein');
  const store = await one('SELECT * FROM stores WHERE license_key = ?', [key]);
  if (!store) throw new HttpError(404, 'Ye license key ghalat hai');
  if (!store.is_active) throw new HttpError(403, 'Ye store band hai. Admin se contact karein.');
  if (fromSql(store.expires_at) < new Date()) {
    const e = new HttpError(402, 'License expire ho gaya hai. Renew karwayein.');
    e.code = 'EXPIRED';
    throw e;
  }
  return store;
}

function tokenFor(store) {
  return sign(
    { role: 'store', store_id: store.id, key: store.license_key, pv: pinVersion(store) },
    Number(process.env.TOKEN_DAYS || 30)
  );
}

router.post('/check-key', ah(async (req, res) => {
  const store = await loadValidStore(req.body.key);
  res.json({ store: storePublic(store) });
}));

router.post('/set-pin', ah(async (req, res) => {
  const { key, pin } = req.body;
  if (!PIN_RE.test(String(pin || ''))) throw new HttpError(400, 'PIN 4 numbers ka hona chahiye');
  const store = await loadValidStore(key);
  if (store.pin_hash) throw new HttpError(409, 'PIN pehle se bana hua hai. Login karein.');
  const hash = await bcrypt.hash(String(pin), 10);
  await query('UPDATE stores SET pin_hash = ?, pin_attempts = 0, pin_locked_until = NULL WHERE id = ?', [hash, store.id]);
  store.pin_hash = hash;
  res.json({ token: tokenFor(store), store: storePublic(store) });
}));

router.post('/login', ah(async (req, res) => {
  const { key, pin } = req.body;
  const store = await loadValidStore(key);
  if (!store.pin_hash) throw new HttpError(409, 'Pehle apna PIN banayein');

  const locked = fromSql(store.pin_locked_until);
  if (locked && locked > new Date()) {
    const mins = Math.ceil((locked - Date.now()) / 60000);
    throw new HttpError(429, `Bohat ghalat PIN. ${mins} minute baad koshish karein.`);
  }

  const ok = PIN_RE.test(String(pin || '')) && await bcrypt.compare(String(pin), store.pin_hash);
  if (!ok) {
    const attempts = store.pin_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const until = toSqlDate(new Date(Date.now() + LOCK_MINUTES * 60000));
      await query('UPDATE stores SET pin_attempts = 0, pin_locked_until = ? WHERE id = ?', [until, store.id]);
      throw new HttpError(429, `5 dafa ghalat PIN. ${LOCK_MINUTES} minute ke liye band.`);
    }
    await query('UPDATE stores SET pin_attempts = ? WHERE id = ?', [attempts, store.id]);
    throw new HttpError(401, `Ghalat PIN (${MAX_ATTEMPTS - attempts} koshishein baqi)`);
  }

  await query('UPDATE stores SET pin_attempts = 0, pin_locked_until = NULL WHERE id = ?', [store.id]);
  res.json({ token: tokenFor(store), store: storePublic(store) });
}));

/** Login hone ke baad PIN badalna */
router.post('/change-pin', storeAuth, ah(async (req, res) => {
  const { old_pin, new_pin } = req.body;
  if (!PIN_RE.test(String(new_pin || ''))) throw new HttpError(400, 'Naya PIN 4 numbers ka ho');
  if (!(await bcrypt.compare(String(old_pin || ''), req.store.pin_hash))) throw new HttpError(401, 'Purana PIN ghalat hai');
  const hash = await bcrypt.hash(String(new_pin), 10);
  await query('UPDATE stores SET pin_hash = ? WHERE id = ?', [hash, req.storeId]);
  req.store.pin_hash = hash;
  res.json({ token: tokenFor(req.store) });
}));

router.get('/me', storeAuth, ah(async (req, res) => {
  res.json({ store: storePublic(req.store), token: tokenFor(req.store) });
}));

module.exports = router;
