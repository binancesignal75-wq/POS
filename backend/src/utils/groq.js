/**
 * Groq vision: dawai ki dabbi ki tasveer -> naam, MG, type, pack, company, MRP, batch, expiry, barcode
 *
 * Key lookup priority:
 *  1. In-memory override (global.__GROQ_KEY__)
 *  2. File override (.groq_key in project root)
 *  3. DB table system_settings (setting_value or `value`)
 *  4. Fallback: process.env.GROQ_API_KEY
 */
const fs = require('fs');
const path = require('path');
const { HttpError } = require('./helpers');
const { normalizeMedicine } = require('./medicine');
const { one } = require('../db');

const BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_MODELS = 'qwen/qwen3.8-27b';
const TIMEOUT_MS = 28000;
const MAX_WAIT_S = 18;
const KEY_FILE = path.join(__dirname, '..', '..', '.groq_key');

/** Get active API Key from Memory -> File -> DB -> .env */
async function getApiKey() {
  // 1. In-memory
  if (global.__GROQ_KEY__ && typeof global.__GROQ_KEY__ === 'string' && global.__GROQ_KEY__.trim()) {
    return global.__GROQ_KEY__.trim();
  }

  // 2. Persistent file (.groq_key)
  try {
    if (fs.existsSync(KEY_FILE)) {
      const fileKey = fs.readFileSync(KEY_FILE, 'utf8').trim();
      if (fileKey && fileKey.length > 10) {
        global.__GROQ_KEY__ = fileKey;
        return fileKey;
      }
    }
  } catch (_) {}

  // 3. Database system_settings (try setting_value first, then `value`)
  try {
    const row1 = await one('SELECT setting_value FROM system_settings WHERE setting_key = "groq_api_key" LIMIT 1').catch(() => null);
    if (row1 && row1.setting_value && row1.setting_value.trim()) {
      global.__GROQ_KEY__ = row1.setting_value.trim();
      return row1.setting_value.trim();
    }
  } catch (_) {}

  try {
    const row2 = await one('SELECT `value` FROM system_settings WHERE `key` = "groq_api_key" LIMIT 1').catch(() => null);
    if (row2 && row2.value && row2.value.trim()) {
      global.__GROQ_KEY__ = row2.value.trim();
      return row2.value.trim();
    }
  } catch (_) {}

  // 4. Fallback to process.env.GROQ_API_KEY
  return (process.env.GROQ_API_KEY || '').trim();
}

