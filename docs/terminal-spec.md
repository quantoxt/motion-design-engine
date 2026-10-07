# Terminal spec — interactive agent sessions in the studio UI

## Goal
From a film view, start a real terminal session running a coding agent pointed at
that film's brief — and interact with it entirely from the web UI. Agent output
streams to the browser; user input goes back. Full duplex, indistinguishable from
a local terminal. Everything runs on localhost.

## Stack
- **`node-pty`** (backend): spawns a real PTY per session. The agent cannot tell
  it isn't a terminal (colors, prompts, interactive questions all work).
- **`xterm.js`** (frontend): renders the session, handles input, scrollback, resize.
- Verified versions (2026-10-07): claude 2.1.292, opencode 2.0.16, node 24.19,
  node-pty 1.1.0 (native build: npm blocks install scripts by default, so approve
  it once: `npm install-scripts approve node-pty && npm rebuild node-pty`),
  @xterm/xterm 6.0.0, ws 8.22.0.
- Transport: websocket between `studio.mjs` and the film view. (Polling fallback
  acceptable for v1 if websockets complicate the server, but streaming is the goal.)

## UX
- Film view gains a terminal pane + a **Run agent** control with three options:
  1. **Claude** (default): `claude "follow brands/<slug>/docs/brief.md"`
  2. **OpenCode**: `opencode --prompt "follow brands/<slug>/docs/brief.md"`
     (verified against opencode v2.0.16: `--prompt` opens the interactive TUI with the
     brief pre-filled; you press Enter in the pane to send it. Verified: it doesn't
     auto-submit. `opencode run` is one-shot and exits, so the agent can't ask you
     anything. Not used.)
  3. **Custom**: free-text field for any agent command
     (e.g. `codex "..."`, `claude --model opus ...`). Template variable `<brief>`
     expands to the brief path; if absent, the brief path is appended.
- Behavior: one session per film (starting again reattaches if alive, else respawns
  after confirm). Session survives page refresh (reattach + scrollback restore).
  Multiple films = independent sessions, no crosstalk. Show session status
  (running / exited with code / idle) and a kill button.
- The brief handoff stays the copy-ready `follow brands/<slug>/docs/brief.md` —
  the terminal just automates pasting it.

## Server
- `POST /api/films/:slug/terminal` `{ runner: "claude" | "opencode" | "custom", command? }`
  → creates (or reattaches) the session, returns a session id. Validated slug only;
  custom commands run as-is (local tool, local user — no sandboxing by design).
- `GET /api/films/:slug/terminal` → session status + recent output (for reattach).
- `DELETE /api/films/:slug/terminal` → kill the PTY.
- PTY cwd = studio root. Env inherits the server's (user's keys, shell, PATH).
  Resize events forwarded (`pty.resize(cols, rows)`).
- Output log persisted per film at `brands/<slug>/out/terminal.log` (capped at 1 MB,
  oldest half dropped), so a session is reviewable after exit. Kept out of `docs/`
  so the agent doesn't read its own transcript as a brief file.
- Env inherits the server's, minus the markers of a parent Claude Code session
  (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_TOKEN`, …) in case the
  studio itself was started from one. User config (`ANTHROPIC_*`, `CLAUDE_CODE_USE_*`) passes.
- Presets run without a shell (`pty.spawn("claude", [prompt])`). Custom commands run
  through `bash -lc "<command>"` so quoting works as typed.
- No permission-skipping flags in presets: the agent asks, you answer in the pane.
  Put `--auto` / `--dangerously-skip-permissions` in a Custom command if you want them.
- Sessions live in the studio process. Restarting `npm run studio` kills every
  running agent; only `out/terminal.log` survives.

## History and resume (added 2026-10-07)
- Every session is recorded in `brands/<slug>/out/agent-sessions.json` (newest 50): runner, command, start/end,
  exit code, and for Claude the `--session-id` we chose. A record with no end that isn't running was cut off by
  a studio restart ("interrupted").
- Claude preset: `claude --session-id <uuid> --name <slug> "follow …"`. Resume: `claude --resume <uuid>`.
- OpenCode creates its session only when the first message is sent, and can't take an id we choose. So the
  studio watches for it: every 5s while the agent runs (and once at exit, for up to 30 min) it runs
  `opencode session list --format json`, and for each new session in the studio root that no film has
  claimed, reads its first user message with `opencode session export <id>`. The one naming
  `brands/<slug>/` is that film's. This binds correctly even with two films running OpenCode at once.
  Resume: `opencode --session <id>`. If no message was ever sent, there's no session and nothing to resume.
- `--continue` is not used: it's per project (the studio root, shared by all films) and could resume the
  wrong film. Custom commands: not resumable.

## Scope discipline
- Same-origin policy and 127.0.0.1-only binding as the existing studio (inherit,
  don't re-decide). No auth layer — localhost is the boundary.
- No freeform shell launcher in the UI: the entry point is always an agent command
  (preset or custom field). A general-purpose shell is out of scope.
- No multi-user, no remote access, no session sharing. Ever.

## Acceptance
1. Click Run agent (Claude) on a film → agent boots in the pane, brief followed.
2. Agent asks a question → user answers in the pane → agent proceeds.
3. Refresh the page → session + scrollback intact.
4. Kill → PTY dead, exit code shown; Run again → fresh session.
5. OpenCode preset + a custom command both verified working at build time.
6. `npm test` covers: session create/reattach/kill, slug validation, output log cap.
