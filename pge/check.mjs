// Image job check: paints every panel in every format and proves what a look at the stills can only suggest.
// node pge/check.mjs --dir pge/jobs/<name> [--format <name>|all (default all)]
//   geometry  text out of its parent, two texts overlapping, anything cut by the frame edge (not bleed)
//   phone     text under 11px when the image is shown 360px wide (a phone feed)
//   contrast  text under 3:1 against what is directly behind it (measured from the painted pixels)
//   empty     a panel that is nearly one flat colour
// Intended exceptions go in job.json "allow": ["contrast:watermark", "off-frame:wall"] (kind:anchor name).
// Writes out/check.json (the studio's "Checks" gate; pge/render.mjs refuses a final render until it passes).
// Exit 0 = passed, 1 = failures, 2 = can't run.
import { args, loadJob, pickFormats, stage } from './lib/page.mjs';
import { checkPanel, boxContrast } from './lib/checks.mjs';
import { writeResult } from './lib/gate.mjs';

const { opt } = args();
let dir, job, sizes;
try { ({ dir, job } = loadJob(opt('dir'))); sizes = pickFormats(job, opt('format', 'all')); }
catch (e) { console.error(e.message); process.exit(2); }
const allow = new Set(job.allow ?? []);

const st = await stage(dir);
const report = { ok: true, formats: {} };
try {
  for (const { name, w, h } of sizes) {
    const { page, panels, errors } = await st.open({ w, h });
    const rows = [];
    for (let i = 0; i < panels.length; i++) {
      const measured = await page.evaluate((i) => {
        window.paint(i);
        const c = document.querySelector('#c'), g = c.getContext('2d');
        const px = g.getImageData(0, 0, c.width, c.height).data;
        // Flatness: share of pixels in the most common (coarse) colour.
        const bins = new Map();
        for (let p = 0; p < px.length; p += 16) {
          const k = (px[p] >> 3) << 10 | (px[p + 1] >> 3) << 5 | (px[p + 2] >> 3);
          bins.set(k, (bins.get(k) ?? 0) + 1);
        }
        const flat = Math.max(...bins.values()) / (px.length / 16);
        const lum = (r, g2, b) => { const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * l(r) + 0.7152 * l(g2) + 0.0722 * l(b); };
        const anchors = window.LAYOUT.live().map((a) => {
          const out = { name: a.name, x: a.x, y: a.y, w: a.w, h: a.h, cx: a.cx, cy: a.cy, parent: a.parent, bleed: a.bleed, solid: a.solid, size: a.size, contrast: a.contrast };
          if (a.contrast && a.w >= 2 && a.h >= 2) {
            const x0 = Math.max(0, Math.floor(a.x)), y0 = Math.max(0, Math.floor(a.y));
            const x1 = Math.min(c.width, Math.ceil(a.x + a.w)), y1 = Math.min(c.height, Math.ceil(a.y + a.h));
            const lums = [];
            const step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 40000)));
            for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
              const p = (y * c.width + x) * 4;
              lums.push(lum(px[p], px[p + 1], px[p + 2]));
            }
            out.lums = lums;
          }
          return out;
        });
        return { flat, anchors };
      }, i);
      for (const a of measured.anchors) if (a.lums) { a.measured = boxContrast(a.lums); delete a.lums; }
      const failures = checkPanel(measured, { frame: { w, h } })
        .filter((f) => ![...allow].some((k) => { const [kind, n] = k.split(':'); return f.kind === kind && (!n || f.msg.includes(`"${n}"`)); }));
      rows.push({ panel: i + 1, name: panels[i], anchors: measured.anchors.length, failures });
    }
    const failures = [...errors.map((e) => ({ panel: null, kind: 'page-error', msg: e })), ...rows.flatMap((r) => r.failures.map((f) => ({ panel: r.panel, ...f })))];
    report.formats[name] = { w, h, panels: rows.map(({ panel, name, anchors }) => ({ panel, name, anchors })), failures };
    if (failures.length) report.ok = false;
    console.log(`\n${name} ${w}x${h}: ${panels.length} panel(s) → ${failures.length ? `${failures.length} failure(s)` : 'passed'}`);
    for (const r of rows) if (!r.anchors) console.log(`  panel ${r.panel} (${r.name}): no anchors. Draw text with S.text / paragraph so it can be checked.`);
    for (const f of failures) console.log(`  ${f.panel ? `panel ${f.panel} ` : ''}[${f.kind}] ${f.msg}`);
    await page.close();
  }
} finally {
  await st.close();
}
if (opt('format', 'all') === 'all') writeResult(dir, report);
else console.log('\n(one format only: out/check.json not written; run without --format for the gate)');
process.exit(report.ok ? 0 : 1);
