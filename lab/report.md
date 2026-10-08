# Report: why the references are crisper than our films

Lab comparison, 2026-10-08. Every number below is measured by `lab/analyze.mjs`
(same tool, same thresholds on all ten videos). Statements point at evidence files.

## The table

| axis | refs v1–v6 | NN (60s) | Quantoxt (20s) |
|---|---|---|---|
| holds >1s | v1 0, v6 0, v2 take, v3/v4/v5 one each | **12**, incl. 3.5s end freeze | 1 borderline (13.4–16.0) |
| mean shot | 0.9–1.5s (v3 strobe-verified) | — (only hard cuts counted: 5 over 60s; shot rhythm isn't comparable) | one 20s take |
| cuts near a sound event (±60ms) | refs live in the 30–70ms band | 5/5, four within 8ms — **on the sound** | n/a (no cuts) |
| hidden hard cuts | 0 (floods/morphs/slides instead) | 5, exactly the documented set (19.9, Unlock 24.0, reader 29.7, shelf 30.0/30.3) | 0 |
| clicks land on target | always (v2/v5: cursor is the cause) | **4 of 5 miss**, yet still trigger UI | cursor present, UI demo |
| motif vs words | never covers (v1/v3/v4/v6 dots, v5 glass) | quill parks across "Addiction" + body copy | n/a |
| end card | static wordmark (v1/v3/v4) | 3.5s unplanned freeze | resolves on proof number |
| full-frame type scenes | v1/v3/v4/v6 | **none** — all type is UI caption | yes ("Your idea.", "3.3 weeks") |
| loudness | −15.0 to −17.5 LUFS | −17.1 LUFS — in range | −17.0 LUFS — in range |

## Why ours are not as crisp

1. **NN stops moving; the refs barely do.** 12 dead holds vs 0–1. This is the single
   largest measured gap — bigger than any taste question. A viewer reads a hold
   as the film buffering. (`lab/ours/nn/analysis/cuts.json`)
2. **NN's transitions cheat.** 5 hard cuts where the refs use floods and morphs.
   A pop forces re-orientation; a flood carries the eye across. The viewer feels
   the difference as "cheap" without knowing why. (strips in `lab/refs/v1`,
   `lab/refs/v5`, `lab/refs/v6` vs NN lessons §third/fourth pass)
3. **NN's cursor lies.** Cause without effect-on-target breaks the demo contract
   that v2/v5 never violate: the hand is always on the thing it changes.
4. **NN never lets type breathe.** Every word is UI caption at UI size. The refs
   (and Quantoxt) alternate full-frame display type with UI — type as scene, not
   label. NN has no "3.3 weeks" moment.
5. **What is NOT the problem:** sound sync (same 30–70ms band as refs),
   loudness (−17.1 in the refs' range), tempo (100 BPM grid holds). Don't remix;
   re-animate.

## The uncomfortable corollary

Quantoxt — the older, simpler film — scores closer to the refs on almost every
lab axis than NN does: 1 borderline hold (13.4–16.0, proof card sits while fine
print fades in — real slow moment, unplanned: Quantoxt predates film.json so there
is no planned-holds list to check it against), 0 hidden cuts, full-frame type
scenes. NN regressed on exactly the axes the lab measures, while advancing on craft
(motif, lighting, staging) the lab doesn't measure. Complexity bought beauty
and spent crispness. The factory lesson: new craft must pass the old metrics —
`holds.mjs` + `check.mjs` on the animatic exist for this now.

## Update 2026-10-08: NN-v2 + Unburn close the gap (measured)

The factory fixes from the NN-v1 lessons (anchors, machine checks, primary gate —
see changelog) were applied, then two films shipped. Same analyzer, same thresholds:

| axis | NN-v1 | NN-v2 | Unburn | refs |
|---|---|---|---|---|
| cuts | 5 (only true hard cuts) | **0** | **0** | 9–35 (incl. v3 strobe montage) |
| holds >1s (unplanned) | 12 | **0** (planned end still excluded; region pipeline agrees with holds.mjs) | **0** | 0–1 |
| motif vs words | covers | clear in every tile | n/a | never covers |
| full-frame type | none | improving (hook type larger) | **yes, 4+ scenes** | yes |
| sync / loudness | fine | fine (untouched, as predicted) | fine | — |

NN-v2's 5.4–6.6 span turned out to be small motion (quill/cursor) invisible to
whole-frame diff — the region pipeline clears it, agreeing with holds.mjs at 0/0
(reviewer catch; lab now mirrors the holds.mjs pipeline exactly). Unburn's lab sheet is empty of findings: the first film the lab cannot
fault on its own axes.

On the restriction question: the factory didn't restrain the model — it removed
the defect classes. NN-v2 keeps the quill, the hinge turns, the ambition; it
drops the pops, the holds, the covered words. Unburn adds the ref grammar
(full-frame type scenes) the v1 report asked for. Constraint removed bugs, not
daring. The remaining gap to the refs is craft ambition (motif design, transition
variety), which no gate can supply — that has to be briefed, not checked.

## Next (proposed, not started)

**Shot recreation (plan step 6):** rebuild one ref transition as `seek(t)` code,
render, compare side by side with the ref strip. Candidate: v1's diagonal flood
+ staggered disassembly (`lab/refs/v1/analysis/strips/cut_00.png`) — the most-cited
transition in the tokens, and the direct cure for NN's hidden-cut habit.
Estimated ~3–4 hrs (code 1–2h, render+compare <1h, iterate 1–2h); clock it, don't trust the estimate.
**Reward if it passes:** a working `flood()` in `lib/` that every future film
imports — the transition grammar becomes factory capability, not per-film craft.
If it takes a day and teaches little, kill the step.

## Unresolved (do not cite as findings)

- Shared BPM readings across unrelated videos (v1/v4/v6: 129.199; v2/v5/Quantoxt:
  120.185) — same royalty-free tracks or librosa grid lock. Needs track
  identification before any tempo token is trusted.
- Cut↔onset offsets live in a 30–70ms band everywhere, refs included — that is
  onset-detector jitter as much as editing. "Near a sound event" is honest;
  "on the beat" would not be.
- Token statements about v2/v5's cursor discipline come from their prompts +
  contact sheets, not from tracked cursor geometry. A cursor-tracking pass
  (plan step 5) would promote them to measurements.
