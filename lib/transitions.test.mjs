// HyperFrames ports: wipe / blinds / dissolve in lib/transitions.js, ripple in lib/cursor.js.
// Fake 2D context (no browser): records calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wipe, blinds, blindsFor, dissolve, flood, coverRadius } from './transitions.js';
import { ripple } from './cursor.js';
import { check } from './checks.mjs';

function ctx() {
  const calls = [];
  return {
    calls,
    set fillStyle(v) { calls.push(['fillStyle', v]); },
    set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set lineWidth(v) { calls.push(['lineWidth', v]); },
    set globalAlpha(v) { calls.push(['globalAlpha', v]); },
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    arc(x, y, r, a0, a1) { calls.push(['arc', Math.round(r)]); },
    fillRect(x, y, w, h) { calls.push(['fillRect', Math.round(x), Math.round(y), Math.round(w), Math.round(h)]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
  };
}

const F = { left: -540, top: -960, right: 540, bottom: 960 };   // 1080x1920 design frame

test('wipe sweeps a wedge and covers the frame at p=1', () => {
  const g = ctx();
  assert.equal(wipe(g, 0, F, 0, 0, '#000'), 0);
  assert.equal(g.calls.length, 0);
  wipe(g, 0.25, F, 0, 0, '#000');
  assert.ok(g.calls.some((c) => c[0] === 'arc'));
  const g2 = ctx();
  wipe(g2, 1, F, 0, 0, '#000');
  assert.ok(g2.calls.some((c) => c[0] === 'fillRect' && c[3] === 1080 && c[4] === 1920));
});

test('blinds cover the frame at p=1; count follows the brief Energy', () => {
  assert.deepEqual([blindsFor('calm'), blindsFor('steady'), blindsFor('showreel-fast')], [4, 8, 14]);
  const g = ctx();
  blinds(g, 1, F, '#000', 4);
  const slats = g.calls.filter((c) => c[0] === 'fillRect');
  assert.equal(slats.length, 4);
  assert.equal(slats.reduce((a, c) => a + c[4], 0), 1920);   // slats tile the full height
});

test('dissolve fills a deterministic fraction of cells', () => {
  const pal = ['#a', '#b', '#c'];
  const g1 = ctx(), g2 = ctx();
  const n1 = dissolve(g1, 0.5, F, pal, 120, 7), n2 = dissolve(g2, 0.5, F, pal, 120, 7);
  assert.equal(n1, n2);   // same seed → same cells
  const cells1 = g1.calls.filter((c) => c[0] === 'fillRect').map((c) => c.slice(1).join(','));
  const cells2 = g2.calls.filter((c) => c[0] === 'fillRect').map((c) => c.slice(1).join(','));
  assert.deepEqual(cells1, cells2);
  const g3 = ctx();
  assert.equal(dissolve(g3, 1, F, pal, 120, 7) >= n1, true);
  const g0 = ctx();
  assert.equal(dissolve(g0, 0, F, pal), 0);
});

test('ripple draws staggered rings mid-progress, nothing at the ends', () => {
  const g = ctx();
  assert.equal(ripple(g, 0, 0, 0), 0);
  assert.equal(ripple(g, 0, 0, 1), 0);
  const gm = ctx();
  const drawn = ripple(gm, 100, 200, 0.5, { rings: 3 });
  assert.ok(drawn >= 2);   // stagger: at least two rings alive mid-flight
  const arcs = gm.calls.filter((c) => c[0] === 'arc');
  const radii = arcs.map((c) => c[1]);
  assert.ok(arcs.length >= 2 && new Set(radii).size >= 2);   // distinct expanding radii
});

test('flood still covers: coverRadius sanity for the wipe radius', () => {
  assert.ok(coverRadius(F, 0, 0) > 1000);
});

// Choreo audit: one anchor entering at wildly different speeds is a failure;
// consistent easings pass.
function framesWith(runs, fps = 10) {
  // runs: [{ from, to, x0, x1 }] — anchor 'card' travels x0→x1 over [from, to]
  const frames = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / fps;
    let x = 0;
    for (const r of runs) {
      if (t >= r.from && t <= r.to) x = r.x0 + (r.x1 - r.x0) * ((t - r.from) / (r.to - r.from));
      else if (t > r.to) x = r.x1;
    }
    frames.push({ t, grid: true, anchors: [{ name: 'card', x, y: 0, w: 50, h: 50, cx: x + 25, cy: 25 }] });
  }
  return frames;
}

test('choreo-easing fires on mixed entrance speeds, passes on one easing', () => {
  const frame = { w: 1920, h: 1080 };
  const mixed = check(framesWith([{ from: 0.5, to: 1.0, x0: 0, x1: 900 }, { from: 2.5, to: 3.5, x0: 900, x1: 1400 }]), { frame, fps: 10 });
  assert.ok(mixed.some((f) => f.kind === 'choreo-easing'), JSON.stringify(mixed));
  const same = check(framesWith([{ from: 0.5, to: 1.0, x0: 0, x1: 900 }, { from: 2.5, to: 3.0, x0: 900, x1: 1800 }]), { frame, fps: 10 });
  assert.ok(!same.some((f) => f.kind === 'choreo-easing'), JSON.stringify(same));
});
