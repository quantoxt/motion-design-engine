# Image jobs (PGE) — rules

PGE is the factory's still-image engine: images that tell a story (a single frame, a poster, or a carousel of
panels), drawn in code on a canvas the same way the films are. You are working on one job in `pge/jobs/<job>/`.
These rules replace the film-only parts of the root `AGENTS.md` (sound, render contract, holds, primary render).
The root's look rules still apply where they make sense for a still, and are restated here.

## Layout — engine vs jobs
- `pge/` (except `pge/jobs/` and `pge/briefs/`), the root scripts, `lib/`, `studio/` and `brands/` are read-only to you,
  even for a one-line fix. Films may be rendering on that code right now. Found an engine bug? Log it in
  `docs/bug-docs.md` (symptom, cause, proposed fix, marked `open`), work around it inside your job folder, and say so
  in your review log.
- Your job: `pge/jobs/<job>/`: `index.html` (the panels), `job.json` (formats, kind, allow), `assets/`, `docs/`
  (`brief.md`, `style_guide.md`, `plan.md`, `review_log.md`, `lessons.md`), `out/`.
- Never read `eye/`, `lab/` or `docs/LESSONS.md`.

## The contract (what the tools read)
- Start from the job's `index.html` (a copy of `pge/_template/index.html`). Build the stage with `createStill()` from
  `pge/lib/still.js`; it reads `job.json`, sizes the canvas and gives you `g, F, K, L`.
- `S.panels([{ name, bg, draw(g, F, i) }, …])` defines the panels. Each `draw` is pure: same pixels every call.
  Seeded noise only (`rng` from `lib/motion.js`), never `Math.random`, no timers, no state between panels.
- `window.ready` awaits `document.fonts.load()` for every face and weight you draw, and `img.decode()` for images.
- Draw in design units: 1080 across the short side, origin at the centre. Size anything that reaches the edge from
  `F` (`F.EX`, `F.EY`, `F.across()`), never from fixed pixels, so every format in `job.json` works.
- **All text goes through `S.text(g, name, str, x, y, { size, font })` or `paragraph(S, …)`** so the checker can see it.
  Text drawn with a bare `fillText` is invisible to the checks: that's a bug.
- Anchor every drawing that sits near words (the motif, doodles, guides, arrows) with `L.anchor(g, name, x, y, w, h, { solid: true })`
  in the same transform you draw it in. Unanchored shapes can cross words and the checker can't see it.
- You may import any `lib/*.js` helper: `fitText` / `flood` / `wipe` (`lib/transitions.js`), `grain` / `vignette`
  (`lib/texture.js`), `ink` / `strokeLine` / `trace` / `boil` (`lib/hand.js`), `iso` / `cube` / `drawHinged`
  (`lib/project.js`), `spring` (`lib/motion.js`). Helpers that take `t` get a fixed value per panel (e.g. `grain(g, i, F)`).
  A still can show a motion frozen mid-way (a spring at 0.6, a stroke half drawn) and stay deterministic.

## Tools
- `node pge/render.mjs --dir pge/jobs/<job> --draft` → `out/draft/<format>/NN-<panel>.png` + `out/draft/contact_<format>.png`.
- `node pge/check.mjs --dir pge/jobs/<job>` → `out/check.json`. Every format, every panel:
  `collision` (texts overlap), `overflow` (text out of its parent), `off-frame` (cut by the edge; mark real bleed
  `{ bleed: true }`), `phone-size` (under 11px when shown 360px wide: under ~33 design units on a 1080 frame),
  `contrast` (under 3:1 against what's directly behind it, measured from the pixels), `empty` (a blank panel).
  An intended exception goes in `job.json` `"allow": ["kind:anchor"]`, with the reason in the review log.
- `node pge/render.mjs --dir pge/jobs/<job>` → `out/final/<job>-<format>-NN-<W>x<H>.png`, `out/contact_<format>.png`,
  `out/contact.png`. Refused until the checks passed on the current `index.html` + `job.json`. Never rename finals:
  the studio reads them by name.
- Preview by eye: open the contact sheet (`Read` the PNG). It shows each panel 360px wide, the size a phone feed
  shows it at. If you can't read it there, nobody will.

## Telling a story in stills
- **One idea per panel.** If a panel needs two sentences to explain, it's two panels.
- **Panel 1 is the hook.** It has to stop a thumb on its own: one bold image or one big line, no preamble, no logo intro.
- **One motif carries the story.** One object or shape (in the accent colour) appears in every panel and changes
  with the story: it grows, breaks, fills the frame, becomes the next thing. A viewer swiping should follow it.
- **Hand-offs between panels.** In a carousel, something leaves one panel's edge and arrives at the next one's
  (a line that continues, a shape that crosses the swipe seam, a colour that floods the next panel). Plan each in `plan.md`.
- **Loud / quiet.** Alternate: a full-frame word or colour field, then one small object in empty space.
  1–3 full-frame type moments per set (one word fills the width with `fitText`), each with a tiny companion line.
- **The last panel lands it.** Answer the hook, then the call to action or the logo, and return to panel 1's object
  and colour so the set feels complete.
- A single image or a poster tells the same arc inside one frame: hook (what the eye hits first), turn (what it
  finds second), payoff (what it leaves with). Plan the eye path in `plan.md`.

## Look
- Banned defaults: centred title on a gradient, stock-photo-style compositions, decorative corner labels and frame
  borders, glow, generic particle bursts, everything centred.
- One display face, one text face. One accent colour unless the brief says otherwise. A full-frame flat colour gets
  `grain` + `vignette` so it doesn't read as a digital fill.
- Text is readable at phone size (the checker enforces 11px at 360 wide; aim higher for body copy: ≥ 44 design units).
  Body copy: short lines, never more than ~3 lines per panel.
- Real assets only: logos, photos and copy come from the brief's source. Check logo resolution by its content box.
  Convert brand oklch tokens to hex with a script, never by eye.
- The motif never covers the words it annotates.
- Hand-drawn lines go through `lib/hand.js` (Path2D + pencil passes), never raster drawings. Fake 3D through `lib/project.js`.

## The loop (before you show anything)
1. Assets → `docs/style_guide.md` (palette in hex, faces, motif, texture, what to avoid).
   **Design references:** if `assets/refs/` has images (uploaded with the brief), open every one and add a
   "References" section to the style guide: per image, what you take (layout, type scale, palette, line quality,
   density) and what you don't. Take the grammar, never the content: no tracing, no copied artwork, logos or text.
2. `docs/plan.md`: one section per panel (`## Panel N · name`: what it shows, its exact words, the motif's state,
   the hand-off to the next), the formats and why, every deviation from the brief, open questions.
   **Stop and wait for the human's OK in the studio** (Images → the job → Story plan). The approval is tied to the
   file's hash: edit the plan after the OK and it needs a new one.
3. Draw. Render `--draft`, read the contact sheet, fix, repeat.
4. `pge/check.mjs` passes in every format.
5. Critique: score each round 1–10 on hook (panel 1 alone), story (can you follow it from the images alone, words
   covered?), readability at phone size, composition, brand accuracy, variety between panels. Score from the
   rendered images and the checker, not from the plan. Fix the 3 worst problems. At least 4 rounds, all 8+,
   logged in `docs/review_log.md` as `## Round N`.
6. Final render. Then write `docs/lessons.md` (short measured rules, not a diary) and tell the human it's ready.
