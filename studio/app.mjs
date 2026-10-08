// Studio UI. Three views, hash-routed:
//   #/               home: what needs you, running agents, recent films, then saved briefs
//   #/agents         every agent session: running, past, resumable
//   #/brief/new      new brief      #/brief/<slug>  edit a saved brief
//   #/film/<slug>    a film's gates, read live from brands/<slug>/
//   #/run/<slug>     the film's agent terminal, full page (gates live in the rail)
//   #/library        Film Library: one folder per brand with finished films
//   #/library/<slug> that brand's films; click one to play it full screen
// The brief form is generated from _raw/brief-template.md (see brief.mjs).
import { parse, serialize, slugFor, inline, readBack } from './brief.mjs';
import { renderMarkdown } from './md.mjs';

const $ = (sel) => document.querySelector(sel);
const DRAFT_KEY = 'studio.brief.draft.v1';
let model, templateText = '', templateId = '';
let state = { checks: {}, inputs: {} };
let editing = null;            // slug of the saved brief open in the editor (null = new brief)
let savedSnapshot = '';        // serialized brief as last saved/loaded, to know if there are unsaved edits
let cleanup = [];              // per-view teardown (observers, timers)

// ── Small DOM helpers ────────────────────────────────────────────
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') n.innerHTML = v;
    else if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [kids].flat(2)) if (c != null && c !== false) n.append(c);
  return n;
};
const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
async function api(path, opts) {
  const res = await fetch(path, opts);
  const isJson = res.headers.get('content-type')?.includes('json');
  return { res, body: isJson ? await res.json().catch(() => ({})) : await res.text() };
}
const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

function shell({ railTitle = '', bar = false, wide = false } = {}) {
  cleanup.forEach((f) => f()); cleanup = [];
  $('#page').classList.toggle('run', wide);
  $('#rail-title').textContent = railTitle;
  $('#frames').textContent = '';
  $('#bar').hidden = !bar;
  $('#page').textContent = '';
  window.scrollTo(0, 0);
}
const fatal = (msg) => { $('#page').innerHTML = `<p class="fatal">${msg}</p>`; };

// Highlight the rail frame for whatever is on screen (sections in the editor, gates in a film).
function watchActive(targets) {
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null);
    // the topmost visible target wins; past the last one, keep the last
    const on = [...visible].filter(([, top]) => top != null).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (!on) return;
    document.querySelectorAll('#frames a').forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === `#${on}` || a.dataset.target === on)));
  }, { rootMargin: '-15% 0px -55% 0px' });
  targets.forEach((t) => io.observe(t));
  cleanup.push(() => io.disconnect());
}
// Rail links scroll within the page (hash routing owns location.hash).
function railLink(target, kids) {
  return el('a', { href: `#${target}`, 'data-target': target, onclick: (e) => {
    e.preventDefault();
    document.getElementById(target)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } }, kids);
}

// ── Template ─────────────────────────────────────────────────────
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
async function loadTemplate() {
  if (model) return;
  const { res, body } = await api('/api/template');
  if (!res.ok) throw new Error('template');
  templateText = body; templateId = hash(body); model = parse(body);
}
const defaults = () => {
  const s = { checks: {}, inputs: {} };
  for (const sec of model.sections) for (const b of sec.blocks) if (b.type === 'choice') for (const o of b.options) if (o.checked) s.checks[o.line] = true;
  return s;
};

// Drafts: only for new briefs, only valid for the exact template they were made on (answers are keyed by line).
const saveDraft = () => { if (editing) return; try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ templateId, state })); } catch {} };
const loadDraft = () => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d?.templateId === templateId ? d.state : null; } catch { return null; }
};
const dropDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };

// ═══ View: briefs list ═══════════════════════════════════════════
async function viewList() {
  shell();
  document.title = 'Home · Motion studio';
  const page = $('#page');
  const dash = el('div', { class: 'dash' });
  page.append(dash);
  const { res: dr, body: d } = await api('/api/dashboard');
  if (dr.ok) renderDash(dash, d);
  page.append(el('div', { class: 'list-head briefs-head' }, [
    el('h1', {}, 'Briefs'),
    el('a', { class: 'button primary', href: '#/brief/new' }, 'New brief'),
  ]));
  const { res, body: briefs } = await api('/api/briefs');
  if (!res.ok) return fatal('Couldn’t read <code>_raw/</code>. Is <code>node studio.mjs</code> running?');
  if (!briefs.length) {
    page.append(el('div', { class: 'empty', html: 'No briefs yet. Start one and it’s saved to <code>_raw/</code>, ready to hand to the agent.' }));
    return;
  }
  const rows = el('ul', { class: 'rows' });
  for (const b of briefs) {
    const name = b.title ? escHtml(b.title) : `<span class="untitled">${escHtml(b.slug)}</span>`;
    const film = b.film
      ? `<span class="progress" aria-hidden="true">${Array.from({ length: b.film.total }, (_, i) => `<i class="${i < b.film.done ? 'on' : ''}"></i>`).join('')}</span>`
        + `${b.film.version > 1 ? `v${b.film.version}: ` : 'Film: '}${b.film.done} of ${b.film.total} gates${b.film.current ? `, next: ${escHtml(b.film.current)}` : ', delivered'}`
      : 'No film yet';
    rows.append(el('li', { class: 'row' }, [
      el('div', {}, [
        el('div', { class: 'name', html: name }),
        el('div', { class: 'meta', html: `<code>_raw/${escHtml(b.slug)}.md</code> · saved ${ago(b.modified)} · ${film}` }),
      ]),
      el('div', { class: 'acts' }, [
        el('a', { class: 'button', href: `#/brief/${encodeURIComponent(b.slug)}` }, 'Edit brief'),
        b.film
          ? [el('a', { class: 'button', href: `#/film/${encodeURIComponent(b.film.slug)}` }, 'Gates'),
            el('a', { class: 'button primary', href: `#/run/${encodeURIComponent(b.film.slug)}` }, 'Agent')]
          : el('button', { type: 'button', class: 'primary', onclick: (e) => startFilm(b.slug, e.currentTarget) }, 'Start film'),
      ]),
    ]));
  }
  page.append(rows);
}

async function startFilm(slug, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  const { res, body } = await post('/api/films', { slug });
  if (res.status === 201 || res.status === 409) { location.hash = `#/run/${encodeURIComponent(body.latest ?? slug)}`; return; }
  if (btn) { btn.disabled = false; btn.textContent = 'Start film'; }
  alert(body.error || `Couldn’t start the film (${res.status}).`);
}

