// Pop + dead-hold scan of a render. Catches what stills can't: one-frame pops (hidden cuts,
// full-size entries, hard label swaps) and holds >1s where only grain/boil moves.
// node holds.mjs --dir brands/<name>                 → scans out/scan.mp4 (render-parallel.mjs --scan)
//   [--file out/x.mp4] [--from S]  file to scan; --from = film time of its first frame (for --from renders)
//   [--tick 12] grain/boil rate (0 = none) [--hold 1] [--eps 8 (region change, 0–255)] [--ratio 2.5] [--min 0.5]
// Allowed holds come from film.json "holds": [[58.2, 60]], intended hard cuts from "pops": [12.6] (±0.05s). Exit 0 = clean, 1 = findings, 2 = error.
// Scanning the default out/scan.mp4 writes out/holds.json (the studio's "Machine checks" gate).
// Pops: whole-frame difference at 135px wide (area-averaging kills grain, objects still register).
// Holds: the largest change in any region of a 34px-wide grid, so a small moving cursor still counts.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyze, parseMafd, regionMax } from './lib/holds.mjs';
import { writeResult } from './lib/gate.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const sarg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = resolve(sarg('dir', '.'));
const film = existsSync(join(DIR, 'film.json')) ? JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')) : {};
const GATE = sarg('file', null) == null;   // the default full-film scan is what the gate trusts
const FILE = resolve(DIR, sarg('file', 'out/scan.mp4'));
const fail = (msg) => { console.error(msg); process.exit(2); };
if (!existsSync(FILE)) fail(`${FILE} not found. Render it first: node render-parallel.mjs --dir ${sarg('dir', '.')} --scan`);
const newest = Math.max(...['index.html', 'film.json'].map((f) => (existsSync(join(DIR, f)) ? statSync(join(DIR, f)).mtimeMs : 0)));
if (statSync(FILE).mtimeMs < newest) fail(`${FILE} is older than the film's index.html/film.json: re-render it (--scan) first.`);

const [n, d] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
  '-of', 'csv=p=0', FILE], { encoding: 'utf8' }).trim().split('/').map(Number);
const fps = n / (d || 1);
const tmp = join(DIR, 'out', '_holds.txt');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', FILE, '-vf',
  `scale=135:-2:flags=area,scdet=threshold=100,metadata=print:file=${tmp.replace(/([\\:'])/g, '\\$1')}`, '-f', 'null', '-']);
const mafd = parseMafd(readFileSync(tmp, 'utf8'));
rmSync(tmp, { force: true });
const RW = 34, RH = (() => { const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height', '-of', 'csv=p=0', FILE], { encoding: 'utf8' }).trim().split(',').map(Number); return Math.max(2, Math.round(h * RW / w / 2) * 2); })();
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', FILE, '-vf', `scale=${RW}:${RH}:flags=area,format=gray`, '-f', 'rawvideo', '-'],
  { maxBuffer: 1 << 30 });
const motion = regionMax(raw, RW, RH);

let r;
try {
  r = analyze(mafd, { fps, from: arg('from', 0), tick: arg('tick', 12), hold: arg('hold', 1), motion, eps: arg('eps', 8),
    ratio: arg('ratio', 2.5), min: arg('min', 0.5), allowed: film.holds ?? [] });
} catch (e) { fail(e.message); }
const cuts = film.pops ?? [];
r.pops = r.pops.filter((p) => !cuts.some((c) => Math.abs(c - p.t) <= 0.05));

console.log(`${FILE}: ${mafd.length} frames at ${fps}fps`);
console.log(r.pops.length ? `\nPops (${r.pops.length}): look at the frame, then fix with a spring/mask entry or a shared-spring swap` : '\nPops: none');
for (const p of r.pops) console.log(`  ${p.t.toFixed(3)}s  peak ${p.peak}${p.frames > 1 ? `  (${p.frames} frames)` : ''}`);
console.log(r.holds.length ? `\nHolds over ${arg('hold', 1)}s (${r.holds.length}): add new content, or list them in film.json "holds" if intended` : '\nHolds: none');
for (const h of r.holds) console.log(`  ${h.from.toFixed(2)}–${h.to.toFixed(2)}s  (${h.dur}s)`);
const ok = !r.pops.length && !r.holds.length;
const params = Object.fromEntries(['tick', 'hold', 'eps', 'ratio', 'min'].map((k) => [k, arg(k, undefined)]).filter(([, v]) => v != null));
if (GATE) writeResult(DIR, 'holds', { ok, fps, frames: mafd.length, params, ...r });   // changed thresholds stay visible
process.exit(ok ? 0 : 1);
