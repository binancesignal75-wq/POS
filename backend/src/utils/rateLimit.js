/** Chhota sa in-memory limiter: hit(key) -> true agar limit ke andar hai. */
function limiter({ max, windowMs }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
  }, Math.max(60000, windowMs));
  timer.unref?.();
  return {
    hit(key) {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.until <= now) { hits.set(key, { n: 1, until: now + windowMs }); return true; }
      h.n += 1;
      return h.n <= max;
    }
  };
}

module.exports = { limiter };
