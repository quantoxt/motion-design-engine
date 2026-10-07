// Studio: local web UI for the factory: briefs, films and their gates, agent terminals,
// the Film Library. node studio.mjs [--port 4321] [--no-open]   →  http://127.0.0.1:4321
//
//   GET  /                 the UI (studio/index.html; views are hash-routed in studio/app.mjs)
//   GET  /api/template     _raw/brief-template.md (the form is generated from it)
//   GET  /api/briefs       saved briefs in _raw/ (+ whether a film exists for each)
//   GET  /api/briefs/:slug one brief's markdown (to reopen and edit)
//   POST /api/briefs       { slug, md, overwrite? } → writes _raw/<slug>.md (409 if it exists)
//   POST /api/films        { slug } → scaffolds brands/<slug>/ from brands/_template (409 if it exists)
//   GET  /api/films/:slug  gate status, read from the files in brands/<slug>/, + brief drift vs _raw/ + version info
//   GET  /api/films/:slug/shotlist          shotlist text + its sha256 + current approval
//   POST /api/films/:slug/shotlist/approve  { sha256 } of the version you read → docs/approvals.json
//   POST /api/films/:slug/shotlist/revoke   withdraw the approval
//   POST /api/films/:slug/primary/approve   { stamp } of the primary render you watched → docs/approvals.json
//   POST /api/films/:slug/primary/revoke    withdraw it (the renderer blocks the other formats again)
//   POST   /api/films/:slug/terminal  { runner, command?, cols, rows } or { resume } → start, resume, or reattach
//   GET    /api/films/:slug/terminal  session status + recent output
//   DELETE /api/films/:slug/terminal  kill the session
//   GET  /api/dashboard      needs you (shotlist and primary-render OKs, edited briefs, failed agents) · running agents · recent films
//   GET  /api/agents         running sessions + every film's session history (Claude and OpenCode sessions resume)
//   GET  /api/films/:slug/terminal/log  the film's transcript as plain text (escape codes stripped)
//   POST /api/films/:slug/brief/sync    copy the edited brief into a film in production (409 once delivered)
//   POST /api/films/:slug/version       delivered film + changed brief → brands/<brand>-vN/, seeded from the last version
//   GET  /api/library        brands with finished films (out/<slug>-<format>-<W>x<H>.mp4)
//   GET  /api/library/:slug  one brand's finished films with size, duration, fps
//   GET  /media/:slug/:file  a final, poster.png, contact.png, animatic.mp4 or a silent_*.mp4 render from brands/<slug>/out/ (Range for seeking; ?download=1 to save)
//   WS     /api/films/:slug/terminal/ws  live output out; { t:'i', d } input and { t:'r', cols, rows } resize in
//
// Local only: binds 127.0.0.1, answers only its own Host, writes need a same-origin Origin.
// Writes: _raw/<slug>.md, brands/<slug>/ (scaffold, docs/brief.md sync, docs/approvals.json,
// out/terminal.log, out/agent-sessions.json), brands/<brand>-vN/ (new version). Slugs are validated; nothing else is written.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { SLUG, briefTitle } from './studio/brief.mjs';
import { scaffold, gates, shotlist, approveShotlist, revokeShotlist, approvePrimary, revokePrimary, films, briefDrift, syncBrief, attention,
  makeVersion, versionInfo, versions, splitVersion } from './studio/films.mjs';
import { createTerminals } from './studio/terminal.mjs';
import { library, brand, mediaFile } from './studio/library.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, '_raw'), TEMPLATE = join(RAW, 'brief-template.md'), UI = join(ROOT, 'studio');
const RESERVED = new Set(['brief-template', '_template']);
const validSlug = (s) => typeof s === 'string' && SLUG.test(s) && !RESERVED.has(s);
const MAX_BODY = 256 * 1024;
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 4321;
// Only the UI files are served; nothing else in studio/ (tests, notes) is reachable.
const PUBLIC = { 'index.html': 'text/html; charset=utf-8', 'app.mjs': 'text/javascript', 'brief.mjs': 'text/javascript',
  'fonts/bricolage-latin.woff2': 'font/woff2', 'fonts/bricolage-latin-ext.woff2': 'font/woff2' };
// The terminal pane's browser libraries, served straight from node_modules.
const VENDOR = {
  'vendor/xterm.mjs': ['@xterm/xterm/lib/xterm.mjs', 'text/javascript'],
  'vendor/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css'],
  'vendor/addon-fit.mjs': ['@xterm/addon-fit/lib/addon-fit.mjs', 'text/javascript'],
};

