// Hand-drawn SVG ink for canvas films. All pure functions of t — contract-safe.
// Paths come from anywhere: hand-authored `d` strings or traced from an image
// (potrace / vtracer → paste the `d` output here; see trace()).
import { rng } from './motion.js';

// Cycle path variants for stop-motion boil. rate = shifts per second (12 = classic).
// Variants: same drawing nudged 1-2px, or 2-3 traced outputs of the same sketch.
// Safe for negative t (renderers sample just before frame 0 for motion blur).
export function boil(variants, t, rate = 12) {
  const n = variants.length;
  return variants[((Math.floor(t * rate) % n) + n) % n];
}

// Parse an SVG string → Path2D[] (one per <path>). Paste traced output directly.
export function trace(svgString) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  return [...doc.querySelectorAll('path')].map((p) => new Path2D(p.getAttribute('d')));
}

// Pencil-ink stroke: 3 passes with tiny seeded offsets read as graphite.
// seed pins the wobble so frame t is identical every render.
export function ink(g, path, { width = 6, color = '#F0EEE6', seed = 1, passes = 3 } = {}) {
  const r = rng(seed);
  const offs = Array.from({ length: passes }, () => [(r() - 0.5) * 2.4, (r() - 0.5) * 2.4]);
  g.save();
  g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = color;
  for (const [dx, dy] of offs) {
    g.save(); g.translate(dx, dy); g.globalAlpha = 0.85; g.stroke(path); g.restore();
  }
  g.restore();
}

// Wobbly underline / connector in one call: draws a slightly bowed line that
// grows along its final shape with progress p (0→1). Pure in (p, seed).
// The bowed curve is fixed; p draws its first part (de Casteljau split), so the
// stroke never changes shape while drawing and stays bowed at p = 1.
export function strokeLine(g, x1, y1, x2, y2, p, { width = 6, color = '#F0EEE6', seed = 2, bow = 14 } = {}) {
  if (p <= 0) return;                                 // a zero-length round-cap stroke would draw a dot
  p = Math.min(1, p);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 - bow;  // control point of the full curve
  const qx = x1 + (cx - x1) * p, qy = y1 + (cy - y1) * p;
  const rx = cx + (x2 - cx) * p, ry = cy + (y2 - cy) * p;
  const ex = qx + (rx - qx) * p, ey = qy + (ry - qy) * p;
  ink(g, new Path2D(`M${x1} ${y1} Q${qx} ${qy} ${ex} ${ey}`), { width, color, seed });
}
