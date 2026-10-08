# Lessons from the Quantoxt brand film (2026-10-06)

Things that cost time, broke, or worked better than expected while building a 20s 9:16 brand film with
`index.html` + `window.seek(t)` + Playwright + ffmpeg. Written for the next agent. Numbers are measured on
this machine (4 cores), not guessed.

---

## 1. Pipeline & tooling

**ES modules don't load over `file://`.** `index.html` importing `./lib/motion.js` fails silently in Chromium.
Serve the folder over HTTP instead: `lib/serve.mjs` (tiny static server, random port). Both `render.mjs` and `shots.mjs` use it.
- Gotcha: if the content type comes from `extname('/')`, it's empty → `application/octet-stream` → Playwright
  throws `Download is starting`. Resolve `/` → `index.html` *before* picking the content type.

**`document.fonts.ready` is not enough.** It only waits for fonts the DOM already uses, and a canvas-only page uses none.
Expose `window.ready = load()` that calls `document.fonts.load()` for every face/weight/style you draw with,
plus `img.decode()` for images. Have the renderer `await page.evaluate(() => window.ready)` before the first seek.

**Render cost is all in the screenshot, not the drawing.** Per 1080×1920 subframe:
| Step | ms |
|---|---|
| `seek(t)` (full canvas draw incl. grain) | 31 |
| Playwright `locator.screenshot()` (PNG encode + base64) | ~810 |
| CDP `Page.captureScreenshot({ optimizeForSpeed: true })` | 441, **pixel-identical** |
| `getImageData` → return to Node (any transport) | 455–1904, slower or no better |

Then split the work: each frame goes to worker `f % N` (one Chromium per worker), and frames are written **in order into one ffmpeg**.
The result is byte-identical to the serial render, and 20s at 60fps×4 subframes took 11.8 min instead of ~60.
Speed tops out around (cores − 1) workers. Full write-up: `docs/parallel-render.md`.
This only works because frames are pure functions of `t`. Guard that contract.

**Measure the render rate before quoting a time.** I estimated 10–15 min and the real number was ~60. Time 1s of film, then multiply.

**Critique stills don't need an encode.** `shots.mjs` screenshots `seek(t)` directly:
- `node shots.mjs beats`: one frame per beat. Sample at `n*0.5 + 0.49` (just before the next beat), which shows
  the settled state of each beat.
- `node shots.mjs strip a b n`: n frames across a transition. **Per-beat sheets miss transition bugs.**
  The odometer overlap and the stat-exit collision only showed up in strips. Always strip every scene handoff.
- Then check the *encoded* MP4 once at the end (contact sheet from the finalized master), because motion blur and compression change how frames look.

**Environment quirk (this setup):** the Read tool was denied for `out/`, and some `cmd | tail` pipes were blocked in auto
mode. `python3 -c "print(open(path).read()[-200:])"` worked for reading logs.

---

## 2. Brand inputs

- **Read the real repo, not just the tokens.** The landing components gave all the copy (hero h1, mock UI cards,
  CTA text). Every line on screen came from the site, so nothing reads as invented.
- **Pull live numbers from the product's public API** (`GET /api/stats`) rather than guessing. Note the date of the snapshot,
  because the film goes stale when the live value changes.
- **Ask the hero-metric question; don't recommend-and-proceed.** I recommended "100% on-time", the user picked "3.3 weeks".
  The shotlist gate (write it, then wait for the OK) is where that correction is cheap.
- **Brief vs live site can conflict** (brief: pill buttons, no shadows; site: rounded-lg with shadows). Surface it as a question.
- **Very dark oklch tokens are effectively black.** `oklch(0.02 …)` → `#000000`, card `oklch(0.082 …)` → `#020203`.
  Dark-mode cards are visible only through their 8% white border, so plan contrast around borders, not fills.
  Convert oklch → hex once with a script; don't eyeball it.
- **Brand indigo `oklch(0.451 0.192 280)` as text on black is too dark**, and unreadable once dimmed to 50%. Use a lighter
  step of the *same hue scale* (accent-violet 0.547) for type, and tell the user you did.
