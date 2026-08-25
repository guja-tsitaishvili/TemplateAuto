#!/usr/bin/env node
/**
 * The prompt chain: seed -> content.json
 *
 *   1  hooks    generate ~20, high temperature, forced structural variety
 *   2  score    judge them against a rubric, return the winner       (low temp)
 *   3  bodies   write every item to the winning hook                 (mid temp)
 *   4  QA       deterministic checks in code; retry step 3 if failed
 *   5  caption  caption + hashtags                                   (low temp)
 *
 * Each step is its own call so a failure can be retried in isolation, and so a
 * bad step can be inspected without unpicking one giant response.
 *
 * The CTA is never written here — the renderer appends it from cta.json.
 *
 * Usage:
 *   node src/generate.js                          roll a seed and write a post
 *   node src/generate.js --mood toxic
 *   node src/generate.js --date 2026-08-25 --record
 *   node src/generate.js --angle deepest-fear --subject zodiac-sign
 */

const fs = require('fs');
const path = require('path');
const { roll, record, subjects } = require('./seed');
const { priorIdeas, priorVectors, recordIdeas } = require('./history');
const { embedMany, closestPrior } = require('./embed');
const { hashtagsFor } = require('./hashtags');
const { generate } = require('./gemini');
const { generateLocal, available: localAvailableRaw } = require('./local');
// Gated by config.useLocalModel, which is off by default — see the note there
// for the measured reason. Wrapping it here means both call sites stay
// unchanged and the local path is one env var away from coming back.
const localAvailable = async () => config.useLocalModel && (await localAvailableRaw());
const { checkItems, filterHooks, hookNamesAxis, BANNED, LIMITS } = require('./quality');
const config = require('./config');

// Only one hook is ever used and the axis filter culls some before scoring.
// 12 keeps the selection pressure that makes over-generation work while
// cutting roughly 40% off this step.
const HOOK_COUNT = 12;

/** House voice, prepended to every writing call. */
function houseStyle() {
  return [
    'You write for an astrology Instagram account with a distinctive voice.',
    '',
    'VOICE RULES:',
    '- Plain words. Never reach for an impressive word when a common one is truer.',
    '- State things as fact. No "maybe", "sometimes", "a little bit".',
    '',
    'THE MOST IMPORTANT RULE — precise about the FEELING, universal about the',
    'CIRCUMSTANCE. The reader must be able to stand inside the sentence.',
    '',
    '  YES  "You deserve to come second sometimes and not be left for it."',
    '  YES  "It wasn\'t too much. You just asked the wrong people for it."',
    '  YES  "You can put the armor down here. Nothing is going to hit you."',
    '',
    '  NO   "You only call me when your radiator leaks and you need someone',
    '        to yell at the landlord."',
    '  NO   "I kept the blue lighter you left on my kitchen table."',
    '',
    'The NO lines are somebody else\'s specific life. A reader with no landlord',
    'and no blue lighter is locked out. The YES lines name the feeling exactly',
    'and let every reader supply their own details.',
    '',
    'TEST EVERY LINE: could most people who identify with this item put',
    'themselves inside it without inventing a backstory? If it needs one, cut',
    'the prop and keep the feeling.',
    '',
    '- Objects are allowed only if nearly everyone has one: a door, a phone,',
    '  a bed, silence. Not a landlord, a radiator, a particular lighter.',
    '- No therapy-speak, no self-help slogans, no motivational poster language.',
    '- Never explain the feeling after naming it. Trust the reader.',
    '- No emoji. No hashtags. No exclamation marks.',
    `- NEVER use these: ${BANNED.join(', ')}.`,
    '',
    'DEVICES THIS VOICE USES (from posts that performed):',
    '- A metaphor built from something universal, not from a personal prop:',
    '    "The world keeps sending you puddles and calling them oceans."',
    '- Parallel sentences where the second one turns:',
    '    "They want the stability you offer. They just never want to become it."',
    '- A short flat sentence to close a paragraph:',
    '    "It will not."   "It is not the same thing."   "You need a peer."',
    '- Short fragments for rhythm: "Still be wanted. Still be enough."',
    '',
    'Mix sentence lengths. A long observation followed by a four-word sentence',
    'lands harder than three medium ones.'
  ].join('\n');
}

