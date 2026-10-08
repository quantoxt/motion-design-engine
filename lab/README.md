# Reverse-pipeline lab

Take a motion-design video that is good, reverse-engineer it, and extract the
**tokens of why it is good**. Output is *understanding* (measured, named
reasons), not a copy. Plan: `docs/reverse-pipeline-plan.md`.

## Boundary (hard)

- The lab **never writes outside `lab/`**. No writes to `brands/`, engine
  scripts, `lib/`, `studio/`, `AGENTS.md`, or any factory doc. Tokens land here
  as lab-local md; flow-back into the factory is a future explicit step.
- The lab **may import** engine pieces read-only (`lib/holds.mjs`,
  `lib/motion.js`, `beats.py`). Never modify them from here.
- `lab/refs/` is gitignored: references are other people's work.

## Layout

```
lab/
  README.md            # this file
  tokens.md            # what a token is (schema: name/kind/measurement/evidence/statement/refs)
  analyze.mjs          # video → measurements + token draft (statements EMPTY for the agent)
  findings.md          # cross-video rules (3+ refs), tool lessons
  eye.md               # cross-check with an external visual model's frame-by-frame read (eye/), + pace numbers
  report.md            # lab-vs-ours comparison: why the refs are crisper
  ours/<name>/         # our masters measured with the same tool (source.mp4 is a
                       # symlink into brands/; lab writes only into ours/<name>/analysis/)
  refs/<name>/         # one folder per reference video (GITIGNORED)
    source.mp4         # the video
    prompt.md          # the prompt that made it (if known)
    meta.md            # tweet URL, author, why it's exceptional (optional)
    analysis/          # lab output: cuts.json, contact.png, strips/, beats.json,
                       # sync.json, tokens.md — written by analyze.mjs
```

## Drop a reference

Create `lab/refs/<name>/`, put in `source.mp4` + `prompt.md` (+ `meta.md`
if you have context), then tell the agent to run the analysis.
Naming: short slug, e.g. `orbit-loader`, `neon-charts`.
