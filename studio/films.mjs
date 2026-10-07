// Server-side film helpers: scaffold brands/<slug>/ from the template, and read gate
// status from the files the pipeline produces. Pure file checks, no state of its own.
import { cp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, readBack, filmSettings } from './brief.mjs';
import { finals } from './library.mjs';

const mtime = async (p) => { try { return (await stat(p)).mtime.toISOString(); } catch { return null; } };
const files = async (dir) => { try { return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name); } catch { return []; } };
const read = async (p) => { try { return await readFile(p, 'utf8'); } catch { return null; } };
// Same value as `sha256sum docs/shotlist.md`, so the agent can check an approval from the shell.
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const readApprovals = async (dir) => { try { return JSON.parse(await readFile(join(dir, 'docs', 'approvals.json'), 'utf8')); } catch { return {}; } };

// Shotlist approval: records the hash of the exact file you read. If the shotlist changes
// afterwards, the approval no longer matches and the gate asks for your OK again.
export async function shotlist(root, slug) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
  const text = await read(join(dir, 'docs', 'shotlist.md'));
  if (text == null) return { status: 404, error: 'No shotlist yet. The agent writes docs/shotlist.md after the assets and style guide.' };
  const approval = (await readApprovals(dir)).shotlist ?? null;
  return { status: 200, text, sha256: sha256(text), approval, current: approval?.sha256 === sha256(text) };
}

