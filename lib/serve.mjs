// Tiny static server so index.html can import ES modules (blocked on file://).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };

export function serve(root = process.cwd(), fallbacks = []) {
  const server = createServer(async (req, res) => {
    let path;
    try { path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); }
    catch { res.writeHead(400).end(); return; }       // malformed URL must not crash the render
    if (path.includes('..')) { res.writeHead(403).end(); return; }
    try {
      const file = path === '/' ? 'index.html' : path;
      let body = null;
      for (const base of [root, ...fallbacks]) {
        try { body = await readFile(join(base, file)); break; } catch { /* next */ }
      }
      if (body === null) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () =>
    r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}
