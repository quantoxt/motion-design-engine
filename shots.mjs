// Stills for the critique loop, straight from seek(t) (no encode).
// node shots.mjs beats            → out/beats.png  (one frame per beat, 0.5s grid)
// node shots.mjs strip 6.0 8.0 12 → out/strip.png  (12 frames across a window)
// node shots.mjs at 1.0 4.2 …     → out/at_<t>.png (full-size frames)
// node shots.mjs events           → out/events.png (a still at every time in window.EVENTS)
//                                  + out/transforms.png (one row per window.TRANSFORMS window, 0.15s steps)
// Add --dir brands/<name> to target a brand folder (all outputs go there).
// Add --format <name> (from film.json "formats") or --format all to shoot other formats; outputs get a
// _<format> suffix (beats_wide.png, at_1.00_wide.png). Without it: film.json's w/h, no suffix.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const DIR = resolve(opt('dir') ?? process.cwd());
const [mode = 'beats', ...rest] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const film = existsSync(join(DIR, 'film.json')) ? JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8')) : {};
const DUR = film.dur ?? 20, TMP = join(DIR, 'out/_shots');
const OUT = (...f) => join(DIR, 'out', ...f);
const fail = (msg) => { console.error(msg); process.exit(2); };

// Which sizes to shoot: film.json's own, one named format, or all of them.
const all = film.formats ?? [];
const fmtArg = opt('format');
let sizes = [{ name: '', w: film.w ?? 1080, h: film.h ?? 1920 }];
if (fmtArg === 'all') sizes = all.length ? all : fail('film.json has no "formats" to shoot');
else if (fmtArg) {
  const f = all.find((x) => x.name === fmtArg);
  if (!f) fail(`unknown format "${fmtArg}" (film.json has ${all.map((x) => x.name).join(', ') || 'none'})`);
  sizes = [f];
}

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

// events: what the film declares as risky. window.EVENTS = { clicks: [{ t, target }…], swaps: [t…] } (any keys;
// entries are times or { t, target }),
// window.TRANSFORMS = [[from, to], …]. Each event gets a still at t and t+0.1 (the moment and just after).
const STEP = 0.15;
function eventShots(events, transforms) {
  const stills = Object.entries(events ?? {}).flatMap(([kind, ts]) =>
    (Array.isArray(ts) ? ts : []).flatMap((e) => {
      const t = typeof e === 'number' ? e : e.t, name = typeof e === 'object' && e.target ? ` ${e.target}` : '';
      return [{ t, label: `${kind}${name} ${t.toFixed(2)}` }, { t: t + 0.1, label: `+0.1` }];
    }));
  const rows = (transforms ?? []).map(([a, b]) => {
    const n = Math.max(2, Math.round((b - a) / STEP) + 1);
    return Array.from({ length: n }, (_, i) => { const t = a + (b - a) * i / (n - 1); return { t, label: t.toFixed(2) }; });
  });
  return { stills, rows };
}

const srv = await serve(DIR, [dirname(fileURLToPath(import.meta.url))]);
const browser = await chromium.launch();
try {
  for (const size of sizes) await shoot(size);
} finally {
  await browser.close();
  srv.close();
}

async function shoot({ name, w: W, h: H }) {
  const sfx = name ? `_${name}` : '';
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(srv.url + `?w=${W}&h=${H}`);
  // Films may finish setup after the load event (e.g. `await fetch('film.json')` in a module),
  // so wait until the contract exists before touching it.
  await page.waitForFunction(() => window.ready && typeof window.seek === 'function');
  await page.evaluate(() => window.ready);

  // One frame per item; label = text burnt into the corner (events/transforms) or the frame number.
  let n = 0;
  const frame = async (t, label, path) => {
    await page.evaluate(([t, label]) => {
      window.seek(t);
      if (!label) return;
      const g = document.querySelector('#c').getContext('2d');
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.font = `bold ${Math.round(g.canvas.width / 20)}px sans-serif`;
      const pad = g.canvas.width / 60, h = g.canvas.width / 14;
      g.fillStyle = '#000a'; g.fillRect(0, 0, g.measureText(label).width + pad * 2, h);
      g.fillStyle = '#ff3b30'; g.textBaseline = 'middle'; g.fillText(label, pad, h / 2);
      g.restore();
    }, [t, label]);
    await page.locator('#c').screenshot({ path: path ?? `${TMP}/${String(n++).padStart(3, '0')}.png` });
  };
  const tile = (cols, rows, w, out, numbered = true) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1',
    '-i', `${TMP}/%03d.png`, '-vf', `scale=${w}:-1,${numbered ? "drawtext=text='%{n}':x=8:y=8:fontsize=18:fontcolor=red," : ''}tile=${cols}x${rows}:padding=4`,
    '-frames:v', '1', out]);
  const fresh = () => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); n = 0; };

  if (mode === 'beats') {
    for (const t of grid) await frame(t);
    tile(10, Math.ceil(grid.length / 10), 216, OUT(`beats${sfx}.png`));
    console.log(OUT(`beats${sfx}.png`), `(${grid.length} frames from ${film.beats || '0.5s grid'})`);
  } else if (mode === 'strip') {
    const [a, b, k = 12] = rest.map(Number);
    const times = k > 1 ? Array.from({ length: k }, (_, i) => a + (b - a) * i / (k - 1)) : [a];
    for (const t of times) await frame(t);
    tile(times.length, 1, 240, OUT(`strip${sfx}.png`));
    console.log(OUT(`strip${sfx}.png`), times.map((t) => t.toFixed(2)).join(' '));
  } else if (mode === 'at') {
    for (const t of rest.map(Number)) await frame(t, null, OUT(`at_${t.toFixed(2)}${sfx}.png`));
  } else if (mode === 'events') {
    const { events, transforms } = await page.evaluate(() => ({ events: window.EVENTS, transforms: window.TRANSFORMS }));
    const { stills, rows } = eventShots(events, transforms);
    if (!stills.length && !rows.length) {
      console.log('No window.EVENTS / window.TRANSFORMS in the film: declare its clicks, swaps and transforms (see _template/index.html).');
    }
    if (stills.length) {
      for (const s of stills) await frame(s.t, s.label);
      tile(8, Math.ceil(stills.length / 8), 270, OUT(`events${sfx}.png`), false);
      console.log(OUT(`events${sfx}.png`), `(${stills.length / 2} events × 2 stills)`);
    }
    if (rows.length) {
      // One row per transform, padded to the longest so the grid lines up.
      fresh();
      const cols = Math.max(...rows.map((r) => r.length));
      for (const r of rows) for (let i = 0; i < cols; i++) await frame(r[Math.min(i, r.length - 1)].t, i < r.length ? r[i].label : '');
      tile(cols, rows.length, 216, OUT(`transforms${sfx}.png`), false);
      console.log(OUT(`transforms${sfx}.png`), rows.map((r) => `${r[0].label}→${r.at(-1).label}`).join(' · '));
    }
  } else fail(`unknown mode "${mode}" (beats | strip | at | events)`);
  await page.close();
}
rmSync(TMP, { recursive: true, force: true });