function seedContext(seed) {
  return [
    `ANGLE BRIEF: ${seed.brief}`,
    `VOICE: ${seed.voiceGuidance}`,
    `SUBJECT: the carousel is indexed by ${seed.subject.replace(/-/g, ' ')}.`,
    `ITEMS: ${seed.items.join(', ')}`
  ].join('\n');
}

/* ---------------------------------------------------------------- step 1 */

/**
 * The reader looks up their OWN item on you/i/they posts, so the cover says
 * "your sign". On her/him posts the subject is a third party and "your" is
 * simply the wrong person — those take her/his instead. (The i voice keeps
 * "your" deliberately: voices.json has the cover addressing the reader as you
 * while only the body switches to I.)
 */
function hookPossessive(voice) {
  if (voice === 'her') return { poss: 'her', who: 'her' };
  if (voice === 'him') return { poss: 'his', who: 'him' };
  return { poss: 'your', who: 'the reader' };
}

async function generateHooks(seed, axis) {
  const { poss, who } = hookPossessive(seed.voice);
  const Poss = poss.charAt(0).toUpperCase() + poss.slice(1);
  const prompt = [
    houseStyle(),
    '',
    seedContext(seed),
    '',
    `Write ${HOOK_COUNT} cover hooks for this carousel.`,
    '',
    `MANDATORY: every hook must contain the words "${axis}" (or "${axis}s").`,
    'Without it the reader cannot place themselves and the post loses its',
    'astrology signal. A hook missing it is discarded automatically.',
    '',
    'Use ONLY these four house templates. The hook shape is brand recognition —',
    'novelty belongs in the idea, never in the format:',
    `  A)  ${Poss} ${axis}, ${poss} <noun phrase>`,
    `  B)  <claim about ${who}>, based on ${poss} ${axis}`,
    `  C)  What each ${axis} <verb phrase>`,
    `  D)  <claim about ${who}>, by ${poss} ${axis}`,
    '',
    'Spread them across all four. Vary the IDEA, not the structure.',
    // The possessive was hardcoded to "your" for every voice, which collides on
    // the third-person ones: a her-voice post produced the cover "The truth of
    // her, based on YOUR birth month" — two different people in one sentence,
    // and no way to tell whose month decides it.
    poss === 'your'
      ? ''
      : `\nPRONOUN: this post is about ${who}, not about the reader. The hook says "${poss} ${axis}" — never "your ${axis}". Do not mix the two in one hook.`,
    '',
    // The earlier fix stopped hooks promising content OUTSIDE the pattern. This
    // is the same bug one level in: a hook can promise a narrow slice INSIDE the
    // angle that only some items can honour ("your impossible standards for
    // yourself" — true of 1/5 signs, the rest were standards for other people).
    // The rule is NOT "be general" — specific hooks are the strong ones. The
    // rule is that the specificity has to survive all 12 items.
    `THE 12-ITEM TEST — apply it to every hook before you return it:`,
    `could EVERY one of the ${seed.items.length} items honestly deliver on this`,
    'hook, or only some of them? A hook may be as specific and as narrow as you',
    'like — narrow is what makes a reader stop — but if it names a situation, a',
    'target or a condition that only a few items can plausibly answer, it is a',
    'failed hook. Each reader only ever sees the cover plus THEIR item, so a',
    'promise kept on eight items and broken on four is broken for a third of',
    'them. Discard those and write one whose specificity holds everywhere.',
    '',
    // Without this the hook was written blind to the slide titles, producing
    // covers that did not match the carousel — a "the side of you they never
    // earned the right to see" hook over slides titled "January Girlfriend".
    seed.itemTitle && seed.itemTitle !== '{item}'
      ? `\nEACH SLIDE IS TITLED "${seed.itemTitle.replace('{item}', seed.items[0])}", "${seed.itemTitle.replace('{item}', seed.items[1])}" and so on.\nThe hook MUST set that up so the cover and the slides read as one post. A hook that ignores this theme is wrong however good it sounds on its own.\n`
      : '',
    // The hook step could not see the body pattern, so it promised things the
    // body never delivers — "What you lose when you lose her" over slides that
    // are a present-tense portrait of her habits, with no loss in them at all.
    seed.pattern
      ? [
          '',
          'WHAT THE SLIDES ACTUALLY CONTAIN — every line is built on this shape:',
          `  ${seed.pattern}`,
          '',
          'Real lines from this format:',
          ...(seed.examples || []).slice(0, 3).map((e) => `  ${e}`),
          '',
          'The hook must promise EXACTLY this and nothing else. Do not promise a',
          'loss, an aftermath, a secret or a confession unless the lines above',
          'deliver one. A cover that sets up content the slides do not contain is',
          'a failed hook however well it reads.',
          ''
        ].join('\n')
      : '',
    `Each under ${LIMITS.hook} characters. Plain words.`,
    'It should feel personally aimed while staying true for thousands of people.',
    `Reference shape: "${seed.hook}" — do not reuse it, beat it.`
  ].join('\n');

  const result = await generate({
    prompt,
    temperature: 1.35,
    schema: {
      type: 'object',
      properties: { hooks: { type: 'array', items: { type: 'string' } } },
      required: ['hooks']
    }
  });

  return result.hooks || [];
}

