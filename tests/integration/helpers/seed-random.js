// Seed Math.random for deterministic test output.
// Uses mulberry32, a simple 32-bit PRNG with good distribution.
// Use via: await page.addInitScript({ path: '...helpers/seed-random.js' });
(function () {
  let s = 42;
  Math.random = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
})();
