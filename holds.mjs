// Pop + dead-hold scan of a render. Catches what stills can't: one-frame pops (hidden cuts,
// full-size entries, hard label swaps) and holds >1s where only grain/boil moves.
// node holds.mjs --dir brands/<name>                 → scans out/scan.mp4 (render-parallel.mjs --scan)
//   [--file out/x.mp4] [--from S]  file to scan; --from = film time of its first frame (read from a window scan's
//   name, scan_<from>-<to>.mp4). To check a fix fast: --scan --from 12 --dur 2, then --file out/scan_12.00-14.00.mp4
//   [--tick 12] grain/boil rate (0 = none) [--hold 1] [--eps 8 (region change, 0–255)] [--ratio 2.5] [--min 0.5]
// Allowed holds come from film.json "holds": [[58.2, 60]], intended hard cuts from "pops": [12.6] (±0.05s). Exit 0 = clean, 1 = findings, 2 = error.
// Scanning the default out/scan.mp4 writes out/holds.json (the studio's "Machine checks" gate).
// Pops found → out/pops.png: ±3 frames around each pop, so you see the cause without hand-made tiles.
// Pops: whole-frame difference at 135px wide (area-averaging kills grain, objects still register).
// Holds: the largest change in any region of a 34px-wide grid, so a small moving cursor still counts.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, statSync, mkdirSync, readdirSync, renameSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyze, parseMafd, regionMax } from './lib/holds.mjs';
import { writeResult } from './lib/gate.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const sarg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = resolve(sarg('dir', '.'));
const film = existsSync(join(DIR, 'film.json')) ? JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')) : {};
const FILE = resolve(DIR, sarg('file', 'out/scan.mp4'));
// A window scan (render-parallel.mjs --scan --from 12 --dur 2 → out/scan_12.00-14.00.mp4) carries its start in its name.
const named = FILE.match(/_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\.mp4$/);
const FROM = arg('from', named ? Number(named[1]) : 0);
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
  r = analyze(mafd, { fps, from: FROM, tick: arg('tick', 12), hold: arg('hold', 1), motion, eps: arg('eps', 8),
    ratio: arg('ratio', 2.5), min: arg('min', 0.5), allowed: film.holds ?? [] });
} catch (e) { fail(e.message); }
const cuts = film.pops ?? [];
r.pops = r.pops.filter((p) => !cuts.some((c) => Math.abs(c - p.t) <= 0.05));

console.log(`${FILE}: ${mafd.length} frames at ${fps}fps`);
console.log(r.pops.length ? `\nPops (${r.pops.length}): look at the frame, then fix with a spring/mask entry or a shared-spring swap` : '\nPops: none');
for (const p of r.pops) console.log(`  ${p.t.toFixed(3)}s  peak ${p.peak}${p.frames > 1 ? `  (${p.frames} frames)` : ''}`);
console.log(r.holds.length ? `\nHolds over ${arg('hold', 1)}s (${r.holds.length}): add new content, or list them in film.json "holds" if intended` : '\nHolds: none');
for (const h of r.holds) console.log(`  ${h.from.toFixed(2)}–${h.to.toFixed(2)}s  (${h.dur}s)`);
// Each pop as a picture: ±3 frames around it, one row per pop, labelled with film time (centre = the pop).
const SHEET = join(DIR, 'out', 'pops.png');
rmSync(SHEET, { force: true });
if (r.pops.length) {
  const dir = join(DIR, 'out', '_pops'), from = FROM, K = 3;
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  r.pops.forEach((p, i) => {
    const start = Math.max(0, p.t - from - K / fps);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', start.toFixed(4), '-i', FILE, '-frames:v', String(2 * K + 1), '-vf',
      `scale=270:-2,drawtext=text='%{eif\\:(t+${(start + from).toFixed(4)})*1000\\:d} ms':x=6:y=6:fontsize=16:fontcolor=red:box=1:boxcolor=black@0.6`,
      join(dir, `${String(i).padStart(3, '0')}_%02d.png`)]);
    // A pop near either end yields fewer frames: pad the row so the grid stays aligned.
    const got = readdirSync(dir).filter((f) => f.startsWith(`${String(i).padStart(3, '0')}_`)).sort();
    for (let k = got.length + 1; k <= 2 * K + 1; k++) copyFileSync(join(dir, got.at(-1)), join(dir, `${String(i).padStart(3, '0')}_${String(k).padStart(2, '0')}.png`));
  });
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  files.forEach((f, i) => renameSync(join(dir, f), join(dir, `f${String(i).padStart(4, '0')}.png`)));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', join(dir, 'f%04d.png'), '-vf',
    `tile=${2 * K + 1}x${r.pops.length}:padding=4`, '-frames:v', '1', SHEET]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`
Pop frames: ${SHEET} (one row per pop, ±${K} frames, centre = the pop)`);
}
const ok = !r.pops.length && !r.holds.length;
const params = Object.fromEntries(['tick', 'hold', 'eps', 'ratio', 'min'].map((k) => [k, arg(k, undefined)]).filter(([, v]) => v != null));
// Only a scan of the whole film counts for the gate: out/scan.mp4, starting at 0, as long as film.json says.
const GATE = FILE === join(DIR, 'out', 'scan.mp4') && FROM === 0 && (!film.dur || Math.abs(mafd.length / fps - film.dur) < 2 / fps);
if (!GATE) console.log(`\n(Not the full-film scan, so out/holds.json is unchanged: the render gate needs node render-parallel.mjs --dir ${sarg('dir', '.')} --scan.)`);
if (GATE) writeResult(DIR, 'holds', { ok, fps, frames: mafd.length, params, ...r });   // changed thresholds stay visible
process.exit(ok ? 0 : 1);
