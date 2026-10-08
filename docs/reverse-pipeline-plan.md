# Reverse pipeline: learn from an existing video (plan, not built yet)

## Status and gaps (reviewed 2026-10-07, before building)

Read this section first. The plan below was written before the factory gained today's analysis tools, and before
the purpose was sharpened.

**Purpose, as the user put it:** a separate, isolated engine. It works like a **lab**: take a motion-design video
that is good, reverse-engineer it, and extract the **tokens of why it is good**. The output is *understanding*
(measured, named reasons), not a copy. The plan below leans toward "breakdown → style_guide.md to rebuild from";
that becomes at most one by-product. The main product is the "why".

**Gaps to settle before building:**
1. **What a "token" is.** Two readings, possibly both:
   (a) *design tokens*: palette, type scale, spacing, timing values, spring k/d;
   (b) *principle tokens*: named, measured reasons it works, e.g. "hook lands a new event every 0.6s in the first
   2s", "every transition is a match on the motif", "cuts sit on downbeats ±1 frame". Agree on a schema, and on how
   tokens flow back into the factory (AGENTS.md rules? `film.json` defaults? a library the agent reads?).
2. **Isolation.** It gets its own folder (e.g. `lab/`, with `lab/refs/<name>/` per video, gitignored: references
   are other people's work). It never writes to `brands/` or the engine. It may *import* engine pieces read-only.
3. **Reuse what exists now.** The factory already measures the things step 1–3 want:
   - `lib/holds.mjs` (`analyze`, `regionMax`, `parseMafd`): pops = hard cuts / hidden cuts, region motion = when
     something moves, holds = dead time. On motion design, frame difference finds transitions better than
     `select='gt(scene,0.3)'`, because much of the film has no hard cuts. Use `holds.mjs --file` (which never writes
     a gate result) or import the pure functions. Grain tick defaults to 12fps: references may need `--tick 0`.
   - `shots.mjs`-style tiling, `beats.py`, `ebur128`: as planned.
   - `lib/motion.js` `spring(t, k, d)` is the exact curve to fit in step 5, so measured k/d plug straight into films.
4. **Calibrate on our own films first.** Run the lab on `brands/narrative-nexus/out/*.mp4` and the Quantoxt master:
   we know their ground truth (beats.json, CLICKS, shotlist, the user's 6.5/10). If the lab can't explain our own
   films' strengths and weaknesses, it can't explain someone else's. That also makes reference vs ours comparable
   on the same metrics.
5. **"Good" needs a judge.** Measurements say *what* happens; "why it's good" needs a rubric. The factory's critique
   axes (hook, phone readability, motion, variety, brand, sync) are a ready rubric. Any classifying/scoring done by
   an LLM on text must follow the TypeSafe Jev rule in the user's global AGENTS.md.
6. **Limits stay honest:** the agent can't watch or hear. Everything is stills + numbers, like the factory.

---

Goal: take a reference video, break it into frames and audio data, and produce a breakdown + `style_guide.md`
an agent can build from. Take the **grammar** (timing, transitions, structure), never the content or logos.

## Why it works
The agent can't watch video or hear audio. It reads **still images** and **numbers**. So the pipeline turns
a video into contact sheets, strips and measured audio data, the same way the forward pipeline uses `shots.mjs`.

## Steps

### 1. Cuts first
- `ffmpeg -i in.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null -` → timestamp of every cut.
- Output: `cuts.json`, plus shot lengths. That alone gives the edit rhythm.

### 2. Frames
- Overview contact sheet at 2–4 fps (`fps=2,scale=270:-1,tile=…`).
- One representative frame per shot (mid-shot).
- **Dense strips across every cut/transition**: every frame, 12–24 in a row. This is where the motion technique is visible
  (mask, morph, wipe, match cut, overshoot).

### 3. Audio
- Extract: `ffmpeg -i in.mp4 -vn audio.wav`.
- `python beats.py audio.wav > beats.json` → BPM, beats, onset hits.
- **Beware:** librosa `beat_track` can lock onto offbeats (seen in this project). Check the grid against the onset `hits`.
- Line the cuts up against beats/hits → is it edited to the beat, and where do the accents land?
- Loudness: `ebur128` → integrated LUFS.
- Limit: tempo, sync and loudness can be measured. Mood and instrument choice can't (the agent can't hear).

### 4. Write-up → `style_guide.md`
- Palette (sample pixels from frames), type faces/sizes, layout grid, margins.
- Shot list with timestamps: what's on screen, the transition used.
- Pacing: shot lengths, new events per beat.
- Motion grammar: spring vs ease, overshoot, stagger, camera moves.
- Sound sync: cuts on beats/downbeats, SFX placement.

## Reads well vs hard
| Easy from frames | Hard |
|---|---|
| Composition, type, colour, layout | Exact easing numbers (needs tracking, step 5) |
| Pacing, events per beat | Fast transitions: must sample every frame |
| Transition type | 3D, particles, live footage: describe only, can't rebuild |
| Overshoot visible in strips | Long videos (2 min ≈ 7,200 frames): cut-first, sample smart |

## Optional later steps
5. **Measured motion curves:** track an element's position frame by frame (OpenCV template tracking), fit a damped
   spring → real `k`/`d` values for `lib/motion.js`.
6. **Recreate a shot** as `seek(t)` code, render it, and compare side by side with the reference strip. That's the critique loop aimed at a
   reference, and the most valuable step.

## Effort
| Scope | Complexity |
|---|---|
| Breakdown + style guide (steps 1–4) | Easy, ~1h agent time |
| + motion curves (5) | Medium, needs a tracking script |
| + shot recreation (6) | Highest, but it's the existing build loop |

## Proposed tool
`node analyze.mjs <video> [--dir refs/<name>]` → `cuts.json`, `contact.png`, `strips/*.png`, `beats.json`,
`sync.json` (cut ↔ beat offsets), draft `style_guide.md`. Run it on a real reference video first, then generalize.
