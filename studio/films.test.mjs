// Scaffold + gates against a throwaway copy of the factory layout (never touches brands/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold, gates, shotlist, approveShotlist, revokeShotlist, films, briefDrift, syncBrief, attention, makeVersion, splitVersion, versions } from './films.mjs';
import { execFileSync } from 'node:child_process';
import { parse, serialize } from './brief.mjs';

const REAL = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'studio-films-'));
cpSync(join(REAL, 'brands', '_template'), join(root, 'brands', '_template'), { recursive: true });
mkdirSync(join(root, '_raw'));
const TEMPLATE = readFileSync(join(REAL, '_raw', 'brief-template.md'), 'utf8');
writeFileSync(join(root, '_raw', 'brief-template.md'), TEMPLATE);

// A brief with 20s, 9:16 + 1:1, 110 BPM
const model = parse(TEMPLATE);
const blocks = model.sections.flatMap((s) => s.blocks);
const opt = (label, re) => blocks.find((b) => b.label === label).options.find((o) => re.test(o.parts[0].text)).line;
writeFileSync(join(root, '_raw', 'acme.md'), serialize(model, {
  checks: { [opt('Duration', /^20s/)]: true, [opt('Formats', /^9:16/)]: true, [opt('Formats', /^1:1/)]: true, [opt('Tempo', /^110/)]: true },
  inputs: { [model.head.title.line]: ['Acme'] },
}));
test.after(() => rmSync(root, { recursive: true, force: true }));

test('scaffold copies the template, the brief, and fills film.json', async () => {
  const r = await scaffold(root, 'acme');
  assert.equal(r.status, 201);
  for (const f of ['index.html', 'README.md', 'docs/style_guide.md', 'docs/brief.md']) assert.ok(existsSync(join(root, 'brands/acme', f)), f);
  assert.ok(existsSync(join(root, 'brands/acme/assets')) && existsSync(join(root, 'brands/acme/out')), 'empty dirs copied');
  assert.equal(readFileSync(join(root, 'brands/acme/docs/brief.md'), 'utf8'), readFileSync(join(root, '_raw/acme.md'), 'utf8'));
  const film = JSON.parse(readFileSync(join(root, 'brands/acme/film.json'), 'utf8'));
  assert.equal(film.dur, 20); assert.equal(film.bpm, 110); assert.equal(film.w, 1080); assert.equal(film.h, 1920);
  assert.deepEqual(film.formats.map((f) => f.name), ['vertical', 'square']);
  assert.equal(film.fps, 60, 'untouched template keys kept');
});

test('scaffold refuses to overwrite and needs a saved brief', async () => {
  assert.equal((await scaffold(root, 'acme')).status, 409);
  assert.equal((await scaffold(root, 'nope')).status, 404);
});

test('gates advance with the files the pipeline writes', async () => {
  const dir = join(root, 'brands/acme');
  let g = await gates(root, 'acme');
  assert.deepEqual(g.gates.map((x) => x.state), ['done', 'current', 'todo', 'todo', 'todo', 'todo', 'todo']);

  writeFileSync(join(dir, 'assets/logo.png'), 'x');
  g = await gates(root, 'acme');
  assert.equal(g.gates[1].state, 'current', 'template style guide alone is not done');
  writeFileSync(join(dir, 'docs/style_guide.md'), '# Style guide — Acme\n');
  writeFileSync(join(dir, 'docs/shotlist.md'), '# Shotlist');
  writeFileSync(join(dir, 'out/animatic.mp4'), 'x');
  writeFileSync(join(dir, 'docs/review_log.md'), '## Round 1\n## Round 2\n## round 3\n');
  g = await gates(root, 'acme');
  assert.equal(g.gates[2].state, 'current', 'a written shotlist is not done until approved');
  assert.equal(g.gates[2].approval, 'waiting');
  const r = await shotlist(root, 'acme');
  assert.equal((await approveShotlist(root, 'acme', r.sha256)).status, 200);
  g = await gates(root, 'acme');
  assert.deepEqual(g.gates.map((x) => x.state), ['done', 'done', 'done', 'done', 'current', 'todo', 'todo']);
  assert.match(g.gates[4].evidence, /3 of 4/);

  writeFileSync(join(dir, 'docs/review_log.md'), '## Round 1\n## Round 2\n## Round 3\n## Round 4\n');
  writeFileSync(join(dir, 'out/silent_vertical.mp4'), 'x');
  for (const f of ['acme-vertical-1080x1920.mp4', 'contact.png', 'poster.png']) writeFileSync(join(dir, 'out', f), 'x');
  g = await gates(root, 'acme');
  assert.equal(g.done, 7);
  assert.match(g.gates[6].evidence, /acme-vertical-1080x1920\.mp4/);
  assert.ok(g.gates.every((x) => x.updated), 'timestamps on done gates');
  assert.equal(await gates(root, 'missing'), null);
});

