# Motion design factory

Brand films rendered from code. You write a brief, a coding agent (Claude Code or OpenCode)
builds the film as an HTML canvas page that is a pure function of time, and the factory
renders it frame by frame to MP4 with synthesized music and SFX, loudness-normalized for posting.

A local web UI, the **studio**, runs the whole flow: write a brief → start a film → run the
agent in a terminal in the browser → approve its shotlist → watch the finished films in the
Library.

## Requirements

| Need | Why | Check |
|---|---|---|
| **Node.js 20+** (tested on 24) | studio, renderers, scripts | `node -v` |
| **ffmpeg + ffprobe** | encoding, audio mix, loudness, Library metadata | `ffmpeg -version` |
| **C/C++ build tools + Python 3** (`gcc`, `g++`, `make`, `python3`) | builds `node-pty`, the studio's terminal | `gcc --version` |
| **Playwright Chromium** | the renderers drive headless Chromium | installed by `npx playwright install chromium` |
| **An agent CLI**: [Claude Code](https://code.claude.com) and/or [OpenCode](https://opencode.ai), logged in | builds the films | `claude --version`, `opencode --version` |
| *Optional:* Python packages `numpy`, `librosa` | only for `beats.py` (beat grid from a supplied music track) | `python3 -c "import librosa"` |

Tested on Linux. macOS should work; Windows is untested.

## Setup

```sh
npm install
npm install-scripts approve node-pty   # npm blocks native build scripts by default
npm rebuild node-pty
npx playwright install chromium
npm test                                # should print: pass 46, fail 0
```

If `node-pty` isn't built, the studio still runs; only the in-browser terminal is disabled and
it tells you what to run.

## Use it

```sh
npm run studio        # → http://127.0.0.1:4321 (opens your browser; --no-open, --port N)
```

1. **Home → New brief.** The form is generated from `_raw/brief-template.md`. Fill in what you know;
   every pick list has an "Agent decides" option. Save writes `_raw/<brand>.md`.
2. **Start film.** Scaffolds `brands/<brand>/` from `brands/_template/` and opens the agent page.
3. **Run agent.** Pick Claude, OpenCode or a custom command. It runs in a real terminal on your
   machine, in this folder, with the prompt `follow brands/<brand>/docs/brief.md`. Answer its
   questions in the pane. (OpenCode fills the prompt in; press Enter to send it.)
4. **Approve the shotlist.** Home shows what needs you. Read the shotlist on the film page and approve
   it; the agent waits for that before writing code.
5. **Machine checks.** Before the full render, the agent runs `check.mjs` (geometry) and `holds.mjs` (pops and dead
   holds). The renderer refuses a full render until both pass on the current code; the film page shows the results.
6. **Approve the primary render.** The agent renders the main format first. Watch it on the film page and approve
   it; only then can the other formats render (they cost the most time, so mistakes are caught before them).
7. **Watch it in the Library.** Finished films appear per brand; click one to play it full screen.

**Edited a brief after its film was delivered?** The studio offers **Make new version**: it creates
`brands/<brand>-v2/` from the new brief, carrying over v1's assets and style guide, and runs the
pipeline again. v1 stays as delivered; the Library shows both under the same brand.

**Agents** lists every session per film. Claude and OpenCode sessions can be resumed, even after
restarting the studio.

Without the studio, open the project in Claude Code and say `follow _raw/<brand>.md`. The
`motion-reel` skill (`.claude/skills/`) and `CLAUDE.md` carry the whole process.

### Engine commands (what the agent runs)

```sh
node render-parallel.mjs --dir brands/<brand> --animatic      # fast pacing draft
node render-parallel.mjs --dir brands/<brand> --all-formats   # full render, every format in film.json
node render-parallel.mjs --dir brands/<brand> --all-formats --formats vertical   # only the named formats
node shots.mjs beats --dir brands/<brand>                     # critique stills
node shots.mjs events --dir brands/<brand> --format all       # clicks, swaps, transforms, every format
node render-parallel.mjs --dir brands/<brand> --scan          # ~3 min input for holds.mjs
node holds.mjs --dir brands/<brand>                           # one-frame pops + dead holds (+ out/pops.png)
node render-parallel.mjs --dir brands/<brand> --scan --from 12 --dur 2   # check one fix fast
node holds.mjs --dir brands/<brand> --file out/scan_12.00-14.00.mp4     # (window: never the gate)
node check.mjs --dir brands/<brand>                           # clicks on target, no overflow, nothing cut off
node finalize.mjs --dir brands/<brand> --all-formats          # mix, −14 LUFS, final + posting copy
```

Always pass `--dir`: without it, scripts work on the current folder. Finished films are named
`brands/<brand>/out/<brand>-<format>-<W>x<H>.mp4` (plus `-posting.mp4`).

## Layout

```
CLAUDE.md               rules every film follows (render contract, look, motion, sound, critique loop)
studio.mjs, studio/     the web UI and its server (local only: binds 127.0.0.1)
render*.mjs, shots.mjs, finalize.mjs, sfx.mjs, beats.py, lib/   the engine, shared by all films
brands/_template/       scaffold for a new film
brands/<brand>/         one film each: not in git
_raw/brief-template.md  the brief form; filled briefs (_raw/<brand>.md) are not in git
docs/                   factory map, changelog, bug log, lessons, specs
```

Start with `docs/factory-map.md` for the full map, and `docs/LESSONS.md` for what building the
first film taught us.

## What's not in the repo

Brand folders (`brands/<brand>/`) and filled briefs (`_raw/<brand>.md`) hold client material and
renders, so `.gitignore` keeps them out. Back them up separately. Git won't show changes inside
them either.

## Security notes

- The studio has no login. It listens on 127.0.0.1 only, refuses cross-origin writes and foreign
  `Host` headers. Don't expose its port.
- Agents run as you, with your shell environment and API keys, in this folder. Custom commands run
  exactly as typed.
