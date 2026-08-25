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

- **FIXED (2026-08-25): hook/bullet mismatch.** Was two separate bugs sharing
  one symptom, and the original fix direction written here was aimed at the
  wrong one. Both are now addressed in `generate.js`.

  *Bug A — hook promises a slice only some items can honour.* Found on
  `thats-why`: hook read "your impossible standards for **yourself**", and the
  pattern (self-contradiction) is broad enough that only 1/5 Aries lines were
  self-directed; Taurus landed 4/5 on the same hook. Cause: the hook is written
  in step 1, before any slide exists, so it can latch onto a specific-sounding
  slice that is not universal. Fixed with a **12-item test** in `generateHooks`
  plus a matching coverage rule in `scoreHooks` so the judge enforces it.
  NOTE the original entry here proposed "tell the hook generator to stay at the
  pattern's level of generality" — that was rejected on implementation. Making
  hooks *general* makes them weaker, and specific hooks are what stop a scroll.
  The rule that shipped is "as narrow as you like, provided all 12 items can
  honour it", which keeps the sharpness and drops only the unkeepable promise.

  *Bug B — the body ignores the hook on some items.* Caught in testing on
  `how-to-love-them` (an unpatterned angle, so Bug A's machinery did not even
  apply): hook was "what each sign needs you to say **when they quiet down**",
  Taurus honoured it exactly, and Aries wrote about de-escalating a *fight* —
  the opposite behaviour. The body step already received the hook and was told
  to "write to it", which was too passive to bind. Fixed by making the hook an
  explicit contract in `writeBodies`: if the hook names a situation, every item
  must be written inside that situation, and an item that answers a different
  question has failed however good its lines are.

  Verified by re-running the failing seed: the hook moved to "The exact words
  to say to each zodiac sign tonight" (still specific, now universally
  honourable) and all three items delivered on it. Watch for Bug B recurring on
  scenario hooks specifically — it is the harder of the two to see, because each
  slide reads fine alone and only the cover-plus-slide pair exposes it.
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
