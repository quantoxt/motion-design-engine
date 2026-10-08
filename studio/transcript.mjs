// Readable transcript of a film's agent sessions. terminal.log is a full-screen TUI's redraws, so once
// escape codes are stripped almost nothing is left. Claude Code keeps the real conversation in
// ~/.claude/projects/<cwd>/<session-id>.jsonl: what you typed, what the agent said, each tool it ran
// and which ones failed. OpenCode and custom sessions fall back to the plain terminal log.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Claude Code's folder for a working directory: every character that isn't a letter or digit becomes '-'.
export const claudeProjectDir = (cwd, home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')) =>
  join(home, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));

const one = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const time = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : '');

// What a tool call did, in one line: its description if it has one, else its main argument.
function toolLine({ name, input = {} }) {
  const main = input.description ?? input.file_path ?? input.path ?? input.pattern ?? input.skill ?? input.url ?? input.prompt ?? input.command;
  return `  → ${name}${main ? `: ${one(main, 160)}` : ''}`;
}
const resultText = (c) => (Array.isArray(c) ? c.map((x) => x.text ?? '').join(' ') : c);

// One Claude session (.jsonl text) → plain text. Skips thinking, attachments and system reminders.
export function claudeTranscript(jsonl) {
  const out = [];
  for (const line of jsonl.split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isMeta || j.isSidechain) continue;
    const c = j.message?.content;
    if (j.type === 'user' && typeof c === 'string') {
      if (/^<(task-notification|command-|local-command)/.test(c.trim())) continue;
      out.push('', `── You (${time(j.timestamp)})`, c.trim(), '');
    } else if (Array.isArray(c)) {
      for (const x of c) {
        if (j.type === 'user' && x.type === 'text' && x.text?.trim()) out.push('', `── You (${time(j.timestamp)})`, x.text.trim(), '');
        else if (x.type === 'text' && x.text?.trim()) out.push(x.text.trim());
        else if (x.type === 'tool_use') out.push(toolLine(x));
        else if (x.type === 'tool_result' && x.is_error) out.push(`    ✗ ${one(resultText(x.content), 200)}`);
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Every session of a film, oldest first. A resumed session continues the same Claude conversation,
// so each conversation is shown once. `plainLog` is the fallback for sessions with no Claude record.
export function filmTranscript({ root, history, plainLog, projectDir = claudeProjectDir(root) }) {
  const parts = [], seen = new Set();
  let fallback = false;
  for (const h of [...history].reverse()) {
    const head = `════ ${h.startedAt?.slice(0, 16).replace('T', ' ')} · ${h.command}${h.endedAt ? ` · exit ${h.exitCode}` : ''}`;
    if (h.runner === 'claude' && h.agentSession) {
      if (seen.has(h.agentSession)) { parts.push(`${head}\n(resumed the conversation above)`); continue; }
      seen.add(h.agentSession);
      const file = join(projectDir, `${h.agentSession}.jsonl`);
      if (existsSync(file)) { parts.push(`${head}\n\n${claudeTranscript(readFileSync(file, 'utf8'))}`); continue; }
    }
    fallback = true;
    parts.push(`${head}\n(no conversation record for this session; see the terminal log below)`);
  }
  if (!parts.length) return plainLog();
  if (fallback) parts.push(`════ Terminal log (screen output)\n\n${plainLog()}`);
  return parts.join('\n\n\n');
}
