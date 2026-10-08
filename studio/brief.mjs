// Brief template ⇄ form model. Shared by the browser form and the Node tests.
// The template markdown is the single source of truth: every line maps to a
// UI block, and serialize() writes the same lines back with answers filled in.
//
// Line grammar (see _raw/brief-template.md):
//   # Title ____                → title field
//   ## N. Section               → section
//   **Label**  *(any)*          → choice group label (multi if "(any)" / "(pick up to …)")
//   - [ ] option text           → option of the current choice group (may contain ____)
//   anything with ____          → inline field(s)
//   *italic line*               → note
//   > …, ---, ### Notes for the agent (and everything after) → hidden, kept verbatim
export const BLANK = '____';
// `____` in backticks on its own is the template *talking about* blanks, not a field.
// (A blank inside longer code, like `brands/____`, is still a field.)
const LITERAL = '`____`', HOLD = '\u0000LIT\u0000';
const blanksIn = (s) => s.replaceAll(LITERAL, '').split(BLANK).length - 1;
const BOX = /^(\s*)- \[( |x|X)\] (.*)$/;
const LABEL = /^\*\*([^*]+)\*\*(?:\s*\*\((.+)\)\*)?\s*$/;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function inline(md) {
  return esc(md)
    .replace(/`([^`]*)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`/g, '');                       // unbalanced backtick left by a ____ split
}
// Split a line around ____ into text and input slots.
const parts = (text) => text.replaceAll(LITERAL, HOLD).split(BLANK)
  .map((t) => t.replaceAll(HOLD, LITERAL))
  .flatMap((t, i) => (i ? [{ input: i - 1 }, { text: t }] : [{ text: t }]));

export function parse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const head = { title: null, intro: [] };
  const sections = [];
  let sec = null, group = null, hidden = false;

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (hidden) return;
    if (/^###\s+Notes for the agent/i.test(line)) { hidden = true; return; }
    if (!line.trim() || line.trim() === '---' || line.startsWith('>')) { group = line.trim() ? null : group; return; }

    const box = line.match(BOX);
    if (box) {
      if (!group) { group = { type: 'choice', label: null, hint: null, multi: true, options: [] }; (sec?.blocks ?? head.intro).push(group); }
      group.options.push({ line: i, checked: box[2] !== ' ', parts: parts(box[3]), blanks: blanksIn(box[3]) });
      return;
    }
    group = null;

    if (line.startsWith('# ')) { head.title = { line: i, parts: parts(line.slice(2)), blanks: blanksIn(line) }; return; }
    if (line.startsWith('## ')) {
      const m = line.slice(3).match(/^(\d+)\.\s*(.*)$/);
      sec = { n: m ? +m[1] : sections.length + 1, title: m ? m[2] : line.slice(3), blocks: [] };
      sections.push(sec); return;
    }
    const target = sec?.blocks ?? head.intro;
    const label = line.match(LABEL);
    if (label && !blanksIn(line)) {
      group = { type: 'choice', label: label[1], hint: label[2] ?? null, multi: /\bany\b|up to/i.test(label[2] ?? ''), options: [] };
      target.push(group); return;
    }
    if (blanksIn(line)) { target.push({ type: 'field', line: i, parts: parts(line), blanks: blanksIn(line) }); return; }
    if (/^\*[^*].*\*$/.test(line.trim())) { target.push({ type: 'note', html: inline(line.trim().slice(1, -1)) }); return; }
    target.push({ type: 'text', html: inline(line) });
  });
  // A bold label followed by text fields (not checkboxes) is a subheading, not a choice.
  for (const blocks of [head.intro, ...sections.map((s) => s.blocks)])
    blocks.forEach((b, k) => { if (b.type === 'choice' && !b.options.length) blocks[k] = { type: 'subhead', label: b.label, hint: b.hint }; });
  return { lines, head, sections };
}

// state: { checks: { [line]: bool }, inputs: { [line]: string[] } }
export function serialize(model, state) {
  return model.lines.map((line, i) => {
    let out = line;
    if (i in (state.checks ?? {})) out = out.replace(/\[( |x|X)\]/, state.checks[i] ? '[x]' : '[ ]');
    const vals = state.inputs?.[i];
    if (vals) {
      let k = 0;
      out = out.replaceAll(LITERAL, HOLD).replace(/____/g, () => {
        const v = String(vals[k++] ?? '').replace(/\s+/g, ' ').trim();
        return v || BLANK;
      }).replaceAll(HOLD, LITERAL);
    }
    return out;
  }).join('\n');
}

export const slugify = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

// File name for the saved brief: the brand-folder (or image job folder) field, else the name in the title.
export function slugFor(model, state) {
  const folder = model.lines.findIndex((l) => l.includes('brands/' + BLANK) || l.includes('pge/jobs/' + BLANK));   // film or image job
  const fromFolder = folder >= 0 ? state.inputs?.[folder]?.[0] : '';
  const fromTitle = model.head.title ? state.inputs?.[model.head.title.line]?.[0] : '';
  return slugify(fromFolder) || slugify(fromTitle);
}

// ── Reopen: read a filled brief back into form state ───────────────────────
// Each answerable template line becomes an anchored pattern. Lines are matched at
// the same position first, else at the nearest unused line that fits, so small
// template edits don't scramble answers. `missed` counts answers that couldn't be placed.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function patternFor(line) {
  const box = line.match(BOX);
  const body = box ? box[3] : line;
  const lit = body.replaceAll(LITERAL, HOLD).split(BLANK)
    .map((t) => escRe(t.replaceAll(HOLD, LITERAL))).join('(.*?)');
  return new RegExp('^' + (box ? escRe(box[1]) + '- \\[( |x|X)\\] ' : '') + lit + '$');
}

export function readBack(model, filled) {
  const got = filled.replace(/\r\n/g, '\n').split('\n');
  const state = { checks: {}, inputs: {} }, used = new Set();
  let missed = 0;
  model.lines.forEach((line, i) => {
    const isBox = BOX.test(line), blanks = blanksIn(line);
    if (!isBox && !blanks) return;
    const re = patternFor(line);
    let j = -1;
    if (!used.has(i) && got[i] !== undefined && re.test(got[i])) j = i;
    else {
      let best = Infinity;
      got.forEach((l, k) => { if (!used.has(k) && Math.abs(k - i) < best && re.test(l)) { best = Math.abs(k - i); j = k; } });
    }
    if (j < 0) { missed++; return; }
    used.add(j);
    const m = got[j].match(re).slice(1);
    if (isBox) state.checks[i] = m.shift() !== ' ';
    if (blanks) state.inputs[i] = m.map((v) => (v.trim() === BLANK ? '' : v.trim()));
  });
  return { state, missed };
}

// ── Brief → film.json overrides (duration, formats, tempo) ─────────────────
const RATIO_NAMES = { '9:16': 'vertical', '1:1': 'square', '16:9': 'wide', '4:5': 'portrait' };
export function filmSettings(model, state) {
  const choice = (label) => model.sections.flatMap((s) => s.blocks)
    .find((b) => b.type === 'choice' && b.label?.toLowerCase().startsWith(label));
  const picked = (b) => (b?.options ?? []).filter((o) => state.checks?.[o.line])
    .map((o) => o.parts.map((p) => ('input' in p ? state.inputs?.[o.line]?.[p.input] ?? '' : p.text)).join(''));
  const out = {};
  const dur = picked(choice('duration'))[0]?.match(/(\d+(?:\.\d+)?)\s*s\b/);
  if (dur) out.dur = Number(dur[1]);
  const bpm = picked(choice('tempo'))[0]?.match(/(\d+)\s*BPM/i) ?? picked(choice('tempo'))[0]?.match(/^Other:\s*(\d+)/i);
  if (bpm) out.bpm = Number(bpm[1]);
  const formats = picked(choice('formats')).map((t) => {
    const m = t.match(/(\d+:\d+)\D+?(\d{3,4})\s*[×x]\s*(\d{3,4})/);
    return m && { name: RATIO_NAMES[m[1]] ?? m[1].replace(':', 'x'), w: Number(m[2]), h: Number(m[3]) };
  }).filter(Boolean);
  if (formats.length) Object.assign(out, { w: formats[0].w, h: formats[0].h, formats });
  return out;
}

export const briefTitle = (md) => md.match(/^# Brief:\s*(.*?)\s*(?:\((?:brand|job) name\))?\s*$/m)?.[1]?.replace(/^_+$/, '') || '';
