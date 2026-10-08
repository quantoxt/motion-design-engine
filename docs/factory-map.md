# Factory map — read this first

This repo is a motion-design FACTORY, not a single film. Engine lives at root
and is shared. Every film lives in its own `brands/<name>/` folder and is
worked with `--dir`. Standing rule: update this file after every factory upgrade.

```
MOTION DESIGN/
  README.md                 # for a new person: requirements, setup, how to use
  .gitignore                # brands/* (except _template) and _raw/* (except the template) stay out of git
  AGENTS.md                 # studio rules: render contract, look, motion, sound, gates
  lib/
    motion.js               # springs, track, indicator, swapAlpha, rng, presets (browser-only)
    hand.js                 # hand-drawn SVG ink: trace(), boil(), ink(), strokeLine()
    project.js              # fake-3D: rot/iso/cube/drawCube/turntable/parallax, hingeQuad/drawHinged (turn on a real edge)
    serve.mjs               # static server; serves --dir, falls back to engine root for /lib/*
    holds.mjs               # pop + dead-hold analysis (pure; used by holds.mjs)
    texture.js              # grain (seeded tiles, pure in t) + vignette for flat colour
    transitions.js          # flood / drain / wipe / blinds / dissolve / coverRadius / fitText: an object becomes the next scene
    layout.js               # named anchors through the canvas transform, prepare/at, wrap + spans, frameExtents (bleed)
    cursor.js               # cursorAt(): cursor driven by anchors, lands early and at rest; ring() + ripple()
    type.js                 # odometer with carry, drawOdometer, swapText (one spring, one clip)
    checks.mjs              # geometry + choreo-easing rules over anchors (pure; used by check.mjs)
    gate.mjs                # check results + film fingerprint; primary-render review state; what blocks a full render
    package.json            # {"type":"module"}: Node reads lib/*.js as ES modules (tests); browsers ignore it
    *.test.mjs              # holds, layout/cursor/checks, type/hinge (part of `npm test`)
  opencode.json             # OpenCode in this folder: film agents' model + variant "high" (Claude's --effort medium is in studio/terminal.mjs)
  package.json              # deps (node-pty, ws, xterm, playwright), `npm run studio`, `npm test`; Node >= 20
  studio.mjs                # web UI server: `npm run studio` → 127.0.0.1:4321. Briefs → _raw/<slug>.md, Start film,
                            # gates + approvals, agent terminals (websocket), Library media. Endpoint list in its header
  studio/
    index.html, app.mjs     # UI: Home (#/: needs you, running, recent, briefs; navbar badge + alerts),
                            # brief editor (#/brief/<slug>), film gates (#/film/<slug>), agent terminal (#/run/<slug>),
                            # Agents (#/agents), Film Library (#/library, #/library/<slug>)
                            # Images (#/images, #/images/<job>, #/images/brief/<job>): see pge/
                            # run page: Resume (terminal/history), version links, Shift+Enter newline
    library.mjs             # Library: finished films per brand, versions folded in (finalize's naming), ffprobe metadata,
                            # the allowlist for /media/ (finals, poster.png, contact.png, animatic.mp4, silent_*.mp4)
    refs.mjs                # design references for both brief kinds: images + clips in <briefs>/<slug>.refs/, notes in
                            # refs.json (upload order, keyed by file name, writes serialized per brief), clips → <name>.frames.png
                            # (ffmpeg, 6–24 frames), job copies in assets/refs/ + refs.md; refsRoute = the HTTP side
    refs-panel.mjs          # the brief form's "Design references" panel: upload, one note per file (saved by name), remove
    md.mjs                  # markdown → HTML (escaped) for the shotlist panel
    transcript.mjs          # readable agent transcript: Claude sessions from ~/.claude/projects/<cwd>/<id>.jsonl, else terminal.log
    brief.mjs               # template ⇄ form model: parse / serialize / readBack / filmSettings (shared with tests)
    films.mjs               # Start film (scaffold brands/<slug>/ from _template), gate status from files,
                            # shotlist + primary-render approvals → brands/<slug>/docs/approvals.json (sha256 of the
                            # approved text; the render's size+mtime and the film fingerprint),
                            # brief drift + sync (_raw/ → docs/brief.md), "needs you" items for Home,
                            # versions: brands/<brand>-vN/ via makeVersion (seeded from the last version),
                            # design references (_raw/<brand>.refs/ → assets/refs/ of every version not yet delivered)
    terminal.mjs            # agent sessions: one node-pty PTY per film, scrollback replay,
                            # transcript → brands/<slug>/out/terminal.log (1 MB cap), session history +
                            # resume ids (Claude --session-id, OpenCode found by first message) → out/agent-sessions.json.
                            # Spec: docs/terminal-spec.md
    fonts/                  # Bricolage Grotesque woff2 + OFL (bundled, works offline)
    *.test.mjs              # `npm test` (76 with lib/ and pge/ tests): parser, reopen, film.json mapping, scaffold, gates, drift/attention,
                            # terminal sessions + resume (fake PTY / fake OpenCode), library + media allowlist,
                            # Machine checks + Primary render gates (fresh/stale/legacy/skip) (no browser)
  pge/                      # IMAGE ENGINE (stills that tell a story), isolated from the films. Rules: pge/AGENTS.md
    README.md               # what it is, how to run it
    brief-template.md       # image brief (the studio's Images editor is generated from it)
    briefs/<job>.md         # saved image briefs (gitignored)
    _template/              # new job scaffold: index.html (panels), job.json (kind, formats, allow), docs/, out/
    jobs/<job>/             # one image job (gitignored): docs/ brief, style_guide, plan (+ approvals.json), review_log,
                            # lessons; out/ draft/, final/, contact*.png, check.json, terminal.log, agent-sessions.json
    lib/still.js            # createStill(): canvas + design units + anchors; S.panels() (window.paint/PANELS); S.text, paragraph
    lib/checks.mjs          # per-panel checks (pure): film geometry + phone-size, contrast, empty
    lib/gate.mjs            # out/check.json fingerprint (index.html + job.json)
    lib/zip.mjs             # stored zip writer (finals download), no dependency
    lib/page.mjs            # headless page for check/render (serves the job, engine root as fallback)
    check.mjs               # node pge/check.mjs --dir pge/jobs/<job> → out/check.json (gate for finals)
    render.mjs              # node pge/render.mjs --dir pge/jobs/<job> [--draft] [--format f] [--panel N]
    studio/api.mjs          # /api/pge/…, /pge-media/… routes incl. finals.zip (mounted by studio.mjs)
    studio/jobs.mjs         # briefs, scaffold, 7 gates, story-plan approval, image lists (by format), media allowlist,
                            # design references (studio/refs.mjs: pge/briefs/<job>.refs/ → job assets/refs/),
                            # Home attention items (merged into /api/dashboard)
    studio/view.mjs         # Images views (served as /pge.mjs, loaded by studio/app.mjs) + full-screen set viewer
    *.test.mjs              # part of npm test
  render.mjs                # serial reference renderer (reads film.json, ?w&h override)
  render-parallel.mjs       # DEFAULT renderer: parallel workers, byte-identical output
                            # --animatic (cheap pacing draft), --scan (half size, full fps, no blur, one keyframe
                            # → out/scan.mp4 for holds.mjs; with --from/--dur → scan_<from>-<to>.mp4), --all-formats (film.json; --formats a,b to pick;
                            # drafts land as animatic_<f>/scan_<f>.mp4, never silent_<f>.mp4),
                            # --workers N, --crf N, --from S, --out FILE
  shots.mjs                 # critique stills: beats (from film's beat grid) / strip / at / events / contact (1 still per bar → contact.png)
                            # (window.EVENTS stills + 0.15s rows for window.TRANSFORMS and every window.SCENES
                            # handoff); --format <name>|all
  check.mjs                 # geometry gate: clicks in targets at rest, no overflow, no text collisions, nothing cut by the
                            # frame edge, every format → out/check.json
  holds.mjs                 # one-frame pops + holds >1s where only grain moves, from out/scan.mp4
                            # (film.json "holds"/"pops" = allowed) → out/holds.json (full-film scan only) + out/pops.png
                            # (±3 frames per pop); --file scan_<from>-<to>.mp4 checks a window, never the gate
  # render-parallel.mjs refuses a full render until both results passed on the current
  # index.html + film.json, and any format but the primary until the human approved the primary
  # render in the studio (--skip-checks overrides, shown on the studio's gates)
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
    LESSONS.md              # factory-level lessons, curated by hand — agents never read or write it
    changelog.md            # what changed in the factory, newest first — update on every factory change
    bug-docs.md             # factory bug log: symptom/cause/fix/verified — append on every engine fix
    terminal-spec.md        # agent terminal: presets, sessions, history + resume (Claude and OpenCode)
    factory-map.md          # this file
  _raw/
    brief-template.md       # interactive checklist — ALSO generates the studio form;
                            # copy → _raw/<brand>.md, fill blanks, hand to agent
    <brand>.refs/           # design references uploaded with the brief (gitignored with the rest of _raw/)
    quantoxt-inc-solo.md    # worked example (first film's brief) — filled briefs are gitignored
  brands/
    _template/              # new-film scaffold: index.html starter, film.json,
                            # docs/{style_guide.md, README}, assets/, out/ (.gitkeep so clones keep them)
                            # the only brands/ folder in git; every film folder is gitignored
    <brand>/, <brand>-v2/   # a film and its later versions (one brief: _raw/<brand>.md). A version folder
                            # has docs/previous-version.md; earlier versions are read-only once delivered
    quantoxt/               # first film (FROZEN — do not modify): index.html, assets/,
                            # docs/, beats.json, music.mjs, out/ (quantoxt-vertical-1080x1920.mp4 et al.)
  .agents/skills/motion-reel/SKILL.md  # the factory door: one-sentence entry
  eye/                          # a visual model's reports on the refs and our films (research input; film agents never read it)
  lab/                          # reverse-pipeline lab (isolated): README, tokens.md (schema),
                                # analyze.mjs (video → measurements + token draft), refs/<name>/
                                # per reference (gitignored) + ours/<name>/ for our masters
                                # (symlinked source; lab writes only into analysis/), findings.md
                                # (cross-video rules), report.md (lab-vs-ours comparison).
                                # Imports engine read-only, never writes outside lab/
```

