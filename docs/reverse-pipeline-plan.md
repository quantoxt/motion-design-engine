# Reverse pipeline: learn from an existing video (plan, not built yet)

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
