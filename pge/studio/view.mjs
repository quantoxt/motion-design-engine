// Studio views for image jobs (served as /pge.mjs, loaded by studio/app.mjs on #/images…).
//   #/images         image jobs and image briefs
//   #/images/<slug>  one job: agent terminal, gates (story plan OK), rendered panels
// ctx carries the studio's helpers, so this file has no imports and the studio keeps one look.

const STYLE = `
.pge-grid { list-style: none; margin: 18px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.pge-grid a { display: block; color: inherit; text-decoration: none; }
.pge-grid img { display: block; width: 100%; height: auto; background: var(--strip); border: 1px solid var(--rule); }
.pge-grid span { display: block; margin-top: 6px; font-size: 0.85rem; color: var(--soft); overflow-wrap: anywhere; }
.pge-thumb { width: 72px; height: 90px; object-fit: cover; background: var(--strip); border: 1px solid var(--rule); }
.pge-row { grid-template-columns: auto minmax(0, 1fr) auto; }
.pge-sheet { display: block; max-width: 100%; height: auto; margin-top: 14px; border: 1px solid var(--rule); }
.pge-sec { margin-top: 44px; }
.pge-sec h2 { margin: 0; font-size: 1.3rem; }
.pge-sec p { color: var(--soft); margin: 6px 0 0; }
.pge-sec-head { display: flex; gap: 12px 20px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
.pge-fmt { margin-top: 26px; }
.pge-fmt-head { display: flex; gap: 10px 16px; align-items: baseline; flex-wrap: wrap; }
.pge-fmt-head h3 { margin: 0; font-size: 1.05rem; }
.pge-fmt-head span { color: var(--soft); font-size: 0.9rem; }
.pge-grid button { all: unset; display: block; cursor: zoom-in; width: 100%; }
.pge-grid button:focus-visible img { outline: 3px solid var(--accent); outline-offset: 2px; }
.pge-view { border: 0; padding: 0; margin: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; overflow: hidden; background: #0B0E13; color: #E3E7EE; }
.pge-view::backdrop { background: #0B0E13; }
.pge-view .stage { position: absolute; inset: 56px 64px 64px; display: grid; place-items: center; }
/* Sized from the viewport (the stage's 56px top + 64px bottom, 64px each side): a % max-height inside a grid cell
   has no definite height to resolve against, so the PNG rendered at full size and the dialog scrolled. */
.pge-view img { display: block; width: auto; height: auto; max-width: calc(100vw - 128px); max-height: calc(100vh - 120px); object-fit: contain; box-shadow: 0 0 0 1px #2C3442; }
.pge-view .top { position: absolute; top: 0; left: 0; right: 0; height: 56px; display: flex; gap: 16px; align-items: center; padding: 0 18px; }
.pge-view .top .count { font-variant-numeric: tabular-nums; }
.pge-view .top .name { color: #AEB6C4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.pge-view a.button, .pge-view button { border-color: #E3E7EE; color: #E3E7EE; }
.pge-view .nav-btn { position: absolute; top: 50%; transform: translateY(-50%); font-size: 1.6rem; padding: 10px 14px; line-height: 1; }
.pge-view .prev { left: 10px; } .pge-view .next { right: 10px; }
.pge-view .dots { position: absolute; bottom: 22px; left: 0; right: 0; display: flex; gap: 8px; justify-content: center; }
.pge-view .dots i { width: 8px; height: 8px; border-radius: 50%; background: #4A5366; }
.pge-view .dots i.on { background: #E3E7EE; }
`;
const STATE_LABEL = { done: 'Done', current: 'Up next', todo: 'Not started' };
const APPROVAL_LABEL = { waiting: 'Needs your OK', stale: 'Changed, needs your OK' };
const enc = encodeURIComponent;
const media = (slug, rel, v) => `/pge-media/${enc(slug)}/${rel.split('/').map(enc).join('/')}${v ? `?v=${enc(v)}` : ''}`;

function style(ctx) {
  if (!document.getElementById('pge-style')) document.head.append(ctx.el('style', { id: 'pge-style' }, STYLE));
}

