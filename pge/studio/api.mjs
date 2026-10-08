// Studio routes for image jobs (the "Images" section). Mounted by studio.mjs under /api/pge/ and /pge-media/;
// it uses the studio's own request helpers and a second terminal manager whose jobs live in pge/jobs/.
//
//   GET  /api/pge/template               pge/brief-template.md
//   GET  /api/pge/briefs                 saved image briefs (+ the job's progress)
//   GET  /api/pge/briefs/:slug           one brief's markdown
//   GET|POST /api/pge/briefs/:slug/refs  design references (POST: raw image bytes, ?name=); DELETE …/refs/:name
//   GET  /pge-media/:slug/_refs/:name    one reference image
//   POST /api/pge/briefs                 { slug, md, overwrite? } → pge/briefs/<slug>.md (409 if it exists)
//   GET  /api/pge/jobs                   every job: progress, cover image, final count
//   POST /api/pge/jobs                   { slug } → scaffold pge/jobs/<slug>/ from pge/_template (409 if it exists)
//   GET  /api/pge/jobs/:slug             gates + rendered images
//   GET  /api/pge/jobs/:slug/plan        story plan text + sha256 + approval
//   POST /api/pge/jobs/:slug/plan/approve|revoke
//   POST|GET|DELETE /api/pge/jobs/:slug/terminal, GET …/terminal/history, …/terminal/log, WS …/terminal/ws
//   GET  /pge-media/:slug/<path under out/>.png, /pge-media/:slug/finals.zip[?format=]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEFS, JOBS, briefs, jobs, gates, images, scaffold, planFile, approvePlan, revokePlan, mediaPath, finalFiles,
  listRefs, addRef, removeRef, refPath, REF_MAX } from './jobs.mjs';
import { zip } from '../lib/zip.mjs';
import { filmTranscript } from '../../studio/transcript.mjs';