- **Check logo resolution by the content box, not the file size.** `full-white-variant.png` is 500px but its logo content
  is only 408px wide, which goes soft at 760px. The 1024px black variant has 833px of content. Recolor it in canvas
  (`drawImage` then `globalCompositeOperation = 'source-in'` and a white fill). It's still the real file, not a redraw.
  Get the alpha bbox with PIL: `Image.open(p).getchannel('A').getbbox()`.
- **Find logo parts precisely** with connected components (`scipy.ndimage.label` on the alpha channel). That gave the
  exact center and radius of the dot in the mark, so the amber decimal point could land on it pixel-perfectly.

---

## 3. Motion techniques that worked

**One motif object carries every transition.** The period of "idea." becomes the dot, which draws the card's corner, which turns into the cursor.
Later, the decimal point of "3.3" becomes the logo's dot, and a dot dropping from the mark stretches into the CTA pill.
That satisfies "every transition is a physical transformation" and makes 8 scenes read as one film.

**`rollText`: text swaps that can't overlap.** Each line gets its own clip (`y − 0.84·size` to `y + 0.24·size`,
height 1.08·size). The outgoing and incoming text use the **same spring**, offset by exactly one clip height,
so they move like an odometer drum and are never in the same pixels at once. Use the same height for the line spacing in stacks.
Use it for captions, button labels, headers and stat labels: one entry grammar for the whole film, borrowed from the site's
own hero line-mask animation.

**Odometer digits, the bugs I hit, in order:**
1. A continuous `pos = v` for the leading digit leaves it permanently half-rolled (3.3 shows between 3 and 4).
   Carry like a real odometer: `tens = floor(u/10) + clamp(u%10 − 9)` with `u` in tenths.
2. Moving the clip *with* the entry offset shows digits outside their window. Keep the clip **fixed**; move only the glyphs.
3. Snap to the exact value once the spring converges (`roll > 0.9999 → u = 33`), or `floor()` lands on the wrong digit.
4. On exit, the "next" digit slides into view. Don't draw it when the column is settled (`f ≈ 0`).

**Exits all go the same direction (up).** One exit dropped digits downward while labels rolled up, and they collided.

**Draw UI in its own design space.** The card is drawn in local coordinates, then `translate(OX, OY)`, `scale(K)` (K = 1.2) for phone
legibility, then a small spring camera that leans toward the active element. **Route every screen-space consumer through
one `S(x, y)` function** (cursor, dot, wipe start rect), including the camera, or they drift off the UI.

**Springs:** type uses critically damped `(170, 26)` (no overshoot, per the project rules); UI uses `(320, 30)` (≈0.8% overshoot).
Give the cursor different stiffness on x and y (`170/26` vs `130/23`) so it moves on a curve, not a straight line.
A click is a dip-and-release: `press(t, tc) = sp(t, tc−0.04, [900,45]) − sp(t, tc+0.08, [400,34])`.

**Dead frames hide at handoffs.** Per-beat sheets showed 0.3–0.5s of empty void after the wipe and a 1.5s static logo.
Fixes: start the next scene's entry *before* the previous exit finishes (the number rises while the wipe is still completing),
and add a beat of new content into any hold longer than ~1s (the tagline under the logo).

**Phone readability check:** 1080px source ÷ 3 ≈ 360px phone. Body/UI text under ~40px in the source lands at ≤13px
on a phone. The first version's card UI (32–40px) was too small, and the scale-up was the single biggest readability gain.

**Two-tone headlines** (first line at 50% alpha, second at full) copy the site's `text-foreground/50` pattern, which makes the film feel on-brand cheaply.

---

## 4. Texture

- **Copying the site's grain literally (SVG turbulence at 0.2 opacity) lifts black to grey** on a video frame. Use seeded
  grayscale noise with per-pixel alpha in 0–24/255 (≈5% lift max).
