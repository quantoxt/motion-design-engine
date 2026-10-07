// node render.mjs --fps 60 --dur 15 --sub 4 --w 1080 --h 1920 [--from 0 --out out/silent.mp4 --dir brands/quantoxt]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const sarg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = resolve(sarg('dir', '.'));
const film = existsSync(join(DIR, 'film.json')) ? JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')) : {};
const FPS = arg('fps', film.fps ?? 60), DUR = arg('dur', film.dur ?? 15), SUB = arg('sub', film.sub ?? 4), FROM = arg('from', 0);
const W = arg('w', film.w ?? 1080), H = arg('h', film.h ?? 1920), OUT = sarg('out', join(DIR, 'out/silent.mp4'));
mkdirSync(join(DIR, 'out'), { recursive: true });

const srv = await serve(DIR, [dirname(fileURLToPath(import.meta.url))]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(srv.url + `?w=${W}&h=${H}`);
// Films may finish setup after the load event (e.g. `await fetch('film.json')` in a module),
// so wait until the contract exists before touching it.
await page.waitForFunction(() => window.ready && typeof window.seek === 'function');
await page.evaluate(() => window.ready);
await page.evaluate(() => document.fonts.ready);

const vf = `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`;
const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
  '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', OUT],
  { stdio: ['pipe', 'inherit', 'inherit'] });

// Subframes sit at the end of each frame's shutter window, so frame n covers ((n-1)/FPS, n/FPS].
const total = Math.round(DUR * FPS * SUB);
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.seek(t), FROM + (i - (SUB - 1)) / (FPS * SUB));
  const png = await page.locator('#c').screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % (FPS * SUB) === 0) console.log(`rendered ${FROM + i / (FPS * SUB)}s / ${FROM + DUR}s`);
}
ff.stdin.end();
const code = await new Promise((r) => ff.on('close', r));
await browser.close();
srv.close();
if (code !== 0) { console.error(`ffmpeg exited ${code}: ${OUT} was not written`); process.exit(1); }
