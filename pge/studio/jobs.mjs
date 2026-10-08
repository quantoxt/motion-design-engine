// Image jobs, server side: briefs in pge/briefs/, jobs in pge/jobs/<slug>/ scaffolded from pge/_template/,
// gate status read from the files the pipeline writes, and the story-plan approval. Pure file checks.
import { cp, readFile, writeFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync, mkdirSync, cpSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, readBack, briefTitle } from '../../studio/brief.mjs';
import { readResult } from '../lib/gate.mjs';
import { createRefs } from '../../studio/refs.mjs';

export const BRIEFS = 'pge/briefs', JOBS = 'pge/jobs';
const mtime = async (p) => { try { return (await stat(p)).mtime.toISOString(); } catch { return null; } };
const read = async (p) => { try { return await readFile(p, 'utf8'); } catch { return null; } };
const pngs = async (d) => { try { return (await readdir(d)).filter((f) => f.endsWith('.png')).sort(); } catch { return []; } };
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const readApprovals = async (dir) => { try { return JSON.parse(await readFile(join(dir, 'docs', 'approvals.json'), 'utf8')); } catch { return {}; } };
const jobDir = (root, slug) => join(root, JOBS, slug);

// Saved briefs, newest first, with the job's progress when one exists.
export async function briefs(root) {
  let names = [];
  try { names = (await readdir(join(root, BRIEFS))).filter((f) => f.endsWith('.md')); } catch {}
  const list = await Promise.all(names.map(async (f) => {
    const slug = f.slice(0, -3), file = join(root, BRIEFS, f);
    const g = await gates(root, slug);
    return { slug, title: briefTitle(await readFile(file, 'utf8')), modified: (await stat(file)).mtime,
      job: g && { slug, done: g.done, total: g.gates.length, current: g.gates.find((x) => x.state === 'current')?.name ?? null } };
  }));
  return list.sort((a, b) => b.modified - a.modified);
}

