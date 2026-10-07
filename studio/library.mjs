// Film Library: the finished films of every brand, read from brands/<slug>/out/.
// A finished film is what finalize.mjs writes: <slug>-<format>-<W>x<H>.mp4 (+ -posting.mp4).
// Nothing here writes files.
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { briefTitle } from './brief.mjs';

const run = promisify(execFile);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const finalPattern = (slug) => new RegExp(`^${esc(slug)}-([a-z0-9-]+?)-(\\d+)x(\\d+)(-posting)?\\.mp4$`);

// Masters in out/, each with its posting copy if there is one. Sorted vertical → square → wide.
export async function finals(root, slug) {
  const out = join(root, 'brands', slug, 'out');
  let names = [];
  try { names = await readdir(out); } catch { return []; }
  const re = finalPattern(slug), masters = new Map();
  for (const f of names) {
    const m = f.match(re);
    if (!m || m[4]) continue;
    masters.set(f, { file: f, format: m[1], w: Number(m[2]), h: Number(m[3]),
      posting: names.includes(f.replace(/\.mp4$/, '-posting.mp4')) ? f.replace(/\.mp4$/, '-posting.mp4') : null });
  }
  return [...masters.values()].sort((a, b) => a.w / a.h - b.w / b.h || a.format.localeCompare(b.format));
}

// ffprobe once per file version (path + size + mtime).
const probed = new Map();
async function probe(file) {
  const s = await stat(file);
  const key = `${file}:${s.size}:${s.mtimeMs}`;
  if (!probed.has(key)) {
    probed.set(key, run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,r_frame_rate',
      '-of', 'json', file]).then(({ stdout }) => {
      const j = JSON.parse(stdout), v = j.streams?.find((x) => x.codec_type === 'video');
      const [n, d] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
      return { duration: Number(j.format?.duration) || null, fps: d ? Math.round((n / d) * 100) / 100 : null,
        audio: !!j.streams?.some((x) => x.codec_type === 'audio') };
    }).catch(() => ({ duration: null, fps: null, audio: null })));
  }
  return { size: s.size, modified: s.mtime.toISOString(), ...(await probed.get(key)) };
}

async function title(root, slug) {
  for (const f of [join(root, 'brands', slug, 'docs', 'brief.md'), join(root, '_raw', `${slug}.md`)]) {
    try { const t = briefTitle(await readFile(f, 'utf8')); if (t) return t; } catch {}
  }
  return slug;
}

// One brand's library page: every master with its metadata, plus the poster.
export async function brand(root, slug) {
  if (!existsSync(join(root, 'brands', slug))) return null;
  const list = await finals(root, slug);
  if (!list.length) return null;
  const out = join(root, 'brands', slug, 'out');
  const videos = await Promise.all(list.map(async (v) => ({
    ...v, ...(await probe(join(out, v.file))),
    postingSize: v.posting ? (await stat(join(out, v.posting))).size : null,
  })));
  return { slug, title: await title(root, slug), poster: existsSync(join(out, 'poster.png')) ? 'poster.png' : null,
    videos, updated: videos.map((v) => v.modified).sort().at(-1) };
}

// Every brand with at least one finished film, newest first. `_`-folders (the template) are skipped.
export async function library(root) {
  let dirs = [];
  try { dirs = (await readdir(join(root, 'brands'), { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')); } catch {}
  const brands = (await Promise.all(dirs.map((d) => brand(root, d.name)))).filter(Boolean);
  return brands.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
}

// Which files under brands/<slug>/out/ the studio may serve: finals, the poster, and the two
// review files the film page shows inline (animatic, contact sheet). Nothing else.
const REVIEW = new Set(['poster.png', 'contact.png', 'animatic.mp4']);
export async function mediaFile(root, slug, name) {
  if (typeof name !== 'string') return null;
  const ok = REVIEW.has(name) || finalPattern(slug).test(name);
  const file = join(root, 'brands', slug, 'out', name);
  return ok && existsSync(file) ? file : null;
}
