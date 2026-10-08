// Image job renderer: every panel → a lossless PNG, plus a contact sheet at phone size.
// node pge/render.mjs --dir pge/jobs/<name> [--draft] [--format <name>|all (default all)] [--panel N]
//   --draft   out/draft/<format>/NN-<panel>.png + out/draft/contact_<format>.png. No gate: use it while working.
//   (final)   out/final/<job>-<format>-NN-<W>x<H>.png + out/contact_<format>.png (+ out/contact.png for the
//             primary format, job.json formats[0]). Refused until pge/check.mjs passed on the current code.
//   --panel N render only panel N (1-based); never counts as a final set.
// The contact sheet shows each panel 360px wide: the size a phone feed shows it at. Read it there.
import { mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { args, loadJob, pickFormats, stage } from './lib/page.mjs';
import { readResult } from './lib/gate.mjs';

const { opt, has } = args();
const fail = (m, code = 2) => { console.error(m); process.exit(code); };
let dir, job, sizes;
try { ({ dir, job } = loadJob(opt('dir'))); sizes = pickFormats(job, opt('format', 'all')); }
catch (e) { fail(e.message); }
const draft = has('draft'), only = opt('panel') ? Number(opt('panel')) : null, name = basename(dir);

if (!draft) {
  const r = readResult(dir);
  if (r.state !== 'passed') fail(`Final render refused: checks ${r.state === 'stale' ? 'are stale (index.html or job.json changed since they ran)' : r.state}.\n`
    + `Run: node pge/check.mjs --dir ${opt('dir')}   (or render a --draft)`, 1);
}

const st = await stage(dir);
try {
  for (const f of sizes) {
    const { page, panels, errors } = await st.open(f);
    if (errors.length) fail(`page error in ${f.name}: ${errors[0]}`);
    const outDir = draft ? join(dir, 'out', 'draft', f.name) : join(dir, 'out', 'final');
    if (only == null) {
      if (draft) rmSync(outDir, { recursive: true, force: true });
      else for (const x of safeList(outDir)) if (x.startsWith(`${name}-${f.name}-`)) rmSync(join(outDir, x));
    }
    mkdirSync(outDir, { recursive: true });
    const written = [];
    for (let i = 0; i < panels.length; i++) {
      if (only != null && only !== i + 1) continue;
      await page.evaluate((i) => window.paint(i), i);
      const nn = String(i + 1).padStart(2, '0');
      const file = join(outDir, draft ? `${nn}-${panels[i]}.png` : `${name}-${f.name}-${nn}-${f.w}x${f.h}.png`);
      await page.locator('#c').screenshot({ path: file });
      written.push(file);
    }
    await page.close();
    console.log(`${f.name} ${f.w}x${f.h}: ${written.length} panel(s) → ${outDir}`);
    if (only != null) continue;
    const contact = draft ? join(dir, 'out', 'draft', `contact_${f.name}.png`) : join(dir, 'out', `contact_${f.name}.png`);
    sheet(written, contact);
    console.log(`  contact sheet (360px per panel, phone size): ${contact}`);
    if (!draft && f.name === job.formats[0].name) copyFileSync(contact, join(dir, 'out', 'contact.png'));
  }
} finally {
  await st.close();
}

function safeList(d) { try { return readdirSync(d); } catch { return []; } }

// Panels side by side, each scaled to 360px wide, up to 5 per row in even rows, numbered. Gaps in the last row stay black.
function sheet(files, out) {
  const cols = Math.ceil(files.length / Math.ceil(files.length / 5));   // even rows: 6 → 3×2, 7 → 4+3
  const scaled = files.map((_, k) => `[${k}:v]scale=360:-1,drawtext=text='${k + 1}':x=10:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5[p${k}]`);
  const cell = (k) => {
    const c = k % cols, r = Math.floor(k / cols);
    return `${c ? Array.from({ length: c }, () => 'w0').join('+') : '0'}_${r ? Array.from({ length: r }, () => 'h0').join('+') : '0'}`;
  };
  const filter = files.length === 1 ? `${scaled[0].replace('[p0]', '[out]')}`
    : [...scaled, `${files.map((_, k) => `[p${k}]`).join('')}xstack=inputs=${files.length}:layout=${files.map((_, k) => cell(k)).join('|')}:fill=black[out]`].join(';');
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', out]);
}
