# PGE — image generation engine

Stills that tell a story: a single image, a poster, or a carousel of panels. Same idea as the films: drawn in code
on a canvas (hand-drawn ink, type, flat colour, fake 3D from `lib/`), checked by machine, rendered deterministically.
Output is lossless PNG.

Isolated from the film factory: everything lives in `pge/`. It imports the shared `lib/` helpers read-only and never
changes them. Films keep rendering while image jobs run.

## Use it from the studio
Images (sidebar) → **New image brief** → fill it in → **Start images** → **Run agent**. The job page shows the gates;
approve the story plan when the agent asks, then wait for the finals and the phone-size contact sheet.

## Use it by hand
```
node pge/render.mjs --dir pge/jobs/<job> --draft     # drafts + out/draft/contact_<format>.png
node pge/check.mjs  --dir pge/jobs/<job>             # every panel, every format → out/check.json
node pge/render.mjs --dir pge/jobs/<job>             # finals (refused until the checks pass)
```
New job without the studio: copy `pge/_template/` to `pge/jobs/<job>/`, put the brief in `docs/brief.md`.

## Gates
Brief → assets and style guide → story plan (your OK) → draft panels → machine checks → critique (4 rounds) → final images.

Rules for agents: `pge/AGENTS.md`. Worked example: `pge/jobs/paper-boat/` (6 panels, 4:5 + 1:1).
