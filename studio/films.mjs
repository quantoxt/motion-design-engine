// Server-side film helpers: scaffold brands/<slug>/ from the template, and read gate
// status from the files the pipeline produces. Pure file checks, no state of its own.
import { cp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, readBack, filmSettings } from './brief.mjs';
import { finals } from './library.mjs';
import { CHECKS, readResult, primaryReview, fingerprint } from '../lib/gate.mjs';

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

// Primary render approval: you watch the primary format's render and OK it; the renderer then allows
// the other formats. The client sends the render stamp it showed you, so you only approve what you saw.
export async function approvePrimary(root, slug, seenStamp) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
  const r = primaryReview(dir);
  if (r.state === 'missing') return { status: 404, error: `No primary render yet (out/${r.primary.file}).` };
  if (seenStamp !== r.stamp) return { status: 409, error: 'The primary render changed since you loaded it. Watch the new one, then approve.' };
  const approvals = await readApprovals(dir);
  approvals.primary = { approved: true, file: r.primary.file, stamp: r.stamp, fingerprint: fingerprint(dir), at: new Date().toISOString() };
  await writeFile(join(dir, 'docs', 'approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
  return { status: 200, approval: approvals.primary };
}

export async function revokePrimary(root, slug) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
  const approvals = await readApprovals(dir);
  delete approvals.primary;
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

  // Machine checks (check.mjs + holds.mjs results on the current code). A film rendered before the checks
  // existed has neither result and no skip record: shown as not run, not as blocking.
  const results = CHECKS.map((n) => readResult(dir, n));
  let skipped = null;
  try { skipped = JSON.parse(await readFile(join(dir, 'out', 'render-gate.json'), 'utf8')); } catch {}
  const legacy = silents.length > 0 && !skipped && results.every((r) => r.state === 'missing');
  const checksPassed = results.every((r) => r.state === 'passed');
  const firstFail = (r) => {
    const fs = r.name === 'check' ? Object.values(r.result.formats ?? {}).flatMap((f) => f.failures) : [...(r.result.pops ?? []), ...(r.result.holds ?? [])];
    const n = fs.length, f = fs[0];
    const what = !f ? '' : f.msg ? `: ${f.t != null ? `${f.t.toFixed(2)}s ` : ''}${f.msg}` : f.dur != null ? `: hold ${f.from}–${f.to}s` : `: pop at ${f.t}s`;
    return `${n} problem${n === 1 ? '' : 's'}${what}`;
  };
  const checkEvidence = legacy ? 'not run: this film was rendered before the machine checks existed'
    : [...results.map((r) => `${r.name}.mjs ${(r.state === 'failed' ? firstFail(r) : { missing: 'not run yet', stale: 'out of date (the film changed since)', passed: 'passed' }[r.state])}`),
      ...(skipped ? [`full render forced with --skip-checks (${skipped.at})`] : [])].join(' · ');

  // Primary render review (lib/gate.mjs) and the formats still to render.
  const primRev = primaryReview(dir);
  const primaryDone = primRev.state === 'approved' || legacy;
  let filmJson = {};
  try { filmJson = JSON.parse(await readFile(join(dir, 'film.json'), 'utf8')); } catch {}
  const formatsLeft = (filmJson.formats ?? []).map((f) => f.name).filter((n) => !silents.includes(`silent_${n}.mp4`));

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
    { id: 'checks', name: 'Machine checks', done: checksPassed || legacy, evidence: checkEvidence,
      note: checksPassed || legacy ? null : 'Geometry (check.mjs) and pops/holds (holds.mjs) must pass on the current code before the full render starts.' },
    { id: 'primary', name: 'Primary render', done: primaryDone, approval: legacy ? undefined : primRev.state, file: primRev.primary.file, stamp: primRev.stamp,
      evidence: legacy ? 'not reviewed: this film was rendered before the primary review existed'
        : { missing: `out/${primRev.primary.file} not rendered yet`, waiting: `out/${primRev.primary.file} · waiting for your OK`,
          stale: `out/${primRev.primary.file} · re-rendered or the film changed since you approved it, needs your OK again`,
          approved: `out/${primRev.primary.file} · approved by you` }[primRev.state],
      note: primaryDone ? null : `Watch the ${primRev.primary.name ?? 'primary'} render and approve it. The other formats only render after your OK.` },
    { id: 'render', name: 'All formats', done: primaryDone && formatsLeft.length === 0,
      evidence: formatsLeft.length ? `still to render: ${formatsLeft.map((f) => `out/silent_${f}.mp4`).join(', ')}` : silents.map((f) => `out/${f}`).join(', ') || 'out/silent.mp4' },
    { id: 'final', name: 'Final delivery', done: masters.length > 0 && has('contact.png') && has('poster.png'),
      evidence: [masters.length ? `✓ ${masters.map((m) => m.file).join(', ')}` : `· ${slug}-<format>-<W>x<H>.mp4`,
        ...['contact.png', 'poster.png'].map((f) => `${has(f) ? '✓' : '·'} ${f}`)].join('  ') },
  ];
  const paths = { brief: 'docs/brief.md', assets: 'docs/style_guide.md', shotlist: 'docs/shotlist.md', animatic: 'out/animatic.mp4',
    critique: 'docs/review_log.md', checks: legacy && silents[0] ? `out/${silents[0]}` : 'out/check.json',
    primary: `out/${primRev.primary.file}`, render: silents[0] ? `out/${silents[0]}` : 'out/silent.mp4', final: masters[0] ? `out/${masters[0].file}` : 'out/poster.png' };
  let current = false;
  for (const g of list) {
    g.updated = g.done ? (g.id === 'shotlist' ? approval.at : g.id === 'primary' && primRev.approval?.at && !legacy ? primRev.approval.at
      : await mtime(join(dir, paths[g.id]))) : null;
    g.state = g.done ? 'done' : current ? 'todo' : 'current';
    if (!g.done) current = true;
  }
  return { slug, path: `brands/${slug}/`, gates: list, done: list.filter((g) => g.done).length };
}