// ctx: { root, send, readBody, sameOrigin, validSlug, terminals, ptyError, plainLog }
export async function pgeApi(req, res, path, ctx) {
  const { root, send, readBody, sameOrigin, validSlug, terminals, ptyError, plainLog } = ctx;
  const json = async () => { try { return JSON.parse((await readBody(req)) || '{}'); } catch (e) { return e.message === 'too large' ? 413 : 400; } };
  const bad = (code) => send(res, code, { error: code === 413 ? 'Over 256 KB.' : 'Request body must be JSON.' });
  if ((req.method === 'POST' || req.method === 'DELETE') && req.headers.origin && !sameOrigin(req.headers.origin))
    return send(res, 403, { error: 'Cross-origin request refused.' });

  if (path === '/api/pge/template' && req.method === 'GET')
    return send(res, 200, await readFile(join(root, 'pge', 'brief-template.md'), 'utf8'), 'text/markdown; charset=utf-8');
  if (path === '/api/pge/briefs' && req.method === 'GET') return send(res, 200, await briefs(root));
  if (path === '/api/pge/jobs' && req.method === 'GET') return send(res, 200, await jobs(root));

  if (path === '/api/pge/briefs' && req.method === 'POST') {
    const body = await json(); if (typeof body === 'number') return bad(body);
    const { slug, md, overwrite } = body ?? {};
    if (!validSlug(slug)) return send(res, 400, { error: 'Name the job (letters, numbers and dashes) before saving.' });
    if (typeof md !== 'string' || !md.trim()) return send(res, 400, { error: 'The brief is empty.' });
    const file = join(root, BRIEFS, `${slug}.md`);
    if (existsSync(file) && overwrite !== true) return send(res, 409, { error: `${BRIEFS}/${slug}.md already exists.`, path: `${BRIEFS}/${slug}.md` });
    await mkdir(join(root, BRIEFS), { recursive: true });
    await writeFile(file, md.endsWith('\n') ? md : md + '\n', 'utf8');
    console.log(`saved ${BRIEFS}/${slug}.md`);
    return send(res, 200, { path: `${BRIEFS}/${slug}.md` });
  }
  if (path === '/api/pge/jobs' && req.method === 'POST') {
    const body = await json(); if (typeof body === 'number') return bad(body);
    if (!validSlug(body?.slug)) return send(res, 400, { error: 'Invalid name.' });
    const r = await scaffold(root, body.slug);
    if (r.status === 201) console.log(`scaffolded ${r.path}`);
    return send(res, r.status, r);
  }

  const m = path.match(/^\/api\/pge\/(briefs|jobs)\/([^/]+)(?:\/(.+))?$/);
  if (!m) return send(res, 404, { error: 'Unknown endpoint.' });
  let slug;
  try { slug = decodeURIComponent(m[2]); } catch { return send(res, 400, { error: 'Invalid name.' }); }
  if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
  const sub = m[3] ?? '';

  if (m[1] === 'briefs' && sub === 'refs' && req.method === 'GET') return send(res, 200, await listRefs(root, slug));
  if (m[1] === 'briefs' && sub === 'refs' && req.method === 'POST') {
    // Raw image bytes; the file name comes in ?name=. Same-origin only (a page can't upload into your briefs).
    if (!sameOrigin(req.headers.origin)) return send(res, 403, { error: 'Cross-origin request refused.' });
    const buf = await rawBody(req, REF_MAX);
    if (!buf) return send(res, 413, { error: 'Over 15 MB.' });
    const r = await addRef(root, slug, new URL(req.url, 'http://x').searchParams.get('name'), buf);
    if (r.status === 201) console.log(`added reference ${BRIEFS}/${slug}.refs/${r.name}`);
    return send(res, r.status, r);
  }
  const del = m[1] === 'briefs' && sub.match(/^refs\/([^/]+)$/);
  if (del && req.method === 'DELETE') {
    let name = null; try { name = decodeURIComponent(del[1]); } catch {}
    const r = await removeRef(root, slug, name);
    if (r.status === 200) console.log(`removed reference ${BRIEFS}/${slug}.refs/${name}`);
    return send(res, r.status, r);
  }
  if (m[1] === 'briefs') {
    if (sub || req.method !== 'GET') return send(res, 404, { error: 'Unknown endpoint.' });
    const file = join(root, BRIEFS, `${slug}.md`);
    return existsSync(file) ? send(res, 200, await readFile(file, 'utf8'), 'text/markdown; charset=utf-8') : send(res, 404, { error: `${BRIEFS}/${slug}.md doesn't exist.` });
  }

  if (!sub && req.method === 'GET') {
    const g = await gates(root, slug);
    return g ? send(res, 200, { ...g, images: await images(root, slug) }) : send(res, 404, { error: `${JOBS}/${slug}/ doesn't exist yet.` });
  }
  if (sub === 'plan' && req.method === 'GET') { const r = await planFile(root, slug); return send(res, r.status, r); }
  if ((sub === 'plan/approve' || sub === 'plan/revoke') && req.method === 'POST') {
    const body = await json(); if (typeof body === 'number') return bad(body);
    const r = sub === 'plan/approve' ? await approvePlan(root, slug, body.sha256) : await revokePlan(root, slug);
    if (r.status === 200) console.log(`${sub === 'plan/approve' ? 'approved' : 'revoked'} story plan for ${JOBS}/${slug}/`);
    return send(res, r.status, r);
  }

  const history = () => terminals?.history(slug) ?? [];
  if (sub === 'terminal/history' && req.method === 'GET') return send(res, 200, { history: history() });
  if (sub === 'terminal/log' && req.method === 'GET') {
    const file = join(root, JOBS, slug, 'out', 'terminal.log');
    const h = history();
    if (!h.length && !existsSync(file)) return send(res, 404, { error: 'No transcript yet.' });
    return send(res, 200, filmTranscript({ root, history: h, plainLog: () => (existsSync(file) ? plainLog(readFileSync(file, 'utf8')) : '') }), 'text/plain; charset=utf-8');
  }
  if (sub === 'terminal') {
    if (!terminals) return send(res, 503, { error: ptyError });
    if (req.method === 'GET') { const r = terminals.get(slug); return send(res, r.status, r); }
    if (req.method === 'DELETE') { const r = terminals.kill(slug); if (r.status === 200) console.log(`killed agent for ${JOBS}/${slug}/`); return send(res, r.status, r); }
    if (req.method === 'POST') {
      if (!sameOrigin(req.headers.origin)) return send(res, 403, { error: 'Cross-origin request refused.' });
      const body = await json(); if (typeof body === 'number') return bad(body);
      const r = terminals.start(slug, body ?? {});
      if (r.status === 201) console.log(`started agent for ${JOBS}/${slug}/: ${r.session.command}`);
      return send(res, r.status, r);
    }
  }
  return send(res, 404, { error: 'Unknown endpoint.' });
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

// GET /pge-media/:slug/<path>.png → a rendered image (?download=1 to save it).
// GET /pge-media/:slug/finals.zip[?format=<name>] → every final PNG (or one format's) in one zip.
export async function pgeMedia(req, res, path, { root, send, validSlug }) {
  const ref = path.match(/^\/pge-media\/([^/]+)\/_refs\/([^/]+)$/);
  if (ref) {   // a design reference uploaded with the brief
    let slug = null, name = null; try { slug = decodeURIComponent(ref[1]); name = decodeURIComponent(ref[2]); } catch {}
    const file = validSlug(slug) ? refPath(root, slug, name) : null;
    if (!file || req.method !== 'GET') return send(res, 404, 'Not found', 'text/plain');
    const type = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[name.split('.').pop()];
    res.writeHead(200, { 'content-type': type, 'content-length': statSync(file).size, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    return createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  const z = path.match(/^\/pge-media\/([^/]+)\/finals\.zip$/);
  if (z) {
    let slug = null; try { slug = decodeURIComponent(z[1]); } catch {}
    if (!validSlug(slug) || req.method !== 'GET') return send(res, 404, 'Not found', 'text/plain');
    const format = new URL(req.url, 'http://x').searchParams.get('format');
    if (format && !/^[a-z0-9-]+$/i.test(format)) return send(res, 400, 'Bad format', 'text/plain');
    const files = await finalFiles(root, slug, format);
    if (!files.length) return send(res, 404, 'No final images yet', 'text/plain');
    const body = zip(await Promise.all(files.map(async (f) => ({ name: f.name, data: await readFile(f.file), mtime: statSync(f.file).mtime }))));
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length, 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${slug}${format ? `-${format}` : ''}.zip"` });
    return res.end(body);
  }
  const m = path.match(/^\/pge-media\/([^/]+)\/(.+)$/);
  let slug = null, rel = null;
  try { slug = m && decodeURIComponent(m[1]); rel = m && decodeURIComponent(m[2]); } catch {}
  const file = slug && validSlug(slug) ? mediaPath(root, slug, rel) : null;
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, 'Not found', 'text/plain');
  const headers = { 'content-type': 'image/png', 'content-length': statSync(file).size, 'cache-control': 'no-cache' };
  if (new URL(req.url, 'http://x').searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${rel.split('/').pop()}"`;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
