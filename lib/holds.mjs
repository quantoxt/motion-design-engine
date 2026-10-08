// Pops and dead holds from per-frame difference (ffmpeg scdet `mafd`). Pure: numbers in, findings out.
// Used by holds.mjs; see docs/factory-map.md.
//
// Pop: one frame changes far more than its neighbours (hidden cut, entry at full size, hard swap).
//   mafd ≥ min AND ≥ ratio × median of the ±3 neighbours AND (with grain) ≥ ratio × median of the
//   frames one and two ticks away, so a grain tick is only compared with other ticks.
//   Adjacent flagged frames merge into one pop. Keyframes re-quantize the whole picture and read as
//   pops, which is why the input is a --scan render (one keyframe).
// Hold: nothing but grain/boil moves for longer than `hold` seconds, measured on `motion`: per frame,
//   the largest change in any small region (holds.mjs: 34px-wide grid, 0–255). A whole-frame average
//   would miss a cursor crossing the screen; the region max sees it, and grain averages out inside a
//   region. Grain re-seeds at `tick` fps, so each tick shows as a spike: per frame, take a window one
//   tick long and drop its 2 largest values. Runs where what's left stays under `eps` are holds.
//   Without `motion`, mafd is used (eps then ~0.08).
//   Needs ≥ 4 frames per tick (60fps for 12fps grain); tick 0 = no grain, every frame counts.

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

export function analyze(mafd, { fps, from = 0, tick = 12, hold = 1, motion: still = null, eps = still ? 8 : 0.08, ratio = 2.5, min = 0.5, allowed = [] }) {
  const t = (i) => +(from + i / fps).toFixed(3);
  const per = tick ? fps / tick : 1;
  if (tick && per < 4) throw new Error(`${fps}fps is too coarse for ${tick}fps grain (need ≥ ${tick * 4}fps). Use a --scan render.`);
  const near = (i, ks) => ks.map((k) => mafd[i + k]).filter((x) => x != null);
  const pops = [];
  for (let i = 1; i < mafd.length; i++) {
    let base = median(near(i, [-3, -2, -1, 1, 2, 3]));
    if (tick) { const p = Math.round(per); base = Math.max(base, median(near(i, [-2 * p, -p, p, 2 * p]))); }
    if (mafd[i] < min || mafd[i] < ratio * Math.max(base, 0.05)) continue;
    const last = pops.at(-1);
    if (last && last.end === i - 1) { last.end = i; if (mafd[i] > last.peak) { last.peak = mafd[i]; last.at = i; } }
    else pops.push({ start: i, end: i, at: i, peak: mafd[i] });
  }

  const win = Math.round(per), drop = tick ? 2 : 0;
  const series = still ?? mafd;
  const motion = series.map((_, i) => {
    const w = series.slice(Math.max(1, i - (win >> 1)), i - (win >> 1) + win).sort((a, b) => b - a);
    return w[drop] ?? 0;
  });
  const runs = [];
  let s = null;
  for (let i = 1; i <= motion.length; i++) {
    if (i < motion.length && motion[i] < eps) { s ??= i; continue; }
    if (s != null) runs.push([t(s), t(i)]);
    s = null;
  }
  // Allowed holds (film.json "holds": [[from, to], …]) are cut out of each run.
  const holds = [];
  for (let [a, b] of runs) {
    for (const [x, y] of [...allowed].sort((p, q) => p[0] - q[0])) {
      if (y <= a || x >= b) continue;
      if (x - a >= hold) holds.push([a, x]);
      a = Math.max(a, y);
    }
    if (b - a >= hold) holds.push([a, b]);
  }

  return {
    pops: pops.map((p) => ({ t: t(p.at), frames: p.end - p.start + 1, peak: +p.peak.toFixed(2) })),
    holds: holds.map(([a, b]) => ({ from: a, to: b, dur: +(b - a).toFixed(2) })),
  };
}

// Region motion: frames as raw 8-bit gray (w × h each) → per frame, the largest pixel change since the
// previous frame. Each pixel of the small frame is one region of the film.
export function regionMax(buf, w, h) {
  const n = w * h, frames = Math.floor(buf.length / n), out = [0];
  for (let f = 1; f < frames; f++) {
    let mx = 0;
    for (let i = 0, a = f * n, b = a - n; i < n; i++) { const d = Math.abs(buf[a + i] - buf[b + i]); if (d > mx) mx = d; }
    out.push(mx);
  }
  return out;
}

// Parse ffmpeg `metadata=print` output from scdet: one mafd per frame, in order.
export const parseMafd = (text) => [...text.matchAll(/lavfi\.scd\.mafd=([\d.]+)/g)].map((m) => Number(m[1]));

// Pace: how much of the screen moves. A frame's activity is the share of grid cells (the same gray grid as
// regionMax) that change by more than `eps`; a rolling 1s median removes grain ticks and single-frame blips.
// A "quiet stretch" is a run where at most `area` of the screen moves for longer than `quiet` seconds:
// a hold in all but name (a highlight moving in one corner keeps regionMax busy but reads as nothing happening).
// Calibrated on the lab's references: the crispest (v1, v4, v5) never go over 2.7s; our first films ran 7–19s.
// → { moving: share of frames with visible change, quiet: [{ from, to, dur }] } (times in film seconds)
export function pace(buf, w, h, fps, { from = 0, eps = 8, area = 0.01, quiet = 3, allowed = [] } = {}) {
  const N = w * h, F = Math.floor(buf.length / N), frac = new Float64Array(F);
  for (let f = 1; f < F; f++) {
    let c = 0;
    for (let i = 0, o = f * N, p = (f - 1) * N; i < N; i++) if (Math.abs(buf[o + i] - buf[p + i]) > eps) c++;
    frac[f] = c / N;
  }
  const H = Math.max(1, Math.round(fps / 2));
  const med = Array.from(frac, (_, i) => { const v = Array.from(frac.subarray(Math.max(0, i - H), Math.min(F, i + H + 1))).sort((a, b) => a - b); return v[v.length >> 1]; });
  const ok = (t) => allowed.some(([a, b]) => t >= a && t <= b);
  const runs = [];
  let s = -1;
  for (let i = 0; i <= F; i++) {
    const still = i < F && med[i] <= area && !ok(from + i / fps);
    if (still && s < 0) s = i;
    if (!still && s >= 0) { if ((i - s) / fps > quiet) runs.push({ from: +(from + s / fps).toFixed(2), to: +(from + i / fps).toFixed(2), dur: +((i - s) / fps).toFixed(2) }); s = -1; }
  }
  return { moving: +(med.filter((x) => x > area).length / Math.max(1, F)).toFixed(2), quiet: runs };
}
