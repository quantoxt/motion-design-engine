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
  (odometer grammar) so glyphs never share pixels. Route every screen-space
  consumer through one mapping function (incl. camera) or elements drift.
- Overlap entries with exits: start the next scene before the previous finishes.
  Holds longer than ~1s need new content. Phone test: source ÷ 3 ≈ 360px wide;
  body/UI text under ~40px source lands ≤13px on phone.
- Hand-drawn SVG goes through `lib/hand.js` (Path2D + boil + pencil ink), never
  raster images of drawings. Fake-3D goes through `lib/project.js`
  (iso/cube/turntable/parallax) — both pure in t, both parallel-safe.

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Write the beat grid FIRST (from BPM), lock every cut to it, then measure the mix.
- Verify librosa grids with onsets, not `beat_track`, when hats sit on offbeats.
- Whooshes peak after they start — begin them ~0.19s before the cut.
- Hit −14 LUFS with two-pass `loudnorm` (`linear=true`), confirm with `ebur128`.
- You cannot hear the result. Say so and ask a human to listen; "sound sync" here
  is measured, never auditioned.

## Loop before you show me anything
1. `shots.mjs beats` (settled state per beat) AND `shots.mjs strip` across EVERY
   scene handoff — beat sheets miss transition bugs. Re-check the encoded MP4 once
   at the end (blur + compression change the look).
2. Score 1-10 on: hook in first 2s, readability at phone size,
   motion quality, variety, brand accuracy, sound sync.
3. Fix the 3 worst problems. Budget 4 critique rounds, not 3. Repeat until 8+.
4. Only then do the full render.
5. If these rules change mid-session, re-read them and re-check the plan.
