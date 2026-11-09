/**
 * TYPOS Desktop (Windows)
 * renderer/ folder mein frontend ka build hota hai (npm run copy-frontend).
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) app.quit();

let win;

const LIVE_URL = 'https://vexoraplay.site/login';
const OFFLINE_FILE = path.join(__dirname, 'offline.html');

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'TYPOS — Medical Store POS',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  Menu.setApplicationMenu(null);

  // Live hosting se load karein taake hosting update karte hi desktop app khud ba khud update ho jaye
  win.loadURL(LIVE_URL).catch(() => {});

  // POS ka data server par hai: net band ho to "dobara koshish" wala safha, khali screen nahi.
  // -3 (ABORTED) naya page khulte waqt aam baat hai, wo ghalti nahi.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith('file://')) win.loadFile(OFFLINE_FILE);
  });

  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // bahar ke links browser mein khulein (lekin vexoraplay.site window ke andar hi rahe)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.includes('vexoraplay.site')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // F5 reload, F12 devtools (support ke liye), Ctrl+P print
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { if (win.webContents.getURL().startsWith('file://')) win.loadURL(LIVE_URL).catch(() => {}); else win.reload(); }
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  // PDF download -> "Save as" dialog
  session.defaultSession.on('will-download', (event, item) => {
    item.setSaveDialogOptions({ title: 'PDF save karein', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
