// Scaffold + gates against a throwaway copy of the factory layout (never touches brands/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold, gates, shotlist, approveShotlist, revokeShotlist, films, briefDrift, syncBrief, attention } from './films.mjs';
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

  const raw = readFileSync(join(root, '_raw/acme.md'), 'utf8');
  writeFileSync(join(root, '_raw/acme.md'), raw + '\nOne more note.\n');
  assert.equal(await briefDrift(root, 'acme'), 'changed');

  const hist = (slug) => (slug === 'acme' ? [{ id: 's2', state: 'exited', exitCode: 1, resumable: true }] : []);
  const items = await attention(root, hist);
  assert.deepEqual(items.map((i) => i.kind), ['shotlist', 'brief', 'agent']);
  assert.match(items[2].text, /code 1/);
  // a user-stopped agent (129) or a clean exit is not your problem
  assert.deepEqual((await attention(root, () => [{ id: 'x', state: 'exited', exitCode: 129 }])).map((i) => i.kind), ['shotlist', 'brief']);

  assert.equal((await syncBrief(root, 'acme')).status, 200);
  assert.equal(await briefDrift(root, 'acme'), 'same');
  assert.equal(readFileSync(join(dir, 'docs/brief.md'), 'utf8'), raw + '\nOne more note.\n');
  assert.equal((await syncBrief(root, 'missing')).status, 404);
});
