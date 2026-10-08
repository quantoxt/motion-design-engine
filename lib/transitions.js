// Scene changes where an object BECOMES the next scene, instead of the old scene flying off.
// Pure functions of their inputs (no state), in design units (see frameExtents in lib/layout.js).
//
//   const F = frameExtents(W, H);
//   flood(g, spring(t - 6.4, 150, 24), F, btn.cx, btn.cy, ACCENT, 42);   // the button grows past every edge
//   if (covered(p)) …                                                    // stop drawing the scene under it
//   fitText(g, 'Unlocked.', F.width * 0.88, '800 {size}px "Geist"')      // one word, edge to edge
//
// Why: a fast fly-off is drawn by the renderer as separate see-through copies (check.mjs reports "streak").
// A flood or shrink moves a big flat edge or a short distance, so it reads clean, and the eye follows
// the object into the next scene.

// Distance from (cx, cy) to the farthest frame corner: a circle this big covers the whole frame.
export function coverRadius(F, cx, cy) {
  return Math.max(...[[F.left, F.top], [F.right, F.top], [F.left, F.bottom], [F.right, F.bottom]]
    .map(([x, y]) => Math.hypot(x - cx, y - cy)));
}

// A circle growing from radius r0 at (cx, cy) until it covers the frame; p is a spring progress 0→1.
export function flood(g, p, F, cx, cy, color, r0 = 0) {
  if (p <= 0) return 0;
  const r = r0 + (coverRadius(F, cx, cy) + 2 - r0) * Math.min(1, p);
  g.fillStyle = color;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  return r;
}

// True once a flood has covered the frame (springs settle at ~0.98+ for practical purposes).
export const covered = (p) => p >= 0.985;

// The reverse: the frame drains into a dot at (cx, cy) (the motif). Draw the next scene, then call this
// with p 0→1 to cut the old colour down to a shrinking circle. Returns the radius.
export function drain(g, p, F, cx, cy, color, r1 = 0) {
  const R = coverRadius(F, cx, cy) + 2, r = R + (r1 - R) * Math.min(1, Math.max(0, p));
  if (r <= 0) return 0;
  g.fillStyle = color;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  return r;
}

// Font size that makes `str` exactly `width` wide in `font` (a template with {size}); sets g.font.
export function fitText(g, str, width, font) {
  g.font = font.replace('{size}', 100);
  const size = 100 * width / Math.max(1, g.measureText(str).width);
  g.font = font.replace('{size}', size.toFixed(2));
  return size;
}
