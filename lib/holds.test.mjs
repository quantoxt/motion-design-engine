// Pop/hold analysis on synthetic mafd series (60fps, grain ticking at 12fps = every 5th frame).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, parseMafd, pace } from './holds.mjs';

const fps = 60;
// grain: a 0.3 spike on every 5th frame; `moving` frames get 0.2 of real motion
const film = (secs, moving = () => false) => Array.from({ length: secs * fps }, (_, i) =>
  (i % 5 === 0 ? 0.3 : 0.01) + (moving(i / fps) ? 0.2 : 0));

test('grain ticks alone are neither pops nor motion', () => {
  const r = analyze(film(3, () => true), { fps });
  assert.deepEqual(r, { pops: [], holds: [] });
});

test('a one-frame jump is a pop; a tick-sized jump on a tick frame is not', () => {
  const m = film(3, () => true);
  m[90] = 2.0;            // hidden cut
  m[150] = 0.45;          // tick frame, a bit stronger than other ticks: grain, not a pop
  m[151] = m[152] = 1.5;  // two-frame pop merges into one
  const r = analyze(m, { fps });
  assert.deepEqual(r.pops.map((p) => [p.t, p.frames]), [[1.5, 1], [2.517, 2]]);
});

test('holds: only-grain runs over 1s, minus film.json allowed holds', () => {
  const m = film(6, (t) => t < 1 || (t >= 2.5 && t < 3));   // still 1–2.5 and 3–6
  const r = analyze(m, { fps, allowed: [[5, 6]] });
  assert.deepEqual(r.holds.map((h) => [Math.round(h.from * 10) / 10, Math.round(h.to * 10) / 10]), [[1, 2.5], [3, 5]]);
  assert.equal(analyze(m, { fps, allowed: [[3, 6]] }).holds.length, 1);
});

test('--from shifts times; coarse files are refused; no grain = every frame counts', () => {
  const m = film(2); m[30] = 3;
  assert.equal(analyze(m, { fps, from: 10 }).pops[0].t, 10.5);
  assert.throws(() => analyze(film(2), { fps: 15 }), /too coarse/);
  const still = Array(120).fill(0.01);
  assert.equal(analyze(still, { fps, tick: 0 }).holds[0].dur > 1.9, true);
});

test('parses ffmpeg metadata output', () => {
  assert.deepEqual(parseMafd('frame:0\nlavfi.scd.mafd=0.000\nlavfi.scd.score=0\nframe:1\nlavfi.scd.mafd=1.25\n'), [0, 1.25]);
});

test('region motion: a small object moving is not a hold, even when the frame average barely moves', async () => {
  const { regionMax } = await import('./holds.mjs');
  const w = 4, h = 2, frames = 140;
  const buf = Buffer.alloc(w * h * frames);
  for (let f = 0; f < frames; f++) if (f < 70) buf[f * w * h + (f % 8)] = 200;   // a dot hopping for 70 frames
  const motion = regionMax(buf, w, h);
  assert.equal(motion[1], 200);
  const mafd = Array(frames).fill(0.01);   // average says "nothing"
  const r = analyze(mafd, { fps, tick: 0, motion });
  assert.deepEqual(r.holds.map((x) => [Math.round(x.from * 60), Math.round(x.to * 60)]), [[71, 140]]);
});

test('pace: a stretch with almost nothing moving is quiet; a planned hold is not counted', () => {
  const w = 10, h = 10, fps = 10, N = w * h;
  // 8s: a 30-cell block moves every frame for 2s, then only 1 cell flickers for 5s, then the block moves again for 1s
  const F = 80, buf = new Uint8Array(F * N);
  for (let f = 0; f < F; f++) {
    const busy = f < 20 || f >= 70;
    if (busy) for (let i = 0; i < 30; i++) buf[f * N + ((i + f) % N)] = 200;
    else buf[f * N] = f % 2 ? 200 : 0;
  }
  const p = pace(buf, w, h, fps, { quiet: 3 });
  assert.equal(p.quiet.length, 1);
  assert.ok(Math.abs(p.quiet[0].from - 2) < 0.6 && Math.abs(p.quiet[0].to - 7) < 0.6, JSON.stringify(p.quiet));
  assert.ok(p.moving > 0.3 && p.moving < 0.5);
  assert.equal(pace(buf, w, h, fps, { quiet: 3, allowed: [[3, 6]] }).quiet.length, 0);   // what's left is under 3s
  assert.equal(pace(buf, w, h, fps, { quiet: 6 }).quiet.length, 0);
});
