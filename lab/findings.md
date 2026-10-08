# Cross-video findings (v1–v6)

Rules = seen in 3+ refs. Observations = fewer. Per lab/tokens.md, rules are
candidates for factory flow-back (a future explicit step — they change nothing yet).

## Rules

1. **A carried motif (4/6: v1 asterisk, v3/v4 red dot, v6 blue dot).** One small
   geometric shape in the accent color recurs across unrelated scenes. It does the
   continuity work that cuts would otherwise break. NN's quill qualifies — but it
   covered words (v5/v6: the motif never obscures information).
2. **No dead holds (v1, v3, v6: zero; v2/v5: continuous takes).** Mean shot
   1.2–1.5s in the cut films. NN shipped 8 holds >1s. This is the sharpest
   measured gap between the references and our film.
3. **End on the static wordmark (v1, v3, v4).** After maximum density, a still
   name card. The stillness is the signature.
4. **Kinetic type is the scene, not the caption (v1, v3, v4, v6).** Display-size
   type fills entire shots. NN is UI-driven; the references suggest giving type
   full-frame moments instead of only UI labels.
5. **Transitions are physical (floods, morphs, whip-slides), never dissolves
   (all six).** v1's diagonal flood, v5's contracting floods, v6's blur-slide,
   v2's zero cuts. NN's hidden hard cuts (reader swap, shelf entries) violate
   exactly this.

## Observations (under 3 refs)

- **Cursor as cause (v2, v5 prompts).** Every change has a visible agent. NN's
  4-of-5 missed clicks are this rule broken — and the references never let the
  cursor lie: it is always on the thing it changes.
- **Accumulate, don't swap (v4).** Words append; nothing hard-swaps. The
  "UUnlockd" ghost class can't exist where swaps don't happen.
- **States slow, transitions fast (v6).** Readable beats separated by ~3-frame
  blurs. Confirms the NN readable-states rule from the other direction.
- **Density is briefed, not discovered (v2/v5 prompts).** "Something on every
  beat" is in the prompt's structure section. Our brief template should demand
  the event grid up front.

## Tool lessons (for analyze.mjs)

- A frame-diff pop ≠ a cut: v5's floods trip the detector while reading as one
  take. Classify by strip, not by spike.
- Beat-phase is unreliable: v1's consistent −0.07s offset and identical BPMs
  across films need the onset cross-check before any sync token is trusted.

## Open vs NN (comparison preview)

| axis | references | NN (6.5/10) |
|---|---|---|
| holds >1s | 0 (cut films) | 8 shipped |
| clicks land | always on target | 4 of 5 missed |
| transitions | floods/morphs, no hidden cuts | 4 hidden pops |
| motif vs words | never covers | quill covered copy |
| end card | static wordmark | 3.1s freeze (unplanned) |

The comparison run (same metrics on NN + Quantoxt) is still to come — this table
is assembled from the NN lessons doc, not a lab measurement. Don't cite it as lab output.
