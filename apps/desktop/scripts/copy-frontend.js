/**
 * ../../frontend/dist  ->  ./renderer
 * Pehle frontend build karein (VITE_API_URL = aapka server):
 *   cd ../../frontend && npm run build
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
const dst = path.join(__dirname, '..', 'renderer');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('\n[TYPOS] frontend/dist nahi mila. Pehle chalayein:\n  cd frontend\n  npm install\n  npm run build\n');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('[TYPOS] Frontend copy ho gaya -> renderer/');
