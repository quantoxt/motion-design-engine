# brands/_template — new film checklist

Copy this folder → `brands/<name>/`. Work only inside the copy.

```
brands/<name>/
  index.html      # the film: window.seek(t) + window.ready (start from _template's)
  film.json       # manifest: dims, fps, dur, sub, bpm, beats file, formats
  assets/         # real product UI, logos, fonts — gathered before any code
  docs/
    style_guide.md  # REQUIRED: extract from reference before shotlist (see template)
    shotlist.md   # beat-grid shot list — get user OK before coding
    review_log.md # critique scores per round
  beats.json      # beat grid (written first, from BPM)
  music.mjs       # score synth (optional — or a measured track + beats.py)
  cues.json       # SFX cues → sfx.mjs
  out/            # renders, sheets, <brand>-<format>-<W>x<H>.mp4 finals, poster.png
```

Gates: assets → style_guide → shotlist + questions → OK → animatic (pacing) →
code → checks by kind of bug (AGENTS.md loop) → critique 4 rounds (8+) → machine checks pass
(check.mjs + holds.mjs; the renderer refuses otherwise) → primary format render → human OK in the
studio → other formats
(--all-formats for every orientation) → finalize.mjs (−14 LUFS + posting copy)
→ deliver `<brand>-<format>-<W>x<H>.mp4` (one per format) `+ contact.png` (`node shots.mjs contact --dir …`) `+ poster.png` → lessons to `docs/lessons.md`.
