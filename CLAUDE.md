# Motion studio rules (factory)

## Layout — engine vs jobs
- Root is the ENGINE, shared by every film. Never put brand files here.
- Each film lives in `brands/<name>/`: its `index.html`, `assets/`, `docs/shotlist.md`,
  `beats.json`, score/SFX sources, and `out/`.
- New job: copy `brands/_template/` → `brands/<name>/`, work only inside it.
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
- Banned defaults: centered title on gradient, everything fading in,
  corner labels and frame borders, glow on UI chrome, generic particle bursts.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Every 2 to 4 seconds something new must happen on screen.
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
- All exits go the same direction. Overlapping text swaps must share one spring
  (odometer grammar) so glyphs never share pixels: `swapText` / `drawOdometer`
  (carry included) from `lib/type.js`, never hand-rolled. Route every screen-space
  consumer through one mapping function (incl. camera) or elements drift.
- Overlap entries with exits: start the next scene before the previous finishes.
  Holds longer than ~1s need new content. Phone test: source ÷ 3 ≈ 360px wide;
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
- A 3D turn pivots on the object's real hinge (`drawHinged`, a cover on its spine), and
  its far edge is where the next object starts. Nothing appears behind it before it gets there.
- An entry starts from 0 (scale, mask or off-frame), never at full size.
- The motif never covers the words it annotates, least of all in the 2s hook.
- A state change must read at phone size in both states (give "before" a tint).
- Bleed elements (marquees, walls) are sized from the frame, not the content box:
  `frameExtents(W, H)` from `lib/layout.js` (`F.across(pad)`, `F.down(pad)`), anchored `{ bleed: true }`.

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Write the beat grid FIRST (from BPM), lock every cut to it, then measure the mix.
- Verify librosa grids with onsets, not `beat_track`, when hats sit on offbeats.
- Whooshes peak after they start — begin them ~0.19s before the cut.
- Hit −14 LUFS with two-pass `loudnorm` (`linear=true`), confirm with `ebur128`.
- You cannot hear the result. Say so and ask a human to listen; "sound sync" here
  is measured, never auditioned.

## Lessons
- Before planning, read `brands/<name>/docs/lessons.md` if it exists (a new version inherits the
  previous one's) and don't repeat its mistakes.
- At the end of every run, write what it taught you to `brands/<name>/docs/lessons.md`
  (create or extend it; short measured rules, not a diary).
- Never read or write `docs/LESSONS.md`. It is curated by hand.

## Loop before you show me anything
1. Check by kind of bug, on the animatic, before any full render. Beat stills only
   show the film at rest; most bugs live between beats, in time, or in other formats.
   - `shots.mjs beats` (layout at rest) AND `shots.mjs strip` across EVERY scene handoff.
   - `shots.mjs events`: a still at every click and label swap, and 0.15s steps across
     every transform (fine endpoints prove nothing about the middle). The film declares
     them in `window.EVENTS` / `window.TRANSFORMS`, derived from the drawing constants.
   - `render-parallel.mjs --scan` then `holds.mjs`: one-frame pops (hidden cuts,
     full-size entries, hard swaps) and holds >1s where only grain/boil moves. Fix
     each, or list an intended hold in film.json `"holds"`. The animatic is too coarse for it.
   - Every format: `shots.mjs events --format all` and `shots.mjs at <hook> <densest> <end> --format all`.
   - `check.mjs`: in every format, every click lands in its target with the cursor at rest,
     no text overflows its parent, nothing sits cut by the frame edge.
   Re-check the encoded MP4 once at the end (blur + compression change the look).
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
