// Geometry checks over a film's anchors (lib/layout.js). Pure: frames in, failures out. Used by check.mjs.
//
// frames: [{ t, anchors: [{ name, x, y, w, h, parent, bleed }] }] sampled at `fps`.
// clicks: [{ t, target }] from window.EVENTS.clicks. frame = { w, h } canvas size.
//
// Failures:
//   click-target   the cursor tip isn't inside the target as drawn at the click time
//   click-moving   the cursor is still travelling at the click (it should land ≥0.4s early)
//   click-missing  a click without a target name, or its target/cursor wasn't drawn then
//   overflow       a child sticks out of its parent for ≥ `persist` seconds (text out of a chip)
//   collision      two solid anchors (every L.text, plus { solid: true }) overlap for ≥ `persist` seconds,
//                  unless one contains the other through the parent chain (a label in its chip)
//   off-frame      an anchor is cut by the frame edge for ≥ `edge` seconds (not bleed; entries cross it briefly)
//   streak         an anchor moves so fast that the renderer's motion blur (film fps × sub snapshots a second)
//                  shows it as separate see-through copies instead of one smooth smear: more than `gap` px
//                  (at 1080 on the short side) between snapshots. Needs blur: { fps, sub }.
// Passing through an edge or a parent briefly (entries, exits, swaps) is motion, not a bug: only
// states that last are reported.
import { inside, contains } from './layout.js';

export function check(frames, { clicks = [], frame, fps, cursor = 'cursor', persist = 0.3, edge = 0.6, settle = 0.1, still = 0.01, overlap = 2, blur = null, gap = 24 }) {
  const failures = [];
  const at = (t) => frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best), frames[0]);
  const get = (f, name) => f.anchors.find((a) => a.name === name);

  for (const c of clicks) {
    const t = typeof c === 'number' ? c : c.t, target = typeof c === 'number' ? null : c.target;
    if (!target) { failures.push({ kind: 'click-missing', t, msg: `click at ${t}s has no target: use { t, target: '<anchor>' }` }); continue; }
    const f = at(t), tip = get(f, cursor), box = get(f, target);
    if (!tip || !box) { failures.push({ kind: 'click-missing', t, msg: `at ${t}s ${!tip ? `no "${cursor}" anchor` : ''}${!tip && !box ? ' and ' : ''}${!box ? `no "${target}" anchor` : ''} was drawn` }); continue; }
    if (!inside(tip, box)) {
      const dx = tip.x < box.x ? tip.x - box.x : tip.x > box.x + box.w ? tip.x - box.x - box.w : 0;
      const dy = tip.y < box.y ? tip.y - box.y : tip.y > box.y + box.h ? tip.y - box.y - box.h : 0;
      failures.push({ kind: 'click-target', t, msg: `click at ${t}s misses "${target}" by (${Math.round(dx)}, ${Math.round(dy)})px` });
    }
    const before = get(at(t - settle), cursor);
    const moved = before ? Math.hypot(tip.x - before.x, tip.y - before.y) : 0;
    if (moved > still * Math.min(frame.w, frame.h)) {
      failures.push({ kind: 'click-moving', t, msg: `cursor still moving at the ${t}s click (${Math.round(moved)}px in the last ${settle}s): land ≥0.4s before` });
    }
  }

  // Lasting states: overflow and off-frame, reported once per run with its start and length.
  const need = { streak: 1, overflow: Math.max(1, Math.round(persist * fps)), collision: Math.max(1, Math.round(persist * fps)), 'off-frame': Math.max(1, Math.round(edge * fps)) };
  const runs = new Map();   // key → { kind, start, n, msg }
  const flush = (key, r) => { if (r.n >= need[r.kind]) failures.push({ kind: r.kind, t: r.start, dur: +(r.n / fps).toFixed(2), msg: r.msg, px: r.px }); runs.delete(key); };
  const grid = frames.filter((x) => x.grid !== false);
  const step = blur ? gap * Math.min(frame.w, frame.h) / 1080 : Infinity;   // px between blur snapshots, scaled to the frame
  grid.forEach((f, k) => {
    const seen = new Set();
    const hit = (key, kind, msg, px = 0) => {
      seen.add(key);
      const r = runs.get(key);
      if (r) { r.n++; r.px = Math.max(r.px, px); } else runs.set(key, { kind, start: f.t, n: 1, msg, px });
    };
    for (const a of f.anchors) {
      if (a.parent) {
        const p = get(f, a.parent);
        if (p && !contains(p, a)) hit(`o:${a.name}`, 'overflow', `"${a.name}" sticks out of "${a.parent}"`);
      }
      const cut = a.w + a.h > 0 && (a.x < -0.5 || a.y < -0.5 || a.x + a.w > frame.w + 0.5 || a.y + a.h > frame.h + 0.5);
      const gone = a.x + a.w <= 0 || a.y + a.h <= 0 || a.x >= frame.w || a.y >= frame.h;   // fully off: not visible, not a bug
      if (!a.bleed && cut && !gone) hit(`f:${a.name}`, 'off-frame', `"${a.name}" is cut by the frame edge (mark it { bleed: true } if intended)`);
    }
    const solid = f.anchors.filter((a) => a.solid && a.w > 0 && a.h > 0);
    const kin = (a, b) => { for (let p = a.parent, n = 0; p && n < 20; p = get(f, p)?.parent, n++) if (p === b.name) return true; return false; };
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (kin(a, b) || kin(b, a)) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > overlap && oy > overlap) hit(`c:${a.name}|${b.name}`, 'collision', `"${a.name}" and "${b.name}" overlap (${Math.round(ox)}×${Math.round(oy)}px)`);
    }
    const prev = grid[k - 1];
    if (prev && blur) for (const a of f.anchors) {
      if (a.name === cursor || !(a.w > 0 && a.h > 0)) continue;
      const b = get(prev, a.name);
      if (!b) continue;
      const visible = a.x + a.w > 0 && a.y + a.h > 0 && a.x < frame.w && a.y < frame.h;
      const per = Math.hypot(a.cx - b.cx, a.cy - b.cy) / ((f.t - prev.t) * blur.fps * blur.sub);
      if (visible && per > step) hit(`s:${a.name}`, 'streak', a.name, Math.round(per));
    }
    for (const [key, r] of runs) if (!seen.has(key)) flush(key, r);
  });
  for (const [key, r] of [...runs]) flush(key, r);
  // One streak line per moment: everything that smears within 0.25s of each other is one exit.
  const out = [];
  for (const f of failures.sort((a, b) => a.t - b.t)) {
    if (f.kind !== 'streak') { out.push(f); continue; }
    const g = out.findLast((x) => x.kind === 'streak' && f.t - x.t <= 0.25);
    if (g) { g.names.push(f.msg); g.px = Math.max(g.px, f.px); g.dur = +Math.max(g.dur, f.t + f.dur - g.t).toFixed(2); }
    else out.push({ ...f, names: [f.msg] });
  }
  for (const f of out) if (f.kind === 'streak') {
    f.msg = `${f.names.map((n) => `"${n}"`).join(', ')} jump up to ${f.px}px between blur snapshots and smear into separate copies: `
      + `turn into the next scene instead of flying off, or shorten/slow the move, or raise film.json "sub"`;
    delete f.names;
  }
  for (const f of out) delete f.px;
  return out;
}