// ── Versions ─────────────────────────────────────────────────────
// A brand has one brief (_raw/<brand>.md) and one or more films: brands/<brand>/ is v1,
// brands/<brand>-v2/, -v3/… are later versions made after a delivered film's brief changed.
// `<x>-vN` counts as a version only if brands/<x>/ exists, so a brand that is really called
// "acme-v2" still works on its own.
export function splitVersion(root, slug) {
  const m = slug.match(/^(.+)-v(\d+)$/);
  if (m && Number(m[2]) >= 2 && existsSync(join(root, 'brands', m[1]))) return { base: m[1], version: Number(m[2]) };
  return { base: slug, version: 1 };
}
const versionSlug = (base, n) => (n === 1 ? base : `${base}-v${n}`);

// Every film folder of a brand, oldest first: [{ slug, version }].
export async function versions(root, base) {
  let names = [];
  try { names = (await readdir(join(root, 'brands'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  const out = [];
  if (names.includes(base)) out.push({ slug: base, version: 1 });
  for (const n of names) {
    const m = n.startsWith(`${base}-v`) && n.slice(base.length).match(/^-v(\d+)$/);
    if (m && Number(m[1]) >= 2 && out.length) out.push({ slug: n, version: Number(m[1]) });
  }
  return out.sort((a, b) => a.version - b.version);
}

// Every film folder (brands/<slug>/ with a docs/brief.md), `_`-folders skipped.
export async function films(root) {
  try {
    return (await readdir(join(root, 'brands'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && existsSync(join(root, 'brands', d.name, 'docs', 'brief.md')))
      .map((d) => d.name);
  } catch { return []; }
}

const briefSource = (root, slug) => join(root, '_raw', `${splitVersion(root, slug).base}.md`);
const delivered = async (root, slug) => (await gates(root, slug))?.gates.at(-1).done ?? false;

// Has the brand's brief been edited since this film took its copy?
// 'same' | 'changed' | 'no-source' (no _raw/<brand>.md to compare against)
export async function briefDrift(root, slug) {
  const raw = await read(briefSource(root, slug));
  const copy = await read(join(root, 'brands', slug, 'docs', 'brief.md'));
  if (raw == null || copy == null) return 'no-source';
  return raw === copy ? 'same' : 'changed';
}

// Copy the edited brief into a film that's still in production. Only docs/brief.md changes:
// film.json may have been tuned by the agent since, so it's left alone. A delivered film is
// never changed: make a new version instead.
export async function syncBrief(root, slug) {
  const dir = join(root, 'brands', slug);
  if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
  const raw = await read(briefSource(root, slug));
  if (raw == null) return { status: 404, error: `_raw/${splitVersion(root, slug).base}.md doesn't exist.` };
  if (await delivered(root, slug)) return { status: 409, error: 'This film is delivered. Make a new version instead, so the delivered one stays as it is.' };
  await writeFile(join(dir, 'docs', 'brief.md'), raw);
  return { status: 200 };
}

// Split a brief into its ## sections, to say which ones changed between versions.
function sections(md) {
  const out = new Map();
  let head = '(top)', body = [];
  for (const line of (md ?? '').split('\n')) {
    if (/^## /.test(line)) { out.set(head, body.join('\n').trim()); head = line.slice(3).trim(); body = []; }
    else body.push(line);
  }
  out.set(head, body.join('\n').trim());
  return out;
}
export function briefChanges(oldMd, newMd) {
  const a = sections(oldMd), b = sections(newMd);
  const changed = [], added = [], removed = [], same = [];
  for (const [h, t] of b) (!a.has(h) ? added : a.get(h) === t ? same : changed).push(h);
  for (const h of a.keys()) if (!b.has(h)) removed.push(h);
  return { changed, added, removed, same };
}

// Make the next version of a delivered film whose brief has changed (unchanged brief → 409): brands/<brand>-vN/ from the current brief, seeded
// with the previous version's research (assets/, style guide, docs/lessons.md, film.json tuning) so the agent
// doesn't redo it, plus docs/previous-version.md saying where v(N-1) is and what changed.
export async function makeVersion(root, slug) {
  const { base } = splitVersion(root, slug);
  const all = await versions(root, base);
  if (!all.length) return { status: 404, error: `brands/${base}/ doesn't exist.` };
  const prev = all.at(-1);
  if (!(await delivered(root, prev.slug))) {
    return { status: 409, error: `${prev.slug} isn’t delivered yet. Sync the brief into it instead.`, latest: prev.slug };
  }
  const raw = await read(join(root, '_raw', `${base}.md`));
  if (raw == null) return { status: 404, error: `_raw/${base}.md doesn't exist.` };
  // Only a brief change makes a new version: same brief, same film.
  if (raw === await read(join(root, 'brands', prev.slug, 'docs', 'brief.md'))) {
    return { status: 409, error: `The brief hasn’t changed since ${prev.slug}. Edit the brief first; a new version only applies brief changes.`, latest: prev.slug };
  }
  const version = prev.version + 1, next = versionSlug(base, version);
  const src = join(root, 'brands', prev.slug), dest = join(root, 'brands', next);
  if (existsSync(dest)) return { status: 409, error: `brands/${next}/ already exists.`, latest: next };

  await cp(join(root, 'brands', '_template'), dest, { recursive: true, errorOnExist: true, force: false });
  await writeFile(join(dest, 'docs', 'brief.md'), raw);
  // Research carried over: assets, the style guide and lessons (the agent replaces what no longer fits).
  if (existsSync(join(src, 'assets'))) await cp(join(src, 'assets'), join(dest, 'assets'), { recursive: true, force: true });
  const guide = await read(join(src, 'docs', 'style_guide.md'));
  if (guide != null) await writeFile(join(dest, 'docs', 'style_guide.md'), guide);
  const lessons = await read(join(src, 'docs', 'lessons.md'));
  if (lessons != null) await writeFile(join(dest, 'docs', 'lessons.md'), lessons);
  // film.json: the previous version's tuning, with the new brief's duration/formats/tempo on top.
  const model = parse(await readFile(join(root, '_raw', 'brief-template.md'), 'utf8'));
  let film;
  try { film = JSON.parse(await readFile(join(src, 'film.json'), 'utf8')); } catch { film = JSON.parse(await readFile(join(dest, 'film.json'), 'utf8')); }
  await writeFile(join(dest, 'film.json'), JSON.stringify({ ...film, ...filmSettings(model, readBack(model, raw).state) }, null, 2) + '\n');

  const diff = briefChanges(await read(join(src, 'docs', 'brief.md')), raw);
  const assetCount = (await files(join(dest, 'assets'))).length;
  const list = (xs) => (xs.length ? xs.join(' · ') : 'none');
  await writeFile(join(dest, 'docs', 'previous-version.md'), `# v${version} of ${base}

This film is a new version. The previous one is **brands/${prev.slug}/** (v${prev.version}, delivered).
Read it, never write to it.

## Carried over (reuse what still fits the new brief, replace what doesn't)
- \`assets/\`: ${assetCount} file${assetCount === 1 ? '' : 's'} copied from v${prev.version}
- \`docs/style_guide.md\` ${guide == null ? '(v' + prev.version + ' had none: write it)' : 'copied from v' + prev.version}
- \`film.json\`: v${prev.version}'s settings, with this brief's duration, formats and tempo applied

Also worth reading in brands/${prev.slug}/: \`docs/shotlist.md\`, \`index.html\`, \`docs/review_log.md\`.

## What changed in the brief since v${prev.version}
- Changed: ${list(diff.changed)}
- Added: ${list(diff.added)}
- Removed: ${list(diff.removed)}

## What to do
Run the full pipeline for v${version}: read \`docs/lessons.md\` first, check the carried-over assets and style guide against the
changes above, then a new shotlist (it needs a fresh approval), animatic, critique, render, finalize.
Finals are named \`${next}-<format>-<W>x<H>.mp4\`. Say which parts of v${prev.version} you're reusing.
`);
  return { status: 201, path: `brands/${next}/`, slug: next, version, previous: prev.slug, changes: diff };
}

// What needs the user, across films: shotlists waiting for an OK, briefs edited after the
// film started (newest version of each brand only), and agents that stopped on an error or
// were cut off by a studio restart. `history(slug)` comes from the terminal manager.
export async function attention(root, history = () => []) {
  const items = [];
  const all = await films(root);
  const latest = new Map();   // brand → newest version's slug
  for (const slug of all) {
    const { base, version } = splitVersion(root, slug);
    const cur = latest.get(base);
    if (!cur || version > cur.version) latest.set(base, { slug, version });
  }
  for (const slug of all) {
    const g = await gates(root, slug);
    const shot = g.gates.find((x) => x.id === 'shotlist');
    if (shot.approval === 'waiting' || shot.approval === 'stale') {
      items.push({ slug, kind: 'shotlist', key: `shotlist:${slug}:${shot.approval}`,
        text: shot.approval === 'stale' ? 'Shotlist changed after you approved it. It needs your OK again.' : 'Shotlist is ready for your OK.' });
    }
    if (latest.get(splitVersion(root, slug).base).slug === slug && await briefDrift(root, slug) === 'changed') {
      items.push(g.gates.at(-1).done
        ? { slug, kind: 'version', key: `version:${slug}`, text: 'You edited the brief after this film was delivered. Make a new version to apply it.' }
        : { slug, kind: 'brief', key: `brief:${slug}`, text: 'You edited the brief after the film started. The film still has the old copy.' });
    }
    const prim = g.gates.find((x) => x.id === 'primary');
    if (prim.approval === 'waiting' || prim.approval === 'stale') {
      items.push({ slug, kind: 'primary', key: `primary:${slug}:${prim.stamp}`,
        text: prim.approval === 'stale' ? 'The primary render changed after you approved it. Watch it again.' : 'The primary render is ready: watch it, then approve the other formats.' });
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

// Version info for a film page: which version it is, its siblings, and whether it's delivered.
export async function versionInfo(root, slug) {
  const { base, version } = splitVersion(root, slug);
  const all = await versions(root, base);
  return { base, version, versions: all, latest: all.at(-1)?.slug === slug, delivered: await delivered(root, slug) };
}