// ═══ #/images ═════════════════════════════════════════════════════
export async function viewImages(ctx) {
  const { $, el, api, shell, fatal, escHtml, ago } = ctx;
  shell();
  style(ctx);
  document.title = 'Images · Motion studio';
  const page = $('#page');
  page.append(el('div', { class: 'list-head' }, [
    el('h1', {}, 'Images'),
    el('a', { class: 'button primary', href: '#/images/brief/new' }, 'New image brief'),
  ]), el('p', { class: 'note', style: 'color:var(--soft);max-width:60ch' },
    'Stills that tell a story: a single image, a poster, or a carousel of panels. Same factory as the films (canvas, code, checks), rendered as PNGs. Engine: pge/.'));

  const [{ res: jr, body: list }, { res: br, body: briefs }] = await Promise.all([api('/api/pge/jobs'), api('/api/pge/briefs')]);
  if (!jr.ok || !br.ok) return fatal('Couldn’t read <code>pge/</code>. Restart <code>node studio.mjs</code> if it was started before the Images section existed.');

  if (list.length) {
    const rows = el('ul', { class: 'rows' });
    for (const j of list) rows.append(el('li', { class: 'row pge-row' }, [
      j.cover ? el('img', { class: 'pge-thumb', src: media(j.slug, j.cover, j.updated), alt: '', loading: 'lazy' }) : el('div', { class: 'pge-thumb' }),
      el('div', {}, [
        el('div', { class: 'name' }, j.title),
        el('div', { class: 'meta', html: `<code>pge/jobs/${escHtml(j.slug)}/</code> · ${j.done} of ${j.total} gates${j.current ? `, next: ${escHtml(j.current)}` : ', delivered'}${j.finals ? ` · ${j.finals} final image${j.finals === 1 ? '' : 's'}` : ''}${j.updated ? ` · ${ago(j.updated)}` : ''}` }),
      ]),
      el('div', { class: 'acts' }, [
        j.finals ? el('a', { class: 'button', href: `/pge-media/${enc(j.slug)}/finals.zip`, download: '' }, 'Download zip') : null,
        el('a', { class: 'button primary', href: `#/images/${enc(j.slug)}` }, 'Open'),
      ]),
    ]));
    page.append(rows);
  }

  const waiting = briefs.filter((b) => !b.job);
  page.append(el('div', { class: 'list-head briefs-head', style: 'margin-top:48px' }, [el('h2', {}, 'Image briefs')]));
  if (!briefs.length) {
    page.append(el('div', { class: 'empty', html: 'No image briefs yet. Write one and it’s saved to <code>pge/briefs/</code>, ready to start.' }));
    return;
  }
  const rows = el('ul', { class: 'rows' });
  for (const b of briefs) rows.append(el('li', { class: 'row' }, [
    el('div', {}, [
      el('div', { class: 'name' }, b.title || b.slug),
      el('div', { class: 'meta', html: `<code>pge/briefs/${escHtml(b.slug)}.md</code> · saved ${ago(b.modified)} · ${b.job ? `job: ${b.job.done} of ${b.job.total} gates` : 'not started'}` }),
    ]),
    el('div', { class: 'acts' }, [
      el('a', { class: 'button', href: `#/images/brief/${enc(b.slug)}` }, 'Edit brief'),
      b.job ? el('a', { class: 'button primary', href: `#/images/${enc(b.slug)}` }, 'Open job')
        : el('button', { type: 'button', class: 'primary', onclick: (e) => start(ctx, b.slug, e.currentTarget) }, 'Start images'),
    ]),
  ]));
  page.append(rows);
  if (!waiting.length && !list.length) page.append(el('p', {}, 'Nothing started yet.'));
}

async function start(ctx, slug, btn) {
  btn.disabled = true; btn.textContent = 'Starting…';
  const { res, body } = await ctx.post('/api/pge/jobs', { slug });
  if (res.status === 201 || res.status === 409) { location.hash = `#/images/${enc(slug)}`; return; }
  btn.disabled = false; btn.textContent = 'Start images';
  alert(body.error || `Couldn’t start the job (${res.status}).`);
}

