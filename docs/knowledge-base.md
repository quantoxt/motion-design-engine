# Motion Design with Opus 5.5 — Knowledge Base

Source: Movez 12-step course (x.com/i/article/2104216919033192746) + related trend posts, 2026-10-06.

## Thesis
- Prompt = 10%, harness = 90%. Opus 5.5 cannot emit MP4; it writes a program, something else renders frames.
- Core trick: determinism. Single pure function `window.seek(t)` / `draw(t)` paints exact frame for any t.
- Headless browser calls it N times (e.g. 900 for 15s@60fps), screenshots, ffmpeg stitches. Identical every run.
- Opus defaults to Route A (zero-dep: one index.html + Playwright + ffmpeg). Skips Remotion/HyperFrames unless told.

## Two routes
- **Route A (default):** 1x index.html + canvas + seek(t), Playwright capture, ffmpeg encode. Best for one-offs.
- **Route B (framework):** Remotion (React, series/templates/data-driven) or HyperFrames (HTML+GSAP, web-page thinking). Must request explicitly.

## Setup (10 min)
- Runtime: Node 22+, ffmpeg, Python + numpy/librosa/soundfile.
- `npm i -D playwright && npx playwright install chromium`
- Optional skills: remotion-dev/skills, heygen-com/hyperframes, buildwithhanif/claude-animation-skill.
- Model: Opus 5.5, effort xhigh (new films) / max (flagship first-3s matters) / medium (small fixes).

## Render contract (CLAUDE.md)
- `window.seek(t)` pure function of time. No CSS transitions, no setTimeout, no rAF in render mode, no carried state.
- Seeded noise only (mulberry32), never Math.random.
- Encode H.264 yuv420p, CRF 16. Fonts ready before capture (`document.fonts.ready`).
- Motion blur: render SUB=4 subframes/frame, blend with ffmpeg `tmix`.

## Look / anti-slop
- Banned: centered title on gradient, everything fading in, decorative corner labels/frame borders (a viewfinder layer only when the brief asks), glow on UI chrome, generic particle bursts, bouncy easing.
- One display face + one UI face. One accent unless brief says otherwise.
- A change every beat, a big one every bar (scene, flood, full-screen word). Loud/quiet alternating. Scenes turn into the next one, never fly off. Hook in first 2s. Must read at 360px wide.

## Prompt patterns (ladder)
1. **One-liner (test engine):** "dynamic 15s showreel for résumé, go all out" — genre sets rules, model is subject. Variants: 60s piano reel w/ original score, anti-slop guardrail (no corners), story not techniques, agency persona.
2. **Brand:** product URL + "use real screenshots/logo/assets via Playwright into ./assets" + "must have music". Never redraw UI from imagination. Keep one session per brand.
3. **Reference:** name a look > describe one. Frame / video (ffmpeg extract 0.5s, write style_guide.md) / library folder. Take grammar, never content/logos.
4. **Spec (XML, best bookmarks):** inputs → direction → beat-by-beat state list → build rules → gotchas. "One shape, never cut": single container morphs size/radius/fill, cursor drives changes, last frame = first (loop).
5. **Director's brief (overnight, 9-19k chars):** logline, refs, tools/keys/budget, character bible, beat sheet w/ timestamps, text-on-screen rules, workflow gates, critique loop, deliverables. Split across subagents with ANIMATION_GUIDE.md.

## Engine
- Scenes = array of {from, to, draw(t)}. draw clears canvas, dispatches active scene.
- Live preview via rAF loop only when `!navigator.webdriver`.
- render.mjs: launch chromium, goto file://index.html, loop t=i/(FPS*SUB), `page.evaluate(seek)`, screenshot canvas PNG → ffmpeg image2pipe. vf tmix+select for blur.

## Springs (lib/motion.js)
- Cheap = easing curve. Expensive = mass: accelerate, tiny overshoot, settle.
- Closed-form damped spring spring(t,k,d) keeps seek(t) pure (no simulation history).
- Multi-target value = `track(t, keys)`: sum of one spring per change. Continuous, random-access.
- Tab indicator stretch: leading edge stiffer than trailing. Text swap: in after morph starts, out before next. Loop: pin last frame to first incl. cursor.
- Presets: snappy UI (320,30), default cards/camera (170,26), heavy type/3D (lower k), playful mascot (visible overshoot).
- Never `will-change` on camera-scaled things (blurry text).

## Sound
- Two paths: supplied track → measure (beats.py → beats.json: bpm, beats, downbeats, hits); else synthesize on same timeline.
- beats.py: librosa beat_track + onset peaks.
- sfx.mjs: synthesize click/pop/thump/whoosh into 16-bit mono WAV from cues.json.
- Place state changes on beats, big moments on downbeats, SFX on measured peaks. Start on downbeat. Mix -14 LUFS.

## Critique loop (viral vs mid separator)
- Contact sheet: `ffmpeg fps=2,tile=6x5`. Strip: 12 frames around fast action. Phone test: scale 360 wide. Loop check: stream_loop 1. Determinism: render twice, hash compare.
- Score 1-10: hook, phone readability, motion quality, variety, composition, brand accuracy, sound sync. List 3 worst w/ timestamps, fix, re-render affected seconds only. 3 rounds min, ship at 8+.
- Honest cost: watercolor short = 163 calls, ~7h. Iteration is method, not failure.

## Ship
- Layout function not fixed pixels; render 9:16, 1:1, 16:9 in parallel. Reframe, don't crop.
- Package as skill (/motion-reel): collect inputs → gather assets → style_guide → beats → shotlist (wait OK) → seek(t)+springs → critique 3 rounds → render+sfx+mix → deliver <brand>-<format>-<W>x<H>.mp4 (finalize.mjs)/contact.png/poster.png + "what I'd improve".
- Revenue anchor: ~$1,000/video replaced in <30min; sell music+mascot+features+offer+any language+3 edits.

## Repos
- PDoomVideo, ClaudeAnimationBase, claude-animation-skill, hyperframes, remotion ai/skills, Battle-of-Austerlitz-Film, awesome-ai-motion, awesome-opus-5-5-videos.
