// Named anchors: one source of truth for where things are on screen.
// Drawing code names each target where it draws it; cursors, ink, underlines and checks read the
// record instead of retyping coordinates. Rects are in canvas pixels, through the CURRENT transform
// (camera, scale, scroll, rotation → axis-aligned bounding box), so they match what was painted.
//
//   const L = createLayout();
//   function draw(t) { L.begin(t); … L.anchor(g, 'unlock', x, y, w, h); … }
//   window.ready = (async () => { …fonts…; await L.prepare(draw, CLICKS.map((c) => c.t)); })();
//   const target = L.at('unlock', 24.0);   // { x, y, w, h, cx, cy } as drawn at t = 24.0
//   window.LAYOUT = L;                       // check.mjs reads it
//
// prepare() draws the film once at each listed time before the first seek and caches the anchors.
// That's deterministic, so the film stays a pure function of t and parallel rendering stays safe.

// Local rect (x, y, w, h) through matrix m ({a,b,c,d,e,f}) → axis-aligned rect.
export function boxThrough(m, x, y, w, h) {
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export const inside = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
export const contains = (outer, r, pad = 0.5) =>
  r.x >= outer.x - pad && r.y >= outer.y - pad && r.x + r.w <= outer.x + outer.w + pad && r.y + r.h <= outer.y + outer.h + pad;

// Text box from the context's current font, alignment and baseline (what fillText would paint).
export function textRect(g, str, x, y) {
  const m = g.measureText(str);
  const left = x - m.actualBoundingBoxLeft, top = y - m.actualBoundingBoxAscent;
  return [left, top, m.actualBoundingBoxLeft + m.actualBoundingBoxRight, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent];
}

export function createLayout() {
  let live = new Map(), now = 0, preparing = false;
  const cache = new Map();   // t → Map(name → anchor)
  const key = (t) => t.toFixed(4);

  const L = {
    // Start a frame: forget the previous frame's anchors.
    begin(t) { live = new Map(); now = t; },

    // Name a rect drawn in the current transform. opts: { parent: 'name', bleed: true }
    // parent = this must sit inside that anchor (labels in chips, text in cards).
    // bleed  = allowed past the frame edge (marquees, walls).
    anchor(g, name, x, y, w, h, opts = {}) {
      const r = { name, ...boxThrough(g.getTransform(), x, y, w, h), parent: opts.parent ?? null, bleed: !!opts.bleed };
      live.set(name, r);
      return r;
    },
    // Same, for a point (the cursor tip): w = h = 0.
    point(g, name, x, y, opts) { return L.anchor(g, name, x, y, 0, 0, opts); },
    // Same, for text about to be drawn with fillText(str, x, y) under the current font.
    text(g, name, str, x, y, opts) { return L.anchor(g, name, ...textRect(g, str, x, y), opts); },

    async prepare(draw, times) {
      preparing = true;   // frames drawn here are measured, never shown: at() may be asked before it can answer
      try { for (const t of times) { draw(t); cache.set(key(t), live); } } finally { preparing = false; }
      live = new Map();
    },
    // An anchor as drawn at time t (t must have been prepared). Throws loudly: a missing target
    // is a bug, never a silent (0, 0).
    at(name, t) {
      const frame = cache.get(key(t));
      if (!frame && preparing) return { name, x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
      if (!frame) throw new Error(`layout: t=${t} was not prepared (add it to L.prepare)`);
      const r = frame.get(name);
      if (!r) throw new Error(`layout: no anchor "${name}" drawn at t=${t} (have: ${[...frame.keys()].join(', ') || 'none'})`);
      return r;
    },
    // This frame's anchors (for check.mjs).
    live: () => [...live.values()],
    get t() { return now; },
  };
  return L;
}

// Word wrap with the context's current font. Returns lines with their character range in `text`,
// so annotations (underlines, highlights) can follow a phrase across line breaks.
export function wrap(g, text, maxW) {
  const lines = [];
  const words = [...text.matchAll(/\S+/g)];
  let cur = null;
  for (const w of words) {
    const start = w.index, end = w.index + w[0].length;
    if (cur && g.measureText(text.slice(cur.start, end)).width <= maxW) { cur.end = end; continue; }
    if (cur) lines.push(cur);
    cur = { start, end };
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, text: text.slice(l.start, l.end), w: g.measureText(text.slice(l.start, l.end)).width }));
}

// Where a phrase sits in wrapped lines: one span per line it touches, x relative to the line start.
// `phrase` is a string (first occurrence) or a [start, end) character range. Throws if not found.
export function spans(g, text, lines, phrase) {
  let [a, b] = Array.isArray(phrase) ? phrase : [text.indexOf(phrase), text.indexOf(phrase) + phrase.length];
  if (a < 0) throw new Error(`spans: "${phrase}" not in text`);
  const out = [];
  lines.forEach((l, line) => {
    const s = Math.max(a, l.start), e = Math.min(b, l.end);
    if (s >= e) return;
    const x0 = g.measureText(text.slice(l.start, s)).width;
    out.push({ line, x0, x1: x0 + g.measureText(text.slice(s, e)).width });
  });
  return out;
}

// The frame in design units (origin at the centre, K = design → screen scale). Content stays in the
// 1080 safe box; anything meant to reach the frame edge (marquees, walls, wipes) is sized from these,
// never from the content box, so it bleeds in every format. Anchor it with { bleed: true }.
//   const F = frameExtents(W, H);
//   const m = F.across(40);   g.fillRect(m.x, y, m.w, 90);   // a marquee 40 units past both side edges
export function frameExtents(W, H, K = Math.min(W, H) / 1080) {
  const EX = W / 2 / K, EY = H / 2 / K;
  return {
    K, EX, EY, left: -EX, right: EX, top: -EY, bottom: EY, width: 2 * EX, height: 2 * EY,
    across: (pad = 0) => ({ x: -EX - pad, w: 2 * (EX + pad) }),   // full width, plus `pad` past each edge
    down: (pad = 0) => ({ y: -EY - pad, h: 2 * (EY + pad) }),     // full height, plus `pad` past each edge
  };
}
