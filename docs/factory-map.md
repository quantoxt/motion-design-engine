# Factory map — read this first

This repo is a motion-design FACTORY, not a single film. Engine lives at root
and is shared. Every film lives in its own `brands/<name>/` folder and is
worked with `--dir`. Standing rule: update this file after every factory upgrade.

```
MOTION DESIGN/
  README.md                 # for a new person: requirements, setup, how to use
  .gitignore                # brands/* (except _template) and _raw/* (except the template) stay out of git
  CLAUDE.md                 # studio rules: render contract, look, motion, sound, gates
  lib/
    motion.js               # springs, track, indicator, swapAlpha, rng, presets (browser-only)
    hand.js                 # hand-drawn SVG ink: trace(), boil(), ink(), strokeLine()
    project.js              # fake-3D: rot/iso/cube/drawCube/turntable/parallax (pure math)
    serve.mjs               # static server; serves --dir, falls back to engine root for /lib/*
  package.json              # deps (node-pty, ws, xterm, playwright), `npm run studio`, `npm test`; Node >= 20
  studio.mjs                # web UI server: `npm run studio` → 127.0.0.1:4321. Briefs → _raw/<slug>.md, Start film,
                            # gates + approvals, agent terminals (websocket), Library media. Endpoint list in its header
  studio/
    index.html, app.mjs     # UI: Home (#/: needs you, running, recent, briefs; navbar badge + alerts),
                            # brief editor (#/brief/<slug>), film gates (#/film/<slug>), agent terminal (#/run/<slug>),
                            # Agents (#/agents), Film Library (#/library, #/library/<slug>)
    library.mjs             # Library: finished films per brand (finalize's naming), ffprobe metadata,
                            # the allowlist for /media/ (finals, poster.png, contact.png, animatic.mp4; nothing else)
    brief.mjs               # template ⇄ form model: parse / serialize / readBack / filmSettings (shared with tests)
    films.mjs               # Start film (scaffold brands/<slug>/ from _template), gate status from files,
                            # shotlist approval → brands/<slug>/docs/approvals.json (sha256 of the approved text),
                            # brief drift + sync (_raw/ → docs/brief.md), "needs you" items for Home
    terminal.mjs            # agent sessions: one node-pty PTY per film, scrollback replay,
                            # transcript → brands/<slug>/out/terminal.log (1 MB cap), session history +
                            # resume ids (Claude --session-id, OpenCode found by first message) → out/agent-sessions.json.
                            # Spec: docs/terminal-spec.md
    fonts/                  # Bricolage Grotesque woff2 + OFL (bundled, works offline)
    *.test.mjs              # `npm test` (27): parser, reopen, film.json mapping, scaffold, gates, drift/attention,
                            # terminal sessions + resume (fake PTY / fake OpenCode), library + media allowlist (no browser)
  render.mjs                # serial reference renderer (reads film.json, ?w&h override)
  render-parallel.mjs       # DEFAULT renderer: parallel workers, byte-identical output
                            # --animatic (cheap pacing draft), --all-formats (film.json),
                            # --workers N, --crf N, --from S, --out FILE
  shots.mjs                 # critique stills: beats (from film's beat grid) / strip / at
  finalize.mjs              # mix (music.wav + sfx.wav if no mix.wav) + two-pass loudnorm −14 LUFS
                            # + mux + ebur128 confirm + CRF-20 posting copy
                            # → out/<brand>-<format>-<W>x<H>.mp4 (+ -posting); --all-formats = every silent_*.mp4
  beats.py                  # measure a supplied track → beats.json (librosa)
  sfx.mjs                   # synthesize click/pop/thump/whoosh → sfx.wav
  prompts/critique-pass.txt # the watch-your-own-frames scoring prompt
  docs/
    knowledge-base.md       # the ritual (Movez course, distilled)
    patterns.md             # Pattern A (product reel) vs Pattern B (educational)
    parallel-render.md      # why parallel is safe + framemd5 verification
    LESSONS.md              # measured lessons from shipped films — extend every run
    changelog.md            # what changed in the factory, newest first — update on every factory change
    bug-docs.md             # factory bug log: symptom/cause/fix/verified — append on every engine fix
    terminal-spec.md        # agent terminal: presets, sessions, history + resume (Claude and OpenCode)
    factory-map.md          # this file
  _raw/
    brief-template.md       # interactive checklist — ALSO generates the studio form;
                            # copy → _raw/<brand>.md, fill blanks, hand to agent
    quantoxt-inc-solo.md    # worked example (first film's brief) — filled briefs are gitignored
  brands/
    _template/              # new-film scaffold: index.html starter, film.json,
                            # docs/{style_guide.md, README}, assets/, out/ (.gitkeep so clones keep them)
                            # the only brands/ folder in git; every film folder is gitignored
    quantoxt/               # first film (FROZEN — do not modify): index.html, assets/,
                            # docs/, beats.json, music.mjs, out/ (quantoxt-vertical-1080x1920.mp4 et al.)
  .claude/skills/motion-reel/SKILL.md  # the factory door: one-sentence entry
```

## Conventions

- `film.json` (per brand) is the source of truth for w/h/fps/dur/sub/bpm/beats/formats.
  Scripts read it; flags override it. Never hardcode sizes in scripts.
- Films read render dimensions from `?w&h` query params (set by renderers),
  falling back to `film.json`. Layout code must use the `S(x,y)` mapping and a
  `K = min(W,H)/1080` scale factor so every format reframes instead of cropping.
- `index.html` may `import './lib/motion.js'` — the server resolves `/lib/*`
  from the engine root automatically. No per-brand copies of `lib/`.

## Rules for agents working here

1. All scripts take `--dir brands/<name>`. Never run them bare
   (bare = legacy single-project mode, current directory as brand).
2. Work ONLY inside `brands/<name>/`. Root engine files change only to fix the
   engine itself — and after any renderer change, re-run the framemd5 check in
   `docs/parallel-render.md`.
3. New film: copy `brands/_template/` → `brands/<name>/`, follow the skill pipeline:
   assets → style_guide → shotlist (WAIT for OK) → animatic (pacing) →
   code → shots (beats + strips) → critique 4 rounds (8+) → `--all-formats` →
   `finalize.mjs --all-formats` (→ `out/<brand>-<format>-<W>x<H>.mp4`) → deliver + lessons.
4. `brands/quantoxt/` is completed work — read it, never write to it.
5. Every run appends its measured lessons to `docs/LESSONS.md`.
6. Every engine fix gets a `docs/bug-docs.md` entry (Symptom / Cause / Fix / Verified),
   reproduced with a failing test BEFORE the fix. Brand-film bugs go in that
   brand's review log, never the bug log.
7. Every factory change gets a `docs/changelog.md` entry (newest first, with bug IDs).
8. Shotlist approval: the gate is done only on your explicit OK in chat or a matching
   `brands/<slug>/docs/approvals.json` (sha256 of the approved text). Any edit after
   approval re-opens the gate — the agent must stop and re-present.
