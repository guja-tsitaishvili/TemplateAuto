# Noted for later

Things identified but deliberately deferred. Nothing here is broken — these are
improvements with a known reason to wait.

## Themes / visual

- **More themes.** 5 today (`yellow`, `crimson`, `pink`, `blush`, `sage`); the
  goal was ~30. Pure visual variety with zero quality risk — design is
  deterministic, nothing is generated. Two carousels of the same angle in
  different themes read as different posts. One JSON file each, see
  [themes/README.md](themes/README.md).
- **Theme colours for bullet posts specifically** — flagged as needing review.
- **Cover artwork barely used.** Four cut-outs sit in `designpics/` and almost
  nothing places them. Needs single-element art, see
  [designpics/PROMPTS.md](designpics/PROMPTS.md).

## Angle bank

- **DONE, but note the recurring mistake:** `pattern`, `patternNote` and
  `examples` are never placeholder-resolved — `{Subj}`/`{item}`/etc written
  into them reach the model as literal unresolved text. Hit twice while
  authoring angles. Rule and fix now documented in
  [seeds/README.md](seeds/README.md#placeholders-only-work-in-some-fields--this-has-broken-angles-twice) —
  check that section before writing a new angle's examples.
- **Frames: 1 per patterned angle.** The section labels ("Your magnetism:" /
  "Your trap:") are the most visible repeated words in a prose post and never
  change. 2-3 alternatives each costs nothing — only one is used per post.
- **Examples: 5-9 per angle.** Sweet spot is 8-12. Must come from the reference
  posters, NOT from generated output — feeding the model its own lines back
  drifts the voice toward the model's habits over weeks.
- **Hooks: some angles have only 1-2 options.** 3-4 each.
- **89 of 107 angles still have no pattern.** They run on `brief` alone and
  produce the metaphor-mush that was rejected early on. Each needs a reference
  post to extract a machine from — inventing them unaided is what produced
  "you were not made of stone, but I treated you like a wall".

## Quality

- **Hooks can promise a narrower theme than the pattern actually delivers on
  every slide.** Found on `thats-why`: hook read "your impossible standards
  for **yourself**", and the pattern (self-contradiction) is broad enough that
  only 1/5 Aries lines were actually self-directed — the rest were about
  demands on others. Taurus, same post, same hook, landed 4/5. Root cause: the
  hook is written in step 1, before any of the 12 slides exist, so it only has
  the pattern + 3 reference examples to go on and can pick a specific-sounding
  slice that is not universal across items. Already fixed hook-vs-pattern
  alignment (don't promise a loss the pattern never delivers); this is the same
  bug one level deeper — don't promise a narrow theme *inside* the pattern that
  is not guaranteed for every item. Fix direction: tell the hook generator to
  stay at the pattern's actual level of generality rather than latching onto
  one example's specific angle. Expected to show up on other patterned angles
  too — check for it as more get built.
- **Nothing checks grammar.** "She plan every detail" shipped in a generated
  post. QA covers length, banned phrases, repetition and idea-similarity, but
  no agreement or tense checking. Rare enough to leave to a human eye for now.
- **Captions run on the local 3B model and are noticeably weaker** than the API
  version. Accepted deliberately — captions matter less than slide copy — but
  it is one `try` block in `writeCaption` to revert if engagement looks soft.
- **`seeds/idea-history.json` carries test junk.** 24 item-keys were saturated
  by repeated same-angle test runs. Those are real forbidden ideas and will
  suppress legitimate content when those angles come round for real. Worth
  clearing before going live. Use `--fresh` when testing to avoid adding more.

## Pipeline

- **Stage 3 (n8n posting) not started.** The Meta side is the unpredictable
  part: business IG account, Facebook Page link, developer app, Content
  Publishing API permissions. Worth starting early — it is mostly clicking
  through Meta's console, not code.
- **Buffer, do not generate-and-post.** Generate ahead into a queue so a bad
  batch never reaches the feed unreviewed.
- **No engagement feedback anywhere.** Every weight in the seed roller — voice,
  format, mood, angle — is currently a guess. Once live, saves and shares
  should drive them. This is the single biggest quality lever that does not
  exist yet.
