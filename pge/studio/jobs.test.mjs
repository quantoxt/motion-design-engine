import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { addRef, removeRef, listRefs, refPath, imageType } from './jobs.mjs';
import { scaffold, gates, planFile, approvePlan, revokePlan, mediaPath, briefs, jobs, jobSettings, images, finalFiles, attention } from './jobs.mjs';
import { fingerprint } from '../lib/gate.mjs';

const PGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(join(PGE, 'brief-template.md'), 'utf8');
const brief = (title, ticks = []) => {
  let md = template.replace('# Brief: ____ (job name)', `# Brief: ${title} (job name)`);
  for (const t of ticks) md = md.replace(`- [ ] ${t}`, `- [x] ${t}`);
  return md;
};

function root() {
  const r = mkdtempSync(join(tmpdir(), 'pge-'));
  mkdirSync(join(r, 'pge', 'briefs'), { recursive: true });
  cpSync(join(PGE, '_template'), join(r, 'pge', '_template'), { recursive: true });
  return r;
}

test('jobSettings: ticked formats (first = primary) and kind', () => {
  const s = jobSettings(brief('X', ['1:1 · 1080×1080 (feed)', '9:16 · 1080×1920 (Stories / status)', 'Poster: one image, type-led, made to be read from far away']));
  assert.deepEqual(s, { formats: [{ name: 'square', w: 1080, h: 1080 }, { name: 'story', w: 1080, h: 1920 }], kind: 'poster' });
  assert.deepEqual(jobSettings(brief('Y')), {});
});

