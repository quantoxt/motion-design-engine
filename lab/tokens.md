# Token schema

A token is one measured, named reason a reference works. Every token has:

| Field | What |
|---|---|
| `name` | short slug, e.g. `hook-event-density` |
| `kind` | `design` (palette, type, k/d, spacing — flows into a build) or `principle` (a rule — flows into md/critique checks) |
| `measurement` | numbers from `analyze.mjs`, with command. No adjectives. |
| `evidence` | files/frames: `contact.png` tile, `strips/cut_03.png`, `sync.json` rows |
| `statement` | the "why it works", one sentence. Filled by the agent AFTER looking at the evidence — never generated from numbers alone. |
| `refs` | which videos exhibit it (v1..v6). A token seen once is an observation; seen 3+ times, a rule. |

## Rules

- Measurements are machine output. Statements are agent judgments from evidence.
  Never let the analyzer write statements.
- Any classifying/scoring of text by an LLM follows the TypeSafe Jev rule
  (user's global CLAUDE.md). Prefer agent-eyed judgments over LLM scores.
- Principle tokens stay lab-local md. They do not edit factory files.
- Calibrate claims against our films: a token that our 6.5/10 NN also
  satisfies is descriptive, not explanatory. Note it.
