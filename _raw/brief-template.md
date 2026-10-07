# Brief: ____ (brand name)

> Copy this file to `_raw/<brand>.md`, fill it in, then tell the agent: `follow _raw/<brand>.md`
>
> - **Checkboxes:** tick what you want (`- [x]`). Tick several only where it says *(any)*.
> - **Text fields:** replace `____` with your answer.
> - **Don't know?** Tick **Agent decides**, or leave `____` as is. The agent picks, explains why in the shotlist, and asks you if the choice is material.

Use the **motion-reel** skill. Go all out.

---

## 1. Source (the main input)

*Give at least one. The agent reads it first and derives the story, copy, features, look, colors, fonts and logos from it. Real logos, UI and copy only; never redrawn from imagination.*

**Website URL:** ____

**Local codebase path:** ____

**GitHub repo URL:** ____

**Optional pointers** *(leave `____` and the agent finds them in the source)*
- **Design tokens file (css / json):** ____
- **Logo folder:** ____
- **Font files location:** ____
- **Pages / screens worth showing:** ____
- **Public data / API for live numbers:** ____

---

## 2. Job

**Brand name:** ____

**Brand folder:** `brands/____` (lowercase, no spaces)

**Pattern**
- [ ] A · Product reel: hook → product → features → proof → logo + CTA
- [ ] B · Educational explainer: a story that teaches one idea (75–90s, voiceover)
- [ ] Agent decides

**Duration**
- [ ] 15s
- [ ] 20s
- [ ] 30s
- [ ] 45s
- [ ] 60s
- [ ] Other: ____
- [ ] Agent decides

**Formats** *(any; the first ticked is primary)*
- [ ] 9:16 · 1080×1920 (Reels / TikTok / Shorts)
- [ ] 1:1 · 1080×1080 (feed)
- [ ] 16:9 · 1920×1080 (YouTube / site / X)
- [ ] 4:5 · 1080×1350 (Instagram / LinkedIn feed)
- [ ] Agent decides

---

## 3. Audience & goal

**Where it will be posted** *(any)*
- [ ] Instagram Reels
- [ ] TikTok
- [ ] YouTube Shorts
- [ ] X
- [ ] LinkedIn
- [ ] Website hero / landing page
- [ ] Paid ad
- [ ] Pitch / presentation
- [ ] Agent decides

**Who's watching:** ____

**The ONE thing they should remember (one sentence):** ____

**What they should do after:** ____

**CTA text on screen:** ____ (e.g. "Start your project")

**CTA destination shown on screen (URL / handle):** ____

**Will most people watch with the sound off?**
- [ ] Yes, design for sound-off (text carries the story)
- [ ] No
- [ ] Agent decides

---

## 4. Brand rules

*Optional. Leave blank to take them from the source's tokens. Anything set here is law: the agent may not bend it.*

**Theme**
- [ ] Dark-first
- [ ] Light-first
- [ ] Agent decides from tokens

**Background (token or color):** ____

**Main accent (one color):** ____

**Second accent, reserved for one moment only**
- [ ] None
- [ ] Use: ____ only for: ____
- [ ] Agent decides from tokens

**Display font:** ____

**UI font:** ____

*(Two faces max. Leave `____` to take them from the tokens.)*

**Texture**
- [ ] Film grain
- [ ] Grid
- [ ] Flat
- [ ] Paper / hand-drawn
- [ ] Other: ____
- [ ] Agent decides

**Button / corner shape**
- [ ] Pill
- [ ] Rounded
- [ ] Sharp
- [ ] Agent decides from site

**Shadows**
- [ ] None
- [ ] Subtle
- [ ] Same as site
- [ ] Agent decides

**Brand-specific banned looks:** ____

---

## 5. Copy & claims

**Lines that must be used word for word (tagline, product name styling):** ____

**Where the rest of the copy comes from**
- [ ] Only lines from the site / repo
- [ ] Agent may write new short lines
- [ ] Agent decides

**Numbers & claims policy**
- [ ] Only live-verifiable numbers (agent pulls them and notes the snapshot date)
- [ ] Only numbers I list here: ____
- [ ] Agent decides, but shows me every claim at the shotlist gate

