# Factory changelog

What changed in the factory (engine, studio, templates, docs), newest first.
Bugs found in existing factory code are detailed in `docs/bug-docs.md`; this file links to them by ID.

---

## 2026-10-08

### Images: crisper finals and stricter look rules
- `pge/render.mjs`: finals render at 2× the format size (1080×1350 → 2160×2700; job.json `"scale"` 1–3). A 1080 PNG
  shown full-screen on a laptop or phone is upscaled 1.5–3× and reads as soft. Drafts and checks stay at 1×.
- `pge/AGENTS.md` Look: crisp by default (texture only when chosen, faint, never on precise panels; strokes ≥ 4 units),
  a different layout on every panel (one-line layout sketch per panel in plan.md), the motif as a main element on half
  the panels, no repeated chrome (label above every headline, rule along every bottom). Critique adds craft + a
  words-ignored variety test. Template no longer puts grain on flat colour or parks the motif in one place.
  Why: both quantoxt-inc-ads runs (OpenCode) came out as one template with new words, hazy on the colour panels.

### Running an agent again on a job with work in it
- `createTerminals({ guard })`: a fresh run (not Resume) on a job that already has work returns 409 with what would
  happen; the studio shows it and only starts on an explicit OK (`confirm: true`). The agent's prompt then says to
  continue from the first unfinished gate.
- Image job already delivered: the finals, docs, index.html and job.json are copied to `out/backup-<time>/` before
  the agent starts. Delivered film: refused (brands/ folders stay as delivered; use Make new version).

### Design references for films too, with a note per file and video clips
- Shared `studio/refs.mjs` + `studio/refs-panel.mjs`: both brief forms (film and image) have the **Design references**
  panel. Images (≤15 MB) and clips (MP4/MOV/WebM, ≤100 MB), 40 per brief, type read from the first bytes.
- Each file has its own note ("what to take from it"), saved by file name in `<briefs>/<slug>.refs/refs.json`, in upload
  order. Writes to one brief are serialized, so notes saved at the same time can't overwrite each other; removing a file
  removes its note.
- A clip becomes `<name>.frames.png` (6–24 frames, ~2 per second, two-pass ffmpeg so the stated count matches the sheet).
- Job folders get `assets/refs/` + `refs.md` (each file, in order, with its note). Films: copied at Start film and into
  new versions, kept in step for versions still in production; a delivered film is never touched.
- Rules: root `AGENTS.md` "Design references", `pge/AGENTS.md` loop step 1. Templates point at the panel.
- Image briefs' old image-only panel and `/pge-media/<job>/_refs/` replaced by the shared routes.

### Images: design references
- The image brief editor has a **Design references** panel: drop or pick images (PNG/JPG/GIF/WebP, ≤15 MB, ≤40). Saved with
  the brief in `pge/briefs/<job>.refs/`, copied to the job's `assets/refs/` at start and mirrored after. Type checked by
  the file's first bytes, same-origin uploads only. `pge/AGENTS.md`: the agent studies every reference and writes what it
  takes (grammar, never content) in the style guide.

### From the portfolio run (lessons + E-OPEN-1/2)
- `shots.mjs events`: handoff rows capped at 1.2s, `{ layer: true }` scenes skipped, transform rows at half size, 12 rows
  per sheet (E-OPEN-1). E-OPEN-2 documented.
- `shots.mjs contact`: one still per bar at exact times → `out/contact.png` (portfolio's hand-made ffmpeg sheet had 23
  tiles for 24 bars).
- AGENTS.md: flood overlays keep painting, exits at every scene `to`, anchor text on every frame + max zoom on full-width
  words, named note lengths (`E8`), odometers start with all columns, what the pace meter can't see, holds on the
  encoded primary, exact loop check.

### Images: zip download, viewer, Home
- Download all final images as one zip (`/pge-media/<job>/finals.zip`, or `?format=<name>` for one format), from the job
  page and the Images list. Stored zip written by `pge/lib/zip.mjs` (no dependency; checked with `unzip -t`).
- Finals shown per format in posting order. Clicking a panel opens a full-screen viewer: ←/→ or swipe through the set,
  D or the button downloads the PNG, Esc closes.
- Home "Needs you" includes image jobs (story plan waiting for your OK, failed image agents); Running includes image agents.
- `npm test`: 76.

### PGE: image generation engine (new, isolated in `pge/`)
- Stills that tell a story (single image, poster, or a carousel of panels), drawn in code on canvas like the films.
  Rules for image agents: `pge/AGENTS.md` (root `AGENTS.md` points there for `pge/jobs/`).
- `pge/lib/still.js`: `createStill()` stage (job.json formats, design units, anchors), `S.panels()` contract
  (`window.paint(i)`, `PANELS`, `ready`), `S.text()` / `paragraph()` (text the checker can see).
- `pge/check.mjs` → `out/check.json`: film geometry checks on each panel + phone size (11px at 360 wide), measured
  contrast (3:1 from the painted pixels), empty panel. `pge/render.mjs`: `--draft`, gated final PNGs
  `out/final/<job>-<format>-NN-<W>x<H>.png`, phone-size contact sheets. Renders are byte-identical run to run.
- Studio: **Images** section (`#/images`): image briefs (same editor, `pge/brief-template.md` → `pge/briefs/`),
  Start images (scaffold from `pge/_template/`), job page with agent terminal (Claude/OpenCode/custom on
  `pge/jobs/<job>/docs/brief.md`), 7 gates incl. story-plan approval, finals/drafts/contact sheets.
  Server routes in `pge/studio/api.mjs`; studio changes are additive: `createTerminals({ base })`, `agentPane({ base })`,
  brief editor `KINDS`, `slugFor` reads `pge/jobs/____`, `briefTitle` accepts "(job name)". Needs a studio restart to appear.
