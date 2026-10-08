// node --test studio/transcript.test.mjs   (readable agent transcripts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeTranscript, filmTranscript, claudeProjectDir } from './transcript.mjs';

const line = (o) => JSON.stringify(o);
const session = [
  line({ type: 'user', timestamp: '2026-10-08T10:00:00Z', message: { content: 'follow brands/x/docs/brief.md' } }),
  line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'secret' }] } }),
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the brief.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'List files' } }] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1\nboom' }] } }),
  line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'fine' }] } }),
  line({ type: 'user', isMeta: true, message: { content: '[Image: …]' } }),
  line({ type: 'user', message: { content: '<task-notification>x</task-notification>' } }),
  line({ type: 'attachment' }), 'not json',
].join('\n');

test('a Claude session reads as a conversation', () => {
  const t = claudeTranscript(session);
  assert.match(t, /── You \(10:00\)\nfollow brands/);
  assert.match(t, /Reading the brief\./);
  assert.match(t, /→ Bash: List files/);
  assert.match(t, /✗ Exit code 1 boom/);
  assert.ok(!/secret|fine|Image|task-notification/.test(t), t);
});

test('film transcript: oldest first, resumes once, screen log only as fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tr-'));
  writeFileSync(join(dir, 'abc.jsonl'), session);
  const history = [   // newest first, as terminals.history() returns it
    { runner: 'custom', command: 'codex x', startedAt: '2026-10-08T12:00:00Z' },
    { runner: 'claude', agentSession: 'abc', command: 'claude --resume abc', startedAt: '2026-10-08T11:00:00Z', endedAt: 'z', exitCode: 0 },
    { runner: 'claude', agentSession: 'abc', command: 'claude "follow"', startedAt: '2026-10-08T10:00:00Z', endedAt: 'z', exitCode: 129 },
  ];
  const t = filmTranscript({ root: '/r', history, plainLog: () => 'SCREEN', projectDir: dir });
  assert.ok(t.indexOf('claude "follow"') < t.indexOf('--resume'));
  assert.equal(t.match(/Reading the brief/g).length, 1);
  assert.match(t, /resumed the conversation above/);
  assert.match(t, /Terminal log[^]*SCREEN/);
  assert.equal(filmTranscript({ root: '/r', history: [], plainLog: () => 'ONLY' }), 'ONLY');
});

test('project folder name matches Claude Code', () => {
  assert.equal(claudeProjectDir('/home/q/Documents/MOTION DESIGN', '/h'), '/h/projects/-home-q-Documents-MOTION-DESIGN');
});
