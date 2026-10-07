// Machine-check results, shared by check.mjs, holds.mjs, the renderer and the studio.
// Each checker writes out/<name>.json with the film's fingerprint (sha of index.html + film.json).
// A result counts only while that fingerprint still matches: editing the film makes it stale.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CHECKS = ['check', 'holds'];

export function fingerprint(dir) {
  const h = createHash('sha256');
  for (const f of ['index.html', 'film.json']) h.update(existsSync(join(dir, f)) ? readFileSync(join(dir, f)) : '');
  return h.digest('hex').slice(0, 16);
}

export function writeResult(dir, name, result) {
  const body = { ...result, fingerprint: fingerprint(dir), at: new Date().toISOString() };
  writeFileSync(join(dir, 'out', `${name}.json`), JSON.stringify(body, null, 2) + '\n');
  return body;
}

// → { name, state: 'missing' | 'stale' | 'failed' | 'passed', result }
export function readResult(dir, name) {
  let result = null;
  try { result = JSON.parse(readFileSync(join(dir, 'out', `${name}.json`), 'utf8')); } catch {}
  const state = !result ? 'missing' : result.fingerprint !== fingerprint(dir) ? 'stale' : result.ok ? 'passed' : 'failed';
  return { name, state, result };
}

// Why a full render may not start yet ([] = go).
export function blockers(dir) {
  const how = { check: 'node check.mjs --dir <film>', holds: 'node render-parallel.mjs --dir <film> --scan && node holds.mjs --dir <film>' };
  return CHECKS.map((n) => readResult(dir, n)).filter((r) => r.state !== 'passed')
    .map((r) => `${r.name}: ${r.state === 'stale' ? 'the film changed since it ran' : r.state}. Run: ${how[r.name]}`);
}

// ── Primary render review ─────────────────────────────────────────
// The primary format (film.json formats[0]) renders first; you watch it and approve it in the studio;
// only then do the other formats render. The approval (docs/approvals.json → primary) is tied to the
// exact render (size + mtime) and the film's fingerprint, so a re-render or a code edit needs a new OK.
export function primaryFormat(dir) {
  let film = {};
  try { film = JSON.parse(readFileSync(join(dir, 'film.json'), 'utf8')); } catch {}
  const f = film.formats?.[0];
  return f ? { name: f.name, w: f.w, h: f.h, file: `silent_${f.name}.mp4` } : { name: null, w: film.w, h: film.h, file: 'silent.mp4' };
}

export function stampOf(file) {
  try { const s = statSync(file); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return null; }
}

// → { state: 'missing' | 'waiting' | 'stale' | 'approved', primary, stamp, approval }
export function primaryReview(dir) {
  const primary = primaryFormat(dir), stamp = stampOf(join(dir, 'out', primary.file));
  let approval = null;
  try { approval = JSON.parse(readFileSync(join(dir, 'docs', 'approvals.json'), 'utf8')).primary ?? null; } catch {}
  const state = !stamp ? 'missing' : !approval ? 'waiting'
    : approval.stamp === stamp && approval.fingerprint === fingerprint(dir) ? 'approved' : 'stale';
  return { state, primary, stamp, approval };
}

// Why a full render of format `name` may not start yet ([] = go). The primary itself is never blocked here,
// nor a plain render to silent.mp4 at film.json's own size (name null).
export function formatBlockers(dir, name) {
  const r = primaryReview(dir);
  if (!r.primary.name || name == null || name === r.primary.name || r.state === 'approved') return [];
  return [{
    missing: `primary: render ${r.primary.name} first (--all-formats --formats ${r.primary.name}), then approve it in the studio`,
    waiting: `primary: ${r.primary.file} is waiting for the human's OK in the studio (film page → Primary render)`,
    stale: `primary: the approval no longer matches (re-rendered or the film changed): it needs a new OK in the studio`,
  }[r.state]];
}