/* ---------------------------------------------------------------- step 2 */

async function scoreHooks(seed, hooks) {
  const { poss, who } = hookPossessive(seed.voice);
  const prompt = [
    'You are a ruthless editor for a large astrology Instagram account.',
    '',
    `ANGLE: ${seed.brief}`,
    '',
    'Score each hook 1-10 on: would a person scrolling stop, feel personally',
    'called out, and tap to read more?',
    '',
    'Penalise heavily: generic phrasing that could describe anyone, therapy-speak,',
    'trying too hard to sound clever, abstract nouns, anything that reads like a',
    'greeting card or a self-help caption.',
    // The generator is now told to apply the 12-item test; the judge has to
    // enforce it or the best-sounding narrow hook still wins. Deliberately does
    // NOT reward generality — a vague hook must not beat a specific one here.
    '',
    // Same collision as in the generator: score down covers that put the reader
    // and the third-person subject in one sentence.
    poss === 'your'
      ? ''
      : `\nPRONOUN RULE: this post is about ${who}. Score 4 or lower any hook that says "your ${subjects[seed.subject].singular}" instead of "${poss} ${subjects[seed.subject].singular}", or that mixes the two — "The truth of her, based on your birth month" names two different people and does not say whose ${subjects[seed.subject].singular} decides it.`,
    `COVERAGE RULE: this carousel has ${seed.items.length} items (${seed.items.join(', ')}).`,
    'Score 4 or lower any hook naming a situation, a target or a condition that',
    'only SOME of those items could plausibly deliver on — a promise kept on most',
    'items and broken on the rest is broken, because each reader sees only the',
    'cover and their own item. This is not a reason to prefer vague hooks: a',
    'specific hook that holds for every item beats a general one every time.',
    'Reward: plainness, natural speech, an uncomfortable truth the reader can',
    'stand inside. A hook naming one person\'s private props (a landlord, a',
    'particular object) is worse than one naming a feeling everybody has had.',
    // The generator knew about the slide theme but the JUDGE did not, so it
    // kept crowning off-theme hooks — "your quiet way of leaving" won over
    // slides titled "January Girlfriend".
    seed.itemTitle && seed.itemTitle !== '{item}'
      ? `\nHARD RULE: the slides are titled "${seed.itemTitle.replace('{item}', seed.items[0])}", "${seed.itemTitle.replace('{item}', seed.items[1])}" and so on.\nA hook that does not set up that theme cannot score above 5, however good it reads alone. Cover and slides must be one post.`
      : '',
    // The judge crowned "What you lose when you lose her" over slides with no
    // loss in them. It has to see what the body actually delivers.
    seed.examples && seed.examples.length
      ? [
          '',
          'WHAT THE SLIDES ACTUALLY SAY — sample lines:',
          ...seed.examples.slice(0, 3).map((e) => `  ${e}`),
          '',
          'HARD RULE: score a hook 4 or lower if it promises something these',
          'lines do not deliver — a loss, an aftermath, a confession, a secret.',
          'The cover is a promise the slides have to keep.'
        ].join('\n')
      : '',
    '',
    'HOOKS:',
    ...hooks.map((h, i) => `${i}. ${h}`),
    '',
    'Return the index of the single best hook, its score, and one short reason.'
  ].join('\n');

  const schema = {
    type: 'object',
    properties: {
      best: { type: 'integer' },
      score: { type: 'number' },
      reason: { type: 'string' }
    },
    required: ['best', 'score', 'reason']
  };

  // Runs locally when a model is available. This step only picks an index from
  // a list — mechanical work a 3B model handles fine, and it was costing ~1,074
  // billed thinking tokens on the API to do it. Falls back automatically, so a
  // stopped Ollama never breaks a scheduled post.
  let result;
  let via = 'local';
  try {
    if (!(await localAvailable())) throw new Error('no local model');
    result = await generateLocal({ prompt, temperature: 0.2, schema });
  } catch {
    via = 'api';
    result = await generate({ prompt, temperature: 0.2, schema });
  }

  const index = Math.max(0, Math.min(hooks.length - 1, result.best));
  return { hook: hooks[index], score: result.score, reason: result.reason, via };
}