// ═══ View: brief editor ══════════════════════════════════════════
function blankInput(line, k, placeholder, cls, label) {
  return el('input', {
    class: cls, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder, 'aria-label': label,
    value: state.inputs[line]?.[k] ?? '',
    oninput: (e) => { (state.inputs[line] ??= [])[k] = e.target.value; changed(); },
  });
}

function renderField(b) {
  const row = el('div', { class: 'field' });
  const label = plain(inline(b.parts.find((p) => p.text?.trim())?.text ?? 'Answer')).replace(/[:\s]+$/, '');
  b.parts.forEach((p) => {
    if ('input' in p) row.append(blankInput(b.line, p.input, 'Leave blank to let the agent decide', 'blank', label));
    else if (p.text.trim()) row.append(el('span', { class: 't', html: inline(p.text.trim()) }));
  });
  return row;
}

let groupSeq = 0;
function renderChoice(b) {
  const name = `g${groupSeq++}`;
  const wrap = el('fieldset', { class: 'choice', style: 'border:0;margin:0;padding-inline:0' });
  if (b.label) wrap.append(el('legend', { class: 'q', html: inline(b.label) + (b.hint ? ` <small>${inline(b.hint)}</small>` : '') }));
  const chips = el('div', { class: 'chips' });
  const type = b.multi || b.options.length === 1 ? 'checkbox' : 'radio';
  b.options.forEach((o, k) => {
    const id = `${name}-${k}`;
    const text = o.parts.map((p) => p.text ?? '').join(' ');
    const box = el('input', { type, id, name, checked: !!state.checks[o.line] });
    box.addEventListener('change', () => {
      if (type === 'radio') b.options.forEach((other) => (state.checks[other.line] = other.line === o.line));
      else state.checks[o.line] = box.checked;
      changed();
    });
    if (type === 'radio') box.addEventListener('click', () => {      // click the picked one again to clear it
      if (box.dataset.was === 'true') { box.checked = false; state.checks[o.line] = false; changed(); }
      b.options.forEach((_, j) => { const r = document.getElementById(`${name}-${j}`); r.dataset.was = String(r.checked); });
    });
    const lab = el('label', { for: id });
    o.parts.forEach((p) => {
      if ('input' in p) {
        const inp = blankInput(o.line, p.input, '…', 'inline', `${plain(inline(text))} detail`);
        inp.addEventListener('input', () => { if (inp.value.trim() && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change')); } });
        inp.addEventListener('click', (e) => e.preventDefault());
        lab.append(inp);
      } else if (p.text) lab.append(el('span', { html: inline(p.text) }));
    });
    chips.append(el('div', { class: 'chip' + (/\bagent\b/i.test(text) ? ' delegate' : '') }, [box, lab]));
  });
  wrap.append(chips);
  return wrap;
}

function renderBlock(b) {
  if (b.type === 'field') return renderField(b);
  if (b.type === 'choice') return renderChoice(b);
  if (b.type === 'subhead') return el('div', { class: 'sub', html: inline(b.label) + (b.hint ? `<small>${inline(b.hint)}</small>` : '') });
  if (b.type === 'note') return el('p', { class: 'note', html: b.html });
  return el('p', { class: 'text', html: b.html });
}

async function viewBrief(slug) {
  shell({ railTitle: 'Brief sections', bar: true });
  try { await loadTemplate(); } catch { return fatal('Couldn’t load <code>_raw/brief-template.md</code>. Check the file exists, then restart <code>node studio.mjs</code>.'); }

  editing = slug;
  let missed = 0;
  if (slug) {
    const { res, body } = await api(`/api/briefs/${encodeURIComponent(slug)}`);
    if (!res.ok) return fatal(`<code>_raw/${escHtml(slug)}.md</code> doesn’t exist. <a href="#/">Back to briefs</a>`);
    ({ state, missed } = readBack(model, body));
  } else {
    state = loadDraft() ?? defaults();
  }
  savedSnapshot = slug ? serialize(model, state) : '';
  document.title = `${slug ? 'Edit' : 'New'} brief · Motion studio`;

  const page = $('#page');
  const t = model.head.title;
  page.append(el('header', { class: 'head' }, [
    el('h1', {}, [el('span', { class: 'lead' }, 'Brief for'), t ? blankInput(t.line, 0, 'brand name', 'blank', 'Brand name') : null]),
    el('p', {}, slug
      ? `Editing _raw/${slug}.md. Changes are saved to the same file.`
      : 'Fill in what you know. Anything you leave blank, the agent works out from the website or codebase in section 1, and asks you when it matters.'),
    missed ? el('p', { class: 'note', style: 'color:var(--danger)' }, `${missed} answer${missed > 1 ? 's' : ''} from this brief couldn’t be matched to the current template and ${missed > 1 ? 'were' : 'was'} left out. Check the file before saving over it.`) : null,
  ]));
  const frames = $('#frames'), sections = [];
  for (const s of model.sections) {
    const id = `s${s.n}`;
    const sec = el('section', { id, 'aria-labelledby': `${id}-h` }, [
      el('header', {}, [el('span', { class: 'n', 'aria-hidden': 'true' }, String(s.n)), el('h3', { id: `${id}-h`, html: inline(s.title) })]),
      ...s.blocks.map(renderBlock),
    ]);
    page.append(sec); sections.push(sec);
    frames.append(el('li', {}, railLink(id, [el('span', { class: 'n' }, String(s.n)), el('span', { class: 'label', html: inline(s.title.replace(/\s*\(.*\)$/, '')) })])));
    frames.lastChild.firstChild.dataset.section = s.n;
  }
  watchActive(sections);
  changed();
}

// ── Editor status: lit frames, save target ──────────────────────
const linesOf = (s) => s.blocks.flatMap((b) => (b.type === 'choice' ? b.options.map((o) => o.line) : b.line != null ? [b.line] : []));
const touched = (line) => !!state.checks[line] || (state.inputs[line] ?? []).some((v) => v?.trim());
let confirming = false;

function changed() {
  saveDraft();
  let lit = 0;
  for (const s of model.sections) {
    const lines = linesOf(s);
    const on = lines.length ? lines.some(touched) : true;   // a section with nothing to fill in (10. Gates) is always complete
    lit += on;
    const a = document.querySelector(`[data-section="${s.n}"]`);
    if (a) a.dataset.lit = String(on);
  }
  $('#count').textContent = `${lit} of ${model.sections.length} sections started`;
  const slug = slugFor(model, state), where = $('#where');
  where.classList.remove('err');
  const renamed = editing && slug && slug !== editing;
  where.innerHTML = !slug ? 'Name the brand to save.'
    : renamed ? `Saves as a new file <b>_raw/${slug}.md</b> (the brand folder changed)`
    : `Saves to <b>_raw/${slug}.md</b>`;
  $('#save').disabled = !slug;
  $('#film').hidden = !(editing && slug === editing);
  $('#clear').hidden = !!editing;
  if (confirming) { confirming = false; $('#save').textContent = 'Save brief'; }
}
const dirty = () => model && $('#bar') && !$('#bar').hidden && serialize(model, state) !== savedSnapshot && (editing || Object.keys(state.inputs).length || Object.values(state.checks).some(Boolean));

async function save() {
  const slug = slugFor(model, state);
  if (!slug) return false;
  const btn = $('#save'), where = $('#where');
  btn.disabled = true;
  try {
    const md = serialize(model, state);
    // Saving the brief you opened replaces it; anything else needs an explicit OK.
    const { res, body } = await post('/api/briefs', { slug, md, overwrite: confirming || slug === editing });
    if (res.status === 409) {
      confirming = true;
      where.classList.add('err');
      where.innerHTML = `<b>${escHtml(body.path)}</b> already exists. Replace it, or change the brand folder.`;
      btn.textContent = 'Replace brief';
      return false;
    }
    if (!res.ok) { where.classList.add('err'); where.textContent = body.error || `Save failed (${res.status}).`; return false; }
    confirming = false;
    btn.textContent = 'Save brief';
    savedSnapshot = md;
    if (!editing) dropDraft();
    if (editing !== slug) { editing = slug; history.replaceState(null, '', `#/brief/${encodeURIComponent(slug)}`); }
    changed();
    where.innerHTML = `Saved <b>${escHtml(body.path)}</b>. Next: <b>Start film</b>, or tell the agent <code>follow ${escHtml(body.path)}</code>`;
    btn.classList.remove('saved'); void btn.offsetWidth; btn.classList.add('saved');
    return true;
  } catch {
    where.classList.add('err');
    where.textContent = 'Can’t reach the studio server. Is node studio.mjs still running?';
    return false;
  } finally {
    btn.disabled = !slugFor(model, state);
  }
}

$('#save').addEventListener('click', save);
$('#film').addEventListener('click', async (e) => {
  if (dirty() && !(await save())) return;     // the film starts from the saved brief
  startFilm(editing, e.currentTarget);
});
$('#clear').addEventListener('click', () => {
  if (!confirm('Clear every answer in this form? Saved briefs are not affected.')) return;
  dropDraft(); state = defaults(); viewBrief(null);
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && !$('#bar').hidden) { e.preventDefault(); if (!$('#save').disabled) save(); }
});
addEventListener('beforeunload', (e) => { if (editing && dirty()) e.preventDefault(); });

// ═══ View: film gates ════════════════════════════════════════════
const STATE_LABEL = { done: 'Done', current: 'Up next', todo: 'Not started' };
const APPROVAL_LABEL = { waiting: 'Needs your OK', stale: 'Changed, needs your OK' };
async function viewFilm(slug) {
  shell({ railTitle: 'Gates' });
  document.title = `${slug} film · Motion studio`;
  const page = $('#page');
  const head = el('header', { class: 'film-head' });
  const list = el('ol', { class: 'gates' });
  const handoff = el('div', { class: 'handoff' });
  const drift = el('div', { class: 'drift', role: 'status', hidden: true });
  page.append(head, drift, handoff, list);
  async function syncBrief(e) {
    if (!confirm('Replace the film’s copy of the brief with your edited version? Tell the agent to re-read docs/brief.md afterwards.')) return;
    e.currentTarget.disabled = true;
    const { res, body } = await post(`/api/films/${encodeURIComponent(slug)}/brief/sync`, {});
    if (!res.ok) alert(body.error || 'Sync failed.');
    await refresh(true);
    pollNeeds();
  }

  let built = false;
  // Shotlist review panel: kept across refreshes so the 4s poll doesn't close what you're reading.
  let panel = null, panelSha = null;
  async function openShotlist(msg) {
    const { res, body } = await api(`/api/films/${encodeURIComponent(slug)}/shotlist`);
    if (!res.ok) { alert(body.error || 'Couldn’t read the shotlist.'); return; }
    panelSha = body.sha256;
    panel = el('div', { class: 'shot' }, [
      msg ? el('p', { class: 'flash' }, msg) : null,
      el('div', { class: 'shot-text md', tabindex: '0', role: 'document', 'aria-label': 'Shotlist', html: renderMarkdown(body.text) }),
      el('div', { class: 'shot-acts' }, body.current
        ? [el('span', {}, `You approved this version ${ago(body.approval.at)}.`), el('button', { type: 'button', class: 'quiet', onclick: closePanel }, 'Close')]
        : [
          el('button', { type: 'button', class: 'primary', onclick: approve }, 'Approve this shotlist'),
          el('button', { type: 'button', class: 'quiet', onclick: closePanel }, 'Close'),
          el('span', { class: 'hint' }, 'Want changes? Tell the agent in chat. It updates the file, and you approve the new version here.'),
        ]),
    ]);
    await refresh(true);
    panel.querySelector('.shot-text')?.focus({ preventScroll: true });
  }
  function closePanel() { panel = null; panelSha = null; refresh(true); }
  async function approve(e) {
    e.currentTarget.disabled = true;
    const { res, body } = await post(`/api/films/${encodeURIComponent(slug)}/shotlist/approve`, { sha256: panelSha });
    if (res.status === 409) return openShotlist('The agent changed the shotlist while you were reading. This is the new version.');
    if (!res.ok) { e.currentTarget.disabled = false; alert(body.error || 'Approval failed.'); return; }
    panel = null; panelSha = null;
    await refresh(true);
  }
  async function revoke() {
    if (!confirm('Withdraw your approval? The agent should stop before writing more code until you approve again.')) return;
    await post(`/api/films/${encodeURIComponent(slug)}/shotlist/revoke`, {});
    await refresh(true);
  }
  // Primary render: watch it inline, then OK it. The stamp sent back is the render you were shown.
  async function approvePrimary(g, e) {
    e.currentTarget.disabled = true;
    const { res, body } = await post(`/api/films/${encodeURIComponent(slug)}/primary/approve`, { stamp: g.stamp });
    if (res.status === 409) { alert('The primary render changed while you were watching. The new one is loaded now.'); await refresh(true); return; }
    if (!res.ok) { e.currentTarget.disabled = false; alert(body.error || 'Approval failed.'); return; }
    await refresh(true);
  }
  async function revokePrimary() {
    if (!confirm('Withdraw your OK on the primary render? The other formats can’t render until you approve again.')) return;
    await post(`/api/films/${encodeURIComponent(slug)}/primary/revoke`, {});
    await refresh(true);
  }
  function primaryControls(g) {
    if (!g.approval || g.approval === 'missing') return null;
    const video = el('video', { class: 'review', src: `${media(slug, g.file)}?v=${encodeURIComponent(g.stamp)}`, controls: true, preload: 'metadata', playsinline: true });
    const acts = g.approval === 'approved'
      ? el('div', { class: 'gacts' }, [el('button', { type: 'button', class: 'quiet', onclick: revokePrimary }, 'Withdraw approval')])
      : el('div', { class: 'gacts' }, [el('button', { type: 'button', class: 'primary', onclick: (e) => approvePrimary(g, e) }, 'Approve, render the other formats'),
        el('span', { class: 'hint' }, 'Watch it with sound off: this is the silent render.')]);
    return [video, acts];
  }
  function shotlistControls(g) {
    if (g.approval === 'missing') return null;
    const open = el('button', { type: 'button', onclick: () => openShotlist() }, panel ? 'Reload shotlist' : 'Read shotlist');
    if (g.approval === 'approved') return el('div', { class: 'gacts' }, [open, el('button', { type: 'button', class: 'quiet', onclick: revoke }, 'Withdraw approval')]);
    return el('div', { class: 'gacts' }, [open, panel ? null : el('span', { class: 'hint' }, 'Read it, then approve it at the bottom.')]);
  }

  // Rebuild only when the folder changed (or on a user action), so an open panel keeps its scroll position.
  let lastKey = '';
  async function refresh(force = false) {
    const { res, body: f } = await api(`/api/films/${encodeURIComponent(slug)}`);
    if (!res.ok) { fatal(`${escHtml(f.error || 'Film not found.')} <a href="#/">Back to briefs</a>`); return false; }
    const key = JSON.stringify([f.drift, f.version, f.gates.map((g) => [g.state, g.approval, g.evidence, g.updated])]) + (panel ? "" : Math.floor(Date.now() / 60000));
    if (!force && key === lastKey) return true;
    lastKey = key;
    const vi = f.version;
    const others = vi.versions.length > 1 ? ' · versions: ' + vi.versions.map((v) => v.slug === slug ? `<b>v${v.version}</b>` : `<a href="#/film/${encodeURIComponent(v.slug)}">v${v.version}</a>`).join(' ') : '';
    head.innerHTML = `<h1>${escHtml(slug)}</h1><p>${others ? `Version ${vi.version} of <b>${escHtml(vi.base)}</b>${others}<br>` : ''}<code>${escHtml(f.path)}</code> · ${f.done} of ${f.gates.length} gates done · checks the folder every few seconds${f.gates.at(-1).done ? ` · <a href="#/library/${encodeURIComponent(slug)}">Watch in the library</a>` : ''}</p>`;
    drift.textContent = '';
    const showDrift = f.drift === 'changed' && vi.latest;
    if (showDrift && vi.delivered) drift.append(
      el('p', {}, 'You edited the brief after this film was delivered. A new version applies it, starting from this one’s assets and style guide. This film stays as delivered.'),
      el('div', { class: 'acts' }, [
        el('a', { class: 'button', href: `#/brief/${encodeURIComponent(vi.base)}` }, 'See the brief'),
        el('button', { type: 'button', class: 'primary', onclick: (e) => makeNextVersion(slug, e.currentTarget) }, `Make v${vi.version + 1}`),
      ]),
    );
    else if (showDrift) drift.append(
      el('p', {}, 'You edited the brief after this film started. The film and its agent still use the old copy in docs/brief.md.'),
      el('div', { class: 'acts' }, [
        el('a', { class: 'button', href: `#/brief/${encodeURIComponent(vi.base)}` }, 'See the brief'),
        el('button', { type: 'button', class: 'primary', onclick: syncBrief }, 'Sync brief into the film'),
      ]),
    );
    drift.hidden = !showDrift;
    list.textContent = '';
    f.gates.forEach((g, i) => list.append(el('li', { class: 'gate', id: `g-${g.id}`, 'data-state': g.state }, [
      el('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)),
      el('div', {}, [
        el('div', { class: 'gname' }, g.name),
      ]),
      el('span', { class: 'st' + (APPROVAL_LABEL[g.approval] ? ' ask' : '') }, (APPROVAL_LABEL[g.approval] ?? STATE_LABEL[g.state]) + (g.updated ? ` · ${ago(g.updated)}` : '')),
      el('div', { class: 'ev', html: `<code>${escHtml(g.evidence)}</code>` }),
      g.note && g.state !== 'todo' ? el('div', { class: 'gnote' }, g.note) : null,
      g.id === 'shotlist' ? shotlistControls(g) : null,
      ...(g.id === 'primary' ? primaryControls(g) ?? [] : []),
      g.id === 'shotlist' && panel ? panel : null,
      g.id === 'animatic' && g.done ? el('video', { class: 'review', src: `${media(slug, 'animatic.mp4')}?v=${encodeURIComponent(g.updated)}`, controls: true, preload: 'metadata', playsinline: true }) : null,
      g.id === 'final' && g.done ? el('a', { class: 'review-img', href: media(slug, 'contact.png'), target: '_blank', rel: 'noopener' },
        el('img', { src: `${media(slug, 'contact.png')}?v=${encodeURIComponent(g.updated)}`, alt: 'Contact sheet of the finished film', loading: 'lazy' })) : null,
    ])));
    const frames = $('#frames'); frames.textContent = '';
    f.gates.forEach((g, i) => {
      const a = railLink(`g-${g.id}`, [el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'label' }, g.name)]);
      a.dataset.lit = String(g.done);
      a.setAttribute('aria-current', String(g.state === 'current'));
      frames.append(el('li', {}, a));
    });
    if (!built) {
      const cmd = `follow brands/${slug}/docs/brief.md`;
      const { res: tr, body: tb } = await api(`/api/films/${encodeURIComponent(slug)}/terminal`);
      const live = tr.ok && tb.session.status === 'running';
      handoff.innerHTML = '';
      handoff.append(
        el('div', { class: 'agent-strip' }, [
          el('p', {}, live ? `The agent is running: ${tb.session.command}`
            : tr.ok ? `Last agent session exited with code ${tb.session.exitCode}.`
            : 'Hand the film to an agent. The folder is set up with the brief, film.json and the template.'),
          el('a', { class: 'button run', href: `#/run/${encodeURIComponent(slug)}` }, live ? 'Open terminal' : 'Run agent'),
        ]),
        el('small', {}, [
          'Or paste into an agent yourself: ', el('code', {}, cmd), ' ',
          el('button', { type: 'button', class: 'copy', onclick: async (e) => {
            try { await navigator.clipboard.writeText(cmd); e.currentTarget.textContent = 'Copied'; } catch { e.currentTarget.textContent = 'Select the text to copy'; }
          } }, 'Copy'),
        ]),
      );
      built = true;
    }
    return true;
  }
  if (!(await refresh())) return;
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  cleanup.push(() => clearInterval(timer));
}

// ═══ Agent terminal (film view) ══════════════════════════════════
// Runs the agent in a real terminal on the server (node-pty) and streams it here over a
// websocket. The session belongs to the studio process, so leaving or refreshing the page
// only detaches; coming back replays the scrollback. See docs/terminal-spec.md.
const RUNNER_KEY = 'studio.agent.runner.v1';
function agentPane(slug, { open = false } = {}) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(RUNNER_KEY)) ?? {}; } catch { return {}; } })();
  let runner = saved.runner ?? 'claude', term = null, fit = null, ws = null, session = null;
  const enc = encodeURIComponent(slug);

  const custom = el('input', { type: 'text', class: 'custom-cmd', value: saved.command ?? '', spellcheck: 'false',
    placeholder: 'codex "follow <brief>"', 'aria-label': 'Custom agent command. <brief> becomes the brief path; without it the path is added at the end.',
    oninput: remember });
  const choice = (id, label) => el('label', { class: 'runner' }, [
    el('input', { type: 'radio', name: 'runner', value: id, checked: runner === id, onchange: () => { runner = id; remember(); sync(); } }), label]);
  const runBtn = el('button', { type: 'button', class: 'run', onclick: run }, 'Run agent');
  const killBtn = el('button', { type: 'button', class: 'kill', onclick: kill, hidden: true }, 'Stop agent');
  const statusEl = el('span', { class: 'term-status', role: 'status' });
  const screen = el('div', { class: 'term', hidden: true });
  const box = el('div', { class: 'agent' }, [
    el('div', { class: 'runners', role: 'radiogroup', 'aria-label': 'Agent' }, [choice('claude', 'Claude'), choice('opencode', 'OpenCode'), choice('custom', 'Custom'), custom]),
    el('div', { class: 'term-bar' }, [runBtn, killBtn, statusEl]),
    screen,
  ]);

  function remember() { try { localStorage.setItem(RUNNER_KEY, JSON.stringify({ runner, command: custom.value })); } catch {} }
  function sync() {
    custom.hidden = runner !== 'custom';
    const live = session?.status === 'running';
    runBtn.textContent = live ? 'Running' : session ? 'Run again' : 'Run agent';
    runBtn.disabled = live;
    killBtn.hidden = !live;
    statusEl.textContent = !session ? '' : live ? `Running: ${session.command}` : `Exited with code ${session.exitCode} · ${session.command}`;
    statusEl.dataset.state = session ? session.status : '';
    if (live && session.runner === 'opencode') statusEl.textContent += ' · OpenCode fills in the prompt: click the terminal and press Enter to send it.';
  }

  async function ensureTerm() {
    if (term) return;
    if (!document.querySelector('link[href="vendor/xterm.css"]')) document.head.append(el('link', { rel: 'stylesheet', href: 'vendor/xterm.css' }));
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('./vendor/xterm.mjs'), import('./vendor/addon-fit.mjs')]);
    term = new Terminal({ fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000,
      theme: { background: '#141922', foreground: '#E3E7EE', cursor: '#E3E7EE', selectionBackground: '#3B2FE066' } });
    fit = new FitAddon();
    term.loadAddon(fit);
    screen.hidden = false;
    term.open(screen);
    fit.fit();
    term.onData((d) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'i', d })));
    term.onResize(({ cols, rows }) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'r', cols, rows })));
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(screen);
    cleanup.push(() => { ro.disconnect(); term.dispose(); });
  }

  // (Re)attach: the server replays the scrollback first, so reset the screen before connecting.
  async function connect() {
    await ensureTerm();
    ws?.close();
    term.reset();
    ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/films/${enc}/terminal/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'o') term.write(m.d);
      else if (m.t === 'x') { session = m.session; sync(); }
    };
    ws.onclose = () => { if (session?.status === 'running') { statusEl.textContent = 'Disconnected from the studio. Reload the page to reattach.'; } };
    term.focus();
  }

  async function run() {
    if (runner === 'custom' && !custom.value.trim()) { custom.focus(); statusEl.textContent = 'Type the command to run.'; return; }
    if (session && !confirm('Start a fresh agent session? The old transcript stays in out/terminal.log.')) return;
    runBtn.disabled = true;
    await ensureTerm();
    const { res, body } = await post(`/api/films/${enc}/terminal`, { runner, command: custom.value, cols: term.cols, rows: term.rows });
    if (!res.ok) { runBtn.disabled = false; statusEl.textContent = body.error || `Couldn’t start the agent (${res.status}).`; return; }
    session = body.session; sync();
    await connect();
  }

  async function kill() {
    if (!confirm('Stop the agent? Unsaved work in its session is lost; files it already wrote stay.')) return;
    const r = await fetch(`/api/films/${enc}/terminal`, { method: 'DELETE' });
    if (!r.ok) statusEl.textContent = 'Couldn’t stop it. It may have already exited.';
  }

  (async () => {
    sync();
    if (open) await ensureTerm();
    const { res, body } = await api(`/api/films/${enc}/terminal`);
    if (res.status === 503) { runBtn.disabled = true; statusEl.textContent = body.error; return; }
    if (res.ok) { session = body.session; sync(); await connect(); }
  })();
  cleanup.push(() => { if (ws) { ws.onclose = null; ws.close(); } });
  return box;
}

