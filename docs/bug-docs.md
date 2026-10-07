# Factory bug log

Every bug found and fixed in factory (engine) code: what broke, how it was proven, what changed, how the fix was verified.
Newest first. Brand-film bugs don't go here (they belong in that brand's review log).

Format per entry: **ID · file · severity**, then Symptom / Cause / Fix / Verified.
Severity: **high** = breaks a real job · **med** = breaks a common option · **low** = edge case or docs.

---

## 2026-10-07 · Film Library work

### L-002 · `prompts/critique-pass.txt` · med
- **Symptom:** after L-001 renamed finals, the critique prompt's contact-sheet commands still read `out/final.mp4`,
  which new films no longer have: ffmpeg would fail at the critique step.
- **Cause:** the rename was applied to code and docs found by grep, but the first sweep missed `prompts/`.
- **Fix:** the commands take `F=out/<brand>-<format>-<W>x<H>.mp4` (or the silent render before finalize).
- **Verified:** repo-wide grep for `final.mp4` / `final_posting` now only hits the changelog, this log and
  the frozen quantoxt folder.

### L-001 · `finalize.mjs` · high
- **Symptom:** a film with several formats could only keep one finished file: every run wrote `out/final.mp4` and
  `out/final_posting.mp4`, so finalizing `silent_square.mp4` after `silent_vertical.mp4` silently overwrote the
  vertical master. The skill and template promise every ticked format.
- **Cause:** fixed output names, no notion of format, one `--video` per run.
- **Fix:** outputs are named `out/<brand>-<format>-<W>x<H>.mp4` (+ `-posting.mp4`), format from the render's name,
  film.json, or its shape. `--all-formats` finalizes every `out/silent*.mp4` with one loudness measurement.
- **Verified:** throwaway brand with `silent_vertical` + `silent_wide` → 4 distinct files, each −13.9 LUFS;
  single `silent.mp4` run picks the film.json format name (`landscape`) by size.

## 2026-10-07 · Full engine audit

Every bug below was reproduced with a failing test **before** the fix and re-run **after** it.
Renderer changes passed the byte-identical check (serial = parallel = `9f8a319e…`, unchanged from the first film).

### B-012 · `finalize.mjs` · high
- **Symptom:** crashed on every run: `SyntaxError: Unexpected end of JSON input` at the first step.
- **Cause:** ffmpeg prints loudnorm's JSON and the ebur128 summary to **stderr** at info level. The script ran with `-v error`
  and read **stdout**, so it got an empty string. It had never been run end-to-end.
- **Fix:** run ffmpeg via `spawnSync`, read stderr at info level, parse the last `{…}` block. Fail with the ffmpeg log
  if anything is missing. Warn if the result is >0.5 LU off −14.
- **Verified:** 3s clip → measured −13.38, delivered **−14.0 LUFS / −1.5 dBTP**.

### B-011 · `finalize.mjs` · high
- **Symptom:** required `out/mix.wav`, but no script in the factory creates it (skill: "sfx.mjs, then finalize").
- **Fix:** audio source order is `--audio` → `out/mix.wav` → `out/music.wav` (+ `out/sfx.wav` mixed on top, mono spread
  to stereo, `amix normalize=0`). Missing video/audio → clear message, exit 1. Relative `--video/--audio` resolve
  against `--dir`. Added `+faststart`.
- **Verified:** music + sfx only → `premix.wav` → **−14.2 LUFS**; empty dir → "no video … render first", exit 1.

### B-010 · `render-parallel.mjs`, `render.mjs`, `shots.mjs` · high
- **Symptom:** `seek is not a function`, render dies.
- **Cause:** renderers called `window.ready` / `seek` right after the `load` event. A module that finishes setup later
  (e.g. `await fetch('./film.json')`, which **`brands/_template/index.html` does**) hasn't defined them yet. Every new
  film from the template was exposed.
- **Fix:** `await page.waitForFunction(() => window.ready && typeof window.seek === 'function')` before the first use.
- **Verified:** test film with an 800 ms delay before defining `seek` renders in all three scripts.

### B-009 · `render.mjs` · high
- **Symptom:** exited 0 ("success") when ffmpeg refused to encode and no file was written.
- **Cause:** ffmpeg's exit code was awaited but never checked.
- **Fix:** non-zero ffmpeg exit → error message + exit 1.
- **Verified:** odd-width (201px) canvas → exit 1, previously exit 0.

### B-008 · `render-parallel.mjs` · med
- **Symptom:** `--animatic` on a 1350-wide film failed: `width not divisible by 2 (675x540)`.
- **Cause:** half size used `Math.ceil(w/2)`; yuv420p needs even dimensions.
- **Fix:** `half = (v) => Math.round(v / 4) * 2`.
- **Verified:** 1350×1080 → animatic **676×540**, exit 0.

### B-007 · `render-parallel.mjs` · med
- **Symptom:** `--all-formats --w 200` rendered every format at width 200 (format "b" 300×100 came out 200×100).
- **Cause:** the re-invocation passed the user's argv through; `indexOf('--w')` found the user's flag before the format's.
- **Fix:** strip `--w`, `--h`, `--out` and their values from the inherited args.
- **Verified:** format b → **300×100**.

