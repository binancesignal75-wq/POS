/**
 * Real-time: mobile scanner  ->  desktop counter
 *
 * Mobile emit:  'scan'  { mode: 'add' | 'sale', name, strength, form, pack_size, company, mrp, batch_no, expiry_date, barcode }
 * Desktop on :  'scan'  { ...same, product (mili hui dawai), similar (isi naam ki dawaiyan), device }
 * Desktop on :  'devices' [ {id, name} ]   (kaun se phone online hain)
 */
const { Server } = require('socket.io');
const { one, query } = require('./db');
const { verify, pinVersion } = require('./middleware/auth');
const { fromSql } = require('./utils/helpers');

const sameStrength = (a, b) => String(a || '').replace(/\s+/g, '').toLowerCase() === String(b || '').replace(/\s+/g, '').toLowerCase();

/** Bina barcode ki dawai: naam (aur MG) se pehle se mojood dawai dhoondna */
async function findByName(sid, name, strength) {
  const rows = await query(
    'SELECT * FROM products WHERE store_id = ? AND is_active = 1 AND name = ? LIMIT 20',
    [sid, name]);
  return strength ? rows.filter((r) => !r.strength || sameStrength(r.strength, strength)) : rows;
}

function setupSocket(httpServer, app, corsOrigin) {
  const io = new Server(httpServer, { cors: { origin: corsOrigin }, path: '/socket.io' });

  const room = (sid) => `store:${sid}`;

  async function devicesOnline(sid) {
    const sockets = await io.in(room(sid)).fetchSockets();
    const map = new Map();
    for (const s of sockets) if (s.data.role === 'device') map.set(s.data.deviceId, { id: s.data.deviceId, name: s.data.deviceName });
    return [...map.values()];
  }
  const broadcastDevices = async (sid) => io.to(room(sid)).emit('devices', await devicesOnline(sid));

  // REST routes ke liye helpers
  const onlineCache = new Map();
  app.set('onlineDevices', (sid) => onlineCache.get(sid) || []);
  app.set('kickDevice', async (sid, deviceId) => {
    const sockets = await io.in(room(sid)).fetchSockets();
    sockets.filter((s) => s.data.deviceId === deviceId).forEach((s) => { s.emit('revoked'); s.disconnect(true); });
  });
  const refreshCache = async (sid) => onlineCache.set(sid, (await devicesOnline(sid)).map((d) => d.id));

  io.use(async (socket, next) => {
    try {
      const p = verify(socket.handshake.auth?.token);
      if (!p || !['store', 'device'].includes(p.role)) return next(new Error('unauthorized'));
      const store = await one('SELECT id, license_key, pin_hash, is_active, expires_at FROM stores WHERE id = ?', [p.store_id]);
      if (!store || store.license_key !== p.key || !store.is_active || fromSql(store.expires_at) < new Date()) {
        return next(new Error('license'));
      }
      if (p.role === 'store' && p.pv !== pinVersion(store)) return next(new Error('unauthorized')); // PIN badla to purana token band
      socket.data.storeId = store.id;
      socket.data.role = p.role;
      if (p.role === 'device') {
        const d = await one('SELECT * FROM devices WHERE id = ? AND store_id = ? AND is_revoked = 0', [p.device_id, store.id]);
        if (!d) return next(new Error('revoked'));
        socket.data.deviceId = d.id;
        socket.data.deviceName = d.name;
      }
      next();
    } catch (e) { next(new Error('server')); }
  });

  io.on('connection', async (socket) => {
    const sid = socket.data.storeId;
    socket.join(room(sid));
    if (socket.data.role === 'device') {
      query('UPDATE devices SET last_seen = UTC_TIMESTAMP() WHERE id = ?', [socket.data.deviceId]).catch(() => {});
      await refreshCache(sid);
      broadcastDevices(sid);
    } else {
      socket.emit('devices', await devicesOnline(sid));
    }

    socket.on('scan', async (raw, ack) => {
      if (socket.data.role !== 'device') return;
      const s = v => (v === undefined || v === null ? null : String(v).trim().slice(0, 150) || null);
      const payload = {
        mode: raw?.mode === 'sale' ? 'sale' : 'add',
        name: s(raw?.name), strength: s(raw?.strength), form: s(raw?.form),
        pack_size: s(raw?.pack_size), barcode: s(raw?.barcode),
        company: s(raw?.company), mrp: s(raw?.mrp), batch_no: s(raw?.batch_no), expiry_date: s(raw?.expiry_date),
        device: { id: socket.data.deviceId, name: socket.data.deviceName },
        at: Date.now()
      };
      let product = null;
      let similar = [];
      if (payload.barcode) {
        product = await one(
          'SELECT * FROM products WHERE store_id = ? AND is_active = 1 AND (barcode = ? OR barcode_strip = ? OR barcode_alt = ?) LIMIT 1',
          [sid, payload.barcode, payload.barcode, payload.barcode]
        ).catch(() => null);
        if (product) {
          product.matched_unit = (product.barcode_strip && product.barcode_strip === payload.barcode && (product.strips_per_box || 1) > 1) ? 'strip' : 'box';
        }
      }
      if (!product && payload.name && payload.mode === 'sale') {
        similar = await findByName(sid, payload.name, payload.strength).catch(() => []);
        // sale mein naam + MG se bilkul ek hi dawai mile to wahi bill mein
        if (similar.length === 1) { product = similar[0]; similar = []; }
      }
      payload.product = product;
      payload.similar = payload.mode === 'sale' ? similar : [];
      const sockets = await io.in(room(sid)).fetchSockets();
      const desktops = sockets.filter((x) => x.data.role === 'store').length;
      io.to(room(sid)).except(socket.id).emit('scan', payload);
      if (typeof ack === 'function') {
        ack({
          ok: true,
          delivered: desktops,
          product: product
            ? {
                id: product.id,
                name: product.name,
                strength: product.strength,
                mrp: product.mrp,
                stock: product.stock,
                strips_per_box: product.strips_per_box || 1,
                matched_unit: product.matched_unit || 'box',
              }
            : null,
        });
      }
    });

    socket.on('disconnect', async () => {
      if (socket.data.role === 'device') { await refreshCache(sid); broadcastDevices(sid); }
    });
  });

  return io;
}

module.exports = { setupSocket };
