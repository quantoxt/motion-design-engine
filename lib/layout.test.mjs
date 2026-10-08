// Anchors, wrap/spans and the geometry checks, with a fake 2D context (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, boxThrough, wrap, spans } from './layout.js';
import { check } from './checks.mjs';

// Fake context: a transform stack and a 10px-per-character font.
function ctx() {
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  return {
    getTransform: () => ({ ...m }),
    translate(x, y) { m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }; },
    scale(s) { m = { ...m, a: m.a * s, b: m.b * s, c: m.c * s, d: m.d * s }; },
    measureText: (s) => ({ width: s.length * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: s.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
  };
}

test('anchors go through the current transform; rotation gives the bounding box', () => {
  const g = ctx(), L = createLayout();
  L.begin(0);
  g.translate(100, 50); g.scale(2);
  assert.deepEqual(L.anchor(g, 'btn', 10, 10, 40, 20), { name: 'btn', x: 120, y: 70, w: 80, h: 40, cx: 160, cy: 90, parent: null, bleed: false, solid: false });
  const r = boxThrough({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, 0, 0, 40, 20);   // 90° turn
  assert.deepEqual([r.x, r.y, r.w, r.h], [-20, 0, 20, 40]);
  assert.deepEqual(L.text(g, 'label', 'Unlock', 0, 0, { parent: 'btn' }).w, 120);
});

test('prepare caches each time; at() is loud about missing times and names', async () => {
  const g = ctx(), L = createLayout();
  const draw = (t) => { L.begin(t); L.anchor(g, 'card', t * 10, 0, 50, 50); };
  await L.prepare(draw, [1, 2.5]);
  assert.equal(L.at('card', 2.5).x, 25);
  assert.equal(L.live().length, 0, 'prepare leaves no stale frame behind');
  assert.throws(() => L.at('card', 3), /not prepared/);
  assert.throws(() => L.at('nope', 1), /no anchor "nope".*have: card/);
});

test('wrap + spans follow a phrase across a line break', () => {
  const g = ctx(), text = 'Eilean Donan Castle hides a legend tonight';
  const lines = wrap(g, text, 200);          // 20 chars per line
  assert.deepEqual(lines.map((l) => l.text), ['Eilean Donan Castle', 'hides a legend', 'tonight']);
  const s = spans(g, text, lines, 'Castle hides a');
  assert.deepEqual(s, [{ line: 0, x0: 130, x1: 190 }, { line: 1, x0: 0, x1: 70 }]);
  assert.throws(() => spans(g, text, lines, 'finds'), /not in text/);   // the indexOf −1 bug, now loud
});

const frame = { w: 1000, h: 1000 }, fps = 30;
const box = (name, x, y, w, h, o = {}) => ({ name, x, y, w, h, parent: null, bleed: false, ...o });
const tip = (x, y) => box('cursor', x, y, 0, 0);

test('clicks: inside and at rest passes; a miss, a moving cursor and a missing target fail', () => {
  const frames = [
    { t: 0.9, grid: false, anchors: [tip(110, 110), box('unlock', 100, 100, 200, 60)] },
    { t: 1.0, grid: false, anchors: [tip(110, 110), box('unlock', 100, 100, 200, 60)] },
    { t: 1.9, grid: false, anchors: [tip(300, 400), box('unlock', 100, 100, 200, 60)] },
    { t: 2.0, grid: false, anchors: [tip(150, 198), box('unlock', 100, 100, 200, 60)] },
  ];
  assert.deepEqual(check(frames, { clicks: [{ t: 1, target: 'unlock' }], frame, fps }), []);
  const f = check(frames, { clicks: [{ t: 2, target: 'unlock' }, 3, { t: 1, target: 'buy' }], frame, fps });
  assert.deepEqual(f.map((x) => x.kind).sort(), ['click-missing', 'click-missing', 'click-moving', 'click-target']);
  assert.match(f.find((x) => x.kind === 'click-target').msg, /misses "unlock" by \(0, 38\)px/);
});

test('overflow and off-frame count only when they last', () => {
  const at = (i, anchors) => ({ t: i / fps, anchors });
  const chip = box('chip', 100, 100, 260, 60);
  const frames = [
    ...Array.from({ length: 5 }, (_, i) => at(i, [chip, box('coins', 300, 110, 80, 30, { parent: 'chip' })])),       // brief: a swap
    ...Array.from({ length: 12 }, (_, i) => at(5 + i, [chip, box('coins', 300, 110, 90, 30, { parent: 'chip' })])),  // 0.4s: a bug
    ...Array.from({ length: 30 }, (_, i) => at(17 + i, [box('marquee', -50, 900, 1100, 80), box('wall', -50, 0, 1100, 80, { bleed: true }), box('gone', -500, 0, 100, 100)])),
  ];
  const f = check(frames, { frame, fps });
  assert.deepEqual(f.map((x) => [x.kind, x.dur]), [['overflow', 0.57], ['off-frame', 1]]);
  assert.match(f[1].msg, /"marquee"/);
});

test('cursorAt lands on the anchor early and at rest, and presses on time', async () => {
  const { cursorAt } = await import('./cursor.js');
  const g = ctx(), L = createLayout();
  const draw = (t) => { L.begin(t); L.anchor(g, 'unlock', 600, 800, 200, 60); };
  const clicks = [{ t: 2, target: 'unlock' }];
  await L.prepare(draw, clicks.map((c) => c.t));
  const at = (t) => cursorAt(t, L, clicks, { home: [100, 100] });
  assert.ok(Math.hypot(at(2).x - 700, at(2).y - 830) < 1, 'on the centre at the click');
  assert.ok(Math.hypot(at(1.6).x - 700, at(1.6).y - 830) < 6, 'already there 0.4s before');
  assert.equal(at(1).press, 0);
  assert.ok(at(2.1).press > 0.5);
  // the same film passes check.mjs's click rules
  const frames = [1.9, 2].map((t) => { draw(t); const c = at(t); return { t, anchors: [...L.live(), { name: 'cursor', x: c.x, y: c.y, w: 0, h: 0 }] }; });
  assert.deepEqual(check(frames, { clicks, frame: { w: 1080, h: 1920 }, fps: 30 }), []);
});

test('a frame drawn during prepare may ask for anchors that are not measured yet', async () => {
  const g = ctx(), L = createLayout();
  const draw = (t) => { L.begin(t); L.anchor(g, 'btn', 10, 10, 5, 5); L.at('btn', 2); };   // e.g. a cursor
  await L.prepare(draw, [1, 2]);
  assert.equal(L.at('btn', 2).x, 10);
  assert.throws(() => L.at('btn', 3), /not prepared/, 'strict again afterwards');
});

test('frameExtents: bleed sizes follow the frame in every format, not the 1080 box', async () => {
  const { frameExtents } = await import('./layout.js');
  const wide = frameExtents(1920, 1080), tall = frameExtents(1080, 1920), sq = frameExtents(1080, 1080);
  assert.deepEqual([wide.EX, wide.EY], [960, 540]);
  assert.deepEqual(wide.across(40), { x: -1000, w: 2000 }, 'a 16:9 marquee spans the whole width');
  assert.deepEqual(tall.down(0), { y: -960, h: 1920 });
  assert.deepEqual([sq.width, sq.height], [1080, 1080]);
});

test('L.text { align, baseline } sets the context before measuring; at() names the handoff fix', async () => {
  const g = ctx();
  g.textAlign = 'left';
  // centre alignment: the box starts half a width left of x
  g.measureText = (s) => { const w = s.length * 10, c = g.textAlign === 'center';
    return { width: w, actualBoundingBoxLeft: c ? w / 2 : 0, actualBoundingBoxRight: c ? w / 2 : w, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; };
  const L = createLayout();
  L.begin(0);
  const r = L.text(g, 'cta', 'Browse', 100, 50, { align: 'center', baseline: 'alphabetic' });
  assert.equal(g.textAlign, 'center');
  assert.equal(g.textBaseline, 'alphabetic');
  assert.deepEqual([r.x, r.w, r.solid], [70, 60, true]);
  await L.prepare((t) => { L.begin(t); if (!(t >= 2)) L.text(g, 'cta', 'x', 0, 0); }, [2]);
  assert.throws(() => L.at('cta', 2), /hand off strictly after it \(`t > 2`\)/);
});

test('streak: a fast exit shows as separate copies at sub 4, smooth at sub 16; slow moves pass', () => {
  const frame = { w: 1080, h: 1920 };
  const box = (t, y) => ({ t, anchors: [{ name: 'title', x: 100, y, w: 400, h: 100, cx: 300, cy: y + 50 }] });
  const fast = [box(0, 900), box(1 / 30, 600)];          // 300px in 1/30s = 9000px/s → 37px per snapshot at 60fps × sub 4
  const slow = [box(0, 900), box(1 / 30, 880)];
  const kinds = (fr, sub) => check(fr, { frame, fps: 30, blur: { fps: 60, sub } }).map((f) => f.kind);
  assert.deepEqual(kinds(fast, 4), ['streak']);
  assert.deepEqual(kinds(fast, 16), []);
  assert.deepEqual(kinds(slow, 4), []);
  assert.deepEqual(check(fast, { frame, fps: 30 }).map((f) => f.kind), []);   // no blur info → not checked
});