// ═══ View: agent terminal (full page) ════════════════════════════
async function viewRun(slug) {
  shell({ railTitle: 'Gates', wide: true });
  document.title = `${slug} agent · Motion studio`;
  const enc = encodeURIComponent(slug);
  const { res, body: f } = await api(`/api/films/${enc}`);
  if (!res.ok) return fatal(`${escHtml(f.error || 'Film not found.')} <a href="#/">Back to briefs</a>`);
  $('#page').append(
    el('header', { class: 'run-head' }, [
      el('h1', {}, slug),
      el('a', { class: 'button quiet', href: `#/film/${enc}` }, 'Gates and shotlist'),
    ]),
    el('div', { class: 'handoff run-box' }, agentPane(slug, { open: true })),
  );
  // The rail shows the gates live while the agent works; each opens the film page.
  let key = '';
  async function rail() {
    const { res, body } = await api(`/api/films/${enc}`);
    if (!res.ok) return;
    const k = JSON.stringify(body.gates.map((g) => [g.state, g.approval]));
    if (k === key) return;
    key = k;
    const frames = $('#frames'); frames.textContent = '';
    body.gates.forEach((g, i) => {
      const a = el('a', { href: `#/film/${enc}`, title: APPROVAL_LABEL[g.approval] ?? STATE_LABEL[g.state] },
        [el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'label' }, g.name + (APPROVAL_LABEL[g.approval] ? ' · needs your OK' : ''))]);
      a.dataset.lit = String(g.done);
      a.setAttribute('aria-current', String(g.state === 'current'));
      frames.append(el('li', {}, a));
    });
  }
  await rail();
  const timer = setInterval(() => { if (!document.hidden) rail(); }, 4000);
  cleanup.push(() => clearInterval(timer));
}

