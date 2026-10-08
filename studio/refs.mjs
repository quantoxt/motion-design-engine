// Design references: images and short video clips uploaded with a brief, for the agent to study (never to copy).
// Shared by films (briefs in _raw/) and image jobs (briefs in pge/briefs/).
//
// One store per brief, <briefs>/<slug>.refs/:
//   - the files, named from the upload (cleaned up; the extension follows the real type, read from the first bytes)
//   - <stem>.frames.png for each video: a sheet of frames cut by ffmpeg, since agents can't watch video
//   - refs.json: [{ name, kind, note, … }] in upload order. It is the only place notes live, keyed by the file's
//     name, so a note can't drift onto another file; removing a file removes its entry and note with it.
// Every job folder made from the brief gets assets/refs/: the same files plus refs.md, which lists them in that order,
// each with its own note. Job folders are refreshed on every change, except the ones targets() leaves out
// (a delivered film is never touched).
import { readFile, writeFile, readdir, stat, mkdir, mkdtemp, rm, copyFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

export const IMAGE_MAX = 15 * 1024 * 1024, VIDEO_MAX = 100 * 1024 * 1024, REF_COUNT = 40, NOTE_MAX = 600;
const NAME = /^[a-z0-9][a-z0-9_-]{0,80}\.(png|jpg|gif|webp|mp4|mov|webm)$/;
const STRIP = /^([a-z0-9][a-z0-9_-]{0,80})\.frames\.png$/;
const VIDEO = new Set(['mp4', 'mov', 'webm']);
export const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

// The real type from the first bytes, or null. Anything else (SVG, HTML, PDF…) is refused.
export function refType(buf) {
  const at = (i, sig) => sig.every((b, k) => buf[i + k] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return buf.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4';
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  return null;
}

const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout: 90_000, maxBuffer: 1 << 20 }, (err, out) => (err ? reject(err) : resolve(out))));

// Frames from a clip: about 2 per second, 6 at least, 24 at most, 360px wide, left to right, top to bottom.
// Two passes (cut, then tile) so the count reported is the count on the sheet: ffmpeg's fps filter can drop the last slice.
export async function frameSheet(video, out) {
  const duration = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video])).trim());
  if (!(duration > 0)) throw new Error('no duration');
  const want = Math.min(24, Math.max(6, Math.round(duration * 2))), every = duration / want;
  const tmp = await mkdtemp(join(tmpdir(), 'frames-'));
  try {
    // One frame from the middle of each slice, so a fade at either end doesn't fill the sheet with black.
    await run('ffmpeg', ['-v', 'error', '-ss', (every / 2).toFixed(4), '-i', video, '-vf', `fps=1/${every.toFixed(4)},scale=360:-2`,
      '-frames:v', String(want), '-y', join(tmp, '%03d.png')]);
    const frames = (await readdir(tmp)).filter((f) => f.endsWith('.png')).length;
    if (!frames) throw new Error('no frames');
    const cols = frames <= 12 ? 4 : 6, rows = Math.ceil(frames / cols);
    await run('ffmpeg', ['-v', 'error', '-i', join(tmp, '%03d.png'), '-vf', `tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', '-y', out]);
    if (!existsSync(out)) throw new Error('no sheet');
    return { duration: Math.round(duration * 10) / 10, frames, every: Math.round((duration / frames) * 100) / 100 };
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

const cleanNote = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);

// refs.md: what the agent reads. One section per file, in upload order, its note right under its name.
export function refsMarkdown(list) {
  const lines = ['# Design references', '',
    'Uploaded with the brief, in this order. Open every file. The note under each one is the client\'s instruction for',
    'that file only: what to take from it. Take the grammar (layout, type, colour, texture, motion, pacing), never the',
    'content: no tracing, no copied artwork, logos or text. Write what you take from each in the style guide.', ''];
  list.forEach((r, i) => {
    lines.push(`## ${i + 1} · ${r.name}`);
    if (r.kind === 'video') lines.push(`Video clip, ${r.duration} s. You can't watch it: open \`${r.frames}\`, ${r.count} frames, left to right then top to bottom, one every ${r.every} s.`);
    else lines.push('Image.');
    lines.push(r.note ? `**Take from it:** ${r.note}` : '**Take from it:** no note. Decide what is worth taking and say why in the style guide.', '');
  });
  return lines.join('\n');
}

