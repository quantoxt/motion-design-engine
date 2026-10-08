# Eye cross-check (2026-10-08)

A second opinion on the same videos, from outside the lab: an external visual model watched the six refs and
our films frame by frame (`eye/report-01.md` refs, `eye/report-02.md` ours) and said why they feel the way they do.
The user confirmed it matched what they saw. `eye/` is read-only and may be deleted; what matters is kept here.

How to read this file: **eye** = visual judgment (like a token `statement`, not a measurement).
**measured** = numbers from code, with the command. Where both agree, the finding is stronger than either alone.

## Where the eye and the lab agree (strongest findings)

| Finding | Lab | Eye | Status |
|---|---|---|---|
| Scenes are born from the one before (flood, shrink, morph), no plain cuts | rule 5 (all six) | reason 1, "the object becomes the world" | in the factory: `lib/transitions.js`, CLAUDE.md |
| One motif carries continuity, never covers words | rule 1 | reason 1 + "shrink before the burst" | already a factory rule |
| Full-screen type is a scene, not a caption | rule 4 | reason 3 + "huge type gets a tiny companion" | in the factory: 2–3 per film, `fitText` |
| Our films stop moving | rule 2 (holds) | reason 4–5 (slow pace, long stills) | in the factory: quiet-stretch gate (below) |
| End on a still wordmark | rule 3 | only after the busiest part, ~1.5–2s | in the factory: end card ≤2s, straight after the climax |
| Sound sync and loudness are not the problem | report §5 | "it's not the render quality" | nothing to change |

## What the eye saw that the lab missed

1. **Exits smear into ghost copies** (our films, not the refs). A scene thrown off fast is drawn by the renderer's
   4-snapshot motion blur as 3–4 see-through copies. The lab's frame-difference signal can't see this: it's motion,
   not a pop or a hold. **Measured since:** `check.mjs` `streak` (anchor moves >24px between blur snapshots at 1080).
   Scratch copy of Unburn: 6 exits flagged (3.7, 7.7, 13.7, 14.0, 23.7, 25.7s), incl. the eye's frame strip at 7.4s.
2. **Background colour flips on the bar.** Refs v1/v3/v4 flip about every 1.9s (one scene = one bar), 5–18 flips per
   film, palette near-black `#0D0D10`, red-orange `#EE4938`, cream `#F0EEE5`, blue `#2E2EF4`, lime `#E1FF44` used briefly.
   Ours: 0 flips. Not yet a lab measurement (a per-second dominant-colour pass would make it one).
3. **Loud / quiet alternation.** Full-screen word or pattern, then one small object in empty space.
4. **Viewfinder layer** (v1/v3/v4): corner brackets, timecode, bar counter, tiny labels, fixed on top. Glue for busy scenes.
5. **Patterns grow from one element, then a wave runs through them** (v1 tiles, v4 dot grid). Not in the factory yet.
6. **Speed effects:** chromatic fringe on fast edges, deliberate echo trails, blur that snaps sharp. Not in the factory yet.
7. **Last frame = first frame** (v1, v2, v4, v5). In the factory as a rule.
8. **Grain + vignette on flat colour** so it isn't a digital fill. In the factory: `lib/texture.js`.
9. **v3's second half is the counter-example:** colours change but scenes swap instead of transform, layout never
   breaks, each scene holds ~2.5s. Reads as a template. Colour flips alone are not enough.

## Measured since: how much of the screen moves (pace)

The lab's whole-frame signal punished calm ref v2 (one shape that never stops changing) and couldn't separate it
from our slow films. Measuring **share of the screen that moves** does: 34px gray grid (as `holds.mjs`), a cell
"moves" if it changes by >8, rolling 1s median (grain-proof). Now `pace()` in `lib/holds.mjs`.

| Video | Moving (share of frames) | Longest quiet stretch (≤1% of screen moving) |
|---|---|---|
| v1 | 74% | 1.6s |
| v4 | 65% | 1.9s |
| v5 | 61% | 2.7s |
| v6 | 61% | 4.8s |
| v2 (calm) | 30% | 4.2s |
| v3 (2nd half = template) | 44% | 9.6s |
| NN v1 | 30% | 6.6s |
| NN v2 | 37% | 4.6s |
| Quantoxt | 27% | 7.3s |
| Unburn | 12% | 9.3s |

Factory gate: quiet stretch >3s fails (`holds.mjs --quiet`, film.json `"quiet"` up to 5s for a calm brief).
Measured on the lab's `source.mp4` files (refs and `ours/` symlinks), 2026-10-08.

## Open questions for the lab

- Does the effort level matter? The eye's read: prompts and rules decided quality more than effort (v1 max, v3/v4
  unset, both crisp). Only a controlled test (same brief, medium vs max) would settle it.
- Make colour flips a measurement (dominant colour per second → flip count and timing vs the bar grid).
- Add `pace()` to `analyze.mjs` so every new reference gets the moving-share and quiet-stretch numbers.