// ═══ Home dashboard + alerts ══════════════════════════════════════
const NEED_ACTION = {
  shotlist: (n) => el('a', { class: 'button primary', href: `#/film/${encodeURIComponent(n.slug)}` }, 'Read shotlist'),
  brief: (n) => el('a', { class: 'button', href: `#/film/${encodeURIComponent(n.slug)}` }, 'Review and sync'),
  primary: (n) => el('a', { class: 'button primary', href: `#/film/${encodeURIComponent(n.slug)}` }, 'Watch primary render'),
  version: (n) => el('button', { type: 'button', class: 'primary', onclick: (e) => makeNextVersion(n.slug, e.currentTarget) }, 'Make new version'),
  agent: (n) => n.resumable
    ? el('button', { type: 'button', class: 'primary', onclick: (e) => resumeAgent(n.slug, n.session, e.currentTarget) }, 'Resume')
    : el('a', { class: 'button', href: `#/run/${encodeURIComponent(n.slug)}` }, 'Open agent'),
};
function renderDash(box, d) {
  box.textContent = '';
  const alerts = 'Notification' in window && Notification.permission === 'default'
    ? el('button', { type: 'button', class: 'quiet', onclick: async (e) => { await Notification.requestPermission(); e.currentTarget.remove(); } }, 'Alert me when a film needs me')
    : null;
  box.append(el('div', { class: 'list-head' }, [el('h1', {}, d.needs.length ? 'Needs you' : 'All clear'), alerts]));
  if (d.needs.length) {
    box.append(el('ul', { class: 'needs' }, d.needs.map((n) => el('li', { 'data-kind': n.kind }, [
      el('div', {}, [el('div', { class: 'name' }, n.slug), el('div', { class: 'meta' }, n.text)]),
      NEED_ACTION[n.kind](n),
    ]))));
  } else {
    box.append(el('p', { class: 'lib-sub' }, 'No film is waiting on you. Agents running and finished films are below.'));
  }
  if (d.running.length) {
    box.append(el('h2', { class: 'dash-h' }, 'Running'));
    box.append(el('ul', { class: 'needs running' }, d.running.map((r) => el('li', {}, [
      el('div', {}, [el('div', { class: 'name' }, r.slug), el('div', { class: 'meta' }, `${r.runner} · started ${ago(r.startedAt)}`)]),
      el('a', { class: 'button', href: `#/run/${encodeURIComponent(r.slug)}` }, 'Open terminal'),
    ]))));
  }
  if (d.finished.length) {
    box.append(el('h2', { class: 'dash-h' }, [ 'Recently finished ', el('a', { href: '#/library' }, 'Library') ]));
    box.append(el('ul', { class: 'recent' }, d.finished.map((f) => el('li', {}, el('a', { href: `#/library/${encodeURIComponent(f.slug)}` }, [
      cover(f.cover),
      el('span', {}, `${f.title} · ${f.count} film${f.count === 1 ? '' : 's'}${f.versions > 1 ? ` · ${f.versions} versions` : ''}`),
    ])))));
  }
  if (d.terminal) box.append(el('p', { class: 'meta' }, d.terminal));
}