// ═══ #/images/<slug> ══════════════════════════════════════════════
export async function viewJob(ctx, slug) {
  const { $, el, api, post, shell, fatal, escHtml, ago, agentPane, renderMarkdown, railLink, onLeave } = ctx;
  shell({ railTitle: 'Gates' });
  style(ctx);
  document.title = `${slug} images · Motion studio`;
  const page = $('#page');
  const head = el('header', { class: 'film-head' });
  const list = el('ol', { class: 'gates' });
  const gallery = el('div');
  const { res: r0, body: f0 } = await api(`/api/pge/jobs/${enc(slug)}`);
  if (!r0.ok) return fatal(`${escHtml(f0.error || 'Job not found.')} <a href="#/images">Back to Images</a>`);
  // The agent pane is built once: the poll below rebuilds only the gates and the images.
  const agent = el('div', { class: 'handoff run-box' }, agentPane(slug, { base: '/api/pge/jobs' }));
  page.append(head, agent, list, gallery);

  let panel = null, panelSha = null;
  async function openPlan(msg) {
    const { res, body } = await api(`/api/pge/jobs/${enc(slug)}/plan`);
    if (!res.ok) { alert(body.error || 'Couldn’t read the plan.'); return; }
    panelSha = body.sha256;
    panel = el('div', { class: 'shot' }, [
      msg ? el('p', { class: 'flash' }, msg) : null,
      el('div', { class: 'shot-text md', tabindex: '0', role: 'document', 'aria-label': 'Story plan', html: renderMarkdown(body.text) }),
      el('div', { class: 'shot-acts' }, body.current
        ? [el('span', {}, `You approved this version ${ago(body.approval.at)}.`), el('button', { type: 'button', class: 'quiet', onclick: closePlan }, 'Close')]
        : [
          el('button', { type: 'button', class: 'primary', onclick: approve }, 'Approve this plan'),
          el('button', { type: 'button', class: 'quiet', onclick: closePlan }, 'Close'),
          el('span', { class: 'hint' }, 'Want changes? Tell the agent in the terminal. It updates the file, and you approve the new version here.'),
        ]),
    ]);
    await refresh(true);
    panel.querySelector('.shot-text')?.focus({ preventScroll: true });
  }
  function closePlan() { panel = null; panelSha = null; refresh(true); }
  async function approve(e) {
    e.currentTarget.disabled = true;
    const { res, body } = await post(`/api/pge/jobs/${enc(slug)}/plan/approve`, { sha256: panelSha });
    if (res.status === 409) return openPlan('The agent changed the plan while you were reading. This is the new version.');
    if (!res.ok) { e.currentTarget.disabled = false; alert(body.error || 'Approval failed.'); return; }
    panel = null; panelSha = null;
    await refresh(true);
  }
  async function revoke() {
    if (!confirm('Withdraw your approval? The agent should stop drawing until you approve again.')) return;
    await post(`/api/pge/jobs/${enc(slug)}/plan/revoke`, {});
    await refresh(true);
  }
  function planControls(g) {
    if (g.approval === 'missing') return null;
    const open = el('button', { type: 'button', onclick: () => openPlan() }, panel ? 'Reload plan' : 'Read plan');
    if (g.approval === 'approved') return el('div', { class: 'gacts' }, [open, el('button', { type: 'button', class: 'quiet', onclick: revoke }, 'Withdraw approval')]);
    return el('div', { class: 'gacts' }, [open, panel ? null : el('span', { class: 'hint' }, 'Read it, then approve it at the bottom.')]);
  }

  // A grid of panels; clicking one opens the viewer on that set (←/→ swipes through it like the carousel).
  const grid = (items, v, label) => el('ul', { class: 'pge-grid' }, items.map((rel, i) => el('li', {},
    el('button', { type: 'button', 'aria-label': `Open ${rel.split('/').pop()}`, onclick: () => viewer(ctx, slug, items, i, v, label) }, [
      el('img', { src: media(slug, rel, v), alt: rel.split('/').pop(), loading: 'lazy' }),
      el('span', {}, rel.split('/').pop()),
    ]))));
  const zipLink = (format, text) => el('a', { class: 'button', href: `/pge-media/${enc(slug)}/finals.zip${format ? `?format=${enc(format)}` : ''}`, download: '' }, text);

  let lastKey = '';
  async function refresh(force = false) {
    const { res, body: f } = await api(`/api/pge/jobs/${enc(slug)}`);
    if (!res.ok) return false;
    const key = JSON.stringify([f.gates.map((g) => [g.state, g.approval, g.updated, g.note]), f.images]) + (panel ? '' : Math.floor(Date.now() / 60000));
    if (!force && key === lastKey) return true;
    lastKey = key;
    head.innerHTML = `<h1>${escHtml(slug)}</h1><p><a href="#/images">Images</a> · <code>${escHtml(f.path)}</code> · ${f.done} of ${f.gates.length} gates done · <a href="#/images/brief/${enc(slug)}">See the brief</a> · checks the folder every few seconds</p>`;
    list.textContent = '';
    f.gates.forEach((g, i) => list.append(el('li', { class: 'gate', id: `g-${g.id}`, 'data-state': g.state }, [
      el('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)),
      el('div', {}, [el('div', { class: 'gname' }, g.name)]),
      el('span', { class: 'st' + (APPROVAL_LABEL[g.approval] ? ' ask' : '') }, (APPROVAL_LABEL[g.approval] ?? STATE_LABEL[g.state]) + (g.updated ? ` · ${ago(g.updated)}` : '')),
      el('div', { class: 'ev', html: `<code>${escHtml(g.evidence)}</code>` }),
      g.note && g.state !== 'todo' ? el('div', { class: 'gnote' }, g.note) : null,
      g.id === 'plan' ? planControls(g) : null,
      g.id === 'plan' && panel ? panel : null,
    ])));
    const frames = $('#frames'); frames.textContent = '';
    f.gates.forEach((g, i) => {
      const a = railLink(`g-${g.id}`, [el('span', { class: 'n' }, String(i + 1)), el('span', { class: 'label' }, g.name)]);
      a.dataset.lit = String(g.done);
      a.setAttribute('aria-current', String(g.state === 'current'));
      frames.append(el('li', {}, a));
    });
    const im = f.images, v = f.updated ?? '';
    gallery.textContent = '';
    if (im.final.length) gallery.append(el('section', { class: 'pge-sec' }, [
      el('div', { class: 'pge-sec-head' }, [el('h2', {}, 'Final images'), zipLink(null, `Download all (${im.final.length} images, zip)`)]),
      el('p', {}, 'Lossless PNGs in out/final/, one set per format, in posting order. Click one to view the set full screen.'),
      ...(im.byFormat.length ? im.byFormat : [{ name: '', files: im.final }]).map((fm) => el('div', { class: 'pge-fmt' }, [
        fm.name ? el('div', { class: 'pge-fmt-head' }, [el('h3', {}, fm.name), el('span', {}, `${fm.w}×${fm.h} · ${fm.files.length} image${fm.files.length === 1 ? '' : 's'}`),
          im.byFormat.length > 1 ? zipLink(fm.name, `Download ${fm.name} (zip)`) : null]) : null,
        grid(fm.files, v, fm.name || 'final'),
      ]))]));
    if (im.contacts.length) gallery.append(el('section', { class: 'pge-sec' }, [
      el('h2', {}, 'Contact sheets'), el('p', {}, 'Every panel at 360px wide: how it reads in a phone feed.'),
      ...im.contacts.map((c) => el('img', { class: 'pge-sheet', src: media(slug, c, v), alt: `Contact sheet ${c}`, loading: 'lazy' }))]));
    if (im.draft.length) gallery.append(el('section', { class: 'pge-sec' }, [
      el('h2', {}, 'Drafts'), el('p', {}, 'Work in progress from out/draft/.'), grid(im.draft, v, 'draft')]));
    return true;
  }
  await refresh(true);
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  onLeave(() => clearInterval(timer));
}

// Full-screen viewer for one set: ←/→ (or the buttons, or a swipe) step through it, Esc closes, D downloads.
function viewer(ctx, slug, items, start, v, label) {
  const { el } = ctx;
  let i = start, x0 = null;
  const img = el('img', { alt: '' });
  const count = el('span', { class: 'count' }), name = el('span', { class: 'name' });
  const save = el('a', { class: 'button', download: '' }, 'Download PNG');
  const dots = el('div', { class: 'dots', 'aria-hidden': 'true' }, items.map(() => el('i')));
  const close = () => dialog.close();
  const prev = el('button', { type: 'button', class: 'nav-btn prev', 'aria-label': 'Previous image', onclick: () => go(i - 1) }, '‹');
  const next = el('button', { type: 'button', class: 'nav-btn next', 'aria-label': 'Next image', onclick: () => go(i + 1) }, '›');
  const dialog = el('dialog', { class: 'pge-view', 'aria-label': `${slug} ${label} images` }, [
    el('div', { class: 'top' }, [count, name, save, el('button', { type: 'button', onclick: close }, 'Close')]),
    el('div', { class: 'stage' }, img), prev, next, dots,
  ]);
  function go(k) {
    i = Math.max(0, Math.min(items.length - 1, k));
    const rel = items[i], file = rel.split('/').pop();
    img.src = media(slug, rel, v); img.alt = `${label} image ${i + 1} of ${items.length}`;
    count.textContent = `${i + 1} / ${items.length}`; name.textContent = `${label} · ${file}`;
    save.href = `${media(slug, rel)}?download=1`;
    prev.disabled = i === 0; next.disabled = i === items.length - 1;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    if (items[i + 1]) new Image().src = media(slug, items[i + 1], v);   // the next one is ready when you swipe
  }
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'd' || e.key === 'D') save.click();
  });
  dialog.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  dialog.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 50) go(i + (e.clientX < x0 ? 1 : -1)); x0 = null; });
  dialog.addEventListener('close', () => { dialog.remove(); removeEventListener('hashchange', close); });
  addEventListener('hashchange', close);
  document.body.append(dialog);
  dialog.showModal();
  go(i);
  next.disabled ? prev.focus() : next.focus();
}
