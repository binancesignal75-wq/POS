const crypto = require('crypto');

const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I nahi — confuse na ho

/** TYPS-XXXX-XXXX-XXXX */
function generateLicenseKey() {
  const block = () =>
    Array.from({ length: 4 }, () => KEY_CHARS[crypto.randomInt(KEY_CHARS.length)]).join('');
  return `TYPS-${block()}-${block()}-${block()}`;
}

function normalizeKey(k) {
  return String(k || '').trim().toUpperCase().replace(/\s+/g, '');
}

function sixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** plan ke hisaab se expiry barhao. Agar abhi tak valid hai to purani expiry se aage. */
function extendExpiry(currentExpiry, plan) {
  const now = new Date();
  const cur = fromSql(currentExpiry);
  const d = new Date(cur && cur > now ? cur : now);
  if (plan === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return toSqlDate(d);
}

function toSqlDate(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** DB datetime string (UTC) -> Date */
function fromSql(s) {
  if (!s) return null;
  return new Date(String(s).replace(' ', 'T') + 'Z');
}

function daysLeft(expires) {
  const e = fromSql(expires);
  if (!e) return 0;
  return Math.ceil((e - Date.now()) / 86400000);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** async route wrapper — errors ko next() tak pohanchaye */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = {
  generateLicenseKey, normalizeKey, sixDigitCode, extendExpiry, toSqlDate, fromSql,
  daysLeft, round2, ah, HttpError
};
