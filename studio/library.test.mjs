// Film Library against a throwaway brands/ tree (fake mp4s: ffprobe fails, metadata is null).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finals, brand, library, mediaFile } from './library.mjs';

const root = mkdtempSync(join(tmpdir(), 'studio-lib-'));
const put = (rel, body = 'x') => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body); };
put('brands/acme-co/out/acme-co-wide-1920x1080.mp4');
put('brands/acme-co/out/acme-co-vertical-1080x1920.mp4');
put('brands/acme-co/out/acme-co-vertical-1080x1920-posting.mp4', 'xx');
put('brands/acme-co/out/silent_vertical.mp4');
put('brands/acme-co/out/animatic.mp4');
put('brands/acme-co/out/acme-vertical-1080x1920.mp4');        // another brand's name: not ours
put('brands/acme-co/out/poster.png');
put('brands/acme-co/docs/brief.md', '# Brief: Acme Co\n');
put('brands/wip/out/silent.mp4');                              // rendering, not finished
put('brands/_template/out/_template-vertical-1080x1920.mp4');
test.after(() => rmSync(root, { recursive: true, force: true }));

test('finals: masters only, paired with posting copies, vertical → wide', async () => {
  const f = await finals(root, 'acme-co');
  assert.deepEqual(f.map((v) => v.file), ['acme-co-vertical-1080x1920.mp4', 'acme-co-wide-1920x1080.mp4']);
  assert.equal(f[0].format, 'vertical');
  assert.equal(f[0].posting, 'acme-co-vertical-1080x1920-posting.mp4');
  assert.equal(f[1].posting, null);
  assert.deepEqual(await finals(root, 'wip'), []);
});

test('library lists finished brands only, with title and poster', async () => {
  const lib = await library(root);
  assert.deepEqual(lib.map((b) => b.slug), ['acme-co']);
  const b = await brand(root, 'acme-co');
  assert.equal(b.title, 'Acme Co');
  assert.equal(b.poster, 'poster.png');
  assert.equal(b.videos[0].size, 1);
  assert.equal(b.videos[0].postingSize, 2);
  assert.equal(await brand(root, 'wip'), null);
  assert.equal(await brand(root, 'missing'), null);
});

test('media: finals, poster and review files only', async () => {
  assert.ok(await mediaFile(root, 'acme-co', 'acme-co-wide-1920x1080.mp4'));
  assert.ok(await mediaFile(root, 'acme-co', 'acme-co-vertical-1080x1920-posting.mp4'));
  assert.ok(await mediaFile(root, 'acme-co', 'poster.png'));
  assert.ok(await mediaFile(root, 'acme-co', 'animatic.mp4'));
  for (const bad of ['silent_vertical.mp4', 'contact.png' /* not written in this fixture */, 'acme-vertical-1080x1920.mp4', '../docs/brief.md',
    'acme-co-wide-1920x1080.mp4/../../docs/brief.md', 'acme-co-nope-1x1.mp4', null]) {
    assert.equal(await mediaFile(root, 'acme-co', bad), null, String(bad));
  }
});
