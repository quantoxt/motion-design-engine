// Terminal sessions against a fake PTY (no native module, no real agent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTerminals, command, appendLog } from './terminal.mjs';

const root = mkdtempSync(join(tmpdir(), 'studio-term-'));
mkdirSync(join(root, 'brands', 'acme', 'out'), { recursive: true });
mkdirSync(join(root, 'brands', 'beta', 'out'), { recursive: true });
test.after(() => rmSync(root, { recursive: true, force: true }));
const noOpencode = { list: async () => [], firstMessage: async () => '' };   // never call the real CLI in tests

function fakeSpawn() {
  const spawned = [];
  const spawn = (file, args, opts) => {
    const p = { file, args, opts, input: '', size: [opts.cols, opts.rows], killed: false, dataFns: [], exitFns: [],
      onData: (f) => p.dataFns.push(f), onExit: (f) => p.exitFns.push(f),
      write: (d) => { p.input += d; }, resize: (c, r) => { p.size = [c, r]; },
      emit: (d) => p.dataFns.forEach((f) => f(d)),
      exit: (exitCode, signal) => p.exitFns.forEach((f) => f({ exitCode, signal })),
      kill: () => { p.killed = true; p.exit(0, 1); } };
    spawned.push(p);
    return p;
  };
  return { spawn, spawned };
}

test('presets run the agent on the brief; custom expands <brief> or appends it', () => {
  assert.deepEqual(command('claude', 'acme', null, { agentSession: 'u-1' }).args, ['--session-id', 'u-1', '--name', 'acme', '--effort', 'medium', 'follow brands/acme/docs/brief.md']);
  const oc = JSON.parse(readFileSync(new URL('../opencode.json', import.meta.url), 'utf8'));
  assert.equal(oc.agent.build.variant, 'high', 'OpenCode film agents run the high variant (factory opencode.json)');
  assert.equal(oc.agent.build.model, oc.model);
  assert.deepEqual(command('claude', 'acme', null, { resume: 'u-1' }).args, ['--resume', 'u-1', '--effort', 'medium']);
  assert.deepEqual(command('opencode', 'acme').args, ['--prompt', 'follow brands/acme/docs/brief.md']);
  assert.deepEqual(command('custom', 'acme', 'codex "follow <brief>"').args, ['-lc', 'codex "follow brands/acme/docs/brief.md"']);
  assert.equal(command('custom', 'acme', ' my-agent ').args[1], 'my-agent brands/acme/docs/brief.md');
  assert.equal(command('custom', 'acme', '  '), null);
  assert.equal(command('bash', 'acme'), null);
  // Image jobs (pge/jobs/) use the same runners on their own brief.
  assert.equal(command('claude', 'night', null, { agentSession: 'u-2', base: 'pge/jobs' }).args.at(-1), 'follow pge/jobs/night/docs/brief.md');
  assert.equal(command('custom', 'night', 'x <brief>', { base: 'pge/jobs' }).args[1], 'x pge/jobs/night/docs/brief.md');
});