### B-006 · `lib/serve.mjs` · med
- **Symptom:** `.svg` served as `application/octet-stream`; the browser won't decode it as an image.
- **Fix:** added MIME types: svg, css, jpg/jpeg, webp, gif, woff, ttf, otf, wav, mp3, mp4.
- **Verified:** `a.svg` → `image/svg+xml`.

### B-005 · `lib/serve.mjs` · med
- **Symptom:** one malformed URL (`%E0%A4%A`) crashed the server (unhandled `URI malformed`), killing a render.
- **Fix:** `decodeURIComponent` in try/catch → 400.
- **Verified:** malformed → 400, next request → 200.

### B-004 · `lib/hand.js` `strokeLine` · med
- **Symptom:** at p=0 it drew a dot (zero-length round-cap stroke). While growing, the curve changed shape. At p=1 the
  bow was gone (`sin(πp)` = 0), so it ended straight although documented as "slightly bowed".
- **Fix:** return at p≤0; one fixed quadratic (control point offset by `bow`), drawn as its first part via de Casteljau split.
- **Verified:** p=0 → nothing; p=0.5 ends at (50,−10), on the full curve; p=1 → `Q50 -20 100 0`, bowed.

### B-003 · `shots.mjs` · low
- **Symptom:** `strip a b 1` → time `NaN` (division by n−1 = 0).
- **Fix:** n ≤ 1 → `[a]`.
- **Verified:** `strip 0.1 0.2 1` → frame at 0.10.

### B-002 · `sfx.mjs` · low
- **Symptom:** empty cue list → `RangeError: Invalid typed array length: -Infinity`; unknown cue type →
  `undefined is not iterable`.
- **Fix:** length from `reduce(max, 0)`; unknown type → `unknown cue type "boom" at t=0.1 (have: click, pop, …)`.
- **Verified:** empty → 2.0s silent wav; typo → readable error.

### B-001 · docs · low
- `docs/patterns.md` Pattern B said "critique 3 rounds"; the studio rule is 4 (+ strips). Fixed.
- `_raw/brief-template.md` said "1920x1080 (16:16...)". Fixed to 16:9.

### Known, deliberately not fixed
- **`lib/motion.js` `spring()`** uses the critical-damping formula when z > 1 (slightly overdamped). It's an
  approximation, but the frozen Quantoxt film has springs at z ≈ 1.004–1.05, and changing it would change its pixels.
  Revisit only with a versioned spring (e.g. `springExact`).
- **`beats.py`** sets `downbeats = beats[::4]`, assuming the first detected beat is beat 1. librosa can lock onto offbeats
  (seen on Quantoxt). Verify against onsets.

---

## 2026-10-07 · New libs review (`lib/hand.js`, `lib/project.js`, template)

### A-004 · `lib/hand.js` `boil()` · high
- **Symptom:** throws on frame 0 for any film that boils at t=0.
- **Cause:** renderers sample t = −0.0125…−0.004 for motion blur → `floor(t·12) % n` = −1 → `variants[-1]` = undefined →
  `g.stroke(undefined)` throws.
- **Fix:** `((i % n) + n) % n`.
- **Verified:** t = −0.0125, −0.004 → valid variant; scratch film renders from frame 0.

### A-003 · `brands/_template/index.html` · high
- **Symptom:** frame 0 (the hook) about 75% darker than frame 1.
- **Cause:** no clamp on t; 3 of frame 0's 4 subframes fall before t=0, where no scene is active → blank.
- **Fix:** `t = clamp(t, 0, DUR - 1e-6)` in `draw()`. Also: title fade-in replaced with a mask roll and critically damped
  spring (the old one broke the "no fade" and "no overshoot on type" rules).
- **Verified:** frame-0 luma 34.8 vs frame-3 35.2.

### A-002 · `lib/project.js` `drawCube` shading · med
- **Symptom:** top face drawn darkest, bottom lightest, opposite faces in different shades.
- **Cause:** `shades[face % 3]` keyed shade to face index (top = index 3 → shade 0 = dark).
- **Fix:** shade by the rotated normal: up → light, x-facing → dark, z-facing → mid.
- **Verified:** top face drawn and lightest in **126/126** turntable poses.

### A-001 · `lib/project.js` `cube`/`drawCube` draw order · med
- **Symptom:** back faces would paint over front faces during a spin.
- **Cause:** painter sort by rotated z, but the iso camera looks along (1,1,1), not z.
- **Fix:** back-face culling by projected winding (exact for convex solids), no sort. **Note:** screen y points down, so
  front faces have *negative* shoelace area. The first attempt had the sign inverted and still passed a count-only test.
- **Verified:** exact visible face set equals `normal·(1,1,1) > 0` in **504/504** poses; turntable strip checked by eye.

---

## 2026-10-06 · First film (Quantoxt) build

### Q-002 · `docs/parallel-render.md` verify commands · low
- **Symptom:** re-running the framemd5 check silently compared stale hash files.
- **Cause:** `ffmpeg … -f framemd5 out.md5` without `-y` refuses to overwrite.
- **Fix:** added `-y`.

### Q-001 · `lib/serve.mjs` · high
- **Symptom:** Playwright `page.goto` failed with `Download is starting`.
- **Cause:** content type came from `extname('/')` = '' → octet-stream → the browser downloaded index.html.
- **Fix:** resolve `/` → `index.html` before picking the content type.
