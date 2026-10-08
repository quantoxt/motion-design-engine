// Check results for an image job, tied to the job's code. out/check.json carries the fingerprint of
// index.html + job.json; editing either makes the result stale, and the final render refuses to run.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function fingerprint(dir) {
  const h = createHash('sha256');
  for (const f of ['index.html', 'job.json']) h.update(existsSync(join(dir, f)) ? readFileSync(join(dir, f)) : '');
  return h.digest('hex').slice(0, 16);
}

export function writeResult(dir, result) {
  mkdirSync(join(dir, 'out'), { recursive: true });
  const body = { ...result, fingerprint: fingerprint(dir), at: new Date().toISOString() };
  writeFileSync(join(dir, 'out', 'check.json'), JSON.stringify(body, null, 2) + '\n');
  return body;
}

// → { state: 'missing' | 'stale' | 'failed' | 'passed', result }
export function readResult(dir) {
  let result = null;
  try { result = JSON.parse(readFileSync(join(dir, 'out', 'check.json'), 'utf8')); } catch {}
  const state = !result ? 'missing' : result.fingerprint !== fingerprint(dir) ? 'stale' : result.ok ? 'passed' : 'failed';
  return { state, result };
}
