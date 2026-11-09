// API helper. Website par same domain; desktop app mein VITE_API_URL.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const asset = (p) => (!p ? null : /^https?:|^data:/.test(p) ? p : API_BASE + p);

const KEYS = { store: 'typos_token', admin: 'typos_admin_token', licenseKey: 'typos_license_key' };

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } }
};

export const storage = {
  token: () => ls.get(KEYS.store),
  setToken: (t) => ls.set(KEYS.store, t),
  adminToken: () => ls.get(KEYS.admin),
  setAdminToken: (t) => ls.set(KEYS.admin, t),
  licenseKey: () => ls.get(KEYS.licenseKey),
  setLicenseKey: (k) => ls.set(KEYS.licenseKey, k)
};

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

/**
 * api('/products', { method:'POST', body:{...} })
 * api('/admin/stores', { admin:true, form: FormData })
 * api('/scan/read', { token: deviceToken, ... })  (web scanner apne phone token se)
 */
export async function api(path, { method = 'GET', body, form, admin = false, query, token: ownToken } = {}) {
  const token = ownToken || (admin ? storage.adminToken() : storage.token());
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}${qs}`, { method, headers, body: payload });
  } catch {
    throw new ApiError('Network issue hai. Internet connection check karein.', 0, 'NETWORK');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new ApiError(data.error || 'Kuch ghalat ho gaya', res.status, data.code);
    if (!admin && !ownToken && token && (res.status === 401 || res.status === 402 || res.status === 403) && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('typos:session', { detail: { status: res.status, message: err.message, code: data.code } }));
    }
    if (admin && token && res.status === 401 && path !== '/admin/login') window.dispatchEvent(new Event('typos:admin-logout'));
    throw err;
  }
  return data;
}

/** Image URL -> dataURL (PDF mein logo ke liye) */
export async function toDataUrl(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    const b = await r.blob();
    return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(null); f.readAsDataURL(b); });
  } catch { return null; }
}