/* ---------------------------------------------------------------- step 3 */

/**
 * @param {string[]} [only] rewrite just these item names. A full rewrite to fix
 *   one bad sign cost as much as the original generation; this targets it.
 */
async function writeBodies(seed, hook, note, prior, only, keptLines) {
  const isBullets = seed.format === 'bullets';
  const targets = only && only.length ? only : seed.items;

  const shape = isBullets
    ? [
        `For each item write ${seed.bulletLabels ? seed.bulletLabels.length : seed.bulletCount} bullets.`,
        `Each bullet is ONE sentence under ${LIMITS.bullet} characters, able to stand alone.`,
        seed.anaphora
          ? seed.anaphora.includes('{item}')
            ? `EVERY bullet must begin with "${seed.anaphora}" where {item} is that slide's own name — so January's lines all open "${seed.anaphora.replace('{item}', seed.items[0])}" and February's all open "${seed.anaphora.replace('{item}', seed.items[1])}". Wrap that opening in ** ** so it renders bold. The repetition IS the format.`
            : `EVERY bullet must begin with the exact words "${seed.anaphora}". This repetition IS the format — it is deliberate, not lazy. Vary only what follows.`
          : '',
        // A fixed sequence of labelled bullets — the labels are the same on
        // every slide and always in the same order, only the content changes.
        seed.bulletLabels && seed.bulletLabels.length
          ? [
              `Each bullet is LABELLED. Use these labels, in this exact order, one per bullet:`,
              ...seed.bulletLabels.map((l, i) => `  ${i + 1}. **${l}** `),
              'Write the label in ** ** so it renders bold, then the content after it.',
              'The content is a short phrase, not a full sentence — no "You are", no "They".'
            ].join('\n')
          : '',
        seed.nameItemInCopy === true
          ? 'Begin each bullet with the item name itself, e.g. "Aries gives energy that never comes back". The repetition of the name is the format.'
          : ''
      ].filter(Boolean)
    : [
        // Frames were hardcoded to two sections. Several proven formats use
        // three — a want/have/lose arc, or gift/why/what-it-hides — so the
        // count now follows whatever the frame declares.
        `For each item write exactly ${seed.frame.length} sections, in this order:`,
        ...seed.frame.map((label, i) => `  Section ${i + 1} label: "${label}"`),
        seed.frameNote ? `LABELS: ${seed.frameNote}` : '',
        `Each section is a paragraph of 3-5 sentences, under ${LIMITS.section} characters.`
      ].filter(Boolean);

  const prompt = [
    houseStyle(),
    '',
    seedContext(seed),
    '',
    `COVER HOOK (already chosen — write to it): "${hook}"`,
    // "write to it" was too passive. The hook is the only thing the reader has
    // agreed to before they swipe, and a narrow hook is the GOOD kind — but a
    // scenario hook ("when they quiet down") was honoured on two items and
    // quietly dropped on the third, which wrote about fighting instead. Each
    // slide is read alone, so one drifting item breaks the post for that reader.
    'THE HOOK IS A CONTRACT. If it names a situation, a moment or a condition',
    '("when they go quiet", "after a fight", "the first time you say no"), then',
    'EVERY item must be written inside that same situation. An item that answers',
    'a different question has failed even if the lines are strong on their own.',
    'Before writing each item, re-read the hook and ask what it promised. If an',
    'item cannot honestly be written inside it, write the closest thing that can',
    'be — never substitute a different scenario.',
    '',
    seed.pattern
      ? [
          'SENTENCE PATTERN — every line must be built on this exact shape:',
          '  ' + seed.pattern,
          seed.patternNote ? '  ' + seed.patternNote : '',
          '',
          'Lines that hit it (do not reuse these, match their construction):',
          ...seed.examples.map((e) => '  ' + e),
          '',
          'A line that abandons the pattern to reach for a metaphor has failed,',
          'however poetic it sounds. The pattern is what carries the meaning.',
          ''
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    only && only.length
      ? `Rewrite ONLY these ${targets.length} item(s): ${targets.join(', ')}. Return just these, nothing else.`
      : `Write the body copy for all ${targets.length} items: ${targets.join(', ')}.`,
    // A partial rewrite was blind to the slides being KEPT, so a replacement
    // could collide with one it could not see — same opening, or an idea
    // already used elsewhere in the carousel. QA would catch it, but there is
    // only one retry, so it could ship.
    only && only.length && keptLines && keptLines.length
      ? [
          '',
          'These items are STAYING as they are. Your replacements must not repeat',
          'their openings or their ideas:',
          ...keptLines.map((k) => `  ${k.title}: "${k.line}"`)
        ].join('\n')
      : '',
    // BUG FIXED: itemTitle was computed into every seed but never reached this
    // prompt, so "{item} Girlfriend" angles silently titled every slide with
    // the plain sign name instead. The model gets no guidance without this line.
    seed.itemTitle && seed.itemTitle !== '{item}'
      ? `Each item's "title" must be EXACTLY "${seed.itemTitle}" with {item} replaced by that item's name. Do not add articles (no "A", no "The"), do not pluralise, do not reword.`
      : '',
    ...shape,
    '',
    'HARD REQUIREMENTS:',
    '- Every item must be genuinely different. Do not fill in a template.',
    seed.anaphora
      ? '- The fixed opening is required; make what FOLLOWS it different every time.'
      : '- Vary how items OPEN. Do not start more than two with the same two words.',
    '- No item may repeat a line or idea from another item.',
    seed.nameItemInCopy === true
      ? '- Name the item in every line, as instructed above.'
      : seed.nameItemInCopy === 'allow'
        ? '- You MAY name the sign or month inside the copy, but ONLY where the' +
          ' pattern says to. Everywhere else use a pronoun — naming it in every' +
          ' sentence reads like a stuck record.'
        : '- Do not mention the sign or month name inside the copy — the title says it.',
    '- Do not write a call to action. That is added separately.',
    '- For each item also return "idea": a 3-6 word label of that item\'s core' +
      ' thought, e.g. "pre-empts abandonment by leaving first". It is never shown' +
      ' to readers — it is how future posts avoid repeating this idea.',
    seed.quote
      ? [
          '- For each item also return "quote": one short punchy line in first' +
            ' person, as if the sign itself is speaking — under the title, above' +
            ' the bullets, in the sign\'s own defiant/confident voice. Under 60' +
            ' characters.',
          seed.quoteExamples && seed.quoteExamples.length
            ? '  Reference quotes: ' + seed.quoteExamples.map((q) => `"${q}"`).join('  /  ')
            : ''
        ].filter(Boolean).join('\n')
      : '',
    // Wording variety alone does not stop repetition — "I run ahead so no one
    // can leave me behind" and "I sprint forward so no one can see how tired I
    // am" are different sentences and the SAME idea. Each sign has one
    // dominant trope in training data and the model reaches for it regardless
    // of prompt phrasing unless it is explicitly forbidden by name.
    prior && Object.keys(prior).length
      ? '\nIDEAS ALREADY USED FOR THESE ITEMS — pick a genuinely DIFFERENT underlying' +
        ' idea for each, not a reworded version:\n' +
        Object.entries(prior)
          .map(([name, ideas]) => `  ${name}: ${ideas.map((g) => `"${g}"`).join('  /  ')}`)
          .join('\n')
      : '',
    note ? `\nPREVIOUS ATTEMPT FAILED: ${note}\nFix exactly these problems.` : ''
  ]
    .filter(Boolean)
    .join('\n');

  // `idea` is a 3-6 word self-label of the item's core thought. It costs a
  // handful of output tokens and makes the anti-repetition memory both more
  // precise (it targets the IDEA, not one sentence) and cheaper to feed back
  // in than storing whole lines.
  const ideaField = { idea: { type: 'string' } };
  // Only requested by angles that use it (angle.quote === true) — an italic
  // first-person line under the title, between the sign name and the
  // third-person bullets. Optional so every other angle stays at the same
  // token cost it already had.
  const quoteField = seed.quote ? { quote: { type: 'string' } } : {};

  const itemSchema = isBullets
    ? {
        type: 'object',
        properties: {
          title: { type: 'string' },
          ...ideaField,
          ...quoteField,
          bullets: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'idea', ...(seed.quote ? ['quote'] : []), 'bullets']
      }
    : {
        type: 'object',
        properties: {
          title: { type: 'string' },
          ...ideaField,
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: { label: { type: 'string' }, text: { type: 'string' } },
              required: ['label', 'text']
            }
          }
        },
        required: ['title', 'idea', 'sections']
      };

  const result = await generate({
    prompt,
    model: config.strongModel,
    temperature: 1.0,
    schema: {
      type: 'object',
      properties: { items: { type: 'array', items: itemSchema } },
      required: ['items']
    }
  });

  return (result.items || []).map(normaliseSectionLabels);
}