// briefs: the briefs folder (relative to root). targets(root, slug) → job folders that should hold assets/refs/.
export function createRefs({ briefs, targets }) {
  const dir = (root, slug) => join(root, briefs, `${slug}.refs`);
  const indexFile = (root, slug) => join(dir(root, slug), 'refs.json');
  // Changes to one brief's store run one at a time: two notes saved at once would otherwise each write an index
  // that lacks the other's note.
  const queues = new Map();
  const serial = (root, slug, fn) => {
    const key = dir(root, slug), next = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = next.catch(() => {}); queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return next;
  };

  // The entries whose files exist, in upload order. A store made before refs.json existed is read from its files.
  async function list(root, slug) {
    let entries;
    try { entries = JSON.parse(await readFile(indexFile(root, slug), 'utf8')); } catch { entries = null; }
    if (!Array.isArray(entries)) {
      let names = [];
      try { names = (await readdir(dir(root, slug))).filter((f) => NAME.test(f) && !VIDEO.has(f.split('.').pop())).sort(); } catch {}
      entries = names.map((name) => ({ name, kind: 'image', note: '' }));
    }
    const out = [];
    for (const e of entries) {
      if (!NAME.test(e?.name ?? '')) continue;
      let size;
      try { size = (await stat(join(dir(root, slug), e.name))).size; } catch { continue; }
      out.push({ ...e, note: cleanNote(e.note), size });
    }
    return out;
  }
  async function save(root, slug, entries) {
    await mkdir(dir(root, slug), { recursive: true });
    const tmp = indexFile(root, slug) + '.tmp';
    await writeFile(tmp, JSON.stringify(entries.map(({ size, ...e }) => e), null, 2) + '\n');
    await rename(tmp, indexFile(root, slug));   // never a half-written index
  }

  // Refresh assets/refs/ in every job folder that uses this brief: files added or removed, refs.md rewritten.
  async function mirror(root, slug, entries) {
    for (const job of await targets(root, slug)) await copyInto(root, slug, job, entries);
  }
  async function copyInto(root, slug, job, entries) {
    entries ??= await list(root, slug);
    const dest = join(job, 'assets', 'refs');
    const want = new Set(entries.flatMap((e) => [e.name, e.frames].filter(Boolean)));
    let have = [];
    try { have = await readdir(dest); } catch {}
    for (const f of have) if (f !== 'refs.md' && !want.has(f) && (NAME.test(f) || STRIP.test(f))) await rm(join(dest, f), { force: true });
    if (!entries.length) { await rm(join(dest, 'refs.md'), { force: true }); return; }
    await mkdir(dest, { recursive: true });
    for (const f of want) if (!have.includes(f)) await copyFile(join(dir(root, slug), f), join(dest, f));
    await writeFile(join(dest, 'refs.md'), refsMarkdown(entries));
  }

  // name = the original file name. Returns { status, name } or { status, error }.
  async function add(root, slug, name, buf) {
    if (!existsSync(join(root, briefs, `${slug}.md`))) return { status: 404, error: 'Save the brief first, then add references.' };
    if (!buf?.length) return { status: 400, error: 'Empty file.' };
    const ext = refType(buf);
    if (!ext) return { status: 415, error: 'Only PNG, JPG, GIF or WebP images, or MP4, MOV or WebM clips.' };
    const video = VIDEO.has(ext);
    if (buf.length > (video ? VIDEO_MAX : IMAGE_MAX)) return { status: 413, error: video ? 'Clips: 100 MB at most.' : 'Images: 15 MB at most.' };
    const entries = await list(root, slug);
    if (entries.length >= REF_COUNT) return { status: 409, error: `${REF_COUNT} references at most.` };
    const stem = String(name ?? '').toLowerCase().replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ref';
    const taken = (f) => entries.some((e) => e.name === f || e.frames === f) || existsSync(join(dir(root, slug), f));
    let file = `${stem}.${ext}`;
    for (let k = 2; taken(file) || (video && taken(`${file.slice(0, -ext.length - 1)}.frames.png`)); k++) file = `${stem}-${k}.${ext}`;
    await mkdir(dir(root, slug), { recursive: true });
    const path = join(dir(root, slug), file);
    await writeFile(path, buf);
    const entry = { name: file, kind: video ? 'video' : 'image', note: '', added: new Date().toISOString() };
    if (video) {
      const frames = `${file.slice(0, -ext.length - 1)}.frames.png`;
      try {
        const m = await frameSheet(path, join(dir(root, slug), frames));
        Object.assign(entry, { frames, duration: m.duration, count: m.frames, every: m.every });
      } catch {
        await rm(path, { force: true }); await rm(join(dir(root, slug), frames), { force: true });
        return { status: 415, error: 'Couldn’t read frames from that clip. Is it a playable video?' };
      }
    }
    const next = [...entries, entry];
    await save(root, slug, next);
    await mirror(root, slug, next);
    return { status: 201, name: file };
  }

  async function setNote(root, slug, name, note) {
    if (typeof note !== 'string') return { status: 400, error: 'The note must be text.' };
    const entries = await list(root, slug);
    const e = entries.find((x) => x.name === name);
    if (!e) return { status: 404, error: 'No such reference.' };
    e.note = cleanNote(note);
    await save(root, slug, entries);
    await mirror(root, slug, entries);
    return { status: 200, name, note: e.note };
  }

  async function remove(root, slug, name) {
    if (!NAME.test(name ?? '')) return { status: 400, error: 'Invalid name.' };
    const entries = await list(root, slug);
    const e = entries.find((x) => x.name === name);
    if (!e) return { status: 404, error: 'No such reference.' };
    await rm(join(dir(root, slug), name), { force: true });
    if (e.frames) await rm(join(dir(root, slug), e.frames), { force: true });
    const next = entries.filter((x) => x !== e);
    await save(root, slug, next);
    await mirror(root, slug, next);
    return { status: 200 };
  }

  // A stored file (a reference or a video's frame sheet) by name, or null.
  async function file(root, slug, name) {
    if (!NAME.test(name ?? '') && !STRIP.test(name ?? '')) return null;
    const entries = await list(root, slug);
    if (!entries.some((e) => e.name === name || e.frames === name)) return null;
    return join(dir(root, slug), name);
  }

  return { dir, list, file, copyInto,
    add: (root, slug, ...a) => serial(root, slug, () => add(root, slug, ...a)),
    setNote: (root, slug, ...a) => serial(root, slug, () => setNote(root, slug, ...a)),
    remove: (root, slug, ...a) => serial(root, slug, () => remove(root, slug, ...a)) };
}