**Things we must NOT say or show:** ____

---

## 6. Story

*Optional. Leave it blank and the agent derives the story from the source. Anything filled in is a starting point: the agent may cut, add or reorder, and must say why in the shotlist.*

**Hook idea (first 2 seconds):** ____

**How the product appears:** ____

**Features to show (each as a real UI action with a cursor)**
1. ____
2. ____
3. ____
- [ ] Agent picks the strongest from the site instead

**Proof number (the one stat):** ____ · **source:** ____
- [ ] Agent proposes options, I pick

**Logo variant for the lockup:** ____

**Ending**
- [ ] Logo + CTA
- [ ] CTA, then logo
- [ ] Loops back to the hook
- [ ] Agent decides

---

## 7. Look & feel

*Optional. Leave it blank and the agent derives the look from the site/codebase.*

**References (links, frames or video paths; the agent takes the grammar, never the content):** ____

**Mood** *(pick up to 3)*
- [ ] Confident
- [ ] Calm
- [ ] Playful
- [ ] Premium
- [ ] Technical
- [ ] Warm
- [ ] Bold
- [ ] Minimal
- [ ] Energetic
- [ ] Cinematic
- [ ] Agent decides

**Energy**
- [ ] Calm and spacious
- [ ] Steady
- [ ] Showreel-fast
- [ ] Agent decides

**Avoid (anything that would feel off-brand):** ____

---

## 8. Sound

**Music**
- [ ] Synthesize original music in code
- [ ] Use my track: ____ (path)
- [ ] No music, SFX only
- [ ] Agent decides

**Tempo**
- [ ] 90 BPM
- [ ] 110 BPM
- [ ] 120 BPM
- [ ] 128 BPM
- [ ] Other: ____
- [ ] Agent decides

**Music mood / genre / reference track:** ____

**Sound effects**
- [ ] UI clicks + whooshes on the beats
- [ ] Minimal
- [ ] None
- [ ] Agent decides

**Voiceover**
- [ ] None
- [ ] Yes, script written by the agent
- [ ] Yes, my script: ____
- [ ] Agent decides

---

## 9. Deliverables

*Always delivered, per format ticked in section 2: `out/<brand>-<format>-<W>x<H>.mp4` (CRF 16) and its `-posting.mp4` copy (CRF 20). Plus `contact.png` and `poster.png`. Finished films appear in the studio's Library.*

**Poster / thumbnail**
- [ ] Best frame from the film
- [ ] Hook frame
- [ ] Proof-number frame
- [ ] Agent decides

**Anything else:** ____

---

## 10. Gates (do not skip)

1. **Assets:** list what was found in `brands/<folder>/assets` and write `docs/style_guide.md`.
2. **Shotlist:** `docs/shotlist.md` on the beat grid, listing every deviation from this brief, every claim, and open questions. Flag any live data that contradicts the site's copy. **Wait for my OK before code.**
3. **Animatic** (`--animatic`) to lock pacing.
4. **Critique:** every check in CLAUDE.md's loop (beats, handoff strips, `shots.mjs events` for clicks, swaps and transforms, `holds.mjs` pop/hold scan, `check.mjs` geometry, every format via `--format all`), scored 1–10 from measurements, at least 4 rounds, all scores 8+, logged in `docs/review_log.md`.
5. **Render** once `check.mjs` and `holds.mjs` pass (the renderer enforces it): the primary format first, then **wait for my OK on it** in the studio (the renderer refuses the other formats until then), then the rest (`--all-formats --formats …`), run `finalize.mjs`, deliver. Write lessons to `brands/<brand>/docs/lessons.md`, log any engine bug in `docs/bug-docs.md`, and say what you'd improve next.

---

### Notes for the agent
- Read the **Source** (section 1) before anything else. Derive whatever the brief leaves blank from it.
- Brand rules (section 4) are law once set. Story (section 6) and look (section 7) are a starting point. Improve them and name every change in the shotlist.
- A ticked **Agent decides**, an untouched `____`, or nothing ticked all mean: decide from the repo/site, say what you picked and why, and ask instead if it changes the message or a claim.
- Worked example of a filled brief: `_raw/quantoxt-inc-solo.md` (older free-text format).
