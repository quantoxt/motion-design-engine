// Film Library: the finished films of every brand, read from brands/<slug>/out/.
// A finished film is what finalize.mjs writes: <slug>-<format>-<W>x<H>.mp4 (+ -posting.mp4).
// Nothing here writes files.
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { briefTitle } from './brief.mjs';
import { splitVersion, versions } from './films.mjs';

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

// One version's finished films (one film folder): every master with its metadata, plus the poster.
async function versionFilms(root, slug, version) {
  const list = await finals(root, slug);
  if (!list.length) return null;
  const out = join(root, 'brands', slug, 'out');
  const videos = await Promise.all(list.map(async (v) => ({
    ...v, ...(await probe(join(out, v.file))),
    postingSize: v.posting ? (await stat(join(out, v.posting))).size : null,
  })));
  return { slug, version, poster: existsSync(join(out, 'poster.png')) ? 'poster.png' : null,
    videos, updated: videos.map((v) => v.modified).sort().at(-1) };
}

// One brand in the library: all its versions with finished films, newest version first.
// Asking for brands/acme-v2 gives the same brand as brands/acme.
// cover = what to show on the brand's folder (newest version's poster, else its first film).
export async function brand(root, slug) {
  const { base } = splitVersion(root, slug);
  if (!existsSync(join(root, 'brands', base))) return null;
  const vs = (await Promise.all((await versions(root, base)).map((v) => versionFilms(root, v.slug, v.version)))).filter(Boolean).reverse();
  if (!vs.length) return null;
  const top = vs[0];
  return { slug: base, title: await title(root, base), versions: vs,
    cover: top.poster ? { slug: top.slug, file: top.poster, kind: 'image' } : { slug: top.slug, file: top.videos[0].file, kind: 'video' },
    count: vs.reduce((n, v) => n + v.videos.length, 0), updated: vs.map((v) => v.updated).sort().at(-1) };
}

// Every brand with at least one finished film, newest first. Versions fold into their brand;
// `_`-folders (the template) are skipped.
export async function library(root) {
  let dirs = [];
  try { dirs = (await readdir(join(root, 'brands'), { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')); } catch {}
  const bases = [...new Set(dirs.map((d) => splitVersion(root, d.name).base))];
  const brands = (await Promise.all(bases.map((b) => brand(root, b)))).filter(Boolean);
  return brands.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
}

// Which files under brands/<slug>/out/ the studio may serve: finals, the poster, and the review files
// the film page shows inline (animatic, contact sheet, silent renders for the primary review). Nothing else.
const REVIEW = new Set(['poster.png', 'contact.png', 'animatic.mp4']);
export async function mediaFile(root, slug, name) {
  if (typeof name !== 'string') return null;
  const ok = REVIEW.has(name) || /^silent(_[a-z0-9-]+)?\.mp4$/.test(name) || finalPattern(slug).test(name);
  const file = join(root, 'brands', slug, 'out', name);
  return ok && existsSync(file) ? file : null;
}
