# The seed bank

A seed is a specific brief rolled **before** the model is called:

```
angle × voice × subject × format × frame × hook pattern
```

Asking a model for "a viral hook" samples the middle of everything it has read,
which is the definition of generic. Rolling the combination first means the model
never chooses what to write about — only how to write it. Variety becomes
mechanical instead of depending on the model being inspired.

```bash
node src/seed.js                        # one seed
node src/seed.js --mood toxic --count 5
node src/seed.js --date 2026-08-23      # same date always rolls the same seed
node src/seed.js --stats
```

Current bank: **101 angles × 2 active subjects → 550 valid combinations**
(toxic 156 · negative 236 · love 274 · positive 138).

## The four axes

**Angle** — the psychological hook, and the real source of variety.
`toxic-attraction`, `deepest-fear`, `never-say-out-loud`, `permission`…

**Voice** — who is being addressed. The same angle reads completely differently
as `you` (accusatory-intimate) versus `her` (about a woman, to the man who is
losing her). Defined in `voices.json`.

**Subject** — what the carousel is indexed by. Active: `zodiac-sign` and
`birth-month`, weighted equally. `attachment-style` and `love-language` exist
but are `disabled: true` — off-brand for now, one flag away from returning.
Birthdates are the next one planned. Defined in `subjects.json`.

Subjects carry a `weight`; uniform picking once produced a whole batch of
short carousels and no staple 12-slide format at all.

**Format** — `prose` (two labelled sections) or `bullets`.

## Adding an angle

One entry in `angles.json`. It is registered immediately.

```json
"how-they-apologise": {
  "moods": ["negative", "love"],
  "voices": ["you", "her", "him"],
  "formats": ["prose", "bullets"],
  "brief": "What their apology actually looks like — whether it names the thing or works around it. What a real one from them would sound like.",
  "frames": [["How You Apologise:", "What Would Actually Land:"]],
  "hooks": {
    "you": ["How you apologise, based on {your} {singular}"],
    "her": ["What {her} apology really means"],
    "him": ["Why his apology never lands"]
  }
}
```

| Key | Notes |
| --- | --- |
| `moods` | From `love`, `positive`, `negative`, `toxic`. Drives poster theme. |
| `voices` | Must have a matching key in `hooks` or the voice is skipped |
| `formats` | `prose`, `bullets`, or both |
| `brief` | **The most important field.** One or two sentences telling the writer what the angle actually means and what tone to hit. Vague brief, generic output. |
| `frames` | Label pairs for the body. Multiple options = more variety. |
| `hooks` | Cover-slide hooks, keyed by voice. Two or three each. |
| `itemTitle` | Optional per-slide title pattern, e.g. `"{item} Girlfriend"` |
| `anaphora` | Fixed opening every line must use — the repetition IS the format. Can contain `{item}`: `"I was born in {item}, that's why"` |
| `bulletLabels` | Fixed bold labels in order, identical on every slide, e.g. `["Warning:", "What {Subj} Hides:"]`. Voice placeholders ARE resolved here. |
| `bulletCount` | Reference posts run 5-11, not always 5. Accepts a single number or an array to roll from, e.g. `[6, 6, 7]` |
| `pattern` + `examples` | **The strongest field there is.** See below. |

`node src/seed.js --stats` warns if an angle declares a voice with no hooks.

### Pattern — the sentence machine

A `brief` says what to write ABOUT. A `pattern` says what SHAPE the sentence
takes. Without the shape the model reaches for metaphor and produces lines that
sound meaningful and mean nothing — "you were not made of stone, but I treated
you like a wall" is two halves of the same image cancelling out.

The best-performing posts are machines. This one:

```
"I am sorry you [gave X generously] for people who [withheld exactly that X]."
```

produces "I am sorry you held the door for people who shut it" all day. Give the
model the machine plus 4-5 real examples and it fills it reliably. Give it only
a topic and it writes poetry that means nothing.

When you find a post that works, reverse-engineer its machine and add it as an
angle. That is the highest-value work on this whole project.

### Placeholders only work in SOME fields — this has broken angles twice

`{Subj}`, `{Obj}`, `{Poss}`, `{item}` etc. are only substituted in fields the
seed roller explicitly resolves before the writer sees them:

| Field | Resolved? |
| --- | --- |
| `hooks` | yes |
| `frames` | yes |
| `bulletLabels` | yes |
| `pattern` | **no — sent to the model as literal text** |
| `patternNote` | **no — sent to the model as literal text** |
| `examples` | **no — sent to the model as literal text** |

Writing `{Subj} isn't fearless` into `examples` or `pattern` does not become
"She isn't fearless" — the model receives the literal string `{Subj}` and has
no idea what it means. This has happened twice while building this angle bank:
once with `the-warning-label`, once nearly with a second angle right after.

