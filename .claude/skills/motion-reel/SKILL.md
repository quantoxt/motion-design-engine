---
name: motion-reel
description: Make a product or showreel motion video rendered from code. Use when the user asks for a launch video, showreel, product reel, animated explainer or motion ad.
---

# Motion reel

Studio root holds the engine (`lib/`, `render*.mjs`, `shots.mjs`, audio scripts, `CLAUDE.md`).
Every film lives in its own `brands/<name>/` folder. Never mix brand files into root.

## Pipeline

1. **Scaffold.** Copy `brands/_template/` → `brands/<name>/`. All work happens inside it.
   If the folder already exists with `docs/brief.md` (made by the studio's **Start film**), use it as is:
   the brief is `docs/brief.md` and `film.json` already carries the brief's duration, formats and tempo.
   Gate status in the studio is read from files, so write them where the gates expect:
   `assets/`, `docs/style_guide.md`, `docs/shotlist.md`, `out/animatic.mp4`, `docs/review_log.md`
   (one `## Round N` heading per round), `out/silent*.mp4`, `out/<slug>-<format>-<W>x<H>.mp4` (written by finalize) + `contact.png` + `poster.png`.
   If the user says they synced the brief (studio **Sync brief into the film**), re-read `docs/brief.md`
   and say what changes for the film before continuing.
   **New version** (`brands/<brand>-vN/` with `docs/previous-version.md`): read that file first. The previous
   version's assets, style guide and film.json are already copied in; check them against the brief changes it
   lists and reuse what fits instead of re-researching. Read the previous version's shotlist and `index.html`
   for what worked. Never write to the previous version's folder. Then run the full pipeline: a new shotlist
   (fresh approval), animatic, critique, render, finalize. Finals come out as `<brand>-vN-<format>-…mp4`.
2. **Collect inputs first.** Product + URL/repo, duration, formats, brand colors + fonts,
   a reference (frame, video, or image folder), music (file or "synthesize").
   Ask the hero-metric question; never invent numbers — pull copy from the real
   site/repo and live stats from public APIs (note snapshot dates).
3. **Assets + style guide.** Gather real screenshots, logo, fonts into `brands/<name>/assets/`.
   List what you found. Then write `docs/style_guide.md` from the reference
   (palette hex via script, type, texture, camera language, banned looks).
   Never redraw product UI or logos.
4. **Music grid first.** Synthesize or measure the track, write `beats.json`,
   verify with onsets. Every cut locks to this grid. Record dims/duration/bpm
   in `film.json` (renderers and stills read it — no hardcoded sizes).
5. **Shotlist.** Write `docs/shotlist.md` on the beat grid, surface brief-vs-site
   conflicts as questions, and WAIT for user OK before code.
   The OK is either an explicit "approved" in chat, or a studio approval:
   `docs/approvals.json` → `shotlist.sha256` must equal `sha256sum docs/shotlist.md`.
   A mismatch means the shotlist changed after approval: stop and ask again. Any edit
   to the shotlist after approval (even a typo) needs a new approval before code continues.
6. **Build + animatic.** `index.html` with `window.seek(t)` + `window.ready`
   (explicit font loads + image decodes). Start from `brands/_template/index.html`:
   camera transform in design units, scenes as `{from,to,draw}`, anchors from `lib/layout.js`
   (`L.anchor`/`L.text`), clicks as `{ t, target }` driven by `lib/cursor.js`, swaps and counters
   from `lib/type.js`, `window.EVENTS`/`TRANSFORMS` from the same constants. Springs from `lib/motion.js`.
   One motif object carries transitions; all exits one direction; overlap entries
   with exits. Render `--animatic` first and fix pacing while it's cheap.
7. **Critique.** Every check in CLAUDE.md's loop (beats, strips, `shots.mjs events`,
   `--scan` + `holds.mjs`, `check.mjs`, every format via `--format all`) on the animatic → score 1-10 from measurements
   (hook, phone readability, motion, variety, brand, sync) → log in
   `docs/review_log.md` → fix 3 worst. Minimum 4 rounds, ship at 8+.
8. **Render.** Gated: `check.mjs` and `holds.mjs` must have passed on the current code.
   `render-parallel.mjs --dir brands/<name> --workers 3`
   (`--all-formats --formats <primary>` first; the human approves it in the studio's Primary
   render gate; the renderer refuses the other formats until then; then `--formats <others>`).
   Time 1s first, then quote. SFX via `sfx.mjs`, then `finalize.mjs`
   (two-pass loudnorm −14 LUFS + CRF-20 posting copy; `--all-formats` finalizes every `silent_*.mp4`).
9. **Deliver.** `out/<slug>-<format>-<W>x<H>.mp4` per format (+ `-posting.mp4`), `out/contact.png`, `out/poster.png`.
   They show up in the studio Library (`#/library`). Never rename finals by hand: the Library and the gates read that name.
   Add what the run taught you to `brands/<slug>/docs/lessons.md` (read it before planning). Say what you'd improve next.

## Hard rules

- Pure `seek(t)`: no timers, no CSS transitions, no carried state, seeded noise only.
  Parallelism is only safe while this holds.
- Real product UI only. Never invent screens, copy, or metrics.
- Banned: corner labels, centered title on gradient, everything fading in,
  meaningless hard cuts.
- You cannot hear the mix. Ask a human to listen.