/** Get list of all configured API keys (supports comma/newline separated keys for rotation) */
async function getAllApiKeys() {
  const rawKey = await getApiKey();
  if (!rawKey) return [];
  const keys = rawKey
    .split(/[\n,;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 15);
  return keys.length ? keys : [rawKey];
}

const PROMPT = `You read photos of medicine packaging (boxes, strips, bottles, tubes) sold in Pakistani pharmacies.
Transcribe what is PRINTED on the pack. Text may be curved, angled, glossy, small, or partly hidden. Never invent or guess a value; use null when it is not clearly printed.

Return one JSON object with exactly these keys:
{
  "is_medicine": true or false,
  "name": the BRAND name, usually the largest text (e.g. "Panadol Extra", "Augmentin"). Not the manufacturer. Use the generic/salt name only if no brand is printed. Do not put the strength or dosage form here.
  "strength": strength with units as printed (e.g. "500 mg", "120 mg/5ml", "875 mg + 125 mg"). Use the strength of the product itself, never the pack volume or weight.
  "form": one of tablet, capsule, syrup, injection, cream, drops, sachet, other,
  "pack_size": pack quantity as printed (e.g. "10x10 tablets", "20 tablets", "90 ml"),
  "company": manufacturer or marketing company,
  "mrp": retail price (labelled MRP, Retail Price, Rs) as a number, or null,
  "batch_no": batch / lot number,
  "expiry_date": expiry date as printed (labelled Exp, Expiry). Never use the Mfg date,
  "barcode": the digits printed under the barcode, only if every digit is readable
}
Output JSON only.`;

let discovered = null; // { id, at }
const keyStatsMap = new Map();

function recordHeaders(apiKey, headers, status, errMessage = null) {
  if (!apiKey || !headers) return;
  const stat = keyStatsMap.get(apiKey) || {};
  stat.lastChecked = Date.now();
  stat.status = status === 429 ? 'rate_limited' : (status === 401 || status === 403) ? 'invalid' : status === 200 ? 'active' : 'unknown';
  if (errMessage) stat.lastError = errMessage;

  const limitReq = parseInt(headers.get('x-ratelimit-limit-requests'), 10);
  const remReq = parseInt(headers.get('x-ratelimit-remaining-requests'), 10);
  const limitTok = parseInt(headers.get('x-ratelimit-limit-tokens'), 10);
  const remTok = parseInt(headers.get('x-ratelimit-remaining-tokens'), 10);
  const resetReq = headers.get('x-ratelimit-reset-requests');
  const resetTok = headers.get('x-ratelimit-reset-tokens');

  if (!Number.isNaN(limitReq) && limitReq > 0) stat.limitRequests = limitReq;
  if (!Number.isNaN(remReq)) stat.remainingRequests = remReq;
  if (!Number.isNaN(limitTok) && limitTok > 0) stat.limitTokens = limitTok;
  if (!Number.isNaN(remTok)) stat.remainingTokens = remTok;
  if (resetReq) stat.resetRequests = resetReq;
  if (resetTok) stat.resetTokens = resetTok;

  keyStatsMap.set(apiKey, stat);
}

async function checkKeyQuota(apiKey, force = false) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) return null;
  const masked = cleanKey.length > 10 ? `${cleanKey.slice(0, 8)}...${cleanKey.slice(-4)}` : cleanKey;

  const cached = keyStatsMap.get(cleanKey);
  if (!force && cached && (Date.now() - (cached.lastChecked || 0) < 45000) && cached.limitRequests) {
    const limitReq = cached.limitRequests || 1000;
    const remReq = cached.remainingRequests !== undefined ? cached.remainingRequests : limitReq;
    const usedReq = Math.max(0, limitReq - remReq);
    const pctReq = Math.max(0, Math.min(100, Math.round((remReq / limitReq) * 100)));

    const limitTok = cached.limitTokens || 8000;
    const remTok = cached.remainingTokens !== undefined ? cached.remainingTokens : limitTok;
    const usedTok = Math.max(0, limitTok - remTok);
    const pctTok = Math.max(0, Math.min(100, Math.round((remTok / limitTok) * 100)));

    return {
      key: cleanKey,
      masked_key: masked,
      status: cached.status || 'active',
      statusText: cached.status === 'rate_limited' ? 'Limit Khatam (Rate Limited)' : cached.status === 'invalid' ? 'Invalid Key' : 'Active & Ready',
      limit_requests: limitReq,
      remaining_requests: remReq,
      used_requests: usedReq,
      percent_requests_remaining: pctReq,
      limit_tokens: limitTok,
      remaining_tokens: remTok,
      used_tokens: usedTok,
      percent_tokens_remaining: pctTok,
      reset_requests: cached.resetRequests || 'Available',
      reset_tokens: cached.resetTokens || ''
    };
  }

  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cleanKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: ctl.signal
    });
    clearTimeout(t);

    recordHeaders(cleanKey, res.headers, res.status);

    const limitReq = parseInt(res.headers.get('x-ratelimit-limit-requests'), 10) || 1000;
    const remReq = parseInt(res.headers.get('x-ratelimit-remaining-requests'), 10) ?? limitReq;
    const limitTok = parseInt(res.headers.get('x-ratelimit-limit-tokens'), 10) || 8000;
    const remTok = parseInt(res.headers.get('x-ratelimit-remaining-tokens'), 10) ?? limitTok;
    const resetReq = res.headers.get('x-ratelimit-reset-requests') || '';
    const resetTok = res.headers.get('x-ratelimit-reset-tokens') || '';

    const usedReq = Math.max(0, limitReq - remReq);
    const usedTok = Math.max(0, limitTok - remTok);
    const pctReq = Math.max(0, Math.min(100, Math.round((remReq / limitReq) * 100)));
    const pctTok = Math.max(0, Math.min(100, Math.round((remTok / limitTok) * 100)));

    let status = 'active';
    let statusText = 'Active & Ready';
    if (res.status === 429) {
      status = 'rate_limited';
      statusText = 'Limit Khatam (Rate Limited)';
    } else if (res.status === 401 || res.status === 403) {
      status = 'invalid';
      statusText = 'Invalid / Expired Key';
    } else if (!res.ok) {
      status = 'error';
      statusText = `Error ${res.status}`;
    }

    return {
      key: cleanKey,
      masked_key: masked,
      status,
      statusText,
      limit_requests: limitReq,
      remaining_requests: remReq,
      used_requests: usedReq,
      percent_requests_remaining: pctReq,
      limit_tokens: limitTok,
      remaining_tokens: remTok,
      used_tokens: usedTok,
      percent_tokens_remaining: pctTok,
      reset_requests: resetReq || 'Available',
      reset_tokens: resetTok
    };
  } catch (err) {
    return {
      key: cleanKey,
      masked_key: masked,
      status: 'error',
      statusText: err.name === 'AbortError' ? 'Timeout' : (err.message || 'Network error'),
      limit_requests: 1000,
      remaining_requests: 0,
      used_requests: 1000,
      percent_requests_remaining: 0,
      limit_tokens: 8000,
      remaining_tokens: 0,
      used_tokens: 8000,
      percent_tokens_remaining: 0,
      reset_requests: 'Unknown'
    };
  }
}

