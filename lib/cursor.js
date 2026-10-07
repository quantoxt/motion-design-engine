// A cursor driven by anchors (lib/layout.js): it travels to each click's target as drawn at the click
// time, arrives early and at rest, and presses on time. Screen pixels, so draw it with an identity
// transform. Different stiffness per axis, so it travels on a curve.
//
//   const CLICKS = [{ t: 24.0, target: 'unlock' }];
//   await L.prepare(draw, CLICKS.map((c) => c.t));            // in window.ready
//   const c = cursorAt(t, L, CLICKS, { home: [W * 0.7, H * 0.8] });
//   g.setTransform(1, 0, 0, 1, 0, 0); drawArrow(c.x, c.y, 1 - 0.15 * c.press);
//   L.point(g, 'cursor', c.x, c.y);                          // the tip check.mjs tests
import { track, spring, clamp } from './motion.js';

// Critically damped springs, within 1% of the target by ~0.5s (x) and ~0.4s (y): with `lead` 0.9 the
// cursor is at rest ≥ 0.4s before every click. Unequal stiffness bends the path.
const SX = [200, 28], SY = [300, 34];

// Where in the target to click: its centre, or { at: [fx, fy] } as fractions of the box (0..1).
const aim = (r, c) => (c.at ? [r.x + r.w * c.at[0], r.y + r.h * c.at[1]] : [r.cx, r.cy]);

export function cursorAt(t, L, clicks, { home = [0, 0], lead = 0.9, from = 0 } = {}) {
  clicks = [...clicks].sort((a, b) => a.t - b.t);
  const kx = [[from, home[0]]], ky = [[from, home[1]]];
  for (const c of clicks) {
    const [x, y] = aim(L.at(c.target, c.t), c);
    kx.push([c.t - lead, x]); ky.push([c.t - lead, y]);
  }
  // press: 0 → 1 → 0 over ~0.3s around each click (scale the arrow, start the ring)
  let press = 0;
  for (const c of clicks) press = Math.max(press, Math.sin(clamp((t - c.t + 0.06) / 0.3) * Math.PI));
  return { x: track(t, kx, ...SX), y: track(t, ky, ...SY), press };
}

// 0 → 1 ring growth after a click, for a click ring drawn at the cursor tip.
export const ring = (t, clickT) => (t < clickT ? 0 : spring(t - clickT, 180, 24));
