# Motion studio rules (factory)

> Working on an image job (`pge/jobs/<name>/`, a still or a carousel, not a film)? Follow `pge/AGENTS.md` instead.

## Layout — engine vs jobs
- Root is the ENGINE, shared by every film. Never put brand files here.
- Each film lives in `brands/<name>/`: its `index.html`, `assets/`, `docs/shotlist.md`,
  `beats.json`, score/SFX sources, and `out/`.
- New job: copy `brands/_template/` → `brands/<name>/`, work only inside it.
- **Film agents never write to the engine.** Root scripts, `lib/`, `studio/`, `brands/_template/`, `AGENTS.md` and
  `.agents/` are read-only to you, even for a one-line fix, even if the bug blocks you. Another film may be mid-render on
  that code. Found an engine bug? Log it in `docs/bug-docs.md` (symptom, cause, proposed fix, marked `open`), work
  around it inside your brand folder, and say so in your review log. Engine fixes are made by hand, outside film runs.
- All scripts take `--dir brands/<name>` (outputs land in that folder's `out/`).
  Running without `--dir` uses the current directory (legacy single-project mode).

## Render contract (load-bearing — parallelism depends on it)
- Every film is a pure function of time: `window.seek(t)` paints frame t.
- No CSS transitions, no setTimeout, no requestAnimationFrame in render mode,
  no state carried between frames. Seeded noise only (mulberry32), never Math.random.
- ES modules don't load over `file://` — the renderers serve `--dir` over HTTP automatically.
- `document.fonts.ready` is NOT enough on a canvas-only page. Expose `window.ready`
  that awaits `document.fonts.load()` for every face/weight drawn plus `img.decode()`
  for images; renderers await it before the first seek.
- Default renderer is parallel: `node render-parallel.mjs --dir brands/<name> --workers 3`
  (cores − 1 on this machine). Serial `render.mjs` stays the reference. After ANY
  renderer change, re-verify byte-identical output via the framemd5 check in
  `docs/parallel-render.md`.
- Dimensions, fps, duration, formats live in the brand's `film.json` — renderers
  and `shots.mjs` read it. Never hardcode sizes in scripts.
- Fix pacing with `--animatic` (half size, 15fps, no blur, CRF 28) before full
  renders. `--all-formats` renders every orientation in `film.json`.
- Finish with `node finalize.mjs --dir brands/<name>` (two-pass loudnorm −14 LUFS,
  ebur128 confirm, CRF-20 posting copy; `--all-formats` for every `silent_*.mp4`). Never hand-mux.
  Finals are named `out/<brand>-<format>-<W>x<H>.mp4`: the studio's gates and Library read
  that name, so never rename them.
- Encode H.264 yuv420p, CRF 16. Grain-heavy finals run large — also export CRF 20 for posting.
- Time 1s of film and multiply before quoting a render duration. Never estimate blind.

## Look
- Banned defaults: centered title on gradient, everything fading in, decorative corner labels and
  frame borders, glow on UI chrome, generic particle bursts. (A viewfinder layer is allowed when the
  brief ticks it: corner brackets, timecode, bar counter, tiny mono labels, fixed on top, never moving.)
- One display face, one UI face. One accent color unless the brief says otherwise. Background floods
  may rotate up to 4–5 flat colours when the brief asks for them (base colour is home; a shock colour
  appears briefly). Each flip is the motif growing past the frame edges, on a bar line.
- Pace: something changes on every beat, and a big change (scene, flood, full-screen word) on every bar.
  Text still stays long enough to read at phone size. `holds.mjs` fails any stretch over 3s where
  ≤1% of the screen moves (film.json `"quiet"` raises it only when the brief asks for a calm film).
- Loud / quiet / loud: plan the shotlist as alternating beats. Loud = full-screen type, a pattern, a flood.
  Quiet = one small object in empty space. 2–3 full-screen type moments per film (one word fills the
  frame width, `fitText` from `lib/transitions.js`), each with a tiny companion line. Shrink before a burst.
- The end card comes straight after the busiest moment: build to the fastest, loudest bar, then land on the
  still logo (2s at most). Don't slow down before it. The last frame returns to the first frame's object and
  colour, so the film feels complete and loops cleanly.
- Convert brand oklch tokens → hex once with a script; don't eyeball. Very dark
  oklch values collapse to black — plan dark-mode contrast around borders, not fills.
- Check logo resolution by content box (alpha bbox), not file size. Recoloring a
  higher-res variant in canvas is still the real file, not a redraw.

## Motion
- Springs over easing (lib/motion.js). Type critically damped (no overshoot);
  UI slightly underdamped (tiny overshoot). Cursor: different stiffness per axis
  so it travels on a curve.
- Every transition must be a physical transformation of an on-screen object —
  lines become paths, rays become diagrams. No meaningless hard cuts.
- One motif object should carry transitions across the whole film.
- Scenes leave by turning into the next one (`flood`/`drain` from `lib/transitions.js`, shrink into the
  motif, morph) or by sinking back into the mask they rose from. Never by flying across the frame: the
  renderer's blur draws a fast move as separate see-through copies. `check.mjs` reports it as `streak`
  (>24px between blur snapshots). Fix by changing the exit, not by hiding it; raising film.json `sub`
  (8–16) is the fallback for a move that must be fast. All exits that do travel go the same direction. Overlapping text swaps must share one spring
  (odometer grammar) so glyphs never share pixels: `swapText` / `drawOdometer`
  (carry included) from `lib/type.js`, never hand-rolled. Route every screen-space
  consumer through one mapping function (incl. camera) or elements drift.
- Overlap entries with exits: start the next scene before the previous finishes.
  Holds longer than ~1s need new content. A planned hold (film.json `holds`) is 2s at most, end card included. Phone test: source ÷ 3 ≈ 360px wide;
  body/UI text under ~40px source lands ≤13px on phone.
- Hand-drawn SVG goes through `lib/hand.js` (Path2D + boil + pencil ink), never
  raster images of drawings. Fake-3D goes through `lib/project.js`
  (iso/cube/turntable/parallax/`drawHinged`) — both pure in t, both parallel-safe.
- One source of truth per position (`lib/layout.js`). Name every target where it is
  drawn (`L.anchor`, `L.text` with `{ parent }`, `{ bleed: true }` for bleed); cursor
  targets, ink and underlines read `L.at(name, t)`. Wrapped copy goes through `wrap` +
  `spans`, so annotations follow the words across line breaks. Never type a coordinate twice.
- Clicks are `{ t, target }` and the cursor is `cursorAt()` from `lib/cursor.js`: it
  lands ≥0.4s before each click, inside the target, at rest. Anchor its tip as `'cursor'`.
  The click visibly changes the thing it touches first (press, colour, label), then anything else follows from it.
- A 3D turn pivots on the object's real hinge (`drawHinged`, a cover on its spine), and
  its far edge is where the next object starts. Nothing appears behind it before it gets there.
- An entry starts from 0 (scale, mask or off-frame), never at full size.
- The motif never covers the words it annotates, least of all in the 2s hook.
- A state change must read at phone size in both states (give "before" a tint).
- A full-screen flat colour (a flood, a colour scene) gets `grain` + `vignette` from `lib/texture.js`, so it
  doesn't read as a digital fill.
- Bleed elements (marquees, walls) are sized from the frame, not the content box:
  `frameExtents(W, H)` from `lib/layout.js` (`F.across(pad)`, `F.down(pad)`), anchored `{ bleed: true }`.
  An entry from below starts at `F.EY + its height`, not a fixed offset.
- One owner per morphing object: a card that morphs from scene A into B is drawn by exactly one scene at
  any moment (A until its `to`, then B). Two scenes each drawing "their" copy pops for a frame.
- No branches on state colour (`t < X ? mix(…) : CARD`): it snaps when the branch flips mid-spring. One
  expression whose springs reach their end values.
- A counter settles before the beat that reads it (stiff spring ≥300/34 when it has <0.5s, or a ramp that
  lands exactly on the next event). An odometer shows every column from its first frame: roll from a value with
  all its digits (10,000 → 28,100, not 0 → 28,100, which shows `03,291` mid-roll), and don't roll it while it rises through a mask.
- Text that stacks near other text: give it `L.text` (always solid) or `{ solid: true }` so check.mjs sees
  collisions. Pass `{ align, baseline }` to `L.text` so it measures what fillText draws.
- An anchor read at a click time must be drawn at exactly that time: hand off strictly after (`t > open`).
- Export the scene table as `window.SCENES`: `shots.mjs events` steps through every handoff from it. Mark scenes that
  are layers, not shots (cursor windows, flood overlays, a motif living through a section) `{ layer: true }`.
- A flood that has covered the frame keeps painting its colour (its own overlay scene) for as long as any scene under
  it is still drawing: scenes running past the cover time draw on top of the new colour (5 of portfolio's first 7 pops).
- Every scene's `to` needs an exit for everything it drew: a heading that vanishes in one frame at `to` can pass
  holds.mjs. Strip-shoot the frames just before each `to`.
- Anchor text on every frame it's drawn, not only when settled: check.mjs only sees what's anchored. A camera push on a
  full-width word clips it at the edges: max zoom = 1 / the word's width fraction (0.9 width → zoom ≤ 1.10).

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Name note lengths once (`BEAT`, `E8 = BEAT / 2`, `S16`, `S32`) and never multiply them inline: `2 * S32` written for an
  8th is a 16th (portfolio's bar-22 wall stopped stepping 2s early).
- Write the beat grid FIRST (from BPM), lock every cut to it, then measure the mix. Snap every visual
  event time to the 16th grid BEFORE writing cues; a cue copied from an off-grid visual is off too.
- Verify librosa grids with onsets, not `beat_track`, when hats sit on offbeats. Use
  `onset_detect(hop_length=128, backtrack=True)`: the default hop reads ~+16ms late (detector latency).
- Whooshes peak after they start — begin them ~0.19s before the cut.
- Hit −14 LUFS with two-pass `loudnorm` (`linear=true`), confirm with `ebur128`.
- You cannot hear the result. Say so and ask a human to listen; "sound sync" here
  is measured, never auditioned.

## Design references
- If `assets/refs/refs.md` exists, read it before the style guide. It lists every image and clip uploaded with the brief,
  in order, each with the client's note on what to take from it. A note applies to its own file only.
- You can't watch a clip: open its `<name>.frames.png` (frames left to right, then down, spacing given in refs.md). Read
  the motion from the sequence: cut rhythm, how objects enter and leave, camera moves, how type changes.
- Write a "References" section in `docs/style_guide.md`: per file, what you take (following its note) and what you don't.
  No note: decide, and say why. Take the grammar (layout, type, colour, texture, motion, pacing), never the content:
  no tracing, no copied artwork, logos, footage or text.

## Lessons
- Before planning, read `brands/<name>/docs/lessons.md` if it exists (a new version inherits the
  previous one's) and don't repeat its mistakes.
- At the end of every run, write what it taught you to `brands/<name>/docs/lessons.md`
  (create or extend it; short measured rules, not a diary).
- Never read or write `docs/LESSONS.md`. It is curated by hand.
- Film agents never read `eye/` or `lab/`. They are research inputs to the factory, and what they taught is already in these rules. (The lab works inside `lab/` under its own README.)

## Loop before you show me anything
1. Check by kind of bug, on the animatic, before any full render. Beat stills only
   show the film at rest; most bugs live between beats, in time, or in other formats.
   - `shots.mjs beats` (layout at rest) AND `shots.mjs strip` across EVERY scene handoff.
   - `shots.mjs events`: a still at every click and label swap, and 0.15s steps across
     every transform (fine endpoints prove nothing about the middle). The film declares
     them in `window.EVENTS` / `window.TRANSFORMS`, derived from the drawing constants.
   - `render-parallel.mjs --scan` then `holds.mjs`: one-frame pops (hidden cuts,
     full-size entries, hard swaps) and holds >1s where only grain/boil moves. Look at `out/pops.png`
     (±3 frames per pop) before fixing. Check a fix on a window (`--scan --from 12 --dur 2`, then
     `holds.mjs --file out/scan_12.00-14.00.mp4`); only the full `--scan` counts for the gate. It also fails
     quiet stretches (>3s with ≤1% of the screen moving) and reports how much of the film moves (crisp: 60%+). The meter
     only sees big, high-contrast shapes moving ≥ ~1 source px/frame: subtle drift, thin type (≤ ~40px) and dark-on-dark
     motion count as still. On a dark flood, carry the beat with light type. Fix
     each, or list an intended hold in film.json `"holds"`. The animatic is too coarse for it.
   - Every format: `shots.mjs events --format all` and `shots.mjs at <hook> <densest> <end> --format all`.
   - `check.mjs`: in every format, no fast move smears into copies (`streak`), every click lands in its target with the cursor at rest,
     no text overflows its parent, no two texts (or `{ solid: true }` anchors) collide, nothing sits cut by the frame edge.
   Re-check the encoded MP4 once at the end (blur + compression change the look), including `holds.mjs --file
   out/silent_<primary>.mp4`: the half-size scan can pass a stretch the full-res render fails (portfolio: 4.4s quiet).
   Overlap springs (a step every beat) so travel is continuous, not 0.4s moves split by 0.5s of stillness.
   Loop check: `shots.mjs at 0` and `at <DUR − 1/fps>` must match; end all motion by DUR − 0.15.
2. Score 1-10 on: hook in first 2s, readability at phone size,
   motion quality, variety, brand accuracy, sound sync. Score from measurements,
   not from the shotlist: if an item can be measured (holds, click hits, sync), measure it.
3. Fix the 3 worst problems. Budget 4 critique rounds, not 3. Repeat until 8+.
4. Only then do the full render. It is gated: `render-parallel.mjs` refuses a full render
   until `check.mjs` and `holds.mjs` have passed on the current code (any edit to
   index.html or film.json re-opens the gate). `--skip-checks` exists for emergencies only:
   it shows on the studio gate, and you say why in the review log.
   The primary format (film.json `formats[0]`) renders first: `--all-formats --formats <primary>`.
   Review it yourself (stills, `holds.mjs --file out/silent_<primary>.mp4`), then tell the human it's
   ready and wait: they watch it and approve it in the studio (Primary render). The renderer refuses
   the other formats until that OK matches the current render and code. Then `--formats <others>`.
   Every format bug so far was visible in the primary.
5. If these rules change mid-session, re-read them and re-check the plan.