// Request body as bytes, up to cap (null when over: the rest is drained so the answer still arrives).
function rawBody(req, cap) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= cap) chunks.push(c); });
    req.on('end', () => resolve(size > cap ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// The HTTP side, mounted under a brief: sub = 'refs' or 'refs/<name>'. Returns false when the path isn't ours.
//   GET  …/refs          the list, in upload order, with notes
//   POST …/refs?name=    raw file bytes
//   GET  …/refs/<name>   the file (or a video's frame sheet)
//   PUT  …/refs/<name>   { note }
//   DELETE …/refs/<name>
export async function refsRoute(req, res, { refs, root, slug, sub, send, readBody, sameOrigin, label }) {
  const one = sub.match(/^refs\/([^/]+)$/);
  if (sub !== 'refs' && !one) return false;
  if (req.method !== 'GET' && !sameOrigin(req.headers.origin)) return send(res, 403, { error: 'Cross-origin request refused.' });
  if (sub === 'refs') {
    if (req.method === 'GET') return send(res, 200, await refs.list(root, slug));
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
    const buf = await rawBody(req, VIDEO_MAX);
    if (!buf) return send(res, 413, { error: 'Over 100 MB.' });
    const r = await refs.add(root, slug, new URL(req.url, 'http://x').searchParams.get('name'), buf);
    if (r.status === 201) console.log(`added reference ${label}/${slug}.refs/${r.name}`);
    return send(res, r.status, r);
  }
  let name = null;
  try { name = decodeURIComponent(one[1]); } catch { return send(res, 400, { error: 'Invalid name.' }); }
  if (req.method === 'GET') {
    const file = await refs.file(root, slug, name);
    if (!file) return send(res, 404, 'Not found', 'text/plain');
    const type = STRIP.test(name) ? 'image/png' : TYPES[name.split('.').pop()];
    res.writeHead(200, { 'content-type': type, 'content-length': (await stat(file)).size, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    return createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  if (req.method === 'PUT') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(res, 400, { error: 'Request body must be JSON.' }); }
    const r = await refs.setNote(root, slug, name, body?.note);
    return send(res, r.status, r);
  }
  if (req.method === 'DELETE') {
    const r = await refs.remove(root, slug, name);
    if (r.status === 200) console.log(`removed reference ${label}/${slug}.refs/${name}`);
    return send(res, r.status, r);
  }
  return send(res, 405, { error: 'Method not allowed.' });
}
