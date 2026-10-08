// Checks for one still panel. Pure: anchors and measurements in, failures out. Used by pge/check.mjs.
//
// Geometry comes from the film engine's checker (lib/checks.mjs) run on a single frame: overflow (text out of
// its parent), collision (two texts overlap), off-frame (cut by the edge unless { bleed: true }).
// Still-only checks on top:
//   phone-size   text smaller than `phone` px when the image is shown `view` px wide (a phone feed is ~360px)
//   contrast     text whose own pixels don't stand out from what's around them (ratio < `ratio`)
//   empty        the panel is almost one flat colour (nothing was drawn)
import { check as geometry } from '../../lib/checks.mjs';

// WCAG relative luminance of an sRGB colour (0–255 channels) → 0..1.
export function luminance(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Contrast inside a text box from its pixel luminances: the glyphs are one end of the spread, the ground the
// other. 5th vs 95th percentile, so a few anti-aliased pixels or grain specks don't decide it.
export function boxContrast(lums) {
  if (!lums.length) return Infinity;
  const s = Float64Array.from(lums).sort();
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
  return ratio(at(0.05), at(0.95));
}

// panel: { anchors: [{ name, x, y, w, h, parent, bleed, solid, size?, contrast?, measured? }], flat: 0..1 }
//   measured = boxContrast of the text's box (computed in the page), flat = share of pixels equal to the
//   most common colour.
// frame: { w, h }. Returns failures [{ kind, msg }].
export function checkPanel(panel, { frame, view = 360, phone = 11, minRatio = 3, maxFlat = 0.985 } = {}) {
  const out = geometry([{ t: 0, anchors: panel.anchors }], { frame, fps: 1 })
    .filter((f) => f.kind !== 'choreo-easing')
    .map(({ kind, msg }) => ({ kind, msg }));
  const scale = view / Math.min(frame.w, frame.h);
  for (const a of panel.anchors) {
    if (a.size > 0 && a.size * scale < phone)
      out.push({ kind: 'phone-size', msg: `"${a.name}" is ${(a.size * scale).toFixed(1)}px on a ${view}px-wide phone (min ${phone}px): make it bigger or cut it` });
    if (a.contrast && Number.isFinite(a.measured) && a.measured < minRatio)
      out.push({ kind: 'contrast', msg: `"${a.name}" contrast ${a.measured.toFixed(2)}:1 against what's behind it (min ${minRatio}:1)` });
  }
  if (panel.flat > maxFlat) out.push({ kind: 'empty', msg: `${(panel.flat * 100).toFixed(1)}% of the panel is one flat colour: nothing drawn?` });
  return out;
}
