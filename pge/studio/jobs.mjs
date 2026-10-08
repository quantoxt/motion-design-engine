// Image jobs, server side: briefs in pge/briefs/, jobs in pge/jobs/<slug>/ scaffolded from pge/_template/,
// gate status read from the files the pipeline writes, and the story-plan approval. Pure file checks.
import { cp, readFile, writeFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { parse, readBack, briefTitle } from '../../studio/brief.mjs';
import { readResult } from '../lib/gate.mjs';

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
  if (existsSync(refsDir(root, slug))) await cp(refsDir(root, slug), join(dest, 'assets', 'refs'), { recursive: true });   // design references
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

// ── Design references: images uploaded with an image brief, for the agent to study (never to copy) ──
// Stored next to the brief in pge/briefs/<slug>.refs/, copied into the job's assets/refs/ when the job starts,
// and mirrored there on upload/delete once the job exists. Only real images (checked by their first bytes).
export const REF_MAX = 15 * 1024 * 1024, REF_COUNT = 40;
const REF_TYPES = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38] };
export function imageType(buf) {
  for (const [ext, sig] of Object.entries(REF_TYPES)) if (sig.every((b, i) => buf[i] === b)) return ext;
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
export const refsDir = (root, slug) => join(root, BRIEFS, `${slug}.refs`);
const jobRefs = (root, slug) => join(jobDir(root, slug), 'assets', 'refs');
const REF_NAME = /^[a-z0-9][a-z0-9._-]{0,80}\.(png|jpg|gif|webp)$/;

export async function listRefs(root, slug) {
  let names = [];
  try { names = (await readdir(refsDir(root, slug))).filter((f) => REF_NAME.test(f)).sort(); } catch {}
  return Promise.all(names.map(async (name) => ({ name, size: (await stat(join(refsDir(root, slug), name))).size })));
}

// Save one uploaded image. name = the original file name (cleaned up; the extension follows the real type).
export async function addRef(root, slug, name, buf) {
  if (!existsSync(join(root, BRIEFS, `${slug}.md`))) return { status: 404, error: 'Save the brief first, then add references.' };
  if (!buf.length) return { status: 400, error: 'Empty file.' };
  if (buf.length > REF_MAX) return { status: 413, error: 'Over 15 MB.' };
  const ext = imageType(buf);
  if (!ext) return { status: 415, error: 'Only PNG, JPG, GIF or WebP images.' };
  const have = await listRefs(root, slug);
  if (have.length >= REF_COUNT) return { status: 409, error: `${REF_COUNT} references at most.` };
  const stem = String(name ?? '').toLowerCase().replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ref';
  let file = `${stem}.${ext}`;
  for (let k = 2; have.some((r) => r.name === file); k++) file = `${stem}-${k}.${ext}`;
  await mkdir(refsDir(root, slug), { recursive: true });
  await writeFile(join(refsDir(root, slug), file), buf);
  if (existsSync(jobDir(root, slug))) { await mkdir(jobRefs(root, slug), { recursive: true }); await writeFile(join(jobRefs(root, slug), file), buf); }
  return { status: 201, name: file };
}

export async function removeRef(root, slug, name) {
  if (!REF_NAME.test(name ?? '')) return { status: 400, error: 'Invalid name.' };
  const file = join(refsDir(root, slug), name);
  if (!existsSync(file)) return { status: 404, error: 'No such reference.' };
  await rm(file);
  await rm(join(jobRefs(root, slug), name), { force: true });
  return { status: 200 };
}

export function refPath(root, slug, name) {
  if (!REF_NAME.test(name ?? '')) return null;
  const file = join(refsDir(root, slug), name);
  return existsSync(file) ? file : null;
}
