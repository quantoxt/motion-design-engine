import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRefs, refType, refsMarkdown } from './refs.mjs';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

// A brief in <root>/briefs/x.md and one job folder that mirrors it (when `live` is true).
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'refs-'));
  mkdirSync(join(root, 'briefs')); writeFileSync(join(root, 'briefs', 'x.md'), '# Brief: X\n');
  const job = join(root, 'job'); mkdirSync(job);
  const state = { live: true };
  const refs = createRefs({ briefs: 'briefs', targets: async () => (state.live ? [job] : []) });
  return { root, job, refs, state, out: join(job, 'assets', 'refs') };
}

test('refType: real images and clips by their first bytes, nothing else', () => {
  assert.equal(refType(PNG), 'png'); assert.equal(refType(JPG), 'jpg');
  assert.equal(refType(Buffer.from('\0\0\0\x18ftypisom')), 'mp4');
  assert.equal(refType(Buffer.from('\0\0\0\x14ftypqt  ')), 'mov');
  assert.equal(refType(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0])), 'webm');
  assert.equal(refType(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal(refType(Buffer.from('<html>')), null);
});

test('upload: brief first, clean unique names, extension follows the real type', async () => {
  const { root, refs } = setup();
  assert.equal((await refs.add(root, 'nope', 'a.png', PNG)).status, 404);
  assert.equal((await refs.add(root, 'x', 'evil.html', Buffer.from('<html>'))).status, 415);
  assert.equal((await refs.add(root, 'x', 'My Moodboard!.PNG', PNG)).name, 'my-moodboard.png');
  assert.equal((await refs.add(root, 'x', 'my moodboard.png', PNG)).name, 'my-moodboard-2.png');
  assert.equal((await refs.add(root, 'x', 'photo.png', JPG)).name, 'photo.jpg');
  assert.deepEqual((await refs.list(root, 'x')).map((r) => r.name), ['my-moodboard.png', 'my-moodboard-2.png', 'photo.jpg'], 'upload order, not alphabetical');
  assert.equal(await refs.file(root, 'x', '../x.md'), null);
  assert.equal(await refs.file(root, 'x', 'refs.json'), null);
  assert.equal((await refs.remove(root, 'x', '../../x.md')).status, 400);
  rmSync(root, { recursive: true, force: true });
});

test('notes stay on their own file: concurrent saves, removals and refs.md order', async () => {
  const { root, refs, out } = setup();
  const names = [];
  for (const n of ['a', 'b', 'c', 'd', 'e']) names.push((await refs.add(root, 'x', `${n}.png`, PNG)).name);
  // All five saved at once: each must land on its own file, none lost.
  await Promise.all(names.map((n) => refs.setNote(root, 'x', n, `note for ${n}`)));
  assert.deepEqual((await refs.list(root, 'x')).map((r) => [r.name, r.note]), names.map((n) => [n, `note for ${n}`]));
  // Removing one takes its note with it; the others keep theirs and their order.
  await refs.remove(root, 'x', 'b.png');
  assert.deepEqual((await refs.list(root, 'x')).map((r) => [r.name, r.note]), [['a.png', 'note for a.png'], ['c.png', 'note for c.png'], ['d.png', 'note for d.png'], ['e.png', 'note for e.png']]);
  // A new file with the old name starts with no note.
  await refs.add(root, 'x', 'b.png', PNG);
  assert.equal((await refs.list(root, 'x')).at(-1).note, '');
  // refs.md: each heading followed by its own note, in list order.
  const md = readFileSync(join(out, 'refs.md'), 'utf8');
  const pairs = [...md.matchAll(/^## (\d+) · (\S+)\n.*\n\*\*Take from it:\*\* (.*)$/gm)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(pairs, [['1', 'a.png', 'note for a.png'], ['2', 'c.png', 'note for c.png'], ['3', 'd.png', 'note for d.png'], ['4', 'e.png', 'note for e.png'],
    ['5', 'b.png', 'no note. Decide what is worth taking and say why in the style guide.']]);
  assert.ok(!existsSync(join(out, 'b.png')) || readFileSync(join(out, 'b.png')).equals(PNG));
  // Notes are one line, capped, and only for files that exist.
  assert.equal((await refs.setNote(root, 'x', 'a.png', 'two\n\n## 9 · fake.png\nlines')).note, 'two ## 9 · fake.png lines');
  assert.equal((await refs.setNote(root, 'x', 'a.png', 'z'.repeat(900))).note.length, 600);
  assert.equal((await refs.setNote(root, 'x', 'gone.png', 'x')).status, 404);
  assert.equal((await refs.setNote(root, 'x', 'a.png', 42)).status, 400);
  rmSync(root, { recursive: true, force: true });
});

test('job folders: refreshed while targeted, left alone once not', async () => {
  const { root, refs, state, out } = setup();
  await refs.add(root, 'x', 'a.png', PNG);
  assert.ok(existsSync(join(out, 'a.png')) && existsSync(join(out, 'refs.md')));
  state.live = false;   // e.g. the film was delivered
  await refs.add(root, 'x', 'b.png', PNG);
  await refs.setNote(root, 'x', 'a.png', 'new note');
  assert.ok(!existsSync(join(out, 'b.png')));
  assert.doesNotMatch(readFileSync(join(out, 'refs.md'), 'utf8'), /new note/);
  state.live = true;
  await refs.remove(root, 'x', 'a.png');
  assert.ok(!existsSync(join(out, 'a.png')) && existsSync(join(out, 'b.png')));
  await refs.remove(root, 'x', 'b.png');
  assert.ok(!existsSync(join(out, 'refs.md')), 'no references, no refs.md');
  rmSync(root, { recursive: true, force: true });
});

test('a clip becomes a frame sheet the agent can read; a fake clip is refused', async () => {
  const { root, refs, out } = setup();
  const clip = join(root, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-pix_fmt', 'yuv420p', clip]);
  const r = await refs.add(root, 'x', 'Promo Cut.mp4', readFileSync(clip));
  assert.equal(r.status, 201); assert.equal(r.name, 'promo-cut.mp4');
  const [e] = await refs.list(root, 'x');
  assert.equal(e.kind, 'video'); assert.equal(e.frames, 'promo-cut.frames.png'); assert.equal(e.count, 8); assert.equal(e.duration, 4);
  assert.equal(refType(readFileSync(await refs.file(root, 'x', e.frames))), 'png');
  assert.ok(existsSync(join(out, 'promo-cut.frames.png')));
  assert.match(readFileSync(join(out, 'refs.md'), 'utf8'), /open `promo-cut\.frames\.png`, 8 frames/);
  const fake = Buffer.concat([Buffer.from('\0\0\0\x18ftypisom'), Buffer.alloc(200)]);
  assert.equal((await refs.add(root, 'x', 'fake.mp4', fake)).status, 415);
  assert.ok(!existsSync(join(refs.dir(root, 'x'), 'fake.mp4')), 'a refused clip leaves nothing behind');
  await refs.remove(root, 'x', 'promo-cut.mp4');
  assert.ok(!existsSync(join(refs.dir(root, 'x'), 'promo-cut.frames.png')) && !existsSync(join(out, 'promo-cut.frames.png')));
  rmSync(root, { recursive: true, force: true });
});

test('refsMarkdown: no references to copy, no stray text', () => {
  assert.match(refsMarkdown([]), /^# Design references/);
});
