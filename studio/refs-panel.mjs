// The "Design references" panel under a brief form (films and image jobs). Drop or pick images or short clips; each
// one gets its own row with its own note ("what to take from this"). A note is saved to its file by name
// (PUT …/refs/<name>), never by position, so notes can't swap when the list changes. Server side: studio/refs.mjs.
//   base    = the briefs endpoint ('/api/briefs' or '/api/pge/briefs')
//   folder  = where the brief lives, for the status line ('_raw' or 'pge/briefs')
//   getSlug = the saved brief's name (null until the brief is saved once)

const STYLE = `
.refs-drop { margin-top: 14px; padding: 28px 20px; border: 2px dashed var(--rule); border-radius: 4px; text-align: center; color: var(--soft); cursor: pointer; }
.refs-drop b { color: var(--ink); }
.refs-drop:hover, .refs-drop:focus-visible, .refs-drop.over { border-color: var(--accent); color: var(--ink); outline: none; }
.refs-drop.off { cursor: not-allowed; opacity: 0.6; }
.refs-status { color: var(--soft); min-height: 1.4em; }
.refs-list { list-style: none; margin: 8px 0 0; padding: 0; counter-reset: ref; }
.refs-list > li { counter-increment: ref; display: grid; grid-template-columns: 2.2em 168px minmax(0, 1fr); gap: 6px 16px; padding: 16px 0; border-top: 1px solid var(--rule); }
.refs-list > li::before { content: counter(ref); font-weight: 700; font-variant-numeric: tabular-nums; color: var(--soft); }
.refs-list .shot { display: block; width: 168px; }
.refs-list .shot img { display: block; width: 100%; max-height: 168px; object-fit: contain; background: var(--strip); border: 1px solid var(--rule); }
.refs-list .file { font-weight: 600; overflow-wrap: anywhere; }
.refs-list .meta { color: var(--soft); font-size: 0.85rem; }
.refs-list label { display: block; margin-top: 10px; font-size: 0.9rem; }
.refs-list textarea { display: block; width: 100%; box-sizing: border-box; min-height: 4.2em; margin-top: 4px; font: inherit; font-size: 0.95rem; padding: 8px 10px; border: 1.5px solid var(--rule); border-radius: 4px; background: var(--sheet); color: var(--ink); resize: vertical; }
.refs-list textarea:focus { border-color: var(--accent); outline: none; }
.refs-list .row-foot { display: flex; gap: 12px; align-items: center; margin-top: 6px; font-size: 0.85rem; color: var(--soft); }
.refs-list .row-foot .saved-err { color: var(--danger); }
.refs-list .x { padding: 1px 8px; font-size: 0.8rem; margin-left: auto; }
@media (max-width: 640px) { .refs-list > li { grid-template-columns: 2.2em minmax(0, 1fr); } .refs-list .shot { grid-column: 2; } .refs-list .body { grid-column: 2; } }
`;
const enc = encodeURIComponent;
const NOTE_MAX = 600;
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function refsPanel({ el, api }, { base, folder, getSlug }) {
  if (!document.getElementById('refs-style')) document.head.append(el('style', { id: 'refs-style' }, STYLE));
  const input = el('input', { type: 'file', multiple: true, hidden: true,
    accept: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm',
    onchange: () => { upload([...input.files]); input.value = ''; } });
  const status = el('p', { class: 'refs-status', role: 'status' });
  const list = el('ol', { class: 'refs-list' });
  const drop = el('div', { class: 'refs-drop', tabindex: '0', role: 'button', 'aria-label': 'Add reference images or clips',
    onclick: () => getSlug() && input.click(),
    onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && getSlug()) { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); },
  }, [el('b', {}, 'Drop images or clips here'), el('span', {}, ' or click to choose. Images up to 15 MB (PNG, JPG, GIF, WebP), clips up to 100 MB (MP4, MOV, WebM).')]);
  const box = el('section', { id: 'refs', 'aria-labelledby': 'refs-h' }, [
    el('header', {}, [el('span', { class: 'n', 'aria-hidden': 'true' }, '+'), el('h3', { id: 'refs-h' }, 'Design references')]),
    el('p', { class: 'note' }, 'Work whose look or motion you want. Under each one, say what to take from it: “the type cropped by the frame edge”, “the cut on every kick”, “colours only”. The agent reads each note with its own file, takes the grammar, never the content. Clips are cut into a sheet of frames, since the agent can’t watch video.'),
    drop, input, status, list,
  ]);

  // name → flush(): a row's pending note, saved now. Rows are rebuilt on every load, so pending notes go first.
  const pending = new Map();
  const flushAll = () => Promise.all([...pending.values()].map((f) => f()));
  const refUrl = (slug, name) => `${base}/${enc(slug)}/refs/${enc(name)}`;

  async function upload(files) {
    const slug = getSlug();
    if (!slug) { status.textContent = 'Save the brief first, then add references.'; return; }
    await flushAll();
    let ok = 0;
    for (const [k, f] of files.entries()) {
      status.textContent = `Uploading ${k + 1} of ${files.length}: ${f.name}${f.type.startsWith('video/') ? ' (cutting frames)' : ''}…`;
      const res = await fetch(`${base}/${enc(slug)}/refs?name=${enc(f.name)}`, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = `${f.name}: ${body.error || `upload failed (${res.status})`}`; await load(true); return; }
      ok++;
    }
    status.textContent = ok ? `Added ${ok} reference${ok === 1 ? '' : 's'}. Add a note to each: what to take from it.` : '';
    await load(true);
  }
  async function remove(slug, name) {
    if (!confirm(`Remove ${name} and its note?`)) return;
    await flushAll();
    await fetch(refUrl(slug, name), { method: 'DELETE' });
    await load();
  }

  function row(slug, r) {
    const url = refUrl(slug, r.name);
    const preview = r.kind === 'video' ? refUrl(slug, r.frames) : url;
    const saved = el('span', { 'aria-live': 'polite' }, r.note ? 'Saved' : '');
    const count = el('span', {}, `${r.note.length} / ${NOTE_MAX}`);
    const id = `ref-note-${r.name.replace(/[^a-z0-9]/g, '-')}`;
    let timer = null, last = r.note;
    const area = el('textarea', { id, maxlength: String(NOTE_MAX), placeholder: 'What should the agent take from this? Layout, type, colour, texture, a transition, the pacing…',
      oninput: () => { count.textContent = `${area.value.length} / ${NOTE_MAX}`; saved.textContent = 'Not saved yet'; saved.className = ''; clearTimeout(timer); timer = setTimeout(save, 700); },
      onblur: () => save() });
    area.value = r.note;
    // Saves this textarea to this file's name. The name is fixed for the row's life, so the note can only land on its own file.
    async function save() {
      clearTimeout(timer);
      if (area.value === last) return;
      const note = area.value;
      saved.textContent = 'Saving…';
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { last = note; if (area.value === note) { saved.textContent = 'Saved'; saved.className = ''; } }
      else { saved.textContent = body.error || `Not saved (${res.status})`; saved.className = 'saved-err'; }
    }
    pending.set(r.name, save);
    const meta = r.kind === 'video' ? `Clip · ${r.duration} s · ${kb(r.size)} · shown as ${r.count} frames, one every ${r.every} s` : `Image · ${kb(r.size)}`;
    return el('li', { 'data-name': r.name }, [
      el('a', { class: 'shot', href: url, target: '_blank', rel: 'noopener', title: r.kind === 'video' ? 'Open the clip' : 'Open the image' },
        el('img', { src: preview, alt: r.kind === 'video' ? `Frames from ${r.name}` : r.name, loading: 'lazy' })),
      el('div', { class: 'body' }, [
        el('div', { class: 'file' }, r.name),
        el('div', { class: 'meta' }, meta),
        el('label', { for: id }, `What to take from ${r.name}`),
        area,
        el('div', { class: 'row-foot' }, [saved, count,
          el('button', { type: 'button', class: 'quiet x', 'aria-label': `Remove ${r.name}`, onclick: () => remove(slug, r.name) }, 'Remove')]),
      ]),
    ]);
  }

  // keepStatus: leave an upload message in place.
  async function load(keepStatus = false) {
    await flushAll();
    pending.clear();
    const slug = getSlug();
    drop.classList.toggle('off', !slug);
    list.textContent = '';
    if (!slug) { status.textContent = 'Save the brief first (name it), then add references here.'; return; }
    const { res, body } = await api(`${base}/${enc(slug)}/refs`);
    if (!res.ok) { status.textContent = res.status === 404 ? 'Restart the studio to add references here.' : 'Couldn’t read the references.'; return; }
    if (!keepStatus) status.textContent = body.length ? `${body.length} reference${body.length === 1 ? '' : 's'}, saved in ${folder}/${slug}.refs/, in this order.` : '';
    for (const r of body) list.append(row(slug, r));
  }
  load();
  return { box, refresh: () => load(), flush: () => { flushAll(); } };
}