export async function approveShotlist(root, slug, seenSha) {
  const r = await shotlist(root, slug);
  if (r.status !== 200) return r;
  // Only approve what you actually read: the client sends the hash of the version it displayed.
  if (seenSha !== r.sha256) return { status: 409, error: 'The shotlist changed since you opened it. Read the new version, then approve.' };
  const dir = join(root, 'brands', slug);
  const approvals = await readApprovals(dir);
  approvals.shotlist = { approved: true, sha256: r.sha256, at: new Date().toISOString() };
  await writeFile(join(dir, 'docs', 'approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
  return { status: 200, approval: approvals.shotlist };
}

export async function revokeShotlist(root, slug) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
  const approvals = await readApprovals(dir);
  delete approvals.shotlist;
  await writeFile(join(dir, 'docs', 'approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
  return { status: 200 };
}

// Copy brands/_template → brands/<slug>, put the brief in docs/brief.md, and fill
// film.json from the brief (duration, formats, tempo). Refuses to touch an existing folder.
export async function scaffold(root, slug) {
  const brief = join(root, '_raw', `${slug}.md`), dest = join(root, 'brands', slug);
  if (!existsSync(brief)) return { status: 404, error: `_raw/${slug}.md doesn't exist. Save the brief first.` };
  if (existsSync(dest)) return { status: 409, error: `brands/${slug}/ already exists.` };
  await cp(join(root, 'brands', '_template'), dest, { recursive: true, errorOnExist: true, force: false });
  const md = await readFile(brief, 'utf8');
  await writeFile(join(dest, 'docs', 'brief.md'), md);
  const template = await readFile(join(root, '_raw', 'brief-template.md'), 'utf8');
  const model = parse(template);
  const settings = filmSettings(model, readBack(model, md).state);
  const film = JSON.parse(await readFile(join(dest, 'film.json'), 'utf8'));
  await writeFile(join(dest, 'film.json'), JSON.stringify({ ...film, ...settings }, null, 2) + '\n');
  return { status: 201, path: `brands/${slug}/`, settings };
}

// Gate status, in pipeline order. Each gate: done when its evidence exists.
// The first unfinished gate is "current"; everything after it is "todo".
export async function gates(root, slug) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return null;
  const tplGuide = await read(join(root, 'brands', '_template', 'docs', 'style_guide.md'));
  const guide = await read(join(dir, 'docs', 'style_guide.md'));
  const assets = await files(join(dir, 'assets'));
  const out = await files(join(dir, 'out'));
  const review = await read(join(dir, 'docs', 'review_log.md'));
  const rounds = review ? (review.match(/^#{1,4}\s*round\b/gim) ?? []).length : 0;
  const silents = out.filter((f) => /^silent(_.+)?\.mp4$/.test(f));
  const has = (f) => out.includes(f);
  const masters = await finals(root, slug);
  const shot = await read(join(dir, 'docs', 'shotlist.md'));
  const approval = (await readApprovals(dir)).shotlist;
  const approved = shot != null && approval?.sha256 === sha256(shot);
  const shotState = shot == null ? 'missing' : approved ? 'approved' : approval ? 'stale' : 'waiting';

  const list = [
    { id: 'brief', name: 'Brief', done: existsSync(join(dir, 'docs', 'brief.md')), evidence: 'docs/brief.md' },
    { id: 'assets', name: 'Assets & style guide', done: assets.length > 0 && guide != null && guide !== tplGuide,
      evidence: `${assets.length} asset${assets.length === 1 ? '' : 's'} · docs/style_guide.md ${guide === tplGuide ? 'not written yet' : 'written'}` },
    { id: 'shotlist', name: 'Shotlist', done: approved, approval: shotState,
      evidence: { missing: 'docs/shotlist.md not written yet', waiting: 'docs/shotlist.md · waiting for your OK',
        stale: 'docs/shotlist.md · changed after you approved it, needs your OK again', approved: 'docs/shotlist.md · approved by you' }[shotState],
      note: shotState === 'missing' ? 'Once it’s written, read it here and approve it. The agent won’t write code before that.' : null },
    { id: 'animatic', name: 'Animatic', done: has('animatic.mp4'), evidence: 'out/animatic.mp4' },
    { id: 'critique', name: 'Critique rounds', done: rounds >= 4, evidence: `docs/review_log.md · ${rounds} of 4 rounds` },
    { id: 'render', name: 'Full render', done: silents.length > 0, evidence: silents.length ? silents.map((f) => `out/${f}`).join(', ') : 'out/silent.mp4' },
    { id: 'final', name: 'Final delivery', done: masters.length > 0 && has('contact.png') && has('poster.png'),
      evidence: [masters.length ? `✓ ${masters.map((m) => m.file).join(', ')}` : `· ${slug}-<format>-<W>x<H>.mp4`,
        ...['contact.png', 'poster.png'].map((f) => `${has(f) ? '✓' : '·'} ${f}`)].join('  ') },
  ];
  const paths = { brief: 'docs/brief.md', assets: 'docs/style_guide.md', shotlist: 'docs/shotlist.md', animatic: 'out/animatic.mp4',
    critique: 'docs/review_log.md', render: silents[0] ? `out/${silents[0]}` : 'out/silent.mp4', final: masters[0] ? `out/${masters[0].file}` : 'out/poster.png' };
  let current = false;
  for (const g of list) {
    g.updated = g.done ? (g.id === 'shotlist' ? approval.at : await mtime(join(dir, paths[g.id]))) : null;
    g.state = g.done ? 'done' : current ? 'todo' : 'current';
    if (!g.done) current = true;
  }
  return { slug, path: `brands/${slug}/`, gates: list, done: list.filter((g) => g.done).length };
}

// Every film folder (brands/<slug>/ with a docs/brief.md), `_`-folders skipped.
export async function films(root) {
  try {
    return (await readdir(join(root, 'brands'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && existsSync(join(root, 'brands', d.name, 'docs', 'brief.md')))
      .map((d) => d.name);
  } catch { return []; }
}

// Has the brief in _raw/ been edited since the film took its copy?
// 'same' | 'changed' | 'no-source' (no _raw/<slug>.md to compare against)
export async function briefDrift(root, slug) {
  const raw = await read(join(root, '_raw', `${slug}.md`));
  const copy = await read(join(root, 'brands', slug, 'docs', 'brief.md'));
  if (raw == null || copy == null) return 'no-source';
  return raw === copy ? 'same' : 'changed';
}

// Copy the edited brief into the film. Only docs/brief.md changes: film.json may have been
// tuned by the agent since, so it's left alone (the agent re-reads the brief and adjusts).
export async function syncBrief(root, slug) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
  const raw = await read(join(root, '_raw', `${slug}.md`));
  if (raw == null) return { status: 404, error: `_raw/${slug}.md doesn't exist.` };
  await writeFile(join(dir, 'docs', 'brief.md'), raw);
  return { status: 200 };
}

// What needs the user, across films: shotlists waiting for an OK, briefs edited after the
// film started, and agents that stopped on an error or were cut off by a studio restart.
// `history(slug)` comes from the terminal manager (newest first), optional.
export async function attention(root, history = () => []) {
  const items = [];
  for (const slug of await films(root)) {
    const g = await gates(root, slug);
    const shot = g.gates.find((x) => x.id === 'shotlist');
    if (shot.approval === 'waiting' || shot.approval === 'stale') {
      items.push({ slug, kind: 'shotlist', key: `shotlist:${slug}:${shot.approval}`,
        text: shot.approval === 'stale' ? 'Shotlist changed after you approved it. It needs your OK again.' : 'Shotlist is ready for your OK.' });
    }
    if (await briefDrift(root, slug) === 'changed') {
      items.push({ slug, kind: 'brief', key: `brief:${slug}`, text: 'You edited the brief after the film started. The film still has the old copy.' });
    }
    const last = history(slug)[0];
    if (last && (last.state === 'interrupted' || (last.state === 'exited' && last.exitCode !== 0 && last.exitCode !== 129))) {
      items.push({ slug, kind: 'agent', key: `agent:${slug}:${last.id}`,
        text: last.state === 'interrupted' ? 'The agent was cut off when the studio stopped.' : `The agent exited with code ${last.exitCode}.`,
        resumable: last.resumable, session: last.id });
    }
  }
  return items;
}