- Sample job `pge/jobs/paper-boat/` (6-panel story, 4:5 + 1:1): all gates done, 4 critique rounds.
- `npm test` includes `pge/lib/*.test.mjs` and `pge/studio/*.test.mjs` (73 tests).

### Agent effort: Claude medium, OpenCode high
- Claude film agents (new and resumed) run with `--effort medium` (capped from high; `CLAUDE_EFFORT` in `studio/terminal.mjs`).
- OpenCode film agents run `opencode/muse-spark-1.3-contributor-free` with variant `high`, set in the new root `opencode.json`
  (OpenCode has no effort flag, and v2.0.16 ignores `OPENCODE_CONFIG_CONTENT`). Any OpenCode run from the factory folder uses it.

### Studio fixes (S-001…S-005 in bug-docs)
- Run page: Resume for the last session after you stop an agent or restart the studio; links to every version (v1, v2…).
- Terminal: Shift+Enter makes a new line.
- Rail no longer stuck on "Assets & style guide" (assets in subfolders now count).
- Film page previews play (videos kept across refreshes; renders now written with `+faststart`).
- Brief editor: Save disabled until something changes; Start film has a border. Film page agent status stays current.
- `GET /api/films/:slug/terminal/history` (new).
- "Read the transcript" shows the conversation (your messages, agent replies, tools run, failures) from Claude's session records, not the screen redraws (`studio/transcript.mjs`, S-006).

### Agent-neutral skills layout
- `CLAUDE.md` → `AGENTS.md`, factory skill `.claude/skills/motion-reel/` → `.agents/skills/motion-reel/`;
  all live references updated. Deleted the divergent `agent/` copy, redundant `.claude/`, `skills-lock.json`.
  Future skill installs land in `.agents/` and work for any agent, not just Claude.

