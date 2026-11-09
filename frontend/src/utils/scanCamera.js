/**
 * Web scanner ka camera kaam:
 *  - camera kholna (behtar focus, torch agar phone de)
 *  - tasveer lena / chhoti karna (AI ko bhejne ke liye)
 *  - barcode parhna: Android Chrome mein phone ka apna detector, baqi sab (iPhone Safari, desktop) mein ZXing
 *  - "dabbi rok li gayi" pehchanna, taake bina button dabaye khud photo le
 */

const MAX_SIDE = 1280; // is se chhoti photo par expiry/batch ghalat parhe jate hain
const QUALITY = 0.82;

export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext ? 'Is browser mein live camera nahi chalta' : 'Live camera sirf https par chalta hai');
  }
  const wanted = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: wanted, audio: false }); }
  catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // purane phones
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  if (caps.focusMode?.includes('continuous')) {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }
  return { stream, track, torch: !!caps.torch };
}

export function closeCamera(video) {
  video?.srcObject?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}

export const setTorch = (track, on) => track.applyConstraints({ advanced: [{ torch: on }] });

function drawScaled(source, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** Live video se tasveer */
export function grabFrame(video) {
  if (!video.videoWidth) return null;
  return drawScaled(video, video.videoWidth, video.videoHeight, MAX_SIDE).toDataURL('image/jpeg', QUALITY);
}

/** Phone camera / gallery wali file -> chhoti JPEG. Barcode ke liye canvas bhi wapas. */
export async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = drawScaled(img, img.naturalWidth, img.naturalHeight, 2000);
    const small = drawScaled(canvas, canvas.width, canvas.height, MAX_SIDE);
    return { dataUrl: small.toDataURL('image/jpeg', QUALITY), canvas };
  } catch {
    throw new Error('Ye tasveer khul nahi saki (JPG ya PNG try karein)');
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- barcode ---------- */

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'];

async function nativeReader() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const have = await window.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => have.includes(f));
    if (!formats.length) return null;
    const d = new window.BarcodeDetector({ formats });
    return async (src) => (await d.detect(src))[0]?.rawValue || null;
  } catch { return null; }
}

async function zxingReader() {
  const z = await import('@zxing/library');
  const hints = new Map();
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [
    z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E,
    z.BarcodeFormat.CODE_128, z.BarcodeFormat.CODE_39, z.BarcodeFormat.ITF, z.BarcodeFormat.QR_CODE, z.BarcodeFormat.DATA_MATRIX
  ]);
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  const reader = new z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return async (src) => {
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    if (!sw) return null;
    const k = Math.min(1, 1100 / Math.max(sw, sh));
    canvas.width = Math.round(sw * k);
    canvas.height = Math.round(sh * k);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    try {
      const bmp = new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(gray, width, height)));
      return reader.decode(bmp).getText();
    } catch { return null; } // is frame mein koi code nahi
    finally { reader.reset(); }
  };
}

/** async (video|canvas) => "code" | null */
export async function createBarcodeReader() {
  return (await nativeReader()) || zxingReader();
}

/* ---------- dabbi ruk gayi? ---------- */

const W = 80, H = 60;

/** Video ka chhota sa gray nakhsha, is se hilna aur khali deewar pehchante hain */
export function createSceneWatcher() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  let prev = null;

  const sample = (video) => {
    x.drawImage(video, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    const g = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] + d[j + 1] * 2 + d[j + 2]) >> 2;
    return g;
  };
  const diff = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };
  const detail = (g) => { let t = 0; for (let i = 1; i < g.length; i++) t += Math.abs(g[i] - g[i - 1]); return t / g.length; };

  return {
    /** { motion, detail, frame } */
    look(video) {
      const frame = sample(video);
      const motion = prev ? diff(frame, prev) : 255;
      prev = frame;
      return { motion, detail: detail(frame), frame };
    },
    diff
  };
}

/* ---------- awaz (Retail Barcode Scanner Beep) ---------- */

let audio;
export function beep(freq = 1900, duration = 0.08) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audio) audio = new AudioCtx();
    if (audio.state === 'suspended') {
      audio.resume();
    }
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, audio.currentTime);
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + duration);
    navigator.vibrate?.(65);
  } catch { /* awaz zaroori nahi */ }
}