## Conventions

- `film.json` (per brand) is the source of truth for w/h/fps/dur/sub/bpm/beats/formats.
  Scripts read it; flags override it. Never hardcode sizes in scripts.
- Films read render dimensions from `?w&h` query params (set by renderers),
  falling back to `film.json`. Scenes draw in design units through one camera transform
  (`K = min(W,H)/1080`, origin at the centre; `EX`/`EY` = frame half-extents for bleed), so every
  format reframes instead of cropping, and anchors (`lib/layout.js`) come out in screen pixels.
- Positions are named, never retyped: `L.anchor`/`L.text` where drawn, `L.at(name, t)` everywhere else.
  Clicks are `{ t, target }`; `window.EVENTS`/`TRANSFORMS` come from the same constants.
- Machine-check results live in `out/check.json` / `out/holds.json`, stamped with a fingerprint of
  `index.html` + `film.json`; `out/render-gate.json` records a `--skip-checks` render.
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
   code → checks by kind of bug on the animatic → critique 4 rounds (8+) → machine checks gate → primary format → human OK (Primary render gate) → other formats →
   `finalize.mjs --all-formats` (→ `out/<brand>-<format>-<W>x<H>.mp4`) → deliver + lessons.
4. `brands/quantoxt/` is completed work — read it, never write to it.
5. Every run writes its measured lessons to `brands/<brand>/docs/lessons.md`, never `docs/LESSONS.md`.
6. Every engine fix gets a `docs/bug-docs.md` entry (Symptom / Cause / Fix / Verified),
   reproduced with a failing test BEFORE the fix. Brand-film bugs go in that
   brand's review log, never the bug log.
7. Every factory change gets a `docs/changelog.md` entry (newest first, with bug IDs).
8. Shotlist approval: the gate is done only on your explicit OK in chat or a matching
   `brands/<slug>/docs/approvals.json` (sha256 of the approved text). Any edit after
   approval re-opens the gate — the agent must stop and re-present.
