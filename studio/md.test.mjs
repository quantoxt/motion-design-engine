// node --test studio/md.test.mjs   (markdown → HTML for the shotlist panel)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { renderMarkdown as md } from './md.mjs';

test('headings shift down one level, inline marks render', () => {
  assert.equal(md('# Title'), '<h2>Title</h2>');
  assert.equal(md('## A **b** `c`'), '<h3>A <strong>b</strong> <code>c</code></h3>');
});

test('paragraph lines join; lists nest one level', () => {
  assert.equal(md('one\ntwo'), '<p>one two</p>');
  assert.equal(md('- a\n- b\n  - c\n  - d\n- e'),
    '<ul><li>a</li><li>b<ul><li>c</li><li>d</li></ul></li><li>e</li></ul>');
  assert.equal(md('1. x\n2. y'), '<ol><li>x</li><li>y</li></ol>');
  assert.equal(md('- a\n  more'), '<ul><li>a more</li></ul>');
});

test('tables, quotes, rules', () => {
  const t = md('| A | B |\n|---|:-:|\n| 1 | **2** |');
  assert.match(t, /<th>A<\/th><th>B<\/th>/);
  assert.match(t, /<td>1<\/td><td><strong>2<\/strong><\/td>/);
  assert.equal(md('> hi'), '<blockquote><p>hi</p></blockquote>');
  assert.equal(md('---'), '<hr>');
});

test('HTML in the file is escaped, never injected', () => {
  const h = md('# <img src=x onerror=alert(1)>\n<script>x</script>\n| <b> |\n|---|\n| <i> |');
  assert.ok(!/<(img|script|b|i)[ >]/.test(h), h);
  assert.match(h, /&lt;script&gt;/);
});

test('odd input terminates', () => {
  assert.equal(md('| lone pipe'), '<p>| lone pipe</p>');
  assert.equal(md(''), '');
});

test('every real shotlist renders without leftover heading marks', () => {
  const root = new URL('../brands/', import.meta.url);
  for (const b of readdirSync(root)) {
    const f = new URL(`${b}/docs/shotlist.md`, root);
    if (!existsSync(f)) continue;
    const h = md(readFileSync(f, 'utf8'));
    assert.ok(!/>#{1,6} /.test(h), `${b}: raw heading left`);
    assert.ok(!/\|---/.test(h), `${b}: raw table rule left`);
  }
});
