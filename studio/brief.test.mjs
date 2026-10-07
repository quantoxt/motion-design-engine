// node --test studio/   (no browser: parser + serializer + server checks)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, serialize, slugFor, slugify, SLUG } from './brief.mjs';

const TEMPLATE = readFileSync(new URL('../_raw/brief-template.md', import.meta.url), 'utf8');
const model = parse(TEMPLATE);
const all = model.sections.flatMap((s) => s.blocks);
const choices = all.filter((b) => b.type === 'choice');
const fields = all.filter((b) => b.type === 'field');
const findChoice = (label) => choices.find((c) => c.label === label);
const findField = (text) => fields.find((f) => f.parts.some((p) => p.text?.includes(text)));

test('template parses into the expected sections', () => {
  assert.equal(model.sections.length, 10);
  assert.deepEqual(model.sections.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(model.sections[0].title, /Source/);
  assert.ok(model.head.title, 'title field');
});

test('choice groups: single vs multi', () => {
  assert.equal(findChoice('Pattern').multi, false);
  assert.equal(findChoice('Formats').multi, true);           // *(any; …)*
  assert.equal(findChoice('Mood').multi, true);              // *(pick up to 3)*
  assert.equal(findChoice('Where it will be posted').multi, true);
  assert.ok(choices.every((c) => c.options.length > 0), 'no empty groups');
  // every labelled group offers an agent-decides escape hatch
  const labelled = choices.filter((c) => c.label);
  const missing = labelled.filter((c) => !c.options.some((o) => o.parts.some((p) => /agent/i.test(p.text ?? ''))));
  assert.deepEqual(missing.map((c) => c.label), []);
});

test('`____` mentioned in instructions is text, not an input', () => {
  const fake = fields.filter((f) => f.parts.some((p) => /leave|Leave/.test(p.text ?? '')));
  assert.deepEqual(fake.map((f) => f.line), []);
  const folder = findField('Brand folder');
  assert.equal(folder.blanks, 1, 'brands/____ is still a field');
});

test('labels followed by text fields become subheadings', () => {
  const subs = all.filter((b) => b.type === 'subhead').map((b) => b.label);
  assert.ok(subs.some((l) => /Optional pointers/.test(l)));
  assert.ok(subs.some((l) => /Features to show/.test(l)));
});

test('agent notes are hidden from the form', () => {
  const text = JSON.stringify(model.sections);
  assert.ok(!text.includes('Notes for the agent'));
});

test('untouched form serializes back to the identical template', () => {
  assert.equal(serialize(model, { checks: {}, inputs: {} }), TEMPLATE.replace(/\r\n/g, '\n'));
});

test('answers land on the right lines, nothing else changes', () => {
  const pattern = findChoice('Pattern'), dur = findChoice('Duration');
  const other = dur.options.find((o) => o.blanks === 1);
  const site = findField('Website URL');
  const state = {
    checks: { [pattern.options[0].line]: true, [other.line]: true },
    inputs: { [model.head.title.line]: ['Acme  Rockets\n'], [site.line]: ['https://acme.dev'], [other.line]: ['25s'] },
  };
  const out = serialize(model, state).split('\n');
  const src = TEMPLATE.replace(/\r\n/g, '\n').split('\n');
  assert.equal(out.length, src.length);
  assert.equal(out[model.head.title.line], '# Brief: Acme Rockets (brand name)');   // whitespace/newlines collapsed
  assert.equal(out[pattern.options[0].line], src[pattern.options[0].line].replace('[ ]', '[x]'));
  assert.equal(out[other.line], '- [x] Other: 25s');
  assert.equal(out[site.line], '**Website URL:** https://acme.dev');
  const changed = out.map((l, i) => (l !== src[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(changed.sort((a, b) => a - b), [model.head.title.line, site.line, pattern.options[0].line, other.line].sort((a, b) => a - b));
});

test('lines with two blanks fill in order', () => {
  const proof = findField('Proof number');
  const out = serialize(model, { checks: {}, inputs: { [proof.line]: ['3.3 weeks', '/api/stats'] } }).split('\n')[proof.line];
  assert.equal(out, '**Proof number (the one stat):** 3.3 weeks · **source:** /api/stats');
});

test('file name comes from the brand folder, falls back to brand name', () => {
  const folder = findField('Brand folder');
  assert.equal(slugFor(model, { inputs: { [model.head.title.line]: ['Acme Rockets'] } }), 'acme-rockets');
  assert.equal(slugFor(model, { inputs: { [model.head.title.line]: ['Acme'], [folder.line]: ['acme_v2'] } }), 'acme-v2');
  assert.equal(slugFor(model, { inputs: {} }), '');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('Café Ünïcode!'), 'cafe-unicode');
  assert.ok(SLUG.test('acme-v2') && !SLUG.test('-x') && !SLUG.test('a/b') && !SLUG.test(''));
});

import { readBack, filmSettings, briefTitle } from './brief.mjs';

test('reopen: a saved brief reads back into the same answers', () => {
  const pattern = findChoice('Pattern'), formats = findChoice('Formats'), dur = findChoice('Duration');
  const other = dur.options.find((o) => o.blanks === 1), proof = findField('Proof number');
  const state = {
    checks: { [pattern.options[1].line]: true, [formats.options[0].line]: true, [formats.options[2].line]: true, [other.line]: true },
    inputs: { [model.head.title.line]: ['Acme'], [proof.line]: ['3.3 weeks', ''], [other.line]: ['25s'] },
  };
  const { state: back, missed } = readBack(model, serialize(model, state));
  assert.equal(missed, 0);
  // same ticks
  const ticked = (s) => Object.entries(s.checks).filter(([, v]) => v).map(([k]) => +k).sort((a, b) => a - b);
  assert.deepEqual(ticked(back), ticked(state));
  // same answers; an unanswered blank reads back as ''
  assert.deepEqual(back.inputs[model.head.title.line], ['Acme']);
  assert.deepEqual(back.inputs[proof.line], ['3.3 weeks', '']);
  assert.deepEqual(back.inputs[other.line], ['25s']);
  // and saving it again changes nothing
  assert.equal(serialize(model, back), serialize(model, state));
});

test('reopen survives a template edit (lines shifted)', () => {
  const site = findField('Website URL'), pattern = findChoice('Pattern');
  const saved = serialize(model, { checks: { [pattern.options[0].line]: true }, inputs: { [site.line]: ['https://a.dev'] } });
  const newer = parse(TEMPLATE.replace('## 1. Source', 'A new intro line.\n\n## 1. Source'));   // +2 lines
  const { state, missed } = readBack(newer, saved);
  assert.equal(missed, 0);
  const nSite = newer.sections[0].blocks.find((b) => b.type === 'field' && b.parts.some((p) => p.text?.includes('Website URL')));
  assert.deepEqual(state.inputs[nSite.line], ['https://a.dev']);
  const nPattern = newer.sections.flatMap((s) => s.blocks).find((b) => b.label === 'Pattern');
  assert.equal(state.checks[nPattern.options[0].line], true);
});

test('film.json settings come from duration, formats and tempo', () => {
  const formats = findChoice('Formats'), dur = findChoice('Duration'), tempo = findChoice('Tempo');
  const s = { checks: {}, inputs: {} };
  s.checks[dur.options.find((o) => /30s/.test(o.parts[0].text)).line] = true;
  s.checks[formats.options[0].line] = true;   // 9:16
  s.checks[formats.options[2].line] = true;   // 16:9
  s.checks[tempo.options.find((o) => /128/.test(o.parts[0].text)).line] = true;
  assert.deepEqual(filmSettings(model, s), {
    dur: 30, bpm: 128, w: 1080, h: 1920,
    formats: [{ name: 'vertical', w: 1080, h: 1920 }, { name: 'wide', w: 1920, h: 1080 }],
  });
  assert.deepEqual(filmSettings(model, { checks: {}, inputs: {} }), {}, 'agent decides → template defaults');
});

test('brief title', () => {
  assert.equal(briefTitle('# Brief: Acme Rockets (brand name)\n'), 'Acme Rockets');
  assert.equal(briefTitle('# Brief: ____ (brand name)\n'), '');
});
