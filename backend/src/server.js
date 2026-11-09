require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const { runAutoMigrations } = require('./migrate');
const { storeAuth } = require('./middleware/auth');
const { setupSocket } = require('./socket');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
  console.error('\n[TYPOS] .env mein JWT_SECRET (kam se kam 24 characters) zaroori hai.\n');
  process.exit(1);
}

const app = express();
const corsOrigin = (process.env.CORS_ORIGIN || '*') === '*' ? '*' : process.env.CORS_ORIGIN.split(',').map((s) => s.trim());

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cors({ origin: corsOrigin }));
// AI scan apni bari (photo) body khud parhta hai, is liye global 1mb limit se pehle
app.use('/api/scan', require('./routes/scan'));
app.use(express.json({ limit: '1mb' }));

// ---------- static ----------
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d' }));
// Windows .exe aur Android .apk yahan rakhein: backend/downloads/
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
app.get('/downloads/:filename', (req, res) => {
  // sirf downloads folder ki .exe/.apk — "..%2F" jaise raste se server ki files bahar na niklein
  const name = String(req.params.filename);
  if (name !== path.basename(name) || !/^[\w.-]+\.(exe|apk)$/i.test(name)) return res.status(404).end();
  const file = path.join(DOWNLOADS_DIR, name);
  if (fs.existsSync(file)) {
    return res.download(file);
  }
  const isApk = req.params.filename.endsWith('.apk');
  const title = isApk ? 'Android Mobile App & Web Scanner' : 'App Setup Jald Dastiyab Hogi';
  const desc = isApk
    ? 'Android APK ke ilawa aap bina koi app install kiye kisi bhi phone se seedha Web Scanner ya Full POS chala sakte hain:'
    : 'Yeh installer file abhi server par copy ki ja rahi hai. Tab tak aap bina kuch download kiye direct browser mein login karke POS use kar sakte hain:';

  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="ur">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>TYPOS Download</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: white; max-width: 480px; width: 100%; padding: 36px 28px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); text-align: center; border: 1px solid #e2e8f0; }
        h2 { font-size: 22px; margin: 0 0 12px; color: #0284c7; }
        p { color: #64748b; font-size: 15px; line-height: 1.6; margin: 0 0 24px; }
        .btn-group { display: flex; flex-direction: column; gap: 10px; }
        .btn { display: block; background: #0284c7; color: white; padding: 13px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; transition: background 0.2s; }
        .btn-sc { background: #0f172a; }
        .btn:hover { opacity: 0.92; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>${title}</h2>
        <p>${desc}</p>
        <div class="btn-group">
          <a class="btn" href="https://vexoraplay.site/scan">📱 Mobile Web Scanner Kholein</a>
          <a class="btn btn-sc" href="https://vexoraplay.site/login">💻 Full Web POS Login</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ---------- API ----------
app.get('/api/health', async (req, res) => {
  const ai = !!process.env.GROQ_API_KEY;
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: true, ai }); }
  catch { res.status(500).json({ ok: false, db: false, ai }); }
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pair', require('./routes/pair'));
app.use('/api/products', storeAuth, require('./routes/products'));
app.use('/api/customers', storeAuth, require('./routes/customers'));
app.use('/api/sales', storeAuth, require('./routes/sales'));
app.use('/api/reports', storeAuth, require('./routes/reports'));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route nahi mila' }));

// ---------- frontend (agar frontend/dist mojood ho to yahin se serve) ----------
const dist = [path.join(__dirname, '..', 'public'), path.join(__dirname, '..', '..', 'frontend', 'dist')].find((p) => fs.existsSync(path.join(p, 'index.html')));
if (dist) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- errors ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Logo 2MB se chhota ho' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ye cheez pehle se mojood hai' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Tasveer ya data bohat bara hai' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message, code: err.code });
});

// kisi ek ghalat promise se poora server band na ho
process.on('unhandledRejection', (e) => console.error('[TYPOS] unhandled:', e));

const server = http.createServer(app);
setupSocket(server, app, corsOrigin);

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => {
  console.log(`[TYPOS] API chal rahi hai: http://localhost:${PORT}`);
  if (dist) console.log(`[TYPOS] Frontend serve ho raha hai: ${dist}`);
  runAutoMigrations().catch((err) => console.error('[TYPOS] Auto-migration error:', err));
});
