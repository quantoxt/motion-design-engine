// Stills for the critique loop, straight from seek(t) (no encode).
// node shots.mjs beats            → out/beats.png  (one frame per beat, 0.5s grid)
// node shots.mjs strip 6.0 8.0 12 → out/strip.png  (12 frames across a window)
// node shots.mjs at 1.0 4.2 …     → out/at_<t>.png (full-size frames)
// node shots.mjs contact          → out/contact.png (one still per bar, mid-bar, exact times: the delivery contact sheet)
// node shots.mjs events           → out/events.png (a still at every time in window.EVENTS)
//                                  + out/transforms.png (one row per window.TRANSFORMS window and per scene
//                                    handoff from window.SCENES, 0.15s steps, half size; 12 rows per sheet →
//                                    transforms_2.png, …)
// Add --dir brands/<name> to target a brand folder (all outputs go there).
// Add --format <name> (from film.json "formats") or --format all to shoot other formats; outputs get a
// _<format> suffix (beats_wide.png, at_1.00_wide.png). Without it: film.json's w/h, no suffix.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
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
// Scene handoffs from window.SCENES ([{ from, to }…], the film's own scene table), so a moved handoff can't go stale:
// overlapping scenes → [next.from, prev.to], capped at HANDOFF_MAX after next.from; touching scenes → ±0.3s around the
// cut. Skipped when a declared transform window already covers it. Scenes marked { layer: true } (cursor windows, flood
// overlays, a motif that lives through a whole section) are not scenes handing off: they're skipped (E-OPEN-1).
const HANDOFF_MAX = 1.2;
function handoffs(scenes, transforms, dur) {
  const s = (scenes ?? []).filter((x) => Number.isFinite(x?.from) && Number.isFinite(x?.to) && !x.layer).sort((a, b) => a.from - b.from);
  const out = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1];
    const w = b.from < a.to ? [b.from, Math.min(a.to, dur, b.from + HANDOFF_MAX)] : [Math.max(0, a.to - 0.3), Math.min(dur, b.from + 0.3)];
    if (w[1] - w[0] < 0.05 || (transforms ?? []).some(([x, y]) => x <= w[0] + 0.05 && y >= w[1] - 0.05)) continue;
    out.push(w);
  }
  return out;
}

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
  let page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(srv.url + `?w=${W}&h=${H}`);
  // Films may finish setup after the load event (e.g. `await fetch('film.json')` in a module),
  // so wait until the contract exists before touching it.
  await page.waitForFunction(() => window.ready && typeof window.seek === 'function');
  await page.evaluate(() => window.ready);

  // One frame per item; label = text burnt into the corner (events/transforms) or the frame number.
  let n = 0;
  // The label is burnt in on an overlay canvas, not on the film's: a film that ends its frame with a clip, a low
  // globalAlpha or a composite mode left set would hide a label drawn on its own context (portfolio did).
  const frame = async (t, label, path) => {
    const box = await page.evaluate(([t, label]) => {
      window.seek(t);
      const c = document.querySelector('#c');
      let o = document.getElementById('shots-label');
      if (!o) {
        o = Object.assign(document.createElement('canvas'), { id: 'shots-label' });
        o.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647';
        document.body.append(o);
      }
      const r = c.getBoundingClientRect();
      o.width = c.width; o.height = c.height; o.style.left = `${r.left}px`; o.style.top = `${r.top}px`;
      if (label) {
        const g = o.getContext('2d');
        g.font = `bold ${Math.round(o.width / 20)}px sans-serif`;
        const pad = o.width / 60, h = o.width / 14;
        g.fillStyle = '#000a'; g.fillRect(0, 0, g.measureText(label).width + pad * 2, h);
        g.fillStyle = '#ff3b30'; g.textBaseline = 'middle'; g.fillText(label, pad, h / 2);
      }
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, [t, label]);
    const file = path ?? `${TMP}/${String(n++).padStart(3, '0')}.png`;
    if (label) await page.screenshot({ path: file, clip: box });   // canvas + label overlay
    else await page.locator('#c').screenshot({ path: file });
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
  } else if (mode === 'contact') {
    // One still per bar at its middle, sampled at exact times (an ffmpeg fps filter over the encode drifts: portfolio got
    // 23 frames for 24 bars and a black tile). Bar = 4 beats of film.json bpm (default 120).
    const bar = 240 / (film.bpm ?? 120), n = Math.max(1, Math.floor(DUR / bar + 1e-6));
    const times = Array.from({ length: n }, (_, i) => Math.min(DUR - 1e-3, i * bar + bar / 2));
    for (const t of times) await frame(t);
    const cols = Math.min(8, Math.ceil(Math.sqrt(n * 1.6)));
    tile(cols, Math.ceil(n / cols), W > H ? 384 : 216, OUT(`contact${sfx}.png`), false);   // delivery sheet: no debug numbers
    console.log(OUT(`contact${sfx}.png`), `(${n} bars × 1 still, ${bar.toFixed(3)}s each)`);
  } else if (mode === 'at') {
    for (const t of rest.map(Number)) await frame(t, null, OUT(`at_${t.toFixed(2)}${sfx}.png`));
  } else if (mode === 'events') {
    const { events, transforms, scenes } = await page.evaluate(() => ({ events: window.EVENTS, transforms: window.TRANSFORMS,
      scenes: (window.SCENES ?? []).map((x) => ({ from: x.from, to: x.to, layer: !!x.layer })) }));
    const auto = handoffs(scenes, transforms, DUR);
    if (!scenes.length) console.log('No window.SCENES: scene handoffs are not shot automatically (export the scene table, see _template/index.html).');
    const { stills, rows } = eventShots(events, [...(transforms ?? []), ...auto]);
    if (!stills.length && !rows.length) {
      console.log('No window.EVENTS / window.TRANSFORMS in the film: declare its clicks, swaps and transforms (see _template/index.html).');
    }
    if (stills.length) {
      for (const s of stills) await frame(s.t, s.label);
      tile(8, Math.ceil(stills.length / 8), 270, OUT(`events${sfx}.png`), false);
      console.log(OUT(`events${sfx}.png`), `(${stills.length / 2} events × 2 stills)`);
    }
    if (rows.length) {
      // One row per transform, padded to the longest so the grid lines up (padding copies the row's last still, no re-shoot).
      // Shot at half size (a motion check, not a hero still: 4× fewer pixels), 12 rows per sheet so no sheet is huge
      // (portfolio: 42 rows at full size was one 182 Mpx image and >10 min, E-OPEN-1).
      const full = page;
      page = await browser.newPage({ viewport: { width: Math.round(W / 2), height: Math.round(H / 2) }, deviceScaleFactor: 1 });
      await page.goto(srv.url + `?w=${Math.round(W / 2)}&h=${Math.round(H / 2)}`);
      await page.waitForFunction(() => window.ready && typeof window.seek === 'function');
      await page.evaluate(() => window.ready);
      const cols = Math.max(...rows.map((r) => r.length)), PER = 12, sheets = [];
      for (let k = 0; k < rows.length; k += PER) {
        fresh();
        for (const r of rows.slice(k, k + PER)) for (let i = 0; i < cols; i++) {
          if (i < r.length) await frame(r[i].t, r[i].label);
          else { copyFileSync(`${TMP}/${String(n - 1).padStart(3, '0')}.png`, `${TMP}/${String(n).padStart(3, '0')}.png`); n++; }
        }
        const out = OUT(`transforms${sfx}${k ? `_${k / PER + 1}` : ''}.png`);
        tile(cols, Math.min(PER, rows.length - k), 216, out, false);
        sheets.push(out);
      }
      await page.close();
      page = full;
      for (const f of readdirSync(OUT()).filter((f) => new RegExp(`^transforms${sfx}_\\d+\\.png$`).test(f) && !sheets.includes(OUT(f)))) rmSync(OUT(f));   // stale extra sheets
      console.log(sheets.join(' '), rows.map((r) => `${r[0].label}→${r.at(-1).label}`).join(' · '));
    }
  } else fail(`unknown mode "${mode}" (beats | strip | at | events | contact)`);
  await page.close();
}
rmSync(TMP, { recursive: true, force: true });
