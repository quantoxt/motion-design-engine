// Stills for the critique loop, straight from seek(t) (no encode).
// node shots.mjs beats            → out/beats.png  (one frame per beat, 0.5s grid)
// node shots.mjs strip 6.0 8.0 12 → out/strip.png  (12 frames across a window)
// node shots.mjs at 1.0 4.2 …     → out/at_<t>.png (full-size frames)
// Add --dir brands/<name> to target a brand folder (all outputs go there).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';

const args = process.argv.slice(2);
const di = args.indexOf('--dir');
const DIR = di >= 0 ? resolve(args[di + 1]) : process.cwd();
const [mode = 'beats', ...rest] = args.filter((a, i) => !(i === di || i === di + 1 || a.startsWith('--dir')));
const film = existsSync(join(DIR, 'film.json')) ? JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')) : {};
const W = film.w ?? 1080, H = film.h ?? 1920, DUR = film.dur ?? 20, TMP = join(DIR, 'out/_shots');
const OUT = (...f) => join(DIR, 'out', ...f);

// Beat grid from the film's beats file when present (settled state = just before next beat)
const grid = (() => {
  try {
    const bj = JSON.parse(readFileSync(join(DIR, film.beats || 'beats.json'), 'utf8'));
    const beats = (bj.beats || []).filter((t) => t < DUR);
    if (beats.length > 1) {
      const step = beats[1] - beats[0];
      return beats.map((t) => t + step - 0.01);
    }
  } catch { /* fall back to 0.5s grid */ }
  return Array.from({ length: DUR * 2 }, (_, i) => i * 0.5 + 0.49);
})();
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let times;
if (mode === 'beats') times = grid;
else if (mode === 'strip') {
  const [a, b, n = 12] = rest.map(Number);
  times = n > 1 ? Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1)) : [a];
} else times = rest.map(Number);

const srv = await serve(DIR, [dirname(fileURLToPath(import.meta.url))]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(srv.url + `?w=${W}&h=${H}`);
// Films may finish setup after the load event (e.g. `await fetch('film.json')` in a module),
// so wait until the contract exists before touching it.
await page.waitForFunction(() => window.ready && typeof window.seek === 'function');
await page.evaluate(() => window.ready);
for (const [i, t] of times.entries()) {
  await page.evaluate((t) => window.seek(t), t);
  const path = mode === 'at' ? OUT(`at_${t.toFixed(2)}.png`) : `${TMP}/${String(i).padStart(3, '0')}.png`;
  await page.locator('#c').screenshot({ path });
}
await browser.close();
srv.close();

const tile = (cols, rows, w, out) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1',
  '-i', `${TMP}/%03d.png`, '-vf', `scale=${w}:-1,drawtext=text='%{n}':x=8:y=8:fontsize=18:fontcolor=red,tile=${cols}x${rows}:padding=4`,
  '-frames:v', '1', out]);
if (mode === 'beats') {
  const rows = Math.ceil(times.length / 10);
  tile(10, rows, 216, OUT('beats.png'));
  console.log(OUT('beats.png'), `(${times.length} frames from ${film.beats || '0.5s grid'})`);
} else if (mode === 'strip') {
  tile(times.length, 1, 240, OUT('strip.png'));
  console.log(OUT('strip.png'), times.map((t) => t.toFixed(2)).join(' '));
}
