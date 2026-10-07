// Agent terminal sessions: one PTY per film, running a coding agent on that film's brief.
// Sessions live in the studio process (a studio restart kills them); the transcript is
// kept in brands/<slug>/out/terminal.log so a session is reviewable after exit, and every
// session is recorded in brands/<slug>/out/agent-sessions.json (the Agents page's history).
// Claude sessions are started with a known --session-id, so they can be resumed later,
// even after a studio restart. OpenCode only creates its session when the first message is
// sent, so we watch for it: a new session in the studio's directory whose first message names
// this film's brief is this film's. Then it resumes with `opencode --session <id>`.
// See docs/terminal-spec.md.
import { appendFileSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// How the studio asks OpenCode about its sessions (injected in tests).
const run = promisify(execFile);
export const opencodeCli = {
  list: async (cwd) => JSON.parse((await run('opencode', ['session', 'list', '--format', 'json', '-n', '20'], { cwd, timeout: 20000 })).stdout || '[]'),
  firstMessage: async (cwd, id) => {
    const j = JSON.parse((await run('opencode', ['session', 'export', id], { cwd, timeout: 20000, maxBuffer: 64e6 })).stdout);
    return j.messages?.find((m) => m.type === 'user')?.text ?? '';
  },
};
export const WATCH_EVERY = 5000, WATCH_FOR = 30 * 60 * 1000;

export const LOG_CAP = 1024 * 1024;        // terminal.log: past this, the oldest half is dropped
export const SCROLLBACK = 256 * 1024;      // in-memory replay for a reattaching browser
export const RUNNERS = ['claude', 'opencode', 'custom'];
export const HISTORY_CAP = 50;
const RESUMABLE = new Set(['claude', 'opencode']);              // agent-sessions.json keeps the newest 50 per film
// If the studio was started from inside a Claude Code session, these mark that session
// (and carry its messaging token). An agent spawned here is its own session, so drop them.
// User config like CLAUDE_CODE_USE_BEDROCK or ANTHROPIC_* passes through.
const PARENT_SESSION_ENV = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN'];

// What to spawn for a runner. Presets run without a shell; a custom command goes through
// `bash -lc` so quoting and env expansion work as typed. `<brief>` expands to the brief path;
// without it the path is appended. Claude gets a session id we choose (so it can be resumed)
// and the film's name; `resume` continues an earlier Claude session instead.
export function command(runner, slug, custom, { agentSession, resume } = {}) {
  const brief = `brands/${slug}/docs/brief.md`, prompt = `follow ${brief}`;
  if (runner === 'claude' && resume) return { file: 'claude', args: ['--resume', resume], label: `claude --resume ${resume}` };
  if (runner === 'claude') return { file: 'claude', args: ['--session-id', agentSession, '--name', slug, prompt], label: `claude "${prompt}"` };
  if (runner === 'opencode' && resume) return { file: 'opencode', args: ['--session', resume], label: `opencode --session ${resume}` };
  if (runner === 'opencode') return { file: 'opencode', args: ['--prompt', prompt], label: `opencode --prompt "${prompt}"` };
  if (runner === 'custom') {
    const text = typeof custom === 'string' ? custom.trim() : '';
    if (!text) return null;
    const line = text.includes('<brief>') ? text.replaceAll('<brief>', brief) : `${text} ${brief}`;
    return { file: 'bash', args: ['-lc', line], label: line };
  }
  return null;
}

// Keep the newest `cap` bytes of a string, cut at a line break so a half escape sequence
// or half a line doesn't lead the replay.
function tail(text, cap) {
  if (text.length <= cap) return text;
  const cut = text.slice(text.length - cap);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < cap / 2 ? cut.slice(nl + 1) : cut;
}

export function appendLog(file, data, cap = LOG_CAP) {
  appendFileSync(file, data);
  if (statSync(file).size > cap) writeFileSync(file, tail(readFileSync(file, 'utf8'), Math.floor(cap / 2)));
}

// spawn: node-pty's spawn (injected so tests can use a fake PTY).
export function createTerminals({ root, spawn, logCap = LOG_CAP, scrollback = SCROLLBACK, opencode = opencodeCli, watchEvery = WATCH_EVERY, watchFor = WATCH_FOR }) {
  const sessions = new Map();   // slug → session (kept after exit, for status + replay)

  const status = (s) => s && {
    id: s.id, slug: s.slug, runner: s.runner, command: s.label, status: s.exitCode === null ? 'running' : 'exited',
    exitCode: s.exitCode, startedAt: s.startedAt, endedAt: s.endedAt, resumable: !!s.agentSession,
  };

  // ── History: brands/<slug>/out/agent-sessions.json, oldest first ──
  const historyFile = (slug) => join(root, 'brands', slug, 'out', 'agent-sessions.json');
  function readHistory(slug) {
    try { const h = JSON.parse(readFileSync(historyFile(slug), 'utf8')); return Array.isArray(h) ? h : []; } catch { return []; }
  }
  function record(s) {
    const h = readHistory(s.slug).filter((e) => e.id !== s.id);
    h.push({ id: s.id, runner: s.runner, command: s.label, agentSession: s.agentSession, resumedFrom: s.resumedFrom,
      startedAt: s.startedAt, endedAt: s.endedAt, exitCode: s.exitCode });
    try { writeFileSync(historyFile(s.slug), JSON.stringify(h.slice(-HISTORY_CAP), null, 2) + '\n'); } catch {}
  }
  // Newest first. A session with no end that isn't running here was cut off by a studio restart.
  function history(slug) {
    const live = sessions.get(slug);
    return readHistory(slug).reverse().map((e) => ({
      ...e, resumable: RESUMABLE.has(e.runner) && !!e.agentSession,
      state: live?.id === e.id && live.exitCode === null ? 'running' : e.endedAt ? 'exited' : 'interrupted',
    }));
  }

  function start(slug, { runner, command: custom, resume, cols = 100, rows = 30 } = {}) {
    const dir = join(root, 'brands', slug);
    if (!existsSync(dir)) return { status: 404, error: `brands/${slug}/ doesn't exist.` };
    const live = sessions.get(slug);
    if (live && live.exitCode === null) return { status: 200, reattached: true, session: status(live) };
    let agentSession = null, resumedFrom = null, cmd;
    if (resume) {
      // Resume continues the same Claude conversation (same session id), as a new studio session.
      const prev = readHistory(slug).find((e) => e.id === resume);
      if (!prev) return { status: 404, error: 'That session isn’t in this film’s history.' };
      if (!RESUMABLE.has(prev.runner)) return { status: 400, error: 'Custom commands can’t be resumed. Run the agent again instead.' };
      if (!prev.agentSession) return { status: 400, error: prev.runner === 'opencode'
        ? 'OpenCode hadn’t started a session yet (no message was sent). Run the agent again instead.'
        : 'This session has no id to resume. Run the agent again instead.' };
      runner = prev.runner; agentSession = prev.agentSession; resumedFrom = prev.id;
      cmd = command(runner, slug, null, { resume: agentSession });
    } else {
      if (!RUNNERS.includes(runner)) return { status: 400, error: 'Pick Claude, OpenCode or a custom command.' };
      if (runner === 'claude') agentSession = randomUUID();
      cmd = command(runner, slug, custom, { agentSession });
      if (!cmd) return { status: 400, error: 'Type the custom command to run.' };
    }

    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    for (const k of PARENT_SESSION_ENV) delete env[k];
    let pty;
    try {
      pty = spawn(cmd.file, cmd.args, { name: 'xterm-256color', cols: clamp(cols, 20, 400), rows: clamp(rows, 5, 200), cwd: root, env });
    } catch (err) {
      return { status: 500, error: `Couldn’t start ${cmd.file}: ${err.message}` };
    }
    const log = join(dir, 'out', 'terminal.log');
    const s = { id: randomUUID(), slug, runner, label: cmd.label, agentSession, resumedFrom, pty, buffer: '', exitCode: null,
      startedAt: new Date().toISOString(), endedAt: null, listeners: new Set() };
    record(s);
    const stamp = `\r\n\x1b[2m── ${s.startedAt} · ${cmd.label}\x1b[0m\r\n`;
    try { appendLog(log, stamp, logCap); } catch {}
    pty.onData((d) => {
      s.buffer = tail(s.buffer + d, scrollback);
      try { appendLog(log, d, logCap); } catch {}
      for (const l of s.listeners) l.data(d);
    });
    pty.onExit(({ exitCode, signal }) => {
      s.exitCode = signal ? 128 + signal : exitCode ?? 0;   // shell convention: killed by SIGHUP → 129
      s.endedAt = new Date().toISOString();
      const end = `\r\n\x1b[2m── exited with code ${s.exitCode}\x1b[0m\r\n`;
      s.buffer = tail(s.buffer + end, scrollback);
      try { appendLog(log, end, logCap); } catch {}
      record(s);
      s.watch?.();
      for (const l of s.listeners) l.exit(status(s));
    });
    sessions.set(slug, s);
    if (runner === 'opencode' && !agentSession) watchOpencode(s);
    return { status: 201, session: status(s) };
  }

  // OpenCode: find the session this run created (after the first message) and remember it.
  // Ours = created after we started, in our directory, not already claimed by any film,
  // and its first message names this film's brief. Checked every few seconds and once at exit.
  function watchOpencode(s) {
    const started = Date.parse(s.startedAt) - 2000, seen = new Set();
    const claimed = () => new Set([...sessions.values()].map((x) => x.agentSession).filter(Boolean));
    let busy = false;
    const check = async () => {
      if (busy || s.agentSession) return;
      busy = true;
      try {
        const taken = claimed();
        for (const o of await opencode.list(root)) {
          if (seen.has(o.id) || taken.has(o.id) || o.created < started || (o.directory && o.directory !== root)) continue;
          const text = await opencode.firstMessage(root, o.id);
          if (!text) continue;                                  // no message yet: look again next time
          seen.add(o.id);
          if (text.includes(`brands/${s.slug}/`)) { s.agentSession = o.id; record(s); break; }
        }
      } catch {} finally { busy = false; }
      if (s.agentSession || s.exitCode !== null || Date.now() - started > watchFor) clearInterval(timer);
    };
    const timer = setInterval(check, watchEvery);
    timer.unref?.();
    s.watch = check;
  }

  // Subscribe a browser: replays the scrollback, then streams. Returns an unsubscribe.
  function attach(slug, listener) {
    const s = sessions.get(slug);
    if (!s) return null;
    listener.data(s.buffer);
    if (s.exitCode !== null) listener.exit(status(s));
    s.listeners.add(listener);
    return () => s.listeners.delete(listener);
  }

  const alive = (slug) => { const s = sessions.get(slug); return s && s.exitCode === null ? s : null; };
  return {
    start, attach, history,
    // Every running session, across films.
    live: () => [...sessions.values()].filter((s) => s.exitCode === null).map(status),
    get: (slug) => { const s = sessions.get(slug); return s ? { status: 200, session: status(s), output: s.buffer } : { status: 404, error: 'No session for this film yet.' }; },
    write: (slug, data) => { alive(slug)?.pty.write(data); },
    resize: (slug, cols, rows) => { alive(slug)?.pty.resize(clamp(cols, 20, 400), clamp(rows, 5, 200)); },
    kill: (slug) => {
      const s = alive(slug);
      if (!s) return { status: 404, error: 'No running session.' };
      s.pty.kill();
      return { status: 200 };
    },
    killAll: () => { for (const s of sessions.values()) if (s.exitCode === null) try { s.pty.kill(); } catch {} },
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(n)) || lo));
