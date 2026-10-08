// The stage for a still image job: canvas, design units, anchors, and the panel contract.
// An image job is a set of panels (1 for a single image or poster, 2–10 for a carousel story).
// Each panel is a pure function: paint(i) draws panel i, the same pixels every time.
//
//   import { createStill } from './pge/lib/still.js';
//   const S = await createStill();                 // reads job.json, ?w=&h= overrides, sizes #c
//   const { g, F, L, K } = S;
//   S.panels([
//     { name: 'hook', bg: '#141413', draw(g, F, i) { … S.text(g, 'title', 'Hello', 0, 0, { size: 120 }); … } },
//     …
//   ]);
//   window.ready = (async () => { await document.fonts.load('700 100px "Gelasio"'); })();
//
// Contract read by pge/render.mjs and pge/check.mjs:
//   window.ready   promise: fonts and images loaded
//   window.PANELS  [{ name }] in order
//   window.paint(i) draws panel i (0-based)
//   window.LAYOUT  the anchors of the panel painted last (lib/layout.js), plus `size` (px on screen) on text
//
// Design units: 1080 across the short side, origin at the centre (lib/layout.js frameExtents).
// Fake time: lib helpers that take t (grain, boil, springs) get a fixed t per panel, so a still can show
// "the middle of a motion" (a spring at 0.6, a half-drawn stroke) and still be deterministic.
import { createLayout, frameExtents } from '../../lib/layout.js';

export async function createStill({ canvas = document.getElementById('c') } = {}) {
  const job = await fetch('./job.json').then((r) => r.json());
  const qs = new URLSearchParams(location.search);
  const first = job.formats?.[0] ?? { w: 1080, h: 1350 };
  const W = +(qs.get('w') || first.w), H = +(qs.get('h') || first.h);
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const F = frameExtents(W, H);
  const { K } = F;
  const L = createLayout();
  window.LAYOUT = L;
  const camera = () => g.setTransform(K, 0, 0, K, W / 2, H / 2);

  const S = {
    job, g, W, H, F, K, L, camera,
    // Text, anchored: the box check.mjs tests for collisions, overflow, frame cuts, phone size and contrast.
    // size = font size in design units (sets g.font from `font`, a template with {size}).
    // opts: everything L.text takes ({ parent, align, baseline, bleed }) + contrast: false to skip the contrast
    // check (text deliberately knocked back, e.g. a watermark).
    text(g, name, str, x, y, { size, font, ...opts } = {}) {
      if (font) g.font = font.replace('{size}', size);
      const r = L.text(g, name, str, x, y, opts);
      r.size = (size ?? parseFloat(g.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)) * K;
      r.contrast = opts.contrast !== false;
      g.fillText(str, x, y);
      return r;
    },
    panels(list) {
      window.PANELS = list.map((p) => ({ name: p.name }));
      window.paint = (i) => {
        const p = list[i];
        if (!p) throw new Error(`no panel ${i} (have ${list.length})`);
        L.begin(i);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        g.fillStyle = p.bg ?? job.bg ?? '#141413';
        g.fillRect(0, 0, W, H);
        camera();
        g.save(); p.draw(g, F, i); g.restore();
        return true;
      };
      // Live preview in a normal browser: ←/→ step through the panels. Off in headless runs.
      if (!navigator.webdriver) {
        let at = 0;
        const show = () => { window.paint(at); document.title = `${at + 1}/${list.length} ${list[at].name}`; };
        Promise.resolve(window.ready).then(show);
        addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight') at = Math.min(list.length - 1, at + 1);
          else if (e.key === 'ArrowLeft') at = Math.max(0, at - 1);
          else return;
          show();
        });
      }
    },
  };
  return S;
}

// Wrapped copy, anchored per line, so every line is checked. Returns the lines ({ text, y, w }).
// Lines are set from y (first baseline) down by lead × size.
export function paragraph(S, g, name, str, x, y, maxW, { size, font, lead = 1.25, align = 'left', ...opts } = {}) {
  if (font) g.font = font.replace('{size}', size);
  const words = str.split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && g.measureText(next).width > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.map((line, k) => {
    const ly = y + k * size * lead;
    S.text(g, `${name}.${k}`, line, x, ly, { size, align, ...opts });
    return { text: line, y: ly, w: g.measureText(line).width };
  });
}
