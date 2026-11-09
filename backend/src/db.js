const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,          // DATETIME/DATE string ki shakal mein wapas aayein
  decimalNumbers: true,       // DECIMAL ko number banayein
  timezone: 'Z'
});

// Har connection UTC mein — dates hamesha UTC save hongi, report mein TZ_OFFSET lagta hai
pool.pool.on('connection', (conn) => { conn.query("SET time_zone = '+00:00'"); });

/** Local timezone (Pakistan = +05:00) — reports mein din/mahina isi se banta hai */
const TZ = () => process.env.TZ_OFFSET || '+05:00';

/** SELECT ... rows */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** pehli row ya null */
async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** transaction helper: await tx(async conn => { ... }) */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, one, tx, TZ };
