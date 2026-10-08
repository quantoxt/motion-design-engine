import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPanel, boxContrast, luminance, ratio } from './checks.mjs';

const frame = { w: 1080, h: 1350 };
const text = (name, x, y, w, h, extra = {}) => ({ name, x, y, w, h, cx: x + w / 2, cy: y + h / 2, parent: null, bleed: false, solid: true, size: 60, contrast: true, measured: 10, ...extra });
const kinds = (fs) => fs.map((f) => f.kind).sort();

test('clean panel passes', () => {
  assert.deepEqual(checkPanel({ anchors: [text('a', 100, 100, 400, 80), text('b', 100, 300, 400, 80)], flat: 0.6 }, { frame }), []);
});

test('collision, frame cut, phone size, contrast, empty', () => {
  const fs = checkPanel({ flat: 0.995, anchors: [
    text('a', 100, 100, 400, 80), text('b', 150, 120, 400, 80),
    text('cut', 900, 500, 400, 80),
    text('tiny', 100, 800, 200, 20, { size: 24 }),
    text('dim', 100, 1000, 400, 80, { measured: 1.4 }),
  ] }, { frame });
  assert.deepEqual(kinds(fs), ['collision', 'contrast', 'empty', 'off-frame', 'phone-size']);
});

test('bleed and contrast:false opt out', () => {
  const fs = checkPanel({ flat: 0.5, anchors: [text('wall', 900, 500, 400, 80, { bleed: true }), text('mark', 100, 100, 300, 60, { contrast: false, measured: 1.1 })] }, { frame });
  assert.deepEqual(fs, []);
});

test('phone size scales with the frame: 36 units is fine at 1080, too small at 2160 short side', () => {
  assert.equal(checkPanel({ flat: 0.5, anchors: [text('t', 10, 10, 100, 30, { size: 36 })] }, { frame }).length, 0);
  assert.equal(checkPanel({ flat: 0.5, anchors: [text('t', 10, 10, 100, 30, { size: 36 })] }, { frame: { w: 2160, h: 2700 } }).length, 1);
});

test('box contrast reads glyph vs ground, ignores a few specks', () => {
  const black = luminance(0, 0, 0), white = luminance(255, 255, 255);
  assert.equal(ratio(black, white), 21);
  const lums = [...Array(70).fill(black), ...Array(30).fill(white)];
  assert.equal(boxContrast(lums), 21);
  const specks = [...Array(98).fill(black), white, white];
  assert.ok(boxContrast(specks) < 1.01);
});