// A delivered film's brief changed: make brands/<brand>-vN/ (seeded from the last version) and
// open its agent page. The delivered film is not touched.
async function makeNextVersion(slug, btn) {
  if (!confirm('Make a new version of this film from the edited brief? The delivered version stays exactly as it is; the new one starts with its assets and style guide.')) return;
  if (btn) btn.disabled = true;
  const { res, body } = await post(`/api/films/${encodeURIComponent(slug)}/version`, {});
  if (!res.ok) { if (btn) btn.disabled = false; alert(body.error || 'Couldn’t make the new version.'); return; }
  pollNeeds();
  location.hash = `#/run/${encodeURIComponent(body.slug)}`;
}

async function resumeAgent(slug, session, btn) {
  if (btn) btn.disabled = true;
  const { res, body } = await post(`/api/films/${encodeURIComponent(slug)}/terminal`, { resume: session, cols: 120, rows: 36 });
  if (!res.ok) { if (btn) btn.disabled = false; alert(body.error || 'Couldn’t resume.'); return; }
  location.hash = `#/run/${encodeURIComponent(slug)}`;
}

// Polls what needs you (every 8s, everywhere in the studio): navbar badge, live-agent dot,
// and a browser notification for anything new, if you allowed alerts.
let seenNeeds = null;
async function pollNeeds() {
  if (document.hidden && !('Notification' in window && Notification.permission === 'granted')) return;
  const { res, body: d } = await api('/api/dashboard').catch(() => ({ res: { ok: false } }));
  if (!res.ok) return;
  const badge = $('#badge');
  badge.hidden = !d.needs.length;
  badge.textContent = d.needs.length;
  badge.setAttribute('aria-label', `${d.needs.length} thing${d.needs.length === 1 ? '' : 's'} need you`);
  $('#live-dot').hidden = !d.running.length;
  const keys = new Set(d.needs.map((n) => n.key));
  if (seenNeeds && 'Notification' in window && Notification.permission === 'granted') {
    for (const n of d.needs) if (!seenNeeds.has(n.key)) {
      const note = new Notification(`${n.slug} needs you`, { body: n.text, tag: n.key });
      note.onclick = () => { window.focus(); location.hash = n.kind === 'agent' ? '#/agents' : `#/film/${encodeURIComponent(n.slug)}`; };
    }
  }
  seenNeeds = keys;
}
pollNeeds();
setInterval(pollNeeds, 8000);