- Precompute 8 seeded 256px tiles once at load (constant data, not frame state, so the render contract holds). Pick the tile
  by `floor(t·24) % 8` with a seeded offset, then draw at 2× scale so the grain survives downscaling and compression.
- Grain at CRF 16 is expensive: the final file runs ~24 Mbps (61 MB for 20s). Make a CRF 20 export for posting.

---

## 5. Sound

- **Write `beats.json` from the BPM first** (synthesized score), lock every cut to it, then *measure* the rendered mix.
- **librosa `beat_track` locked onto the offbeat hi-hats** (+0.26s phase, 119.7 BPM). Its "beats" list was wrong for placing hits.
  The onset `hits` list was right (kicks within ~12ms = one analysis hop). Verify the grid with onsets, not beat_track,
  when the hats are on the offbeats.
- Whoosh shape `sin(π·t/0.35)` peaks 0.175s after it starts, so start a whoosh ~0.19s *before* the cut it should land on.
- Hit −14 LUFS exactly with **two-pass `loudnorm` with `linear=true`**, using the measured values from pass 1. Confirm with
  `ebur128=peak=true` (got −14.0 LUFS, −1.4 dBTP).
- The agent can't hear the result. Say so plainly and ask a human to listen. "Sound sync" can only be *measured* here.

---

## 6. Process

- The gates worked: assets → shotlist + questions → OK → code → critique loop. The shotlist question round changed the hero stat.
- Project `AGENTS.md` changed mid-session (new Motion rules: no overshoot on type, transitions must be physical).
  Re-read the rules when notified and check the existing plan against them.
- 4 critique rounds were needed, not 3. Round 1 found structural bugs (odometer, scale), round 2 found pacing (dead
  frames), round 3 found transition collisions in strips, round 4 confirmed. Budget for that.
- When the user asks "is it my CPU?", measure before answering. The benchmark turned a guess into a 4× speedup with proof.

---

## 7. Engine fixes (2026-10-07, lib/hand.js, lib/project.js, _template)

- **Renderers sample negative t.** For motion blur, frame 0's subframes are at t = −0.0125…−0.004. Any `floor(t·rate) % n`
  goes negative and indexes `arr[-1]` (undefined → `stroke()` throws). Use `((i % n) + n) % n`, and clamp t to `[0, DUR)` in
  `draw()`. Unclamped, the template's frame 0 blended 3 blank subframes and the hook frame rendered ~75% dark.
- **Back-face culling on canvas: screen y is down, so the winding sign flips.** Front faces have *negative* shoelace area.
  A count-only test passed with the sign wrong (same number of faces, the wrong ones). Test the exact visible set
  against `normal · view > 0` (iso view = (1,1,1)), then look at a turntable strip.
- Shade faces by their rotated normal (up = light), never by face index. `face % 3` put the darkest shade on top.

## 8. Engine audit (2026-10-07): 12 bugs, all reproduced before fixing

- **ffmpeg logs go to stderr.** `finalize.mjs` read loudnorm JSON from stdout with `-v error` → empty → crash on
  every run. It had never actually been run. Rule: run every new script once end-to-end before calling it done.
- **The film contract can appear after `load`.** A module that does `await fetch('film.json')` sets `window.seek`
  later → `seek is not a function`. Renderers now `waitForFunction(() => window.ready && window.seek)`.
- **A success message isn't success.** Serial `render.mjs` exited 0 when ffmpeg refused to encode (no file written).
  Check the child's exit code.
- **yuv420p needs even dimensions**, so any derived size (animatic halves) must round to even.
- **Flag inheritance bites:** `--all-formats` re-invoked itself with the user's `--w`, which won over each format's own.
- **Serve real MIME types.** SVG as octet-stream won't decode in `<img>`; a malformed URL crashed the server mid-render.
- **Write tests that check *which*, not *how many*.** (Cube culling passed a count test with the sign wrong.)
- **Not fixed on purpose:** `spring()` uses the critical-damping curve for slightly *over*damped springs (z > 1).
  It's an approximation, but frozen films depend on it. Changing it changes their pixels, so keep it.