test('scaffold: copies the template, brief into docs, formats into job.json; refuses twice', async () => {
  const r = root();
  assert.equal((await scaffold(r, 'night')).status, 404);
  writeFileSync(join(r, 'pge', 'briefs', 'night.md'), brief('Night', ['4:5 · 1080×1350 (Instagram / LinkedIn feed)']));
  assert.equal((await scaffold(r, 'night')).status, 201);
  const dir = join(r, 'pge', 'jobs', 'night');
  assert.ok(existsSync(join(dir, 'index.html')));
  assert.match(readFileSync(join(dir, 'docs', 'brief.md'), 'utf8'), /# Brief: Night/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')).formats, [{ name: 'portrait', w: 1080, h: 1350 }]);
  assert.equal((await scaffold(r, 'night')).status, 409);
  const [b] = await briefs(r);
  assert.equal(b.title, 'Night');
  assert.equal(b.job.current, 'Assets and style guide');
  rmSync(r, { recursive: true, force: true });
});

test('gates follow the files; the plan approval is tied to its hash; checks go stale on edit', async () => {
  const r = root();
  writeFileSync(join(r, 'pge', 'briefs', 'n.md'), brief('N'));
  await scaffold(r, 'n');
  const dir = join(r, 'pge', 'jobs', 'n'), state = async () => Object.fromEntries((await gates(r, 'n')).gates.map((g) => [g.id, g.state]));
  assert.equal((await state()).style, 'current');
  writeFileSync(join(dir, 'docs', 'style_guide.md'), '# style');
  writeFileSync(join(dir, 'docs', 'plan.md'), '## Panel 1 · hook');
  let g = (await gates(r, 'n')).gates.find((x) => x.id === 'plan');
  assert.equal(g.approval, 'waiting');
  const p = await planFile(r, 'n');
  assert.equal(p.sha256, createHash('sha256').update('## Panel 1 · hook').digest('hex'));
  assert.equal((await approvePlan(r, 'n', 'nope')).status, 409);
  assert.equal((await approvePlan(r, 'n', p.sha256)).status, 200);
  assert.equal((await state()).plan, 'done');
  writeFileSync(join(dir, 'docs', 'plan.md'), '## Panel 1 · hook (edited)');
  g = (await gates(r, 'n')).gates.find((x) => x.id === 'plan');
  assert.equal(g.approval, 'stale');
  assert.equal((await revokePlan(r, 'n')).status, 200);
  assert.equal((await gates(r, 'n')).gates.find((x) => x.id === 'plan').approval, 'waiting');

  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(join(dir, 'out', 'check.json'), JSON.stringify({ ok: true, fingerprint: fingerprint(dir) }));
  assert.ok((await gates(r, 'n')).gates.find((x) => x.id === 'checks').done);
  writeFileSync(join(dir, 'index.html'), readFileSync(join(dir, 'index.html'), 'utf8') + '\n<!-- edit -->');
  const c = (await gates(r, 'n')).gates.find((x) => x.id === 'checks');
  assert.equal(c.done, false);
  assert.match(c.note, /changed/);

  writeFileSync(join(dir, 'docs', 'review_log.md'), '## Round 1\n## Round 2\n## Round 3\n');
  assert.equal((await gates(r, 'n')).gates.find((x) => x.id === 'critique').done, false);
  writeFileSync(join(dir, 'docs', 'review_log.md'), '## Round 1\n## Round 2\n## Round 3\n## Round 4\n');
  assert.equal((await gates(r, 'n')).gates.find((x) => x.id === 'critique').done, true);
  rmSync(r, { recursive: true, force: true });
});

test('media: PNGs under out/ only, no path tricks; job list picks a cover', async () => {
  const r = root();
  writeFileSync(join(r, 'pge', 'briefs', 'm.md'), brief('M'));
  await scaffold(r, 'm');
  const out = join(r, 'pge', 'jobs', 'm', 'out');
  mkdirSync(join(out, 'final'), { recursive: true });
  writeFileSync(join(out, 'final', 'm-portrait-01-1080x1350.png'), 'png');
  writeFileSync(join(r, 'pge', 'jobs', 'm', 'docs', 'secret.png'), 'png');
  assert.ok(mediaPath(r, 'm', 'final/m-portrait-01-1080x1350.png'));
  assert.equal(mediaPath(r, 'm', '../docs/secret.png'), null);
  assert.equal(mediaPath(r, 'm', 'final/../../docs/secret.png'), null);
  assert.equal(mediaPath(r, 'm', 'check.json'), null);
  assert.equal(mediaPath(r, 'm', 'final/missing.png'), null);
  const [j] = await jobs(r);
  assert.equal(j.cover, 'final/m-portrait-01-1080x1350.png');
  assert.equal(j.finals, 1);
  // Finals grouped by job.json format; the zip takes all or one format.
  const dir = join(r, 'pge', 'jobs', 'm');
  writeFileSync(join(dir, 'job.json'), JSON.stringify({ formats: [{ name: 'portrait', w: 1080, h: 1350 }, { name: 'square', w: 1080, h: 1080 }] }));
  writeFileSync(join(out, 'final', 'm-square-01-1080x1080.png'), 'png');
  writeFileSync(join(out, 'final', 'm-portrait-02-1080x1350.png'), 'png');
  const { byFormat } = await images(r, 'm');
  assert.deepEqual(byFormat.map((f) => [f.name, f.files.length]), [['portrait', 2], ['square', 1]]);
  assert.deepEqual((await finalFiles(r, 'm', 'square')).map((f) => f.name), ['m/square/m-square-01-1080x1080.png']);
  assert.equal((await finalFiles(r, 'm')).length, 3);
  rmSync(r, { recursive: true, force: true });
});

test('attention: plan waiting/stale and failed image agents show on Home', async () => {
  const r = root();
  writeFileSync(join(r, 'pge', 'briefs', 'a.md'), brief('A'));
  await scaffold(r, 'a');
  assert.deepEqual(await attention(r), []);
  writeFileSync(join(r, 'pge', 'jobs', 'a', 'docs', 'plan.md'), 'plan');
  const hist = () => [{ id: 's1', state: 'exited', exitCode: 1 }];
  const items = await attention(r, hist);
  assert.deepEqual(items.map((x) => [x.kind, x.image]), [['plan', true], ['image-agent', true]]);
  assert.deepEqual(await attention(r, () => [{ id: 's2', state: 'exited', exitCode: 129 }]).then((x) => x.map((i) => i.kind)), ['plan']);
  rmSync(r, { recursive: true, force: true });
});

test('design references: real images only, unique names, copied into the job and mirrored after', async () => {
  const r = root();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  assert.equal(imageType(png), 'png'); assert.equal(imageType(jpg), 'jpg');
  assert.equal(imageType(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal((await addRef(r, 'x', 'a.png', png)).status, 404, 'brief must be saved first');
  writeFileSync(join(r, 'pge', 'briefs', 'x.md'), brief('X'));
  assert.equal((await addRef(r, 'x', 'evil.html', Buffer.from('<html>'))).status, 415);
  assert.equal((await addRef(r, 'x', 'My Moodboard!.PNG', png)).name, 'my-moodboard.png');
  assert.equal((await addRef(r, 'x', 'my moodboard.png', png)).name, 'my-moodboard-2.png');
  assert.equal((await addRef(r, 'x', 'photo.png', jpg)).name, 'photo.jpg', 'extension follows the real type');
  assert.deepEqual((await listRefs(r, 'x')).map((f) => f.name), ['my-moodboard-2.png', 'my-moodboard.png', 'photo.jpg']);
  assert.equal(refPath(r, 'x', '../x.md'), null);
  await scaffold(r, 'x');
  const refs = join(r, 'pge', 'jobs', 'x', 'assets', 'refs');
  assert.ok(existsSync(join(refs, 'photo.jpg')), 'copied into the job at start');
  assert.equal((await addRef(r, 'x', 'late.png', png)).status, 201);
  assert.ok(existsSync(join(refs, 'late.png')), 'mirrored once the job exists');
  assert.equal((await removeRef(r, 'x', 'late.png')).status, 200);
  assert.ok(!existsSync(join(refs, 'late.png')));
  assert.equal((await removeRef(r, 'x', '../../x.md')).status, 400);
  rmSync(r, { recursive: true, force: true });
});