test('create, stream, input, resize, reattach, kill, respawn', () => {
  const { spawn, spawned } = fakeSpawn();
  const t = createTerminals({ root, spawn, opencode: noOpencode });
  process.env.CLAUDE_CODE_MESSAGING_TOKEN = 'parent-secret';
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  assert.equal(t.start('nope', { runner: 'claude' }).status, 404, 'film folder must exist');
  assert.equal(t.start('acme', { runner: 'rm -rf' }).status, 400);
  assert.equal(t.get('acme').status, 404);

  const a = t.start('acme', { runner: 'claude', cols: 120, rows: 40 });
  assert.equal(a.status, 201);
  const p = spawned[0];
  assert.equal(p.file, 'claude');
  assert.equal(p.args[0], '--session-id');
  assert.match(p.args[1], /^[0-9a-f-]{36}$/);
  assert.equal(p.opts.cwd, root);
  assert.equal(p.opts.env.TERM, 'xterm-256color');
  assert.equal(p.opts.env.CLAUDECODE, undefined);
  assert.equal(p.opts.env.CLAUDE_CODE_MESSAGING_TOKEN, undefined, 'parent session token not leaked');
  assert.equal(p.opts.env.CLAUDE_CODE_USE_BEDROCK, '1', 'user config passes through');
  delete process.env.CLAUDE_CODE_MESSAGING_TOKEN; delete process.env.CLAUDE_CODE_USE_BEDROCK;
  p.emit('hello\r\n');

  // a browser attaching later gets the scrollback, then live output
  const seen = [];
  const detach = t.attach('acme', { data: (d) => seen.push(d), exit: () => seen.push('EXIT') });
  p.emit('question? ');
  assert.deepEqual(seen, ['hello\r\n', 'question? ']);
  t.write('acme', 'yes\r');
  t.resize('acme', 90, 20);
  assert.equal(p.input, 'yes\r');
  assert.deepEqual(p.size, [90, 20]);

  // starting again while alive reattaches; nothing new is spawned
  const again = t.start('acme', { runner: 'opencode' });
  assert.equal(again.reattached, true);
  assert.equal(spawned.length, 1);

  // films are independent
  t.start('beta', { runner: 'custom', command: 'echo <brief>' });
  spawned[1].emit('beta only');
  assert.ok(!t.get('acme').output.includes('beta only'));

  assert.equal(t.kill('acme').status, 200);
  assert.ok(p.killed);
  assert.equal(seen.at(-1), 'EXIT');
  const s = t.get('acme').session;
  assert.equal(s.status, 'exited');
  assert.equal(s.exitCode, 129, 'killed by SIGHUP');
  assert.equal(t.kill('acme').status, 404);
  t.write('acme', 'ignored');   // writing to a dead session is a no-op
  detach();

  const b = t.start('acme', { runner: 'opencode' });
  assert.equal(b.status, 201);
  assert.notEqual(b.session.id, a.session.id);
  assert.deepEqual(spawned[2].args, ['--prompt', 'follow brands/acme/docs/brief.md']);
  spawned[2].exit(3);
  assert.equal(t.get('acme').session.exitCode, 3);

  const log = readFileSync(join(root, 'brands/acme/out/terminal.log'), 'utf8');
  assert.match(log, /claude --effort medium "follow brands\/acme\/docs\/brief.md"/);
  assert.match(log, /hello/);
  assert.match(log, /exited with code 129/);
  assert.match(log, /exited with code 3/);
});

test('spawn failure is reported, not thrown', () => {
  const t = createTerminals({ root, spawn: () => { throw new Error('ENOENT'); }, opencode: noOpencode });
  const r = t.start('acme', { runner: 'claude' });
  assert.equal(r.status, 500);
  assert.match(r.error, /claude/);
});

test('terminal.log and the replay buffer are capped', () => {
  const file = join(root, 'cap.log');
  writeFileSync(file, '');
  for (let i = 0; i < 300; i++) appendLog(file, `line ${i} ${'x'.repeat(40)}\n`, 4096);
  assert.ok(statSync(file).size <= 4096);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /line 299 /, 'newest kept');
  assert.ok(text.startsWith('line '), 'cut at a line break');

  const { spawn, spawned } = fakeSpawn();
  const t = createTerminals({ root, spawn, scrollback: 1000, opencode: noOpencode });
  t.start('beta', { runner: 'claude' });
  for (let i = 0; i < 100; i++) spawned[0].emit(`row ${i}\n`);
  const out = t.get('beta').output;
  assert.ok(out.length <= 1000);
  assert.match(out, /row 99\n$/);
});

test('history survives restarts; Claude sessions resume, others don\'t', () => {
  const { spawn, spawned } = fakeSpawn();
  let t = createTerminals({ root, spawn, opencode: noOpencode });
  mkdirSync(join(root, 'brands', 'hist', 'out'), { recursive: true });
  const a = t.start('hist', { runner: 'claude' }).session;
  const claudeId = spawned[0].args[1];
  spawned[0].exit(0);
  t.start('hist', { runner: 'opencode' });
  spawned[1].exit(1);
  const c = t.start('hist', { runner: 'claude' }).session;   // left running, then the studio "restarts"

  t = createTerminals({ root, spawn, opencode: noOpencode });                       // fresh process, same files
  const h = t.history('hist');
  assert.deepEqual(h.map((e) => [e.runner, e.state]), [['claude', 'interrupted'], ['opencode', 'exited'], ['claude', 'exited']]);
  assert.equal(h[0].id, c.id);
  assert.deepEqual(h.map((e) => e.resumable), [true, false, true]);
  assert.deepEqual(t.live(), []);

  assert.equal(t.start('hist', { resume: h[1].id }).status, 400, 'opencode can\'t resume');
  assert.equal(t.start('hist', { resume: 'nope' }).status, 404);
  const r = t.start('hist', { resume: a.id });
  assert.equal(r.status, 201);
  assert.deepEqual(spawned.at(-1).args, ['--resume', claudeId, '--effort', 'medium'], 'same Claude conversation');
  assert.equal(t.live().length, 1);
  assert.equal(t.history('hist')[0].resumedFrom, a.id);
  assert.equal(t.history('hist')[0].state, 'running');
});

