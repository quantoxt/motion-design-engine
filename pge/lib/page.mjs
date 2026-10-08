// Shared by pge/check.mjs and pge/render.mjs: serve a job folder (engine root as fallback, so the job's page
// can import ./lib/*.js and ./pge/lib/*.js), open it headless at a size, wait for window.ready.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../lib/serve.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function args(argv = process.argv.slice(2)) {
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const has = (k) => argv.includes('--' + k);
  return { opt, has };
}

// --dir pge/jobs/<name> (or just <name>) → absolute job folder + its job.json.
export function loadJob(dirArg) {
  if (!dirArg) throw new Error('pass --dir pge/jobs/<name>');
  let dir = resolve(dirArg);
  if (!existsSync(join(dir, 'job.json')) && /^[a-z0-9-]+$/.test(dirArg)) dir = join(ROOT, 'pge', 'jobs', dirArg);
  if (!existsSync(join(dir, 'job.json'))) throw new Error(`${dir}/job.json not found`);
  const job = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8'));
  if (!job.formats?.length) throw new Error('job.json needs "formats": [{ "name", "w", "h" }]');
  return { dir, job };
}

export function pickFormats(job, pick = 'all') {
  const list = pick === 'all' ? job.formats : job.formats.filter((f) => f.name === pick);
  if (!list.length) throw new Error(`unknown format "${pick}" (job.json has ${job.formats.map((f) => f.name).join(', ')})`);
  return list;
}

export async function stage(dir) {
  const srv = await serve(dir, [ROOT]);
  const browser = await chromium.launch();
  return {
    async open({ w, h }, scale = 1) {
      const page = await browser.newPage({ viewport: { width: Math.round(w * scale), height: Math.round(h * scale) }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(srv.url + `?w=${Math.round(w * scale)}&h=${Math.round(h * scale)}`);
      try {
        await page.waitForFunction(() => window.ready && typeof window.paint === 'function' && Array.isArray(window.PANELS), null, { timeout: 20000 });
      } catch { throw new Error(`the page never exposed window.ready / window.paint / window.PANELS${errors.length ? `: ${errors[0]}` : ''} (see pge/AGENTS.md)`); }
      await page.evaluate(() => window.ready);
      const panels = await page.evaluate(() => window.PANELS.map((p) => p.name));
      return { page, panels, errors };
    },
    async close() { await browser.close(); srv.close(); },
  };
}
