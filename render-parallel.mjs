// Parallel twin of render.mjs: same flags, same output, ~4-5x faster.
// node render-parallel.mjs --fps 60 --dur 20 --sub 4 --w 1080 --h 1920 [--from 0 --out out/silent.mp4 --workers 4]
//
// Why it's safe: seek(t) is a pure function of t, so any browser can paint any frame.
//  - Frame f is painted by worker f % N (one headless Chromium each).
//  - Subframe times use the exact same expression as render.mjs → bit-identical t.
//  - Frames are written to ONE ffmpeg in order, so tmix + x264 see the same stream.
//  - Capture is CDP PNG with optimizeForSpeed: lighter zlib, identical pixels.
// See docs/parallel-render.md.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { serve } from './lib/serve.mjs';
import { blockers, formatBlockers } from './lib/gate.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const sarg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const DIR = resolve(sarg('dir', '.'));
const HERE = dirname(fileURLToPath(import.meta.url));
const film = existsSync(join(DIR, 'film.json')) ? JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')) : {};

// --all-formats: re-invoke once per film.json format (flags are inherited).
// --formats a,b limits it to those names (primary first, the rest after review).
if (flag('all-formats')) {
  const all = film.formats ?? [{ name: 'main', w: film.w ?? 1080, h: film.h ?? 1920 }];
  const pick = sarg('formats', '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = pick.filter((n) => !all.some((f) => f.name === n));
  if (unknown.length) { console.error(`unknown format(s): ${unknown.join(', ')} (film.json has ${all.map((f) => f.name).join(', ')})`); process.exit(1); }
  const formats = pick.length ? all.filter((f) => pick.includes(f.name)) : all;
  // Drop --all-formats and any --w/--h/--out/--formats (+ value): each format sets its own.
  const argv = process.argv.slice(2), drop = new Set(['--w', '--h', '--out', '--formats']);
  const base = argv.filter((a, i) => a !== '--all-formats' && !drop.has(a) && !drop.has(argv[i - 1]));
  for (const f of formats) {
    console.log(`=== format ${f.name} (${f.w}x${f.h}) ===`);
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url),
      ...base, '--w', String(f.w), '--h', String(f.h),
      '--out', join(DIR, 'out', `${flag('animatic') ? 'animatic' : flag('scan') ? 'scan' : 'silent'}_${f.name}.mp4`)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  process.exit(0);
}

// Gate: a full-length final render of a film needs its machine checks (check.mjs, holds.mjs) passed on
// the current code, and a format other than the primary (film.json formats[0]) also needs the human's
// OK on the primary render (studio → Primary render). So `--all-formats` on a fresh film renders the
// primary and stops there. Drafts (--animatic, --scan) and partial windows (--from/--dur) are always
// allowed. --skip-checks overrides it, loudly.
{
  const draft = flag('animatic') || flag('scan') || flag('from') || flag('dur');
  const fmt = (sarg('out', '').match(/silent_([a-z0-9-]+)\.mp4$/) ?? [])[1];
  const why = !draft && existsSync(join(DIR, 'film.json')) ? [...blockers(DIR), ...formatBlockers(DIR, fmt ?? null)] : [];
  if (why.length && !flag('skip-checks')) {
    console.error(`Full render blocked:\n  ${why.join('\n  ')}\n(--skip-checks overrides this; say why in docs/review_log.md.)`);
    process.exit(3);
  }
  if (why.length) {
    console.warn(`WARNING: rendering with --skip-checks. Not passed:\n  ${why.join('\n  ')}`);
    mkdirSync(join(DIR, 'out'), { recursive: true });   // the studio shows the override on the Machine checks gate
    writeFileSync(join(DIR, 'out', 'render-gate.json'), JSON.stringify({ skipped: true, at: new Date().toISOString(), why }, null, 2) + '\n');
  }
}

const ANIM = flag('animatic');   // cheap pacing draft: half size, 15fps, no blur, CRF 28
const SCAN = flag('scan');       // input for holds.mjs: half size, full fps, no blur, CRF 28
const SMALL = ANIM || SCAN;
const FPS = ANIM ? 15 : arg('fps', film.fps ?? 60);
const DUR = arg('dur', film.dur ?? 15), SUB = SMALL ? 1 : arg('sub', film.sub ?? 4), FROM = arg('from', 0);
const half = (v) => Math.round(v / 4) * 2;        // half size, kept even (yuv420p needs even dims)
const W = SMALL ? half(arg('w', film.w ?? 1080)) : arg('w', film.w ?? 1080);
const H = SMALL ? half(arg('h', film.h ?? 1920)) : arg('h', film.h ?? 1920);
const CRF = SMALL ? 28 : arg('crf', 16);
// A relative --out is inside --dir (like every default), unless it already names a path under it from the cwd.
const outArg = sarg('out', '');
// A partial draft (--from/--dur) gets its window in the name, so it never replaces the full-film scan.mp4 the gate trusts.
const WIN = SMALL && (flag('from') || flag('dur')) ? `_${FROM.toFixed(2)}-${(FROM + DUR).toFixed(2)}` : '';
const OUT = !outArg ? join(DIR, 'out', `${ANIM ? 'animatic' : SCAN ? 'scan' : 'silent'}${WIN}.mp4`)
  : resolve(outArg).startsWith(DIR + '/') ? resolve(outArg) : resolve(DIR, outArg);
const N = arg('workers', availableParallelism());
const AHEAD = 2;                                   // frames queued per worker (bounds memory)
mkdirSync(join(DIR, 'out'), { recursive: true });

const total = Math.round(DUR * FPS * SUB);        // subframes, same count as render.mjs
const frames = Math.ceil(total / SUB);
const tOf = (i) => FROM + (i - (SUB - 1)) / (FPS * SUB);   // identical to render.mjs

const srv = await serve(DIR, [dirname(fileURLToPath(import.meta.url))]);
const browsers = [];
let ff;
try {
  const workers = await Promise.all(Array.from({ length: N }, async () => {
    const browser = await chromium.launch();
    browsers.push(browser);
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.goto(srv.url + `?w=${W}&h=${H}`);
    await page.waitForFunction(() => window.ready && typeof window.seek === 'function');   // setup may finish after load
    await page.evaluate(() => window.ready);
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    return { page, cdp, queue: Promise.resolve() };
  }));

  const vf = `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`;
  ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
    '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-crf', String(CRF),
    // Scan: one keyframe only. A keyframe re-quantizes the whole picture, which holds.mjs reads as a pop.
    ...(SCAN ? ['-x264-params', 'keyint=infinite:scenecut=0'] : []),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
  ff.stdin.on('error', () => {});   // ffmpeg quit early: ffDone carries its exit code instead of an EPIPE stack
  ffDone.catch(() => {});

  async function paint(w, f) {
    const pngs = [];
    for (let i = f * SUB; i < Math.min((f + 1) * SUB, total); i++) {
      await w.page.evaluate((t) => window.seek(t), tOf(i));
      const { data } = await w.cdp.send('Page.captureScreenshot',
        { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
      pngs.push(Buffer.from(data, 'base64'));
    }
    return pngs;
  }

  // Each worker runs its jobs one at a time (seek + capture must not interleave on a page).
  const jobs = new Map();
  const enqueue = (f) => {
    if (f >= frames) return;
    const w = workers[f % N];
    const job = w.queue.then(() => paint(w, f));
    w.queue = job.catch(() => {});
    jobs.set(f, job);
  };
  for (let f = 0; f < AHEAD * N; f++) enqueue(f);

  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    const pngs = await jobs.get(f);
    jobs.delete(f);
    enqueue(f + AHEAD * N);
    for (const png of pngs) if (!ff.stdin.write(png)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), ffDone]);
    if ((f + 1) % FPS === 0 || f === frames - 1) {
      const s = (performance.now() - t0) / 1000;
      console.log(`rendered ${(FROM + (f + 1) / FPS).toFixed(1)}s / ${FROM + DUR}s  (${s.toFixed(0)}s elapsed, ${N} workers)`);
    }
  }
  ff.stdin.end();
  await ffDone;
} catch (err) {
  ff?.kill('SIGKILL');
  console.error(err);
  process.exitCode = 1;
} finally {
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
  srv.close();
}