test('OpenCode: the session is found after the first message and bound to the right film', async () => {
  const { spawn, spawned } = fakeSpawn();
  mkdirSync(join(root, 'brands', 'oc-a', 'out'), { recursive: true });
  mkdirSync(join(root, 'brands', 'oc-b', 'out'), { recursive: true });
  const now = Date.now();
  const store = [];   // what `opencode session list` would show; first messages by id
  const first = {};
  const opencode = { list: async () => store, firstMessage: async (cwd, id) => first[id] ?? '' };
  const t = createTerminals({ root, spawn, opencode, watchEvery: 10 });
  const wait = () => new Promise((r) => setTimeout(r, 40));

  store.push({ id: 'ses_old', created: now - 60_000, directory: root });            // from before: never ours
  first.ses_old = 'follow brands/oc-a/docs/brief.md';
  t.start('oc-a', { runner: 'opencode' });
  t.start('oc-b', { runner: 'opencode' });
  await wait();
  assert.equal(t.history('oc-a')[0].agentSession, null, 'no message sent yet → no session');

  // both films send their first message; B's session happens to be listed first
  store.unshift({ id: 'ses_b', created: now + 5, directory: root }, { id: 'ses_a', created: now + 6, directory: root },
    { id: 'ses_elsewhere', created: now + 7, directory: '/some/other/project' });
  first.ses_b = 'follow brands/oc-b/docs/brief.md';
  first.ses_a = 'follow brands/oc-a/docs/brief.md';
  first.ses_elsewhere = 'follow brands/oc-a/docs/brief.md';
  await wait();
  assert.equal(t.history('oc-a')[0].agentSession, 'ses_a');
  assert.equal(t.history('oc-b')[0].agentSession, 'ses_b');
  assert.equal(t.history('oc-a')[0].resumable, true);

  spawned[0].exit(0);
  const r = t.start('oc-a', { resume: t.history('oc-a')[0].id });
  assert.equal(r.status, 201);
  assert.deepEqual(spawned.at(-1).args, ['--session', 'ses_a']);
  spawned[1].exit(0); spawned.at(-1).exit(0);
});

test('guard: a fresh run on a job with work needs { confirm: true }; blocked jobs never start; Resume skips it', () => {
  const { spawn, spawned } = fakeSpawn();
  let backedUp = 0;
  const guard = (slug, history) => (slug === 'beta' ? { block: true, message: 'delivered' }
    : { message: `has work (${history.length})`, note: 'Continue from the first unfinished gate.', before: () => { backedUp++; } });
  const r2 = mkdtempSync(join(tmpdir(), 'studio-guard-'));
  for (const s of ['acme', 'beta']) mkdirSync(join(r2, 'brands', s, 'out'), { recursive: true });
  const t = createTerminals({ root: r2, spawn, guard, opencode: noOpencode });
  const ask = t.start('acme', { runner: 'claude' });
  assert.deepEqual([ask.status, ask.confirm, spawned.length, backedUp], [409, true, 0, 0], 'asks, starts nothing, backs up nothing');
  assert.equal(t.start('acme', { runner: 'claude', confirm: 'yes' }).status, 409, 'only a literal true confirms');
  const ok = t.start('acme', { runner: 'claude', confirm: true });
  assert.equal(ok.status, 201); assert.equal(backedUp, 1);
  assert.match(spawned[0].args.at(-1), /^follow brands\/acme\/docs\/brief\.md\. Continue from the first unfinished gate\.$/);
  const blocked = t.start('beta', { runner: 'claude', confirm: true });
  assert.deepEqual([blocked.status, blocked.confirm, spawned.length], [409, undefined, 1]);
  spawned[0].exit(0);
  const resumed = t.start('acme', { resume: ok.session.id });
  assert.equal(resumed.status, 201, 'Resume continues the same conversation, no guard');
  assert.equal(backedUp, 1);
  rmSync(r2, { recursive: true, force: true });
});
