# Brief: ____ (job name)

> Saved to `pge/briefs/<job>.md` by the studio's Images section. Start the job there, or tell the agent: `follow pge/jobs/<job>/docs/brief.md`
>
> - **Checkboxes:** tick what you want (`- [x]`). Tick several only where it says *(any)*.
> - **Text fields:** replace `____` with your answer.
> - **Don't know?** Tick **Agent decides**, or leave `____` as is. The agent picks, explains why in the story plan, and asks you if the choice is material.

Read `pge/AGENTS.md` first: it is the rulebook for image jobs.

---

## 1. The idea

*The one input that matters. A brand, a product, a person, a cause, a feeling, a story you want told in pictures.*

**What is this about (a sentence or a paragraph):** ____

**The ONE thing a viewer should feel or remember:** ____

**Who is looking at it:** ____

**Job folder:** `pge/jobs/____` (lowercase, no spaces)

---

## 2. Source material

*Optional. Real logos, copy, photos and colours come from here, never redrawn from imagination.*

**Website URL:** ____

**Local folder with assets (logos, photos, fonts):** ____

**Lines that must be used word for word:** ____

**Things we must NOT say or show:** ____

---

## 3. What to make

**What to make**
- [ ] Carousel: a story told across panels (swipe)
- [ ] Single image: one frame that tells the whole story
- [ ] Poster: one image, type-led, made to be read from far away
- [ ] Agent decides

**Number of panels (carousel):** ____

**Formats** *(any; the first ticked is primary)*
- [ ] 4:5 · 1080×1350 (Instagram / LinkedIn feed)
- [ ] 1:1 · 1080×1080 (feed)
- [ ] 9:16 · 1080×1920 (Stories / status)
- [ ] 16:9 · 1920×1080 (X / site / slides)
- [ ] 3:4 · 1500×2000 (print-style poster)
- [ ] Agent decides

**Where it will be posted:** ____

**Ending / call to action on the last panel:** ____

---

## 4. Look

*Optional. Anything set here is law; anything left blank the agent derives from the source or the idea.*

**Theme**
- [ ] Dark
- [ ] Light
- [ ] Agent decides

**Background colour:** ____

**Accent (one colour):** ____

**Display font:** ____

**Text font:** ____

**Drawing style** *(any)*
- [ ] Hand-drawn ink (wobbly lines, pencil passes)
- [ ] Flat shapes and colour fields
- [ ] Type-led (big words do the work)
- [ ] Fake-3D objects (isometric, turned cards)
- [ ] Diagram / annotated (arrows, circles, notes)
- [ ] Agent decides

**Texture**
- [ ] Film grain
- [ ] Paper
- [ ] Flat
- [ ] Agent decides

**Mood** *(pick up to 3)*
- [ ] Calm
- [ ] Bold
- [ ] Playful
- [ ] Premium
- [ ] Warm
- [ ] Technical
- [ ] Cinematic
- [ ] Minimal
- [ ] Agent decides

**References (links or image paths; the agent takes the grammar, never the content):** ____

*Images can also be uploaded under **Design references** at the bottom of this form; they land in the job's `assets/refs/`.*

**Avoid:** ____

---

## 5. Story

*Optional. A starting point: the agent may cut, add or reorder, and must say why in the plan.*

**Hook (what panel 1 says or shows):** ____

**The turn (the moment the story changes):** ____

**The motif (one object or shape that recurs in every panel):** ____

**The one swing (the single boldest image; the agent must attempt it):** ____

---

## 6. Gates (do not skip)

1. **Assets and style guide:** gather real assets into `pge/jobs/<job>/assets/`, write `docs/style_guide.md`.
2. **Story plan:** `docs/plan.md`, one entry per panel (what it shows, its words, how it hands off to the next), every deviation from this brief, and open questions. **Wait for my OK in the studio before drawing.**
3. **Draft:** `node pge/render.mjs --dir pge/jobs/<job> --draft`, look at the contact sheet at phone size.
4. **Checks:** `node pge/check.mjs --dir pge/jobs/<job>` passes in every format.
5. **Critique:** at least 4 rounds in `docs/review_log.md`, scored from the rendered images, all scores 8+.
6. **Final:** `node pge/render.mjs --dir pge/jobs/<job>` (refused until the checks pass), then write `docs/lessons.md`.

---

### Notes for the agent
- Read `pge/AGENTS.md` before anything else, then this brief, then any source in section 2.
- Look rules (section 4) are law once set. The story (section 5) is a starting point.
- A ticked **Agent decides**, an untouched `____`, or nothing ticked all mean: decide, say what you picked and why in the plan, and ask if it changes the message.