### HyperFrames takes (patterns ported to canvas; their DOM/CSS code doesn't transfer)
- `lib/transitions.js`: `wipe` (clock-wipe wedge — the directional reveal flood can't do), `blinds` +
  `blindsFor` (slat count follows the brief's Energy: calm 4 / steady 8 / showreel-fast 14), `dissolve`
  (seeded palette grid — deterministic, pure like the rest). Same `(g, p, …)` signature as `flood()`.
- `lib/cursor.js`: `ripple` (1–3 staggered rings from the click point — cause → effect instead of a blip);
  template draws it, `ring()` kept as the progress source. Next films inherit it.
- `lib/checks.mjs`: `choreo-easing` (animation-map pattern over anchors — one anchor entering at >3×
  different speeds fails; teleports/swaps, exits, blips and ambient flicker don't count). Verified 0
  findings on Unburn; 61/61 tests green.
- `lib/transitions.test.mjs` (new): fake-ctx tests for all three takes, incl. choreo fires/pass cases.

### Lab: eye cross-check
- `lab/eye.md` (new): where the eye reports and the lab agree, what the eye saw that the lab missed (ghosting exits,
  colour flips, loud/quiet, viewfinder, patterns, speed effects), the pace table for all 10 videos, open questions.
  `lab/README.md` and `lab/findings.md` point to it. The lab's own measured `report.md` is unchanged.

### From the eye reports, part 2
- **`lib/texture.js`** (new): `grain` (seeded tiles, re-seeds 12×/s, parallel-safe) and `vignette`, for floods and
  full-screen colour. The template's flood uses both.
- `render.mjs`: relative `--out` now lands inside `--dir`, like the parallel renderer (F-002). Serial = parallel
  byte-identical on the template's grain flood.
- AGENTS.md: the last frame returns to the first frame's object and colour; full-screen flat colour gets grain +
  vignette.

### From the lab reports
- AGENTS.md: the end card comes straight after the busiest moment (no slowing down before the logo), and a click
  visibly changes the thing it touches first. The rest of the lab's findings were already covered.

### From the eye reports (`eye/`, a visual model's frame-by-frame read of the refs and our films)
The reports said why our films feel soft next to the references; the measures below confirm it before acting.
- **Exits smeared into copies.** Scenes flew off fast, and with 4 blur snapshots per frame a fast move draws as
  3–4 see-through copies (Unburn 7.7s). `check.mjs` has a new `streak` failure: an anchor moving more than 24px
  between blur snapshots (scaled to 1080), grouped into one line per exit. Scratch Unburn: 6 exits flagged
  (3.7, 7.7, 13.7, 14.0, 23.7, 25.7), including the one in the report's frame strip. Uses film.json `fps`/`sub`.
- **`lib/transitions.js`** (new): `flood` (an object grows past every frame edge and becomes the background),
  `drain` (the reverse), `covered`, `coverRadius`, `fitText` (one word, edge to edge).
- **Template:** `exitUp` removed. The title sinks back into the line it rose from; a new scene shows the Unlock
  button flooding the frame, then one full-screen word with a tiny line under it. Passes `check.mjs` in all formats.
- **Pace measured as screen area, not just "anything moved".** `lib/holds.mjs` `pace()`: share of a 34px grid that
  changes, rolling 1s median. `holds.mjs` fails a quiet stretch (≤1% of the screen moving) over 3s (`--quiet`,
  film.json `"quiet"` for a calm brief) and prints how much of the film moves. Calibrated on the lab videos: crisp
  refs v1/v4/v5 61–74% moving, longest quiet 1.6–2.7s; our films 12–37%, 4.6–9.3s (Unburn 12%, 9.3s).
  Calm refs v2/v6 would fail at 3s (4.2/4.8s): that's the "Calm and spacious" brief option.
- **Planned holds capped at 2s** (film.json `holds`), end card included.
- **Rules:** AGENTS.md pace (a change every beat, a big one every bar), loud/quiet/loud, 2–3 full-screen type
  moments, exits turn into the next scene, background floods may rotate 4–5 colours when briefed, viewfinder layer
  allowed when briefed. Film agents never read `eye/` or `lab/`. Critique prompt and knowledge base updated.
- **Brief template:** Full-screen type (2–3), Scene changes (flood / one background), Background colours for floods,
  Viewfinder layer, "Calm and spacious" allows 5s quiet. Skill: shotlist marks loud/quiet and the scene change per bar.


### Lab: planned holds no longer counted (lab agent's change, logged here)
- `lab/analyze.mjs --film-json brands/<x>/film.json` drops the film's planned holds from the count. NN-v2 went from
  "2 holds" to 1 (the end still was planned). `lab/report.md` and `lab/ours/nn-v2/analysis/tokens.md` updated.
- Open: the lab still finds holds with the whole-frame signal only, at full size. The engine's `holds.mjs` also
  watches regions, so a small moving thing counts as motion. On NN-v2's final render the engine finds 0 holds and
  0 pops; the lab's remaining 5.4–6.6 hold is likely that difference, not a real still. The lab's "pops" are its
  cut list, not errors.
- Who logs lab changes: the lab never writes factory docs, so its changes are logged here by hand.
- Follow-up (done): `lab/analyze.mjs` now uses the same method as `holds.mjs` (135px scdet for cuts, 34px region
  motion for holds), and the report says "cuts" instead of "pops". NN-v2 now reads 0 holds and 0 cuts, the same as
  `holds.mjs`; the 5.4–6.6 "hold" was the quill and cursor moving. NN-v1 re-measured at 12 holds and 5 hard cuts. `lab/report.md` text now matches its tables (ten videos;
  NN-v1 mean shot dropped as not comparable; NN-v1's 5 cuts all near a sound; Quantoxt has 1 real unplanned slow
  moment at 13.4–16.0, since Quantoxt has no film.json to list planned holds).

### Rule: film agents never write to the engine
- AGENTS.md, the skill, the brief template and `docs/bug-docs.md` now say it outright: root scripts, `lib/`, `studio/`,
  `brands/_template/`, `AGENTS.md` and `.agents/` are read-only during a film run. Engine bugs are logged `open` with a
  proposed fix and worked around in the brand folder. Before, the rules only said "log any engine bug", and the v2 agent
  fixed N-001/U-001 in the engine itself mid-run (good fixes, but one broke a test while Unburn depended on that code).

### From the Unburn and Narrative Nexus v2 lessons
- **`holds.mjs` → `out/pops.png`:** ±3 frames around every pop, one row per pop, film time burnt in (centre = the pop).
  Unburn built these tiles by hand for every pop.
- **Window scans for checking a fix:** `--scan --from S --dur D` (and `--animatic` likewise) writes
  `scan_<from>-<to>.mp4` instead of overwriting `scan.mp4`. `holds.mjs --file` reads the start from that name.
  `out/holds.json` is written only for a full-film `out/scan.mp4` (from 0, film.json's length): before, a partial
  scan overwrote `scan.mp4` and could pass the gate on 2 seconds of film.
- **`shots.mjs events` shoots scene handoffs automatically** from `window.SCENES` (overlap → `[next.from, prev.to]`,
  cut → ±0.3s), unless a declared transform already covers it. Template exports `window.SCENES`.
- **`L.text(…, { align, baseline })`** sets them before measuring. `L.at` errors name the `t >= x` handoff fix.
- `lib/layout.test.mjs`: the anchor test now expects the `solid` field added by N-001.
- Rules: AGENTS.md (one owner per morphing object, no state-colour branches, counters settle, entry from below
  from `F.EY`, solid text, `window.SCENES`, snap visuals to the 16th grid before cues, onset `hop_length=128,
  backtrack=True`, pops.png + window scans in the loop); brief template + skill: every UI action a beat shows must
  exist in the product; template comment for entry from below.

### Studio: shotlist reads as a document
- The shotlist panel rendered raw markdown in a `<pre>`. New `studio/md.mjs` renders headings, paragraphs, lists
  (one nested level), tables (scroll sideways on narrow screens), quotes and rules. All text goes through the
  escaping `inline()`, so HTML in the file never becomes markup (tested). Served by `studio.mjs`.

## 2026-10-07

### Added: reverse-pipeline lab scaffold
- `lab/` (isolated): `README.md` with the hard boundary (never writes outside
  `lab/`, imports engine read-only), `refs/<name>/` per reference video
  (gitignored: `source.mp4` + `prompt.md` + optional `meta.md`, `analysis/`
  output). Tokens land as lab-local md; flow-back into the factory is a future
  explicit step. `docs/reverse-pipeline-plan.md` is the plan.
- `lab/analyze.mjs` + `lab/tokens.md` (schema). The analyzer measures only:  `meta.json`, `mafd.txt`, `cuts.json` (frame-diff pops via `lib/holds.mjs`,
  `--tick 0` default — references have no 12fps grain), `contact.png`,
  `shots/` (mid-shot), `strips/` (13 frames per cut), `beats.json`,
  `loudness.json`, `sync.json` (cut↔beat offsets), `tokens.md` draft with
  statements EMPTY for the agent. Fixed own bug: assumed holds shape
  `{start,end}`, engine returns `{from,to}` — read the source, don't guess.
- Judgment pass on all six refs: per-ref `tokens.md` (statements from evidence,
  measurements flagged where unverified: shared BPMs, −0.07s beat-phase offset)
  + `lab/findings.md` (5 cross-video rules, tool lessons, NN comparison preview
  clearly marked as NOT lab output yet).
- Onset cross-check + comparison run: `sync` now reports cut↔beat AND cut↔onset
  (librosa grids phase-shift; onsets are the honest signal). `lab/ours/`
  measures our masters via symlink (lab writes only into `lab/ours/`).
  `lab/report.md`: the full comparison — NN's 9 holds vs refs' 0, sync/loudness
  cleared as non-issues, and the corollary that Quantoxt outscores NN on lab axes.
- Shot-recreation proposal saved in `lab/report.md` (v1 flood first, ~3–4h,
  reward = `flood()` in `lib/`); not started — awaiting audit + your call.
- Reviewer audit fixes: analyzer takes `--film-json` (planned holds excluded —
  NN-v2 now shows the 1 real open hold, 5.4–6.6), tokens.md is write-once
  (re-runs no longer clobber agent judgments), brief template gains lab rules
  (full-screen type scenes, motif, the one swing). 53/53 tests green.
- Comparison run: `lab/ours/{nn-v2,unburn}/` measured + `lab/report.md` updated —
  NN-v2 26→2 cuts then 0 cuts/0 holds (region pipeline = holds.mjs); Unburn 0/0 with full-frame type scenes. Verdict:
  the factory removed defect classes without removing ambition.

### Fixed: brief editor counted 9 of 10 at most
- Section 10 (Gates) has no fields, so it never counted as started. Field-less sections now count as complete
  (`studio/app.mjs` `changed()`); filling 1–9 shows 10 of 10.

### Added: Primary render gate, and `frameExtents` for bleed
- The primary format (`film.json` `formats[0]`) renders first and you approve it in the studio before the other
  formats render (they cost ~70 min per fix loop on a 60s film). New **Primary render** gate (9 gates now):
  the silent render plays inline; **Approve** sends the render's stamp (size + mtime), so you only approve what
  you watched. The approval also stores the film fingerprint: a re-render or a code edit makes it stale.
  "Needs you" on Home + browser alert when it's waiting. **All formats** gate lists the formats still to render.
- `render-parallel.mjs` refuses any format but the primary until that approval is current (exit 3), so
  `--all-formats` on a fresh film renders the primary and stops. `--skip-checks` overrides, as before.
- `/media` also serves `silent_*.mp4` (for the inline review). New endpoints `POST /api/films/:slug/primary/approve|revoke`.
- Films delivered before this show the gate as "not reviewed", not blocking.
- `lib/layout.js` `frameExtents(W, H)` → `EX/EY`, `across(pad)`, `down(pad)`: bleed elements sized from the frame
  (the 16:9 half-width marquee bug). The template uses it.
- Verified: 46 tests (approve/stale/revoke/409, legacy, media allowlist, frameExtents). On a scratch copy of the
  template: `--all-formats` rendered vertical and stopped at square ("waiting for the human's OK"); after
  `approvePrimary`, `--formats square,wide` rendered and the All formats gate listed all three.
- AGENTS.md, skill, brief template, `_template/README.md`, README, factory map, terminal spec updated.

### Added: anchors, `check.mjs`, and the Machine checks gate
The Narrative Nexus lessons traced most bugs to one position typed twice. This makes the right way the default
and proves it before a full render.
- `lib/layout.js`: `createLayout()` → `L.anchor(g, name, x, y, w, h, { parent, bleed })`, `L.text`, `L.point`,
  rects through the current canvas transform; `L.prepare(draw, times)` in `window.ready` measures targets at
  given times; `L.at(name, t)` throws on a missing time or name. `wrap()` + `spans()` follow a phrase across
  line breaks (the wrong-underline bug).
- `lib/cursor.js`: `cursorAt(t, L, clicks)`: the cursor flies to each click's anchor on critically damped
  per-axis springs, at rest ≥0.4s before the click; `ring()` for the click ring.
- `lib/type.js`: `odometer()` / `drawOdometer()` with carry, `swapText()` on one spring inside one clip.
- `lib/project.js`: `hingeQuad()` / `drawHinged()`: turns on a real edge with perspective; returns the far edge.
- `check.mjs` (+ pure `lib/checks.mjs`): seeks every format at 30fps and fails on click off target, cursor
  still moving at a click, click without a target, child overflowing its parent ≥0.3s, anchor cut by the frame
  edge ≥0.6s (unless bleed). Writes `out/check.json`.
- `holds.mjs` now measures holds by the largest change in any region (34px grid) instead of the frame average,
  so a small moving cursor isn't a hold; pops still use the validated frame average. `film.json` `"pops"` lists
  intended hard cuts. Refuses a scan older than the film. Writes `out/holds.json`.
- `lib/gate.mjs`: results carry a fingerprint of `index.html` + `film.json`; any edit makes them stale.
  `render-parallel.mjs` refuses a full-length final render (exit 3) until both passed; drafts and `--from/--dur`
  windows are exempt; `--skip-checks` overrides and writes `out/render-gate.json`.
- Studio: new **Machine checks** gate between Critique and Full render, with the first failure as evidence.
  Films rendered before the gate existed show "not run", not blocking; a `--skip-checks` render is shown.
- `_template/index.html` rebuilt as the reference: camera transform, anchors, a chip sized from its text, an
  odometer, a button whose label swaps on the click, an anchor-driven cursor, EVENTS/TRANSFORMS from constants.
- `lib/package.json` marks `lib/*.js` as ES modules for Node (tests); the browser is unaffected.
- Docs: AGENTS.md (Motion + Loop), skill, brief template, `_template/README.md`, README (steps, commands, test count),
  factory map (tree, conventions: camera transform replaces `S(x,y)`, anchors, check results), terminal spec (8 gates).
- Verified: 45 tests. On a scratch copy of the template: `check.mjs` passes in all 3 formats; a broken copy
  (hand-typed cursor, fixed-width chip, cut-off element) fails with all 4 planted bugs named. Gate flow: blocked →
  edit makes results stale → rerun → render proceeds. Serial vs parallel byte-identical (`bf9850b8…`) over the
  click window. `holds.mjs` on Narrative Nexus: same 4 pops; holds now exclude spans where something moves.

### Added: `shots.mjs events` and `--format`
- `shots.mjs events` reads `window.EVENTS` (`{ clicks: [t…], swaps: [t…] }`, any keys) and `window.TRANSFORMS`
  (`[[from, to], …]`) from the film: `out/events.png` = a still at t and t+0.1 per event, labelled;
  `out/transforms.png` = one row per transform at 0.15s steps.
- `--format <name>` / `--format all` shoots any `film.json` format in every mode; outputs get a `_<format>` suffix.
  Unknown format or mode exits 2. Without the flag, output is unchanged.
- `_template/index.html` declares empty `window.EVENTS` / `window.TRANSFORMS`; AGENTS.md loop, skill, brief
  template, factory map and README use the commands.
- Verified on a scratch copy of Narrative Nexus with its CLICKS wired in: the sheets show the click misses (7.2,
  11.4, 24.0), the edge-on cover (14.85–15.15) and the unreadable shrink (28.95–29.25); `--format wide` and
  `at 1.5 --format all` wrote the suffixed files. Not unit-tested: it needs a browser, so it's checked by running it.

### Added: `holds.mjs` pop + dead-hold scanner
- `node render-parallel.mjs --dir brands/<x> --scan` → `out/scan.mp4`: half size, film fps, no blur, CRF 28, a
  single keyframe (periodic keyframes re-quantize the picture and read as pops). ~3 min for a 60s film vs ~31 min full.
- `node holds.mjs --dir brands/<x>` scales to 135px (kills grain), runs `scdet`, and reports one-frame pops (vs ±3
  neighbours and vs frames one/two grain ticks away) and holds >1s where only the 12fps grain ticks. `film.json`
  `"holds"` lists intended holds. Exit 1 on findings. Logic in `lib/holds.mjs`, 5 tests (34 total).
- Verified on a scratch copy of Narrative Nexus: all 4 pops the agent found by hand (24.000 Unlock swap, 29.717,
  30.017, 30.317), no false ones; every hold it listed, plus 22.58–24.03. Runs in ~5s.
- AGENTS.md loop, skill, brief template, factory map and README name the commands.
- Fixed L-004 (below).

### Changed: rules from the Narrative Nexus lessons
- `AGENTS.md` Motion: one source of truth per position, cursor lands ≥0.4s early inside its target,
  hinged 3D turns, entries from 0, motif never covers its words, readable before/after states, bleed from the frame.
- `AGENTS.md` Loop: check by kind of bug on the animatic (click/swap stills, 0.15s transform steps, pop/hold
  scan, every format), score from measurements, render the primary format first. Skill and brief template match.
- `render-parallel.mjs --all-formats --formats a,b` renders only the named formats (unknown names exit 1).
  Dispatch only; frame code untouched, so no framemd5 re-check needed.
- `_template/index.html` declares `<meta charset="utf-8">` (non-ASCII glyphs drawn to canvas came out as `â†’`).
- Brief template: live data that contradicts site copy is flagged at the shotlist gate.

### Changed: lessons live in each brand folder
- Agents write lessons to `brands/<brand>/docs/lessons.md` and never read or write `docs/LESSONS.md`, which is now
  curated by hand. New `## Lessons` section in `AGENTS.md`; skill, brief template, `_template/README.md` and
  factory map updated to match. Agents read their brand's `lessons.md` before planning; `makeVersion`
  carries it into the next version (test assertion added).

### Changed: a new version needs a brief change
- `makeVersion` refuses (409) when `_raw/<brand>.md` is identical to the latest version's `docs/brief.md`. A redo
  without a brief change is no longer possible from the studio or the API. Test added (29 total, same count).

### Added: film versions (v2, v3…) for briefs edited after delivery
- One brief per brand (`_raw/<brand>.md`); films are versions: `brands/<brand>/` is v1, then `brands/<brand>-v2/`…
  (`<x>-vN` counts as a version only if `brands/<x>/` exists).
- **While a film is in production**, a brief edit is synced into it as before. **Once it's delivered**, Sync is
  refused (409) and the studio offers **Make new version** instead (film page banner + Home *Needs you*).
- **Make v2** (`POST /api/films/:slug/version`) scaffolds `brands/<brand>-v2/` from the current brief and
  seeds it so it's nearly as cheap as editing: v1's `assets/` and `docs/style_guide.md` are copied (so the assets
  gate is already done), v1's `film.json` tuning is kept with the new brief's duration/formats/tempo on top, and
  `docs/previous-version.md` says where v1 is (read-only), what was copied and which brief sections changed.
  Shotlist, approval, renders start fresh. Refused until the latest version is delivered.
- Drift and *Needs you* follow the newest version only; older versions stay quiet. The briefs list, Start film
  and the Agents page follow versions (labels "v2").
- **Library:** versions fold into their brand's folder. The folder card shows the newest version's cover and
  "N versions, latest vK". The brand page has a section per version, newest first, each with its films and a
  Gates link; `/api/library/<brand>-v2` opens the brand.
- `motion-reel` skill: a version folder means read `docs/previous-version.md` first, reuse, never write to v1.
- Tests: 29 (`npm test`), with sync refused after delivery, v2 seeding (assets, style guide, tuning kept + new
  duration, fresh shotlist, no v1 renders), gates of a fresh v2, `x-v2` brands that aren't versions, drift on the
  newest version only, v3 refused until v2 is delivered, Library folding three folders into one brand.
  Checked end to end on a real server with a throwaway brand (removed).

### Sync pass: code, docs and comments checked against each other
- All `.mjs`/`.js` pass `node --check` (lib/*.js checked as ES modules), `beats.py` compiles, `npm test` 27/27.
- `studio.mjs` header: resume in the terminal POST, OpenCode resume, the full `/media/` allowlist, `drift` on
  the film GET, and an accurate "what it writes" note (it said it only wrote `_raw/`).
- `docs/factory-map.md`: `package.json` entry; Home/Agents/Library routes in one place; library allowlist,
  OpenCode resume and films.mjs drift/sync/attention described; rule 3 says `finalize.mjs --all-formats`.
- `AGENTS.md`: finalize's `--all-formats` and the final file naming (never rename: gates and Library read it).
- `finalize.mjs`: when two renders would make the same final, the newest wins with a warning (L-003).
- Removed dead CSS (`.handoff .cmd`). `.gitignore`: `__pycache__/`.
- Every file in the repo is in the factory map, except the test files and fonts (covered by `*.test.mjs` and
  `fonts/`) and `docs/reverse-pipeline-plan.md` (deliberately off the map). Every map entry exists.

### Added: git repo, README, .gitignore
- `git init` (branch `master`, nothing committed yet). `.gitignore` keeps out `node_modules/`, every brand folder
  except `brands/_template/`, every filled brief except `_raw/brief-template.md`, a stray root `out/`, and
  `.agents/settings.local.json`.
- `brands/_template/assets/.gitkeep` and `out/.gitkeep` so a fresh clone scaffolds films with both folders.
- `README.md`: requirements (Node 20+, ffmpeg/ffprobe, build tools for node-pty, Playwright Chromium, an agent CLI,
  optional numpy/librosa), setup, the studio flow, engine commands, layout, what's not in the repo.
- `package.json`: `engines.node >=20`, `private`, description; `playwright` moved to `dependencies` (the
  renderers need it at run time, so `npm install --omit=dev` no longer breaks rendering).
- Stale `final.mp4` references fixed: `prompts/critique-pass.txt` (its contact-sheet commands would have failed on
  any new film; they now take the brand-named master), `docs/knowledge-base.md`. `studio.mjs` header comment
  describes the whole studio, not just the brief form.
- `docs/terminal-spec.md` matches what was built: status line, the separate `#/run/<slug>` page, websocket
  message format, all endpoints and guards, acceptance with ✓/☐ per item, and the test summary.
- `docs/factory-map.md`: README and .gitignore in the tree, `terminal-spec.md` in the docs list, test summary
  (27), and which folders are kept out of git.

### Added: OpenCode sessions can be resumed
- OpenCode makes its session on the first message, so the studio finds it afterwards: new session in the studio
  root, unclaimed, whose first message names `brands/<slug>/` (read via `opencode session export`). Stored in
  `agent-sessions.json`; **Resume** runs `opencode --session <id>`.
- Tests: 27, with two films' OpenCode sessions created at once and listed in the "wrong" order, an older session
  and another project's session that must not bind. Verified for real: no id before Enter, bound after, resume
  launched with that id. The two test sessions were deleted from OpenCode afterwards.

### Added: Agents page, Home dashboard, alerts, inline review, brief sync
- **Navbar:** Home · Agents · Library. Home shows a count badge for things that need you; Agents shows a green dot
  while an agent runs. Polled every 8s on every page.
- **Home (`#/`):** *Needs you* (shotlist waiting or changed after approval, brief edited after the film started,
  agent exited with an error or cut off by a studio restart), each with its action (Read shotlist / Review and
  sync / Resume). Then *Running* agents and *Recently finished* films, then the briefs list as before.
- **Alerts:** "Alert me when a film needs me" asks for browser notification permission. After that, each new
  *Needs you* item pops a notification; clicking it opens the film or Agents page.
- **Agents (`#/agents`):** running sessions across films, then each film's session history (when, agent, how it
  ended, duration), **Resume** for Claude sessions, **New agent**, and the transcript as plain text.
- **Resume:** Claude is now started with `--session-id <uuid> --name <slug>`; the id is stored in
  `brands/<slug>/out/agent-sessions.json` (newest 50). **Resume** runs `claude --resume <uuid>`: same
  conversation, works after a studio restart. Verified in a real PTY (a word given in session 1 was in the resumed
  history). OpenCode and custom commands can't be resumed by id: they get New agent only.
- **Film page:** a banner when `_raw/<slug>.md` differs from the film's `docs/brief.md`, with **Sync brief into the
  film** (copies the brief only; film.json is left alone since the agent may have tuned it). The animatic plays
  inline at its gate; the contact sheet shows at Final delivery.
- **Server:** `GET /api/dashboard`, `GET /api/agents`, `GET /api/films/:slug/terminal/log` (escape codes stripped),
  `POST /api/films/:slug/brief/sync` (same-origin). `GET /api/films/:slug` adds `drift`. `/media/` also serves
  `animatic.mp4` and `contact.png` for review; still nothing else.
- Tests: 26 (`npm test`), with history across a simulated restart, resume rules, drift/sync, attention rules
  (user stop 129 and clean exits don't alert). Checked end to end on a real server with a throwaway film (removed).

### Added: Film Library + navbar; finals are named after the brand
- **Naming (engine):** `finalize.mjs` now writes `out/<brand>-<format>-<W>x<H>.mp4` and `…-posting.mp4` instead of
  `final.mp4` / `final_posting.mp4`. Brand = the `--dir` folder name. Format = `silent_<format>.mp4`'s name, else the
  film.json format of the same size, else vertical/square/wide by shape. `--all-formats` finalizes every
  `out/silent*.mp4` with one audio measurement; before this, finalizing a second format overwrote the first.
  Tested on a throwaway 2-format brand: 4 files, −13.9 LUFS each.
- **Quantoxt:** `out/final.mp4` renamed once to `out/quantoxt-vertical-1080x1920.mp4` (user-approved exception to
  frozen; nothing else touched). It has no posting copy.
- **Library (`#/library`):** one slide-mount folder per brand with finished films (poster as cover, sheets stacked
  behind for extra formats). **`#/library/<slug>`**: that brand's films at true proportions, same height, with
  duration, fps, size, **Download master** and **Posting copy**. Click a film: full-screen player (black, fitted).
  Esc or leaving full screen closes it; Shift+←/→ switches formats. Finals only: animatics and silent renders stay
  on the gates page.
- **Navbar:** Briefs and Library at the head of the rail, current page marked. Replaces the "All briefs" link.
  The film page links to the library once the film is delivered.
- **Server:** `GET /api/library`, `GET /api/library/:slug`, `GET /media/:slug/:file` with byte ranges (206/416,
  so the player seeks without loading the whole file) and `?download=1`. Only finals and `poster.png` are served
  (`studio/library.mjs` allowlist); `.wav`, logs, drafts, `_template` and traversal attempts get 404.
- **Final delivery gate** now looks for the brand-named masters. Docs updated: brief template, motion-reel skill,
  `_template/README.md`, factory map, LESSONS.
- Tests: 24 (`npm test`), with finals parsing, posting pairing, other-brand names ignored, media allowlist.

### Changed: the agent terminal is its own page (`#/run/<slug>`)
- **Start film** (editor bar and briefs list) now scaffolds and lands on the agent page. Pick Claude, OpenCode or
  Custom, click **Run agent**. The terminal fills the page; the rail shows the 7 gates live (every 4s), each linking
  to the film page.
- Film page: the agent strip moved to the top, under the title. It shows **Run agent** or **Open terminal** if one
  is running, plus the copyable `follow …` command for pasting into an agent yourself.
- Briefs list: films get **Gates** and **Agent** buttons.
- `el()` now flattens nested child arrays (the list's two-button group needed it).

### Added: Run agent (terminal pane in the film view), per `docs/terminal-spec.md`
- The film view's handoff box now has **Run agent**: pick **Claude** (`claude "follow brands/<slug>/docs/brief.md"`),
  **OpenCode** (`opencode --prompt "…"`, press Enter in the pane to send) or **Custom** (any command; `<brief>`
  becomes the brief path, otherwise it's appended; runs via `bash -lc`). The agent runs in a real PTY (node-pty)
  and streams to an xterm.js pane over a websocket. You type answers straight into it.
- One session per film. Refreshing or leaving the page only detaches; coming back replays the scrollback (256 KB).
  **Stop agent** kills it and shows the exit code (129 = stopped). **Run again** asks first, then starts fresh.
- Transcript: `brands/<slug>/out/terminal.log`, capped at 1 MB (oldest half dropped). Sessions die with the studio
  process; the log survives.
- Server: `POST|GET|DELETE /api/films/:slug/terminal`, `WS /api/films/:slug/terminal/ws`. POST and the websocket
  require a same-origin `Origin` header (missing counts as foreign), so another site can't start processes.
  xterm files are served from `node_modules` by an explicit allowlist (`/vendor/*`). If node-pty isn't built, the
  studio still runs and the pane says how to fix it (503).
- Every request must carry our own `Host` (`127.0.0.1:<port>` or `localhost:<port>`), else 421. This blocks DNS
  rebinding, which could otherwise read briefs or terminal output from a foreign site.
- Spawned agents don't inherit a parent Claude Code session's markers or messaging token.
- Spec corrected: `opencode run` is one-shot (can't answer questions), so the preset uses `--prompt`.
- New deps: `node-pty` 1.1.0 (native; `allowScripts` approves its build), `ws`, `@xterm/xterm`, `@xterm/addon-fit`.
- Tests: 21 (`npm test`), with terminal create/stream/reattach/kill/respawn, film isolation, log + scrollback caps,
  env stripping, on a fake PTY. Checked end to end on a real server: input reaches the PTY, resize applies
  (`tput cols` = 77), reattach replays, kill → 129, 403 for foreign/missing Origin on POST and websocket,
  400 bad slug, 404 for `/node_modules/*` and test files. Both presets boot in a real PTY (Claude answered).

### Added: Approve shotlist (studio film view)
- The Shotlist gate is done only when **you approve it**, not just when the file exists. The film view shows
  **Read shotlist** (the full text inline), with **Approve this shotlist** at the bottom of it. Approved shotlists show
  **Withdraw approval**. The gate label reads *Needs your OK* or *Changed, needs your OK*.
- Approval is stored in `brands/<slug>/docs/approvals.json` as `{ shotlist: { approved, sha256, at } }`. The sha256 is
  of the exact text you read: the browser sends the hash of the version on screen, and the server refuses (409) if
  the file changed since, then shows you the new version.
- If the agent edits the shotlist after approval, the hashes no longer match: the gate goes back to *Changed, needs
  your OK*, and the agent must stop. The hash equals `sha256sum docs/shotlist.md`, so the agent checks it from the shell.
- `motion-reel` skill step 5: the OK is either "approved" in chat or a matching `approvals.json`.
- Endpoints: `GET /api/films/:slug/shotlist`, `POST …/shotlist/approve { sha256 }`, `POST …/shotlist/revoke`
  (same-origin only). The film view now rebuilds only when the folder changes, so an open shotlist keeps its scroll.
- Tests: 17 (`npm test`), incl. approve-what-you-read, stale-after-edit, revoke, `sha256sum` parity. HTTP checked
  end to end: 404 before a shotlist exists, 409 on wrong hash, 403 cross-origin, 200 approve → gate done, agent edit →
  stale, revoke, 405 on wrong method.


### Added: Studio step 2 (briefs list, reopen, Start film, gates)
- **Briefs list** (`#/`): every brief in `_raw/` with its brand name, save time and film progress (a 7-frame bar).
  **Edit brief** reopens it in the form. **Start film** / **Open film** for each.
- **Reopen and edit:** a saved brief is read back into the form (`readBack` in `studio/brief.mjs`). Lines are matched by
  position, else by nearest line with the same shape, so small template edits don't scramble answers. Answers that can't
  be placed are counted and shown as a warning. Saving the brief you opened replaces it with no prompt. If you change the
  brand folder, it saves as a new file. Unsaved-change guards on navigation and tab close.
- **Start film** (`POST /api/films`): copies `brands/_template/` → `brands/<slug>/`, copies the brief to
  `docs/brief.md`, and writes the brief's duration, formats (first is primary) and tempo into `film.json`. Never
  overwrites an existing folder (409); needs a saved brief (404). From the editor, it saves unsaved edits first.
- **Film view** (`#/film/<slug>`): 7 gates (Brief → Assets & style guide → Shotlist → Animatic → Critique rounds →
  Full render → Final delivery). Each is done when its file evidence exists. It shows the evidence, the "up next" gate,
  timestamps, and the copy-ready handoff `follow brands/<slug>/docs/brief.md`. Re-checks the folder every 4s while open.
- **Active state:** the rail frame for the section you're viewing gets a white leading bar (IntersectionObserver).
  Answered sections stay lit in the accent color. In the film view, the rail shows the gates with the current one marked.
- **Font bundled locally:** Bricolage Grotesque variable woff2 (latin + latin-ext, 107 KB) + OFL in `studio/fonts/`.
  No network needed.
- `motion-reel` skill: step 1 now says to use a studio-scaffolded folder as is, and where to write files so the gates
  see them (incl. `## Round N` headings in `docs/review_log.md`).
- New: `studio/films.mjs`, `studio/films.test.mjs`. `npm test`: 16 tests. Server checked end to end: save → reopen
  (byte-identical, 0 missed) → list → start film (201) → again (409) → no brief (404) → reserved/traversal (400) →
  gates (1/7, assets up next) → film.json (15s, 16:9 primary).


### Added: Studio web UI, step 1 (brief form)
- `npm run studio` (or `node studio.mjs [--port 4321] [--no-open]`) starts a local server on 127.0.0.1 and opens the
  browser on a form for a new film brief. **Save brief** writes `_raw/<slug>.md`.
- **The form is generated from `_raw/brief-template.md`** at load time. Edit the template and the form follows: bold
  label + `- [ ]` lines become pick lists (radio, or multi when the label says *(any)* / *(pick up to …)*), `____`
  becomes a fill-in field, `*italic*` lines become notes, `### Notes for the agent` and blockquotes stay hidden but
  are written back verbatim. A backticked `` `____` `` is treated as text, not a field.
- Saved file = the template line for line, with `[x]` ticks and answers filled in. Unanswered fields stay `____`
  (= agent decides). Verified byte-for-byte against the serializer.
- File name: the *Brand folder* field, else the brand name, slugified (`a-z0-9-`, max 40). An existing file is never
  overwritten without a **Replace brief** confirmation. `brief-template` is reserved.
- Drafts autosave in the browser (localStorage) and are discarded if the template changed (answers are keyed by line).
- Safety: binds 127.0.0.1 only, refuses cross-origin POSTs, 256 KB body limit (413), serves only `index.html`,
  `app.mjs`, `brief.mjs`, and writes only `_raw/<validated-slug>.md`.
- Files: `studio.mjs`, `studio/index.html`, `studio/app.mjs`, `studio/brief.mjs`, `studio/brief.test.mjs`.
- Tests: `npm test` runs 9 parser/serializer tests (no browser). Server checked with curl: pages, template, save,
  409 on existing, overwrite, bad/reserved slug, cross-origin, oversize, traversal, served-file allowlist.

### Changed: brief template
- `_raw/brief-template.md` rewritten as an interactive checklist (outside code blocks, so editors render real checkboxes).
  Every pick list has an **Agent decides** option; `____` left blank also means agent decides.
- **Source** (website URL / local codebase / GitHub repo) moved to section 1 as the main input. Story, look and brand
  rules are optional overrides that the agent derives from the source when left blank.

### Fixed: engine audit
- 12 bugs: B-001 … B-012 in `docs/bug-docs.md` (finalize crash, renderer setup race, serial false-success,
  animatic odd sizes, `--all-formats` flag leak, server MIME + malformed URL, `strokeLine`, `shots` strip, `sfx`, docs).
- `finalize.mjs` now builds the mix from `music.wav` + `sfx.wav` when no `mix.wav` exists.

### Fixed: new libs review
- A-001 … A-004 in `docs/bug-docs.md` (`boil` negative t, template frame-0 darkening, cube shading and culling).

### Added: factory structure (by the user)
- `brands/<name>/` per film with `--dir`, `brands/_template/`, `film.json`, `--animatic`, `--all-formats`,
  `finalize.mjs`, `lib/hand.js`, `lib/project.js`, the motion-reel skill, `docs/factory-map.md`.

## 2026-10-06

### Added: parallel renderer
- `render-parallel.mjs`: ~4× faster, byte-identical to `render.mjs` (`docs/parallel-render.md`).

### Added: first film
- Quantoxt brand film (`brands/quantoxt/`, frozen). Lessons in `docs/LESSONS.md`.
