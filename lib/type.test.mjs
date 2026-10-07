// Odometer carry, swap geometry and the hinge quad (fake context, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { odometer, swapText } from './type.js';
import { hingeQuad } from './project.js';

const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

test('odometer: columns roll only on carry, never rest half-rolled', () => {
  assert.ok(near(odometer(125, 3), [1, 2, 5]));
  assert.ok(near(odometer(125.5, 3), [1, 2, 5.5]), 'between 125 and 126 only the ones move');
  assert.ok(near(odometer(129.5, 3), [1, 2.5, 9.5]), '9 → 0 carries half a tens step');
  assert.ok(near(odometer(199.5, 3), [1.5, 9.5, 9.5]));
  assert.ok(near(odometer(130, 3), [1, 3, 0]));
});

test('swapText: both labels on one progress, 1.3 lines apart', () => {
  const calls = [];
  const g = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText: (s, x, y) => calls.push([s, y]) };
  swapText(g, 'Unlock', 'Unlocked', 0.5, 0, 100, 40);
  assert.deepEqual(calls, [['Unlock', 74], ['Unlocked', 126]]);
  calls.length = 0; swapText(g, 'Unlock', 'Unlocked', 0, 0, 100, 40);
  assert.deepEqual(calls, [['Unlock', 100]], 'at rest only one label is drawn');
});

test('hingeQuad: turns on its edge; edge-on is a line at the hinge; far edge marks where the next thing starts', () => {
  const r = { x: 100, y: 100, w: 200, h: 300 };
  assert.deepEqual(hingeQuad(r, 0, 'left', 0), [[100, 100], [100, 400], [300, 400], [300, 100]]);
  const on = hingeQuad(r, Math.PI / 2, 'left', 0);
  assert.ok(Math.abs(on[2][0] - 100) < 1e-9, 'edge-on collapses onto the spine, not the centre');
  const open = hingeQuad(r, Math.PI, 'left', 0);
  assert.ok(Math.abs(open[2][0] + 100) < 1e-9, 'fully open: far edge one width left of the spine');
  const tilted = hingeQuad(r, Math.PI / 3, 'left');
  assert.ok(tilted[2][1] - tilted[3][1] > 300, 'perspective: the lifted edge comes toward the viewer');
});
