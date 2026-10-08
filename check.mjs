// Geometry check: proves what stills can only suggest. Seeks the film at 30fps in every format (no encode)
// and reads its anchors (lib/layout.js): clicks land inside their targets with the cursor at rest,
// children stay inside parents, solid anchors (all text) don't collide, nothing sits cut by the frame edge unless marked bleed.
// node check.mjs --dir brands/<name> [--format <name>|all (default all)] [--fps 30]
// Writes out/check.json (the studio's "Machine checks" gate; full renders need it to pass).
// Exit 0 = passed, 1 = failures, 2 = can't run.
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';
import { check } from './lib/checks.mjs';
import { writeResult } from './lib/gate.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const DIR = resolve(opt('dir', '.'));
const fail = (msg) => { console.error(msg); process.exit(2); };
if (!existsSync(join(DIR, 'film.json'))) fail(`${DIR}/film.json not found`);
const film = JSON.parse(readFileSync(join(DIR, 'film.json'), 'utf8'));
const FPS = Number(opt('fps', 30)), DUR = film.dur ?? 20;
const formats = film.formats?.length ? film.formats : [{ name: 'main', w: film.w ?? 1080, h: film.h ?? 1920 }];
const pick = opt('format', 'all');
const sizes = pick === 'all' ? formats : formats.filter((f) => f.name === pick);
if (!sizes.length) fail(`unknown format "${pick}" (film.json has ${formats.map((f) => f.name).join(', ')})`);
mkdirSync(join(DIR, 'out'), { recursive: true });

const srv = await serve(DIR, [dirname(fileURLToPath(import.meta.url))]);
const browser = await chromium.launch();
const report = { ok: true, formats: {} };
try {
  for (const { name, w, h } of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.url + `?w=${w}&h=${h}`);
    await page.waitForFunction(() => window.ready && typeof window.seek === 'function');
    await page.evaluate(() => window.ready);
    const meta = await page.evaluate(() => ({ layout: !!window.LAYOUT, clicks: window.EVENTS?.clicks ?? [] }));
    if (!meta.layout) fail('No window.LAYOUT: the film must use lib/layout.js (see _template/index.html) so its targets can be checked.');

    // The grid, plus each click time and just before it (settle check), sampled exactly.
    const extra = meta.clicks.flatMap((c) => { const t = typeof c === 'number' ? c : c.t; return [t, t - 0.1]; });
    const grid = Array.from({ length: Math.floor(DUR * FPS) }, (_, i) => i / FPS);
    const times = [...grid.map((t) => ({ t, grid: true })), ...extra.map((t) => ({ t, grid: false }))];
    const frames = await page.evaluate((times) => times.map(({ t, grid }) => {
      window.seek(t);
      return { t, grid, anchors: window.LAYOUT.live().map(({ name, x, y, w, h, cx, cy, parent, bleed, solid }) => ({ name, x, y, w, h, cx, cy, parent, bleed, solid })) };
    }), times);
    const failures = check(frames, { clicks: meta.clicks, frame: { w, h }, fps: FPS, blur: { fps: film.fps ?? 60, sub: film.sub ?? 4 } });
    for (const e of errors) failures.unshift({ kind: 'page-error', t: null, msg: e });
    const anchored = new Set(frames.flatMap((f) => f.anchors.map((a) => a.name))).size;
    report.formats[name] = { w, h, anchors: anchored, clicks: meta.clicks.length, failures };
    if (failures.length) report.ok = false;
    console.log(`\n${name} ${w}x${h}: ${anchored} anchors, ${meta.clicks.length} clicks → ${failures.length ? `${failures.length} failure(s)` : 'passed'}`);
    for (const f of failures) console.log(`  ${f.t == null ? '' : `${f.t.toFixed(2)}s `}[${f.kind}] ${f.msg}${f.dur ? ` (for ${f.dur}s)` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  srv.close();
}
// A partial run (one format) never counts as the gate.
if (pick === 'all') writeResult(DIR, 'check', report);
else console.log('\n(one format only: out/check.json not written; run without --format for the gate)');
process.exit(report.ok ? 0 : 1);