async function getAllKeysQuota(rawKeyString = null, force = false) {
  let keys = [];
  if (rawKeyString !== null && rawKeyString !== undefined) {
    keys = String(rawKeyString)
      .split(/[\n,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 15);
  } else {
    keys = await getAllApiKeys();
  }

  if (!keys.length) return [];
  const results = await Promise.all(keys.map((k) => checkKeyQuota(k, force)));
  return results.filter(Boolean);
}

async function call(path, init, ms = TIMEOUT_MS, customKey = null) {
  const apiKey = customKey || (await getApiKey());
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctl.signal
    });
    recordHeaders(apiKey, res.headers, res.status);
    return res;
  } finally { clearTimeout(t); }
}

/** Abhi ka koi bhi model jo image leta ho */
async function findVisionModel(exclude, apiKey = null) {
  if (discovered && Date.now() - discovered.at < 6 * 3600000 && !exclude.includes(discovered.id)) return discovered.id;
  const r = await call('/models', { method: 'GET' }, 10000, apiKey);
  if (!r.ok) return null;
  const { data = [] } = await r.json();
  const m = data.find((x) => x.active !== false && (x.input_modalities || []).includes('image') && !exclude.includes(x.id));
  discovered = m ? { id: m.id, at: Date.now() } : null;
  return m?.id || null;
}

function parseJson(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function ask(model, dataUrl, apiKey = null) {
  const r = await call('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      temperature: 0,
      max_completion_tokens: 500, // Reduced from 2000 to 500: saves 1,500 tokens quota per request!
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }]
      }]
    })
  }, TIMEOUT_MS, apiKey);

  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(body?.error?.message || `Groq ${r.status}`);
    e.upstream = r.status;
    e.retryAfter = Number(r.headers.get('retry-after')) || 0;
    e.modelGone = r.status === 404 || /decommission|does not exist|not support|must be a string/i.test(e.message);
    throw e;
  }
  return parseJson(body?.choices?.[0]?.message?.content);
}

/**
 * Free plan: parse actual wait time required by Groq and retry
 */
async function askWithWait(model, dataUrl, apiKey = null) {
  let waited = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ask(model, dataUrl, apiKey);
    } catch (e) {
      if (e.upstream === 429) {
        let wait = e.retryAfter;
        // Parse "try again in X.Xs" from Groq error message
        if (!wait && e.message) {
          const m = e.message.match(/try again in ([0-9.]+)s/i);
          if (m && m[1]) {
            wait = Math.ceil(parseFloat(m[1]));
          }
        }
        if (!wait || wait < 1) wait = 2;
        wait = Math.min(wait, 5); // cap retry interval to 5s

        if (waited + wait > MAX_WAIT_S) throw e;
        waited += wait;
        console.log(`[scan] Groq 429 rate limit. Waiting ${wait}s before retry (waited: ${waited}s)...`);
        await new Promise((ok) => setTimeout(ok, wait * 1000));
        continue;
      }
      throw e;
    }
  }
}

/** dataUrl: "data:image/jpeg;base64,..." */
async function readMedicine(dataUrl) {
  const keys = await getAllApiKeys();
  if (!keys.length) throw new HttpError(503, 'AI scanner abhi set nahi (Super Admin se Groq API Key set karein)');

  const models = (process.env.GROQ_VISION_MODELS || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);
  let lastErr = null;

  // Try each API key in rotation
  for (const apiKey of keys) {
    const tried = [];
    for (let i = 0; i < 2; i++) {
      const model = models[i] || (await findVisionModel(tried, apiKey).catch(() => null));
      if (!model) break;
      tried.push(model);
      try {
        const raw = await askWithWait(model, dataUrl, apiKey);
        if (!raw) { console.error(`[scan] ${model}: JSON nahi mila`); continue; }
        return { medicine: normalizeMedicine(raw), is_medicine: raw.is_medicine !== false, model };
      } catch (e) {
        lastErr = e;
        if (e.name === 'AbortError') throw new HttpError(504, 'AI ne waqt par jawab nahi diya. Dobara photo lein.');
        if (e.upstream === 401 || e.upstream === 403) {
          console.error('[scan] Groq key reject hui:', e.message);
          break; // try next key
        }
        if (e.upstream === 429) {
          console.error('[scan] Groq 429 rate limit hit on key:', e.message);
          break; // try next key
        }
        console.error(`[scan] ${model}:`, e.message);
        if (!e.modelGone && e.upstream !== undefined && e.upstream < 500) {
          throw new HttpError(422, 'AI ye tasveer nahi parh saka. Dobara saaf photo lein.');
        }
      }
    }
  }

  if (lastErr && lastErr.upstream === 429) {
    throw new HttpError(429, 'AI ki free limit poori ho gayi. 1-2 minute baad koshish karein ya Super Admin se nayi Groq key enter karein.');
  }

  throw new HttpError(502, 'AI scanner abhi jawab nahi de raha. Dobara koshish karein ya form khud bharein.');
}

module.exports = { readMedicine, getApiKey, getAllApiKeys, checkKeyQuota, getAllKeysQuota };
