// Type motion the rules require, as one import, so the correct way is the easy way.
// All pure in t; they draw with the context's current font, fill and alignment.

// Odometer columns with carry, for a value animated by a spring (e.g. track(t, [[0,120],[2,150]])).
// A column rolls only while every column to its right passes 9 → 0, so the tens never rest
// half-rolled (the `1⁵25` bug). → one fractional digit per column, left to right (0 ≤ d < 10).
export function odometer(v, columns) {
  v = Math.max(0, v);
  const out = [];
  for (let i = 0; i < columns; i++) {
    const p = 10 ** (columns - 1 - i);
    const roll = p === 1 ? v : Math.floor(v / p) + Math.max(0, (v % p) - (p - 1));
    out.push(((roll % 10) + 10) % 10);
  }
  return out;
}

// Draw one rolling column at (x, y baseline): digit floor(d) moving up, the next one coming in.
export function rollDigit(g, d, x, y, size) {
  const lo = Math.floor(d) % 10, f = d - Math.floor(d), step = size * 1.2;
  g.save();
  g.beginPath(); g.rect(x - size, y - size * 1.0, size * 2, size * 1.28); g.clip();
  g.fillText(String(lo), x, y - f * step);
  if (f > 0) g.fillText(String((lo + 1) % 10), x, y + (1 - f) * step);
  g.restore();
}

// Draw a whole odometer: `columns` digits `step` apart starting at x (each column centred: set
// g.textAlign = 'center' for a monospaced look).
export function drawOdometer(g, v, columns, x, y, size, step = size * 0.62) {
  odometer(v, columns).forEach((d, i) => rollDigit(g, d, x + i * step, y, size));
}

// Swap two labels on ONE spring progress p (0 → 1): `from` exits up while `to` enters from below,
// inside one line clip. They travel together and are 1.3 lines apart, so glyphs never share pixels
// (no "UUnlockd" ghost under motion blur) and the swap is a motion, not a hard cut.
export function swapText(g, from, to, p, x, y, size) {
  const gap = size * 1.3;
  g.save();
  g.beginPath(); g.rect(x - 1e4, y - size * 1.0, 2e4, size * 1.28); g.clip();
  if (p < 1) g.fillText(from, x, y - p * gap);
  if (p > 0) g.fillText(to, x, y + (1 - p) * gap);
  g.restore();
}