test('shotlist approval is tied to the exact text you read', async () => {
  const dir = join(root, 'brands/acme');
  writeFileSync(join(dir, 'docs/shotlist.md'), '# Shotlist v1\n');
  await revokeShotlist(root, 'acme');
  const v1 = await shotlist(root, 'acme');
  assert.equal(v1.approval, null);
  // the hash matches what `sha256sum` prints, so the agent can verify from the shell
  assert.equal(v1.sha256, execFileSync('sha256sum', [join(dir, 'docs/shotlist.md')], { encoding: 'utf8' }).split(' ')[0]);

  // approving a version you didn't see is refused
  assert.equal((await approveShotlist(root, 'acme', 'deadbeef')).status, 409);
  assert.equal((await approveShotlist(root, 'acme', v1.sha256)).status, 200);
  const saved = JSON.parse(readFileSync(join(dir, 'docs/approvals.json'), 'utf8'));
  assert.equal(saved.shotlist.sha256, v1.sha256);
  assert.equal((await gates(root, 'acme')).gates[2].approval, 'approved');

  // the agent edits the shotlist after approval → stale, needs your OK again
  writeFileSync(join(dir, 'docs/shotlist.md'), '# Shotlist v2\n');
  const g = await gates(root, 'acme');
  assert.equal(g.gates[2].approval, 'stale');
  assert.equal(g.gates[2].state, 'current');
  assert.equal((await shotlist(root, 'acme')).current, false);

  await revokeShotlist(root, 'acme');
  assert.equal((await gates(root, 'acme')).gates[2].approval, 'waiting');
  assert.equal((await shotlist(root, 'missing')).status, 404);
});

test('brief drift, sync, and what needs you', async () => {
  const dir = join(root, 'brands/acme');
  assert.deepEqual(await films(root), ['acme'], 'the template is not a film');
  assert.equal(await briefDrift(root, 'acme'), 'same');
  writeFileSync(join(dir, 'docs/shotlist.md'), '# Shotlist v3\n');
  await revokeShotlist(root, 'acme');
  // in production (not delivered): hide the master for this part
  renameSync(join(dir, 'out/acme-vertical-1080x1920.mp4'), join(dir, 'out/hidden.mp4'));

  const raw = readFileSync(join(root, '_raw/acme.md'), 'utf8');
  writeFileSync(join(root, '_raw/acme.md'), raw + '\nOne more note.\n');
  assert.equal(await briefDrift(root, 'acme'), 'changed');

  const hist = (slug) => (slug === 'acme' ? [{ id: 's2', state: 'exited', exitCode: 1, resumable: true }] : []);
  const items = await attention(root, hist);
  assert.deepEqual(items.map((i) => i.kind), ['shotlist', 'brief', 'agent']);
  assert.match(items[2].text, /code 1/);
  // a user-stopped agent (129) or a clean exit is not your problem
  assert.deepEqual((await attention(root, () => [{ id: 'x', state: 'exited', exitCode: 129 }])).map((i) => i.kind), ['shotlist', 'brief']);

  assert.equal((await makeVersion(root, 'acme')).status, 409, 'no v2 of a film still in production');
  assert.equal((await syncBrief(root, 'acme')).status, 200);
  assert.equal(await briefDrift(root, 'acme'), 'same');
  assert.equal(readFileSync(join(dir, 'docs/brief.md'), 'utf8'), raw + '\nOne more note.\n');
  assert.equal((await syncBrief(root, 'missing')).status, 404);
  renameSync(join(dir, 'out/hidden.mp4'), join(dir, 'out/acme-vertical-1080x1920.mp4'));
});