**The fix:** write `pattern`, `patternNote` and `examples` as plain concrete
text for ONE voice (pick whichever the reference post used), and if the angle
serves multiple voices, say so in `patternNote` in plain English — "written
below for the her voice; mirror every pronoun for him" — and trust the model to
do the substitution. It already gets the target voice from `VOICE:` in the
prompt, so this works reliably; unresolved template syntax does not.

If an angle's `hooks`, `frames` or `bulletLabels` need a voice-specific word,
those three fields DO support the placeholders below.

### Never let `examples` reconstruct ONE complete item

On a `bulletLabels` angle, if the examples happen to cover every label exactly
once, they add up to a full filled-in slide — and the model will replay it
almost word for word on whichever item comes first.

This happened on `the-monthly-profile`. All eight examples were lifted from the
same "January girl" reference poster, in label order, so the generated January
came back 6/8 identical to it — a near-copy of the reference account's actual
published post, and an item that would never vary. The prompt does say "do not
reuse these, match their construction"; that instruction does not survive a set
of examples this complete.

**Rule:** scramble examples across at least two or three different items, and
give at least two alternatives per label so no single item is reconstructible.
Then say so in `patternNote` — "the examples are deliberately scrambled across
three months; never assemble them back into one profile".

Diagnostic — flags any fixed-label angle whose examples cover every label with
little slack:

```bash
node -e "const a=require('./seeds/angles.json');for(const[i,x]of Object.entries(a)){if(!x.bulletLabels||x.disabled)continue;console.log(i,'labels='+x.bulletLabels.length,'examples='+(x.examples||[]).length)}"
```

Anything where `examples` is not comfortably larger than `labels` needs a look.
This applies to free-sentence angles too, just less sharply — there is no fixed
slot count for the examples to fill.

### Placeholders

Resolved from the voice (pronouns) and the subject (noun):

| | |
| --- | --- |
| `{singular}` | "birth month" / "zodiac sign" |
| `{each}` | "each birth month" |
| `{item}` | the individual item, in `itemTitle` only |
| `{your}` `{her}` `{his}` `{their}` | this voice's possessive |
| `{she}` `{he}` `{they}` | this voice's subject pronoun |
| `{She}` `{Her}` … | capitalised forms |

Since hooks are stored per voice, the pronoun in a hook is already the right one
— it only needs substituting, never choosing. Write `your {singular}`, not
`{your} {singular}`, or you get "your birth month birth month".

**Frames are templates, not final labels.** "How You Grieve:" has to become "How
She Grieves:" for the `her` voice, and verb agreement makes naive substitution
wrong. The seed carries a `frameNote` telling the writing step to conjugate them.

## Anti-repetition

Every rolled seed can be appended to `used.json`:

```bash
node src/seed.js --record
```

Rolls then skip anything used in the last 60 days (`avoidDays`), on **two**
levels:

1. the `angle|voice|subject` combination, and
2. the **rendered hook text**.

The second one is not redundant. A hook pattern with no `{singular}` in it —
`"How you ruin it right before it gets good"` — renders identically whether the
subject rolled `birth-month` or `zodiac-sign`. The combinations are genuinely
different and so is the slide content, but the reader only sees the cover, and
the cover would be word-for-word the same. Dedupe on the text, not just the
combination.

On top of that there is an **angle cooldown**, because the first two rules are
not enough. An angle is the *idea* of a post, and returning to the same idea with
a different voice or subject still reads as a repeat — `"how you test people"`
and `"how he tests her"` are one idea, not two. Without a cooldown they can land
on the same afternoon: measured at 4 posts/day, the same angle recurred **2 posts
apart**.

The cooldown counts **posts, not days** (cadence varies — 60 posts is twelve days
at 5/day and two months at 1/day) and ignores voice and subject entirely. Default
60, set with `angleCooldown`. Keep it well under the bank size so candidates
always remain.

Verified at the heaviest cadence — 450 posts (90 days at 5/day): **450 distinct
hooks out of 450**, soonest angle repeat 61 posts (12 days), median 80 posts
(16 days).

### Bank depth sets the ceiling

The best achievable gap between repeats of an angle is `angles ÷ posts-per-day`
days. No cooldown setting beats that:

| Angles | 1/day | 3/day | 5/day |
| --- | --- | --- | --- |
| 100 (today) | 100 days | 33 days | 20 days |
| 150 | 150 days | 50 days | 30 days |

If the bank cools down every candidate, or saturates, the roller relaxes and
allows a repeat rather than crashing — it degrades instead of breaking the
schedule.

## Determinism

`--date 2026-08-23` seeds the PRNG from the date string, so a given day always
rolls the same seed, on any machine, however many times it runs. That means:

- **Preview** — see a month of hooks before any of it posts.
- **Reproduce** — a bad post can be rolled again exactly, to debug it.
- **Safe retries** — a cron that fires twice, or retries after a crash, produces
  the same post rather than two different ones.

One caveat: when a roll collides with the used log it re-rolls, so the result
depends on the log's state as well as the date. Same date + same `used.json` =
same seed. Previewing far ahead without recording will therefore drift slightly
from what actually runs — the preview is indicative, not a contract.