// Job list for the Images page: every job folder, newest activity first, with its cover (first final or draft).
export async function jobs(root) {
  let names = [];
  try { names = (await readdir(join(root, JOBS), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  const list = await Promise.all(names.map(async (slug) => {
    const g = await gates(root, slug);
    const title = briefTitle((await read(join(jobDir(root, slug), 'docs', 'brief.md'))) ?? '') || slug;
    const imgs = await images(root, slug);
    return { slug, title, done: g.done, total: g.gates.length, current: g.gates.find((x) => x.state === 'current')?.name ?? null,
      cover: imgs.final[0] ?? imgs.draft[0] ?? null, finals: imgs.final.length, updated: g.updated };
  }));
  return list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

// Rendered images, as paths relative to the job's out/ (what /pge-media/ serves).
export async function images(root, slug) {
  const out = join(jobDir(root, slug), 'out');
  const final = (await pngs(join(out, 'final'))).map((f) => `final/${f}`);
  const draft = [];
  try {
    for (const d of (await readdir(join(out, 'draft'), { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).sort())
      for (const f of await pngs(join(out, 'draft', d))) draft.push(`draft/${d}/${f}`);
  } catch {}
  // Phone-size sheets: the final ones once they exist, else the drafts'. (contact.png is a copy of the primary's.)
  const finalSheets = (await pngs(out)).filter((f) => f.startsWith('contact_'));
  const contacts = finalSheets.length ? finalSheets : (await pngs(join(out, 'draft'))).filter((f) => f.startsWith('contact_')).map((f) => `draft/${f}`);
  // Finals grouped by format, in job.json's order (primary first): the viewer and the zip download read this.
  let formats = [];
  try { formats = JSON.parse(await readFile(join(jobDir(root, slug), 'job.json'), 'utf8')).formats ?? []; } catch {}
  const byFormat = formats.map((fm) => ({ name: fm.name, w: fm.w, h: fm.h,
    files: final.filter((x) => x.startsWith(`final/${slug}-${fm.name}-`)) })).filter((fm) => fm.files.length);
  return { final, draft, contacts, byFormat };
}

// Final PNGs to zip: all formats, or one. → [{ name (path inside the zip), file (absolute) }]
export async function finalFiles(root, slug, format = null) {
  const { byFormat } = await images(root, slug);
  return byFormat.filter((fm) => !format || fm.name === format)
    .flatMap((fm) => fm.files.map((rel) => ({ name: `${slug}/${fm.name}/${rel.split('/').pop()}`, file: join(jobDir(root, slug), 'out', rel) })));
}

// A file under out/ the browser may load: PNGs only, no path tricks.
export function mediaPath(root, slug, rel) {
  if (typeof rel !== 'string' || !/^[a-z0-9_./-]+\.png$/i.test(rel) || rel.includes('..')) return null;
  const file = normalize(join(jobDir(root, slug), 'out', rel));
  return file.startsWith(join(jobDir(root, slug), 'out') + '/') && existsSync(file) ? file : null;
}

// Copy pge/_template → pge/jobs/<slug>, put the brief in docs/brief.md, and set job.json formats from it.
export async function scaffold(root, slug) {
  const brief = join(root, BRIEFS, `${slug}.md`), dest = jobDir(root, slug);
  if (!existsSync(brief)) return { status: 404, error: `${BRIEFS}/${slug}.md doesn't exist. Save the brief first.` };
  if (existsSync(dest)) return { status: 409, error: `${JOBS}/${slug}/ already exists.` };
  await mkdir(join(root, JOBS), { recursive: true });
  await cp(join(root, 'pge', '_template'), dest, { recursive: true });
  const md = await readFile(brief, 'utf8');
  await writeFile(join(dest, 'docs', 'brief.md'), md);
  await refs.copyInto(root, slug, dest);   // design references + refs.md
  const job = JSON.parse(await readFile(join(dest, 'job.json'), 'utf8'));
  Object.assign(job, jobSettings(md));
  await writeFile(join(dest, 'job.json'), JSON.stringify(job, null, 2) + '\n');
  return { status: 201, path: `${JOBS}/${slug}/` };
}

// Brief → job.json: the ticked formats (first = primary) and what the job makes.
const RATIO_NAMES = { '4:5': 'portrait', '1:1': 'square', '9:16': 'story', '16:9': 'wide', '3:4': 'poster' };
export function jobSettings(md) {
  let model, state;
  try { model = parse(md); ({ state } = readBack(model, md)); } catch { return {}; }
  const choice = (label) => model.sections.flatMap((s) => s.blocks).find((b) => b.type === 'choice' && b.label?.toLowerCase().startsWith(label));
  const picked = (b) => (b?.options ?? []).filter((o) => state.checks?.[o.line]).map((o) => o.parts.map((p) => p.text ?? '').join(''));
  const out = {};
  const formats = picked(choice('formats')).map((t) => {
    const m = t.match(/(\d+:\d+)\D+?(\d{3,4})\s*[×x]\s*(\d{3,4})/);
    return m && { name: RATIO_NAMES[m[1]] ?? m[1].replace(':', 'x'), w: Number(m[2]), h: Number(m[3]) };
  }).filter(Boolean);
  if (formats.length) out.formats = formats;
  const kind = picked(choice('what to make'))[0]?.toLowerCase() ?? '';
  if (kind.startsWith('single')) out.kind = 'single';
  else if (kind.startsWith('poster')) out.kind = 'poster';
  else if (kind.startsWith('carousel')) out.kind = 'carousel';
  return out;
}

// Gates, in order. The first one not done is "current".
export async function gates(root, slug) {
  const dir = jobDir(root, slug);
  if (!existsSync(dir)) return null;
  const docs = (f) => join(dir, 'docs', f), out = (f) => join(dir, 'out', f);
  const plan = await read(docs('plan.md'));
  const approval = (await readApprovals(dir)).plan ?? null;
  const planOk = plan != null && approval?.sha256 === sha256(plan);
  const imgs = await images(root, slug);
  const check = readResult(dir);
  const review = await read(docs('review_log.md'));
  const rounds = (review?.match(/^##+\s*Round\b/gim) ?? []).length;
  const list = [
    { id: 'brief', name: 'Brief', done: existsSync(docs('brief.md')), evidence: 'docs/brief.md', updated: await mtime(docs('brief.md')) },
    { id: 'style', name: 'Assets and style guide', done: existsSync(docs('style_guide.md')), evidence: 'docs/style_guide.md', updated: await mtime(docs('style_guide.md')) },
    { id: 'plan', name: 'Story plan (your OK)', done: planOk, evidence: 'docs/plan.md', updated: await mtime(docs('plan.md')),
      approval: plan == null ? 'missing' : planOk ? 'approved' : approval ? 'stale' : 'waiting' },
    { id: 'draft', name: 'Draft panels', done: imgs.draft.length > 0, evidence: 'out/draft/', updated: await mtime(join(dir, 'out', 'draft')) },
    { id: 'checks', name: 'Machine checks', done: check.state === 'passed', evidence: 'out/check.json', updated: check.result?.at ?? null,
      note: check.state === 'stale' ? 'The code changed since the checks ran.' : check.state === 'failed' ? 'Checks failed: see out/check.json.' : null },
    { id: 'critique', name: 'Critique (4 rounds)', done: rounds >= 4, evidence: `docs/review_log.md (${rounds} round${rounds === 1 ? '' : 's'})`, updated: await mtime(docs('review_log.md')) },
    { id: 'final', name: 'Final images', done: imgs.final.length > 0 && existsSync(out('contact.png')), evidence: 'out/final/ + out/contact.png', updated: await mtime(out('contact.png')) },
  ];
  let current = false;
  for (const g of list) { g.state = g.done ? 'done' : current ? 'todo' : 'current'; if (!g.done) current = true; }
  const updated = list.map((g) => g.updated).filter(Boolean).sort().at(-1) ?? null;
  return { slug, path: `${JOBS}/${slug}/`, gates: list, done: list.filter((g) => g.done).length, updated };
}

// Home's "Needs you" for image jobs: a story plan waiting for an OK, an agent that failed or was cut off.
export async function attention(root, history = () => []) {
  let names = [];
  try { names = (await readdir(join(root, JOBS), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  const items = [];
  for (const slug of names) {
    const plan = (await gates(root, slug)).gates.find((x) => x.id === 'plan');
    if (plan.approval === 'waiting' || plan.approval === 'stale')
      items.push({ slug, image: true, kind: 'plan', key: `plan:${slug}:${plan.approval}:${plan.updated}`,
        text: plan.approval === 'stale' ? 'Image story plan changed after you approved it. It needs your OK again.' : 'Image story plan is ready for your OK.' });
    const last = history(slug)[0];
    if (last && (last.state === 'interrupted' || (last.state === 'exited' && last.exitCode !== 0 && last.exitCode !== 129)))
      items.push({ slug, image: true, kind: 'image-agent', key: `image-agent:${slug}:${last.id}`,
        text: last.state === 'interrupted' ? 'The image agent was cut off when the studio stopped.' : `The image agent exited with code ${last.exitCode}.` });
  }
  return items;
}

export async function planFile(root, slug) {
  const dir = jobDir(root, slug);
  if (!existsSync(dir)) return { status: 404, error: `${JOBS}/${slug}/ doesn't exist.` };
  const text = await read(join(dir, 'docs', 'plan.md'));
  if (text == null) return { status: 404, error: 'No story plan yet. The agent writes docs/plan.md after the style guide.' };
  const approval = (await readApprovals(dir)).plan ?? null;
  return { status: 200, text, sha256: sha256(text), approval, current: approval?.sha256 === sha256(text) };
}

export async function approvePlan(root, slug, seenSha) {
  const r = await planFile(root, slug);
  if (r.status !== 200) return r;
  if (seenSha !== r.sha256) return { status: 409, error: 'The plan changed since you opened it. Read the new version, then approve.' };
  const dir = jobDir(root, slug), approvals = await readApprovals(dir);
  approvals.plan = { approved: true, sha256: r.sha256, at: new Date().toISOString() };
  await writeFile(join(dir, 'docs', 'approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
  return { status: 200, approval: approvals.plan };
}

export async function revokePlan(root, slug) {
  const dir = jobDir(root, slug);
  if (!existsSync(dir)) return { status: 404, error: `${JOBS}/${slug}/ doesn't exist.` };
  const approvals = await readApprovals(dir);
  delete approvals.plan;
  await writeFile(join(dir, 'docs', 'approvals.json'), JSON.stringify(approvals, null, 2) + '\n');
  return { status: 200 };
}

// ── Design references: images and clips uploaded with an image brief (studio/refs.mjs, shared with films) ──
// Stored next to the brief in pge/briefs/<slug>.refs/, copied into the job's assets/refs/ (with refs.md) when the
// job starts, and kept in step there on every change once the job exists.
export const refs = createRefs({ briefs: BRIEFS, targets: async (root, slug) => (existsSync(jobDir(root, slug)) ? [jobDir(root, slug)] : []) });

// ── Running an agent again on a job that already has work (studio/terminal.mjs guard) ──
// A fresh run starts the brief over, so the studio asks first. A delivered job is backed up before the agent starts:
// out/final/, the docs and the drawing code go to out/backup-<time>/, so a mistaken click can't cost the finals.
export function runGuard(root) {
  return (slug, history) => {
    const dir = jobDir(root, slug);
    let finals = [];
    try { finals = readdirSync(join(dir, 'out', 'final')).filter((f) => f.endsWith('.png')); } catch {}
    if (finals.length) {
      const backup = `out/backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
      return {
        message: `This job is delivered (${finals.length} final images). A new agent reworks it and can overwrite them. `
          + `The finals, docs and index.html are copied to ${JOBS}/${slug}/${backup}/ first. Run a new agent anyway?`,
        note: `This job was delivered before. That version is backed up in ${backup}/ (read it, never write to it). `
          + 'Read docs/ first (plan, review log, lessons), then rework it under the current pge/AGENTS.md rules; a changed plan needs a new OK.',
        before: () => {
          const to = join(dir, backup);
          mkdirSync(to, { recursive: true });
          cpSync(join(dir, 'out', 'final'), join(to, 'final'), { recursive: true });
          for (const f of ['docs', 'index.html', 'job.json']) if (existsSync(join(dir, f))) cpSync(join(dir, f), join(to, f), { recursive: true });
        },
      };
    }
    const started = existsSync(join(dir, 'docs', 'plan.md')) || existsSync(join(dir, 'docs', 'style_guide.md')) || history.length > 0;
    if (!started) return null;
    return {
      message: 'An agent has already worked on this job. A new agent starts from the brief again, on top of that work. '
        + 'To continue where it stopped, use Resume instead. Run a new agent anyway?',
      note: 'This job already has work in it: read docs/ and out/ first and continue from the first unfinished gate. Don’t redo finished gates.',
    };
  };
}