/**
 * Section labels are declared WITH a trailing colon ("On the outside:") but on
 * any voice other than `you` the frameNote asks the model to rewrite them, and
 * it reliably drops the colon — shipping "On the outside They go quiet" next to
 * the code-generated "Their Best Matches:" on the same slide. Enforced here
 * instead of asked for in the prompt: it costs no tokens and cannot regress.
 */
function normaliseSectionLabels(item) {
  if (!item || !Array.isArray(item.sections)) return item;
  return {
    ...item,
    sections: item.sections.map((s) => {
      const label = String(s.label || '').trim().replace(/[:\s]+$/, '');
      return { ...s, label: label ? `${label}:` : label };
    })
  };
}

/* ---------------------------------------------------------------- step 5 */

/**
 * Caption only — hashtags are built in code from the seed.
 *
 * The full houseStyle block is 608 tokens of universality examples, copy
 * devices and the banned list. A caption needs none of that; it needs the
 * voice basics. This trimmed version does the same job for a fraction of the
 * prompt.
 */
async function writeCaption(seed, hook, items) {
  // Showing the model actual lines from the post turns this from invention
  // into reaction, which is far easier work — the first local attempt failed
  // partly because it was given only the hook and had nothing to respond to.
  const sample = (items || [])
    .slice(0, 3)
    .map((it) => {
      const lines = it.bullets || (it.sections || []).map((s) => s.text);
      return lines && lines[0] ? `- ${lines[0]}` : null;
    })
    .filter(Boolean);

  const prompt = [
    'You write captions for an astrology Instagram account.',
    'Plain words. No therapy-speak, no motivational-poster language.',
    'No exclamation marks. One emoji maximum, at the end, optional.',
    '',
    `The carousel's cover reads: "${hook}"`,
    sample.length ? '\nLines from inside the post:' : '',
    ...sample,
    '',
    'Write a caption of 1-2 short lines that invites a comment or a save.',
    'Do not restate the hook. Do not write hashtags.'
  ]
    .filter(Boolean)
    .join('\n');

  const schema = {
    type: 'object',
    properties: { caption: { type: 'string' } },
    required: ['caption']
  };

  // Local first — this is short, reactive writing rather than the sustained
  // voice work of step 3. Falls back to the API so a stopped Ollama cannot
  // break a scheduled post.
  let result;
  let via = 'local';
  try {
    if (!(await localAvailable())) throw new Error('no local model');
    result = await generateLocal({ prompt, temperature: 0.8, schema });
    if (!result.caption || !result.caption.trim()) throw new Error('empty caption');
  } catch {
    via = 'api';
    result = await generate({ prompt, temperature: 0.8, schema });
  }

  // An average caption is fine; an off-brand one is not. The small model
  // reliably slips in exclamation marks and sometimes tacks on hashtags
  // despite being told not to, so both are stripped rather than retried.
  const caption = result.caption
    // Small models leak JSON punctuation into the string itself — one caption
    // came back as `What's your secret room? 💌}` with a trailing brace.
    .replace(/^[\s{}[\]"']+/, '')
    .replace(/[{}[\]"']+\s*$/, '')
    .replace(/#\w+/g, '')
    .replace(/!+/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();

  return { caption, hashtags: hashtagsFor(seed), via };
}

/* ------------------------------------------------------------------ chain */

/**
 * Idea-level repetition check.
 *
 * The text forbid-list stops the model reusing a phrasing it can see. This
 * catches the case it cannot: a genuinely different sentence carrying an idea
 * already used for that sign. Embeds this run's tags and compares each against
 * the stored vectors for the same item.
 *
 * Returns the vectors too, so a passing run records them without embedding twice.
 * Never throws — an embedding outage degrades to the text-only checks rather
 * than failing a scheduled post.
 */
async function checkSemantic(seed, items, priorVecs, log) {
  const empty = { problems: [], vectors: {}, failed: [] };
  if (!items || !items.length) return empty;

  const named = seed.items
    .map((name) => {
      const match = items.find((it) => (it.title || '').toLowerCase().includes(name.toLowerCase()));
      const idea = match && match.idea && match.idea.trim();
      return idea ? { name, idea } : null;
    })
    .filter(Boolean);

  if (!named.length) return empty;

  let vectors;
  try {
    vectors = await embedMany(named.map((n) => n.idea));
  } catch (err) {
    log(`memory  : embedding unavailable (${err.message.slice(0, 60)}) — text checks only`);
    return empty;
  }

  const problems = [];
  const failed = [];
  const out = {};
  named.forEach((entry, i) => {
    out[entry.name] = vectors[i];
    const hit = closestPrior(vectors[i], priorVecs[entry.name]);
    if (hit.similar) {
      problems.push(
        `"${entry.name}": idea "${entry.idea}" is ${hit.score.toFixed(2)} similar to one already used — needs a different thought, not different words`
      );
      failed.push(entry.name);
    }
  });

  return { problems, vectors: out, failed };
}

/**
 * @param {object} [opts] passed through to the seed roller, plus { verbose }
 * @returns {Promise<object>} content.json ready for compose.js
 */
async function generatePost(opts = {}) {
  const log = opts.verbose === false ? () => {} : (...a) => console.log(...a);
  const seed = opts.seed || roll(opts);  // opts.exclude flows straight through

  log(`seed    : ${seed.mood} · ${seed.angle} · ${seed.voice} · ${seed.subject} · ${seed.format}`);

  // 1 — over-generate
  const axis = subjects[seed.subject].singular;
  // The angle's own hand-written hook competes with the generated ones. It was
  // written by a person against a proven reference, and the generator was told
  // to "beat" it — which it does not always manage. Let the judge decide.
  const raw = [seed.hook, ...(await generateHooks(seed, axis))];
  // The axis rule is not a preference — a hook without it is unusable.
  const hooks = filterHooks(raw).filter((h) => hookNamesAxis(h, axis));
  log(`hooks   : ${raw.length} generated, ${hooks.length} kept (named "${axis}")`);
  if (!hooks.length) throw new Error('every generated hook was filtered out');

  // 2 — select
  const chosen = await scoreHooks(seed, hooks);
  log(`chosen  : "${chosen.hook}"  (${chosen.score}/10 via ${chosen.via} — ${chosen.reason})`);

  // 3 + 4 — write, check, retry once against the specific failures
  const prior = opts.fresh ? {} : priorIdeas(seed.angle, seed.subject, seed.items);
  if (Object.keys(prior).length) log(`memory  : forbidding ${Object.keys(prior).length} prior idea(s)`);

  const priorVecs = opts.fresh ? {} : priorVectors(seed.angle, seed.subject, seed.items);

  let items = await writeBodies(seed, chosen.hook, undefined, prior);
  let check = checkItems(items, { expectedCount: seed.items.length, anaphora: seed.anaphora, bulletLabels: seed.bulletLabels, examples: seed.examples });
  let semantic = await checkSemantic(seed, items, priorVecs, log);

  const allProblems = () => [...check.problems, ...semantic.problems];

  if (allProblems().length) {
    const problems = allProblems();

    // Rewrite only the broken items when the fault is item-level. Regenerating
    // all twelve to fix one sign cost as much as the original generation — the
    // retry was ~35% of a post's total tokens.
    const broken = [...new Set([...check.failed, ...semantic.failed])];
    const partial = !check.globalProblem && broken.length && broken.length < seed.items.length;

    log(
      `qa      : failed — ${problems.length} problem(s), rewriting ` +
        (partial ? `${broken.length}/${seed.items.length}: ${broken.join(', ')}` : 'all items')
    );
    problems.slice(0, 5).forEach((p) => log(`          · ${p}`));

    // First line of each slide being kept, so replacements can avoid colliding
    // with copy the rewrite cannot otherwise see.
    const keptLines = partial
      ? items
          .filter((it) => !broken.some((b) => (it.title || '').toLowerCase().includes(b.toLowerCase())))
          .map((it) => {
            const lines = it.bullets || (it.sections || []).map((s) => s.text);
            return lines && lines[0] ? { title: it.title, line: lines[0] } : null;
          })
          .filter(Boolean)
      : undefined;

    const rewritten = await writeBodies(
      seed,
      chosen.hook,
      problems.join('; '),
      prior,
      partial ? broken : undefined,
      keptLines
    );

    if (partial) {
      // Splice the rewrites in by name; anything the model failed to return
      // keeps its original version rather than vanishing from the carousel.
      const byName = new Map(
        rewritten.map((it) => [(it.title || '').toLowerCase(), it])
      );
      items = items.map((it) => {
        const name = broken.find((b) => (it.title || '').toLowerCase().includes(b.toLowerCase()));
        if (!name) return it;
        const replacement = [...byName.values()].find((r) =>
          (r.title || '').toLowerCase().includes(name.toLowerCase())
        );
        return replacement || it;
      });
    } else {
      items = rewritten;
    }

    check = checkItems(items, { expectedCount: seed.items.length, anaphora: seed.anaphora, bulletLabels: seed.bulletLabels, examples: seed.examples });
    semantic = await checkSemantic(seed, items, priorVecs, log);
  }
  log(
    allProblems().length === 0
      ? 'qa      : passed'
      : `qa      : still ${allProblems().length} problem(s) — review before posting`
  );

  // Whatever shipped becomes the thing future generations are forbidden from
  // repeating. Recorded even when QA has open issues — a repeated idea is a
  // failure mode of its own, independent of length/banned-phrase checks.
  // A throwaway test should not pollute the memory a real schedule relies on.
  if (!opts.fresh) recordIdeas(seed, items, semantic.vectors);

  // 5 — caption
  const { caption, hashtags, via: captionVia } = await writeCaption(seed, chosen.hook, items);
  log(`caption : via ${captionVia}`);

  return {
    // date+angle alone collides when one angle is rolled twice in a batch —
    // the second post silently overwrote the first.
    id: `${seed.date}-${seed.angle}-${seed.subject}`,
    seed: {
      angle: seed.angle,
      voice: seed.voice,
      subject: seed.subject,
      format: seed.format,
      date: seed.date
    },
    mood: seed.mood,
    hook: chosen.hook,
    hookScore: chosen.score,
    items,
    caption,
    hashtags,
    // Must report BOTH check sets. Reading only `check` marked posts "passed"
    // while the run log showed unresolved semantic problems — the saved record
    // disagreed with what actually happened.
    qa: allProblems().length === 0 ? 'passed' : allProblems(),
    _seed: seed
  };
}

// generateHooks/scoreHooks are exported for diagnostics — comparing the local
// judge against the API judge on an IDENTICAL hook list is the only way to tell
// whether the 3B model is picking well or just rubber-stamping.
module.exports = { generatePost, generateHooks, scoreHooks, writeCaption };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };

  (async () => {
    const started = Date.now();
    const post = await generatePost({
      mood: flag('mood'),
      angle: flag('angle'),
      voice: flag('voice'),
      subject: flag('subject'),
      format: flag('format'),
      date: flag('date'),
      fresh: argv.includes('--fresh')
    });

    const outDir = path.resolve(flag('out') || 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${post.id}.content.json`);

    const { _seed, ...clean } = post;
    fs.writeFileSync(file, JSON.stringify(clean, null, 2) + '\n');

    if (argv.includes('--record')) record(_seed);

    console.log(`caption : ${post.caption.replace(/\n/g, ' ')}`);
    console.log(`done    : ${((Date.now() - started) / 1000).toFixed(1)}s → ${file}`);
    console.log(`\nrender it:\n  node src/compose.js ${file} out`);
  })().catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
  });
}