// ═══ View: Agents ═════════════════════════════════════════════════
const RUNNER_NAME = { claude: 'Claude', opencode: 'OpenCode', custom: 'Custom' };
const took = (a, b) => { if (!a || !b) return ''; const s = Math.round((new Date(b) - new Date(a)) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
async function viewAgents() {
  shell({ railTitle: 'Films' });
  document.title = 'Agents · Motion studio';
  const page = $('#page');
  page.append(el('div', { class: 'list-head' }, [el('h1', {}, 'Agents')]));
  const { res, body: d } = await api('/api/agents');
  if (!res.ok) return fatal('Couldn’t read agent sessions. Is <code>node studio.mjs</code> running?');
  if (d.terminal) page.append(el('p', { class: 'fatal' }, d.terminal));

  page.append(el('h2', { class: 'dash-h' }, 'Running now'));
  page.append(d.live.length
    ? el('ul', { class: 'needs running' }, d.live.map((s) => el('li', {}, [
      el('div', {}, [el('div', { class: 'name' }, s.slug), el('div', { class: 'meta' }, `${RUNNER_NAME[s.runner]} · running for ${took(s.startedAt, new Date().toISOString())}`)]),
      el('a', { class: 'button primary', href: `#/run/${encodeURIComponent(s.slug)}` }, 'Open terminal'),
    ])))
    : el('p', { class: 'lib-sub' }, 'No agent is running.'));

  if (!d.films.length) {
    page.append(el('div', { class: 'empty', html: 'No films yet. Start one from a brief on <a href="#/">Home</a>.' }));
    return;
  }
  const liveSlugs = new Set(d.live.map((s) => s.slug));
  for (const f of d.films) {
    const id = `a-${f.slug}`;
    const sec = el('section', { class: 'agent-film', id }, [
      el('div', { class: 'list-head' }, [
        el('h2', {}, f.version > 1 ? `${f.title} v${f.version}` : f.title),
        el('div', { class: 'acts' }, [
          el('a', { class: 'button', href: `#/film/${encodeURIComponent(f.slug)}` }, 'Gates'),
          liveSlugs.has(f.slug)
            ? el('a', { class: 'button primary', href: `#/run/${encodeURIComponent(f.slug)}` }, 'Open terminal')
            : el('a', { class: 'button primary', href: `#/run/${encodeURIComponent(f.slug)}` }, 'New agent'),
        ]),
      ]),
    ]);
    if (!f.history.length) sec.append(el('p', { class: 'meta' }, 'No agent has run on this film yet.'));
    else {
      sec.append(el('ul', { class: 'sessions' }, f.history.map((h) => el('li', { 'data-state': h.state }, [
        el('span', { class: 'when' }, ago(h.startedAt)),
        el('span', { class: 'who' }, RUNNER_NAME[h.runner] + (h.resumedFrom ? ' (resumed)' : '')),
        el('span', { class: 'how' }, h.state === 'running' ? 'Running' : h.state === 'interrupted' ? 'Cut off by a studio restart'
          : h.exitCode === 0 ? `Finished · ${took(h.startedAt, h.endedAt)}` : h.exitCode === 129 ? `Stopped by you · ${took(h.startedAt, h.endedAt)}` : `Exited with code ${h.exitCode}`),
        el('span', { class: 'act' }, h.state === 'running' ? null
          : h.resumable && !liveSlugs.has(f.slug) ? el('button', { type: 'button', onclick: (e) => resumeAgent(f.slug, h.id, e.currentTarget) }, 'Resume')
          : null),
      ]))));
      sec.append(el('a', { class: 'transcript', href: `/api/films/${encodeURIComponent(f.slug)}/terminal/log`, target: '_blank', rel: 'noopener' }, 'Read the transcript'));
    }
    page.append(sec);
    $('#frames').append(el('li', {}, railLink(id, [el('span', { class: 'n' }, liveSlugs.has(f.slug) ? '●' : String(f.history.length)), el('span', { class: 'label' }, f.version > 1 ? `${f.title} v${f.version}` : f.title)]))); 
  }
}

// ═══ View: Film Library ══════════════════════════════════════════
const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);
const secs = (d) => (d == null ? '' : d < 60 ? `${Math.round(d * 10) / 10}s` : `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`);
const formatName = (f) => f.charAt(0).toUpperCase() + f.slice(1);
const media = (slug, file) => `/media/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`;

// A brand's cover: newest version's poster, else its first film's frame at 1s.
const cover = (c) => c.kind === 'image'
  ? el('img', { src: media(c.slug, c.file), alt: '', loading: 'lazy' })
  : el('video', { src: `${media(c.slug, c.file)}#t=1`, preload: 'metadata', muted: true, playsinline: true, 'aria-hidden': 'true' });

async function viewLibrary() {
  shell();
  document.title = 'Library · Motion studio';
  const page = $('#page');
  page.append(el('div', { class: 'list-head' }, [el('h1', {}, 'Library')]));
  const { res, body: brands } = await api('/api/library');
  if (!res.ok) return fatal('Couldn’t read the library. Is <code>node studio.mjs</code> running?');
  if (!brands.length) {
    page.append(el('div', { class: 'empty', html: 'No finished films yet. A film lands here when <code>finalize.mjs</code> has written its masters. <a href="#/">Go to Home</a>' }));
    return;
  }
  page.append(el('p', { class: 'lib-sub' }, `${brands.length} brand${brands.length === 1 ? '' : 's'} · ${brands.reduce((n, b) => n + b.count, 0)} films`));
  const grid = el('ul', { class: 'folders' });
  for (const b of brands) {
    const top = b.versions[0];
    const formats = [...new Set(top.videos.map((v) => formatName(v.format)))].join(', ');
    const meta = [b.versions.length > 1 ? `${b.versions.length} versions, latest v${top.version}` : null,
      `${b.count} film${b.count === 1 ? '' : 's'}`, formats, secs(top.videos[0].duration), ago(b.updated)].filter(Boolean).join(' · ');
    // sheets behind the mount: one per extra version, else per extra format (max 2)
    const stack = Math.min(Math.max(b.versions.length, top.videos.length) - 1, 2);
    grid.append(el('li', {}, el('a', { class: 'folder', href: `#/library/${encodeURIComponent(b.slug)}`, 'data-stack': stack }, [
      el('div', { class: 'mount' }, cover(b.cover)),
      el('div', { class: 'fname' }, b.title),
      el('div', { class: 'fmeta' }, meta),
    ])));
  }
  page.append(grid);
}

// One brand: a shelf per version, newest first. Each film plays full screen on click.
async function viewBrand(slug) {
  shell({ railTitle: 'Versions' });
  document.title = `${slug} · Library · Motion studio`;
  const page = $('#page');
  const { res, body: b } = await api(`/api/library/${encodeURIComponent(slug)}`);
  if (!res.ok) return fatal(`${escHtml(b.error || 'Not found.')} <a href="#/library">Back to the library</a>`);
  document.title = `${b.title} · Library · Motion studio`;
  const multi = b.versions.length > 1;
  page.append(el('header', { class: 'film-head' }, [
    el('h1', {}, b.title),
    el('p', { html: `<a href="#/library">Library</a> · ${b.count} film${b.count === 1 ? '' : 's'}${multi ? ` in ${b.versions.length} versions` : ''}` }),
  ]));
  const frames = $('#frames');
  for (const v of b.versions) {
    const id = `ver-${v.version}`;
    const label = `${b.title}${multi ? ` v${v.version}` : ''}`;
    const reel = { slug: v.slug, title: label, videos: v.videos };
    const shelf = el('ul', { class: 'shelf' });
    v.videos.forEach((f, i) => shelf.append(el('li', { class: 'film', style: `--ar:${f.w / f.h}` }, [
      el('button', { type: 'button', class: 'screen', 'aria-label': `Play ${label} ${formatName(f.format)} full screen`, onclick: () => play(reel, i) }, [
        el('video', { src: `${media(v.slug, f.file)}#t=1`, preload: 'metadata', muted: true, playsinline: true, 'aria-hidden': 'true', tabindex: '-1' }),
        el('span', { class: 'play', 'aria-hidden': 'true' }),
      ]),
      el('div', { class: 'fname' }, `${formatName(f.format)} · ${f.w}×${f.h}`),
      el('div', { class: 'fmeta' }, [secs(f.duration), f.fps && `${f.fps} fps`, f.audio === false && 'no audio', mb(f.size)].filter(Boolean).join(' · ')),
      el('div', { class: 'dl' }, [
        el('a', { href: `${media(v.slug, f.file)}?download=1`, download: f.file }, 'Download master'),
        f.posting && el('a', { href: `${media(v.slug, f.posting)}?download=1`, download: f.posting }, `Posting copy (${mb(f.postingSize)})`),
      ]),
    ])));
    page.append(el('section', { class: 'version', id }, [
      multi ? el('h2', { class: 'ver-h' }, [`Version ${v.version}`, el('span', {}, `${v.version === b.versions[0].version ? 'latest · ' : ''}${ago(v.updated)} · `),
        el('a', { href: `#/film/${encodeURIComponent(v.slug)}` }, 'Gates')]) : null,
      shelf,
    ]));
    frames.append(el('li', {}, railLink(id, [el('span', { class: 'n' }, `v${v.version}`), el('span', { class: 'label' }, `${v.videos.length} film${v.videos.length === 1 ? '' : 's'}`)])));
  }
}

// Full-screen player. Opens on a click (browsers only allow full screen from a user action);
// leaving full screen or pressing Esc closes it. Shift+← / Shift+→ step through the brand's other
// formats (plain arrows stay with the video: they seek).
function play(b, index) {
  let i = index;
  const video = el('video', { controls: true, autoplay: true, playsinline: true });
  const label = el('span', { class: 'p-title' });
  const dialog = el('dialog', { class: 'player', 'aria-label': `${b.title} player` }, [
    video,
    el('div', { class: 'p-bar' }, [
      label,
      b.videos.length > 1 && el('button', { type: 'button', onclick: () => go(i - 1) }, 'Previous format'),
      b.videos.length > 1 && el('button', { type: 'button', onclick: () => go(i + 1) }, 'Next format'),
      el('button', { type: 'button', onclick: () => close() }, 'Close'),
    ]),
  ]);
  function go(n) {
    i = (n + b.videos.length) % b.videos.length;
    const v = b.videos[i];
    video.src = media(b.slug, v.file);
    label.textContent = `${b.title} · ${formatName(v.format)} ${v.w}×${v.h}`;
    video.play().catch(() => {});
  }
  function close() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    video.pause(); video.removeAttribute('src'); video.load();
    dialog.close(); dialog.remove();
    document.removeEventListener('fullscreenchange', onFs);
    removeEventListener('hashchange', close);
  }
  const onFs = () => { if (!document.fullscreenElement && dialog.open) close(); };
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' && e.shiftKey) go(i + 1);
    else if (e.key === 'ArrowLeft' && e.shiftKey) go(i - 1);
  });
  document.body.append(dialog);
  dialog.showModal();
  go(i);
  dialog.requestFullscreen?.().then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
  addEventListener('hashchange', close);
  video.focus();
}

// ═══ Router ══════════════════════════════════════════════════════
async function route() {
  const [, view, arg] = location.hash.match(/^#\/(brief|film|run|library)\/([^/]+)$/) ?? [];
  const slug = arg && decodeURIComponent(arg);
  const section = location.hash.startsWith('#/library') ? 'library' : location.hash.startsWith('#/agents') ? 'agents' : 'home';
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (view === 'brief') return viewBrief(slug === 'new' ? null : slug);
  if (view === 'film') return viewFilm(slug);
  if (view === 'run') return viewRun(slug);
  if (view === 'library') return viewBrand(slug);
  if (location.hash === '#/agents') return viewAgents();
  if (location.hash === '#/library') return viewLibrary();
  editing = null;
  return viewList();
}
let lastHash = location.hash;
addEventListener('hashchange', () => {
  if (lastHash.startsWith('#/brief/') && editing && dirty() && !confirm('You have unsaved changes to this brief. Leave without saving?')) {
    history.replaceState(null, '', lastHash); return;
  }
  lastHash = location.hash;
  route();
});
route();
