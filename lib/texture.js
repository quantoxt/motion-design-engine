// Film texture for flat colour: fine grain and a soft vignette, so a flood or a full-screen colour
// doesn't read as a digital fill. Pure in t: the grain frame is picked from a fixed set of seeded tiles
// (mulberry32, built once), so every worker paints the same pixels at the same t (parallel-safe).
//
//   flood(g, p, F, cx, cy, ACCENT, 42);
//   grain(g, t, F);          // after the colour, before the type that sits on it
//   vignette(g, F);
import { rng } from './motion.js';

const tiles = new Map();   // key → [canvas…]
function tileSet(size, frames, seed) {
  const key = `${size}:${frames}:${seed}`;
  if (tiles.has(key)) return tiles.get(key);
  const set = Array.from({ length: frames }, (_, i) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d'), img = x.createImageData(size, size), r = rng(seed * 997 + i);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = Math.round(r() * 255);
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  });
  tiles.set(key, set);
  return set;
}

// Grain over the whole frame (design units, current transform). It re-seeds `fps` times a second, like film.
// holds.mjs ignores it (grain is too small to count as screen area moving).
export function grain(g, t, F, { amount = 0.07, fps = 12, size = 256, frames = 8, seed = 7 } = {}) {
  const set = tileSet(size, frames, seed), k = Math.floor(Math.max(0, t) * fps);
  const pat = g.createPattern(set[k % frames], 'repeat');
  g.save();
  g.globalAlpha = amount; g.globalCompositeOperation = 'overlay';
  g.fillStyle = pat;
  g.fillRect(F.left, F.top, F.width, F.height);
  g.restore();
}

// Darkens the corners a little, centred on the frame. amount = corner opacity.
export function vignette(g, F, { amount = 0.16, color = '0,0,0' } = {}) {
  const R = Math.hypot(F.EX, F.EY), grad = g.createRadialGradient(0, 0, Math.min(F.EX, F.EY) * 0.55, 0, 0, R);
  grad.addColorStop(0, `rgba(${color},0)`);
  grad.addColorStop(1, `rgba(${color},${amount})`);
  g.save();
  g.fillStyle = grad;
  g.fillRect(F.left, F.top, F.width, F.height);
  g.restore();
}
