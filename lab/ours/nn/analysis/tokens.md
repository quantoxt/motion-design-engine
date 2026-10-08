# Tokens: ours-nn (Narrative Nexus, 60s, vertical 1080x1920, primary format)

> Measured with the same analyzer (lab/analyze.mjs, --tick 12: our grain runs 12fps).
> Source is a symlink to the shipped master — lab writes only into lab/ours/nn/analysis/.

## Measured
- duration 60s, 6 shots / 5 cuts, mean shot 10s (135px pipeline: only true hard cuts spike)
- holds >1s unplanned: 12 —
  3.1–4.8 (1.7s), 7.8–9.6 (1.8s), 17.3–18.8 (1.5s), 20.1–21.6 (1.5s),
  22.7–24.0 (1.3s), 39.0–40.8 (1.8s), 49.5–50.5 (1.1s), 51.3–52.8 (1.5s),
  56.8–60.0 (3.2s end freeze)
- tempo ~99.4 BPM (100 BPM grid per shotlist — match)
- cuts near a sound event (±60ms): 15/26, median offset 55ms — same band as the refs
- loudness −17.1 LUFS, peak −1.0 dBFS

## Evidence
- contact.png (quill over "Addiction", trope chips, shelf, unlock) · strips/ · sync.json

## Tokens (what the lab confirms about our film)

| name | kind | measurement | evidence | statement | refs |
|---|---|---|---|---|---|
| twelve-dead-holds | principle | 12 holds >1s incl. a 3.5s end freeze; refs have 0–1 | cuts.json | Confirms and extends the lessons doc (which found 8 by hand). The 135px pipeline's 5 cuts are exactly the documented hidden pops (19.9, 24.0 Unlock swap, 29.7 reader swap, 30.0/30.3 shelf entries) — precision up, recall same. | nn |
| sync-is-fine | principle | median cut↔onset 55ms, 15/26 within 60ms — same band as refs (30–70ms) | sync.json | Sound sync was never the problem. The 6.5/10 came from picture, not timing. Don't "fix" the mix. | nn |
| motif-covers-words | principle | contact tiles: quill parks across "Addiction" and body copy mid-stroke | contact.png | The quill qualifies as a carried motif (rule 1) but violates its corollary: refs never let the motif obscure information. | nn |
| clicks-without-cause | principle | 4 of 5 click rings land off target yet still trigger UI (lessons doc; geometry, not pixels) | lessons.md | Refs v2/v5: the cursor is always on the thing it changes. A click on empty paper that still works breaks cause→effect — the demo's whole point. | nn |
