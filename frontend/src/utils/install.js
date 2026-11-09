/**
 * Phone par app install (PWA).
 * Android Chrome install ka apna prompt deta hai; browser ye event page khulte hi bhejta hai,
 * is liye ye file main.jsx se React se pehle load hoti hai.
 */
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  notify();
});
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const canPrompt = () => !!deferred;

/** Browser ka asal install dialog */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === 'accepted';
}

export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export function platform() {
  const u = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(u)) return 'android';
  return 'desktop';
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || window.typos?.isDesktop) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