// node-pty is native; if it isn't built, the rest of the studio still runs and the terminal says why.
let terminals = null, ptyError = null;
try {
  const { spawn: ptySpawn } = createRequire(import.meta.url)('node-pty');
  terminals = createTerminals({ root: ROOT, spawn: ptySpawn });
} catch (err) {
  ptyError = 'The terminal needs node-pty built: run `npm install-scripts approve node-pty && npm rebuild node-pty`, then restart the studio.';
  console.warn(`terminal disabled: ${err.message.split('\n')[0]}`);
}
const sameOrigin = (origin) => origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;

const send = (res, code, body, type = 'application/json') =>
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }).end(type === 'application/json' ? JSON.stringify(body) : body);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });   // keep draining so we can answer
    req.on('end', () => (size > MAX_BODY ? reject(new Error('too large')) : null));
    req.on('end', () => size <= MAX_BODY && resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(req, res, path) {
  if (path === '/api/template' && req.method === 'GET') return send(res, 200, await readFile(TEMPLATE, 'utf8'), 'text/markdown; charset=utf-8');

  if (path === '/api/briefs' && req.method === 'GET') {
    const names = (await readdir(RAW)).filter((f) => f.endsWith('.md') && f !== 'brief-template.md');
    const list = await Promise.all(names.map(async (f) => {
      const slug = f.slice(0, -3), file = join(RAW, f);
      // A brand's progress is its newest version's.
      const latest = validSlug(slug) ? (await versions(ROOT, slug)).at(-1) : null;
      const film = latest ? await gates(ROOT, latest.slug) : null;
      return { slug, title: briefTitle(await readFile(file, 'utf8')), modified: (await stat(file)).mtime,
        film: film && { slug: latest.slug, version: latest.version, done: film.done, total: film.gates.length,
          current: film.gates.find((g) => g.state === 'current')?.name ?? null } };
    }));
    return send(res, 200, list.sort((a, b) => b.modified - a.modified));
  }

  if (path === '/api/library' && req.method === 'GET') return send(res, 200, await library(ROOT));
  const history = (slug) => terminals?.history(slug) ?? [];
  if (path === '/api/dashboard' && req.method === 'GET') {
    const lib = await library(ROOT);
    return send(res, 200, { needs: await attention(ROOT, history), running: terminals?.live() ?? [],
      finished: lib.slice(0, 4).map((b) => ({ slug: b.slug, title: b.title, cover: b.cover, count: b.count, versions: b.versions.length, updated: b.updated })),
      terminal: terminals ? null : ptyError });
  }
  if (path === '/api/agents' && req.method === 'GET') {
    const list = await Promise.all((await films(ROOT)).map(async (slug) => ({ slug, title: await titleOf(slug), version: splitVersion(ROOT, slug).version, history: history(slug) })));
    return send(res, 200, { live: terminals?.live() ?? [], films: list, terminal: terminals ? null : ptyError });
  }
  const lib = path.match(/^\/api\/library\/([^/]+)$/);
  if (lib && req.method === 'GET') {
    const slug = decodeURIComponent(lib[1]);
    if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
    const b = await brand(ROOT, slug);
    return b ? send(res, 200, b) : send(res, 404, { error: `No finished films for ${slug} yet.` });
  }

  const one = path.match(/^\/api\/(briefs|films)\/([^/]+)$/);
  if (one && req.method === 'GET') {
    const slug = decodeURIComponent(one[2]);
    if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
    if (one[1] === 'briefs') {
      const file = join(RAW, `${slug}.md`);
      return existsSync(file) ? send(res, 200, await readFile(file, 'utf8'), 'text/markdown; charset=utf-8') : send(res, 404, { error: `_raw/${slug}.md doesn't exist.` });
    }
    const g = await gates(ROOT, slug);
    return g ? send(res, 200, { ...g, drift: await briefDrift(ROOT, slug), version: await versionInfo(ROOT, slug) })
      : send(res, 404, { error: `brands/${slug}/ doesn't exist yet.` });
  }

  if (req.method === 'POST' || req.method === 'DELETE') {
    // Same-origin only: a page on another site must not be able to write files or start agents here.
    const origin = req.headers.origin;
    if (origin && !sameOrigin(origin)) return send(res, 403, { error: 'Cross-origin request refused.' });
  }

  const sub = path.match(/^\/api\/films\/([^/]+)\/(terminal\/log|brief\/sync|version)$/);
  if (sub) {
    const slug = decodeURIComponent(sub[1]);
    if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
    if (sub[2] === 'terminal/log' && req.method === 'GET') {
      const file = join(ROOT, 'brands', slug, 'out', 'terminal.log');
      if (!existsSync(file)) return send(res, 404, { error: 'No transcript yet.' });
      return send(res, 200, plainLog(await readFile(file, 'utf8')), 'text/plain; charset=utf-8');
    }
    if (sub[2] === 'version' && req.method === 'POST') {
      const r = await makeVersion(ROOT, slug);
      if (r.status === 201) console.log(`made ${r.path} (v${r.version}, from brands/${r.previous}/)`);
      return send(res, r.status, r);
    }
    if (sub[2] === 'brief/sync' && req.method === 'POST') {
      const r = await syncBrief(ROOT, slug);
      if (r.status === 200) console.log(`synced _raw/${slug}.md → brands/${slug}/docs/brief.md`);
      return send(res, r.status, r);
    }
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const term = path.match(/^\/api\/films\/([^/]+)\/terminal$/);
  if (term) {
    const slug = decodeURIComponent(term[1]);
    if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
    if (!terminals) return send(res, 503, { error: ptyError });
    if (req.method === 'GET') { const r = terminals.get(slug); return send(res, r.status, r); }
    if (req.method === 'DELETE') { const r = terminals.kill(slug); if (r.status === 200) console.log(`killed agent for brands/${slug}/`); return send(res, r.status, r); }
    if (req.method === 'POST') {
      // A POST from a page always carries Origin; requiring it here stops non-browser-origin tricks from starting processes.
      if (!sameOrigin(req.headers.origin)) return send(res, 403, { error: 'Cross-origin request refused.' });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Request body must be JSON.' }); }
      const r = terminals.start(slug, body ?? {});
      if (r.status === 201) console.log(`started agent for brands/${slug}/: ${r.session.command}`);
      return send(res, r.status, r);
    }
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const shot = path.match(/^\/api\/films\/([^/]+)\/shotlist(?:\/(approve|revoke))?$/);
  if (shot) {
    const slug = decodeURIComponent(shot[1]);
    if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
    if (!shot[2] && req.method === 'GET') { const r = await shotlist(ROOT, slug); return send(res, r.status, r); }
    if (shot[2] && req.method === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(res, 400, { error: 'Request body must be JSON.' }); }
      const r = shot[2] === 'approve' ? await approveShotlist(ROOT, slug, body.sha256) : await revokeShotlist(ROOT, slug);
      if (r.status === 200) console.log(`${shot[2] === 'approve' ? 'approved' : 'revoked'} shotlist for brands/${slug}/`);
      return send(res, r.status, r);
    }
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const prim = path.match(/^\/api\/films\/([^/]+)\/primary\/(approve|revoke)$/);
  if (prim) {
    const slug = decodeURIComponent(prim[1]);
    if (!validSlug(slug)) return send(res, 400, { error: 'Invalid name.' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(res, 400, { error: 'Request body must be JSON.' }); }
    const r = prim[2] === 'approve' ? await approvePrimary(ROOT, slug, body.stamp) : await revokePrimary(ROOT, slug);
    if (r.status === 200) console.log(`${prim[2] === 'approve' ? 'approved' : 'revoked'} primary render for brands/${slug}/`);
    return send(res, r.status, r);
  }

  if (path === '/api/films' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Request body must be JSON.' }); }
    if (!validSlug(body?.slug)) return send(res, 400, { error: 'Invalid name.' });
    const r = await scaffold(ROOT, body.slug);
    if (r.status === 201) console.log(`scaffolded ${r.path}`);
    if (r.status === 409) r.latest = (await versions(ROOT, body.slug)).at(-1)?.slug ?? body.slug;   // Start film on an existing brand opens its newest version
    return send(res, r.status, r);
  }

  if (path === '/api/briefs' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch (e) { return e.message === 'too large' ? send(res, 413, { error: 'Brief is over 256 KB.' }) : send(res, 400, { error: 'Request body must be JSON.' }); }
    const { slug, md, overwrite } = body ?? {};
    if (!validSlug(slug))
      return send(res, 400, { error: 'Give the brand a name or folder (letters, numbers and dashes) before saving.' });
    if (typeof md !== 'string' || !md.trim()) return send(res, 400, { error: 'The brief is empty.' });
    const file = join(RAW, `${slug}.md`);
    if (existsSync(file) && overwrite !== true) return send(res, 409, { error: `_raw/${slug}.md already exists.`, path: `_raw/${slug}.md` });
    await writeFile(file, md.endsWith('\n') ? md : md + '\n', 'utf8');
    console.log(`saved _raw/${slug}.md`);
    return send(res, 200, { path: `_raw/${slug}.md` });
  }
  return send(res, 404, { error: 'Unknown endpoint.' });
}

// A brief's title, for listing films by brand name.
async function titleOf(slug) {
  for (const f of [join(ROOT, 'brands', slug, 'docs', 'brief.md'), join(RAW, `${slug}.md`)]) {
    try { const t = briefTitle(await readFile(f, 'utf8')); if (t) return t; } catch {}
  }
  return slug;
}

// Terminal transcripts are full-screen TUI output. For reading, drop escape sequences and
// carriage-return redraws, keep the text. Newest 200 KB.
function plainLog(text) {
  return text.slice(-200_000)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')          // OSC (titles, links)
    .replace(/\x1b\[[0-9;?<>=!]*[ -\/]*[@-~]/g, '')             // CSI (colors, cursor moves)
    .replace(/\x1b[()][A-Za-z0-9]|\x1b[=>78DEHMNOPZc]/g, '')
    .replace(/[^\n]*\r(?!\n)/g, '')                             // a line redrawn in place: keep the last draw
    .replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

// Finished films and posters. Byte ranges so the player can seek without loading 60 MB first.
async function media(req, res, path) {
  const m = path.match(/^\/media\/([^/]+)\/([^/]+)$/);
  const slug = m && decodeURIComponent(m[1]), name = m && decodeURIComponent(m[2]);
  const file = m && validSlug(slug) ? await mediaFile(ROOT, slug, name) : null;
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, 'Not found', 'text/plain');
  const { size } = await stat(file);
  const headers = { 'content-type': name.endsWith('.png') ? 'image/png' : 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (new URL(req.url, 'http://x').searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${name}"`;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = size - 1, code = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    code = 206; headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = end - start + 1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// DNS rebinding guard: a foreign site whose name resolves to 127.0.0.1 would otherwise be "same-origin"
// and could read briefs or terminal output. Only our own host names are answered.
const ownHost = (host) => host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
const server = createServer(async (req, res) => {
  if (!ownHost(req.headers.host)) return send(res, 421, 'Unknown host', 'text/plain');
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (path.startsWith('/media/')) return await media(req, res, path);
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (Object.hasOwn(VENDOR, file)) return send(res, 200, await readFile(join(ROOT, 'node_modules', VENDOR[file][0])), VENDOR[file][1]);
    const type = Object.hasOwn(PUBLIC, file) ? PUBLIC[file] : null;
    if (!type) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, await readFile(join(UI, file)), type);
  } catch (err) {
    if (err.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain');
    console.error(err);
    return send(res, 500, { error: 'Server error, see the terminal.' });
  }
});

// Live terminal stream. Browsers always send Origin on a websocket, so a missing or foreign one is refused.
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const m = new URL(req.url, 'http://x').pathname.match(/^\/api\/films\/([^/]+)\/terminal\/ws$/);
  let slug = null;
  try { slug = m && decodeURIComponent(m[1]); } catch {}
  if (!terminals || !validSlug(slug) || !sameOrigin(req.headers.origin) || !ownHost(req.headers.host)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const out = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
    const detach = terminals.attach(slug, { data: (d) => out({ t: 'o', d }), exit: (s) => out({ t: 'x', session: s }) });
    if (!detach) { out({ t: 'none' }); ws.close(); return; }
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.t === 'i' && typeof msg.d === 'string') terminals.write(slug, msg.d);
      else if (msg.t === 'r') terminals.resize(slug, msg.cols, msg.rows);
    });
    ws.on('close', detach);
  });
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { terminals?.killAll(); process.exit(0); });

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Studio running at ${url}  (Ctrl+C to stop)`);
  if (!argv.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref();
  }
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Try: node studio.mjs --port ${PORT + 1}` : err.message);
  process.exit(1);
});