test('a delivered film is never synced: its brief change makes v2, seeded from v1', async () => {
  const v1 = join(root, 'brands/acme');
  writeFileSync(join(v1, 'docs/style_guide.md'), '# Style guide — Acme (researched)\n');
  writeFileSync(join(v1, 'film.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(v1, 'film.json'), 'utf8')), sub: 6 }));
  // the brief changes after delivery: 20s → 30s
  const model = parse(TEMPLATE);
  const blocks = model.sections.flatMap((x) => x.blocks);
  const opt = (label, re) => blocks.find((b) => b.label === label).options.find((o) => re.test(o.parts[0].text)).line;
  writeFileSync(join(root, '_raw/acme.md'), serialize(model, {
    checks: { [opt('Duration', /^30s/)]: true, [opt('Formats', /^9:16/)]: true, [opt('Tempo', /^110/)]: true },
    inputs: { [model.head.title.line]: ['Acme'] },
  }));
  assert.deepEqual((await attention(root)).filter((i) => i.slug === 'acme').map((i) => i.kind), ['shotlist', 'version']);
  // same brief as the delivered film → no new version
  const changed = readFileSync(join(root, '_raw/acme.md'), 'utf8');
  writeFileSync(join(root, '_raw/acme.md'), readFileSync(join(v1, 'docs/brief.md'), 'utf8'));
  assert.equal((await makeVersion(root, 'acme')).status, 409, 'no redo without a brief change');
  writeFileSync(join(root, '_raw/acme.md'), changed);
  assert.equal((await syncBrief(root, 'acme')).status, 409, 'delivered film is left as delivered');

  const r = await makeVersion(root, 'acme');
  assert.equal(r.status, 201);
  assert.equal(r.slug, 'acme-v2');
  const v2 = join(root, 'brands/acme-v2');
  assert.equal(readFileSync(join(v2, 'docs/brief.md'), 'utf8'), readFileSync(join(root, '_raw/acme.md'), 'utf8'));
  assert.ok(existsSync(join(v2, 'assets/logo.png')), 'assets carried over');
  assert.match(readFileSync(join(v2, 'docs/style_guide.md'), 'utf8'), /researched/);
  const film = JSON.parse(readFileSync(join(v2, 'film.json'), 'utf8'));
  assert.equal(film.sub, 6, 'v1 tuning kept');
  assert.equal(film.dur, 30, 'new brief applied');
  const note = readFileSync(join(v2, 'docs/previous-version.md'), 'utf8');
  assert.match(note, /brands\/acme\//);
  assert.ok(r.changes.changed.length > 0);
  assert.ok(!existsSync(join(v2, 'docs/shotlist.md')) && !existsSync(join(v2, 'docs/approvals.json')), 'shotlist and approval start fresh');
  assert.ok(!existsSync(join(v2, 'out/acme-vertical-1080x1920.mp4')), 'v1 renders not copied');

  // v2 has research already: the assets gate is done, the shotlist gate is next
  const g = await gates(root, 'acme-v2');
  assert.deepEqual(g.gates.slice(0, 3).map((x) => x.state), ['done', 'done', 'current']);
  assert.deepEqual(splitVersion(root, 'acme-v2'), { base: 'acme', version: 2 });
  assert.deepEqual(splitVersion(root, 'nobody-v2'), { base: 'nobody-v2', version: 1 }, 'a real brand called x-v2');
  assert.deepEqual((await versions(root, 'acme')).map((v) => v.slug), ['acme', 'acme-v2']);
  // drift now follows the newest version only; v1 stays quiet
  assert.equal(await briefDrift(root, 'acme-v2'), 'same');
  assert.deepEqual((await attention(root)).map((i) => `${i.slug}:${i.kind}`), ['acme:shotlist']);
  assert.equal((await makeVersion(root, 'acme')).status, 409, 'v3 waits until v2 is delivered');
  rmSync(v2, { recursive: true });
});
