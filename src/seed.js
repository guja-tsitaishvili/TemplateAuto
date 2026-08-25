#!/usr/bin/env node
/**
 * The seed roller.
 *
 * Asking a model for "a viral hook" samples the middle of everything it has
 * read, which is the definition of generic. So nothing is left to the model's
 * imagination at this stage: a specific combination is rolled FIRST, and the
 * model only writes to that brief.
 *
 * A seed is angle x voice x subject x format x frame x hook pattern. Angles
 * declare which moods and voices they support, so no invalid combination can
 * be produced — "your addiction" never gets rolled as a love post.
 *
 * CLI:
 *   node src/seed.js                        one seed
 *   node src/seed.js --mood toxic --count 5
 *   node src/seed.js --date 2026-08-23      deterministic for a given day
 *   node src/seed.js --record               append to the used log
 *   node src/seed.js --stats                combination count and coverage
 */

const fs = require('fs');
const path = require('path');

const SEED_DIR = process.env.SEEDS_DIR || path.join(__dirname, '..', 'seeds');
const USED_FILE = path.join(SEED_DIR, 'used.json');

const read = (name) => JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), 'utf8'));

const angles = read('angles.json');
const subjects = read('subjects.json');
const voices = read('voices.json');

/** Deterministic PRNG, so a given date always rolls the same seed. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/**
 * How likely an angle is to be rolled.
 *
 * An angle with a `pattern` carries an explicit sentence machine and reliably
 * produces good copy; one with only a `brief` reaches for metaphor and often
 * produces lines that sound meaningful and mean nothing. Treating them as
 * equally likely meant 86% of posts drew from the weaker half.
 *
 * Derived rather than stored, so adding a pattern promotes an angle
 * automatically — no second list to keep in sync. Override per angle with an
 * explicit `weight`.
 */
function angleWeight(angle) {
  if (typeof angle.weight === 'number') return angle.weight;
  return angle.pattern ? 4 : 1;
}

/** Picks from a list of angle ids, favouring patterned ones. */
function pickAngle(rng, ids, table) {
  const total = ids.reduce((sum, id) => sum + angleWeight(table[id]), 0);
  let roll = rng() * total;
  for (const id of ids) {
    roll -= angleWeight(table[id]);
    if (roll <= 0) return id;
  }
  return ids[ids.length - 1];
}

/**
 * Resolves `anaphora`, which can be a bare string, a {subject: value} map, or
 * have an array at either level to roll a phrasing from.
 */
function resolveAnaphora(raw, subjectId, rng) {
  let value = raw;
  if (value && typeof value === 'object' && !Array.isArray(value)) value = value[subjectId];
  if (Array.isArray(value)) value = pick(rng, value);
  return value || null;
}

/** Picks a subject id honouring its `weight` (default 1). */
function pickWeighted(rng, table) {
  const names = Object.keys(table).filter((n) => !table[n].disabled);
  const total = names.reduce((sum, n) => sum + (table[n].weight || 1), 0);
  let roll = rng() * total;
  for (const n of names) {
    roll -= table[n].weight || 1;
    if (roll <= 0) return n;
  }
  return names[names.length - 1];
}

/**
 * Placeholders are resolved from the VOICE (pronouns) and the SUBJECT (noun).
 * Hooks are already stored per voice, so the pronoun in a hook is always the
 * right one for that voice — it only needs substituting, not choosing.
 */
function resolve(str, { subject, voice, item }) {
  const p = voices[voice].pronouns;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  return str
    .replace(/\{singular\}/g, subject.singular)
    .replace(/\{each\}/g, subject.each)
    .replace(/\{item\}/g, item || '{item}')
    .replace(/\{subj\}/g, p.subject)
    .replace(/\{Subj\}/g, cap(p.subject))
    .replace(/\{obj\}/g, p.object)
    .replace(/\{Obj\}/g, cap(p.object))
    .replace(/\{poss\}/g, p.possessive)
    .replace(/\{Poss\}/g, cap(p.possessive))
    // Voice-scoped aliases: a hook written for "her" says {her}, one written
    // for "you" says {your}. Both mean "this voice's possessive".
    .replace(/\{your\}|\{her\}|\{his\}|\{their\}/g, p.possessive)
    .replace(/\{she\}|\{he\}|\{they\}/g, p.subject)
    .replace(/\{She\}|\{He\}|\{They\}/g, cap(p.subject))
    .replace(/\{Her\}|\{His\}|\{Their\}/g, cap(p.possessive));
}

function loadUsed() {
  if (!fs.existsSync(USED_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USED_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function comboKey(s) {
  return `${s.angle}|${s.voice}|${s.subject}`;
}

/**
 * @param {object} [opts]
 *   mood       restrict to angles supporting this mood
 *   angle/voice/subject/format   pin any axis
 *   date       'YYYY-MM-DD' — deterministic roll for that day
 *   seed       explicit numeric seed
 *   avoidDays  skip combinations used within this many days (default 60)
 */
function roll(opts = {}) {
  const rng =
    opts.seed != null
      ? mulberry32(opts.seed)
      : opts.date
        ? mulberry32(hashString(opts.date))
        : Math.random;

  let candidates = Object.keys(angles);
  if (opts.angle) {
    candidates = candidates.filter((a) => a === opts.angle);
  } else {
    candidates = candidates.filter((a) => !angles[a].disabled);
  }
  // Angles already used in THIS run. The cooldown reads the recorded log, so a
  // batch that is not being recorded would otherwise repeat itself.
  if (opts.exclude && opts.exclude.length && candidates.length > opts.exclude.length) {
    candidates = candidates.filter((a) => !opts.exclude.includes(a));
  }
  if (opts.mood) candidates = candidates.filter((a) => angles[a].moods.includes(opts.mood));
  if (opts.voice) candidates = candidates.filter((a) => angles[a].voices.includes(opts.voice));
  if (opts.format) candidates = candidates.filter((a) => angles[a].formats.includes(opts.format));
  if (opts.subject) {
    candidates = candidates.filter((a) => !angles[a].subjects || angles[a].subjects.includes(opts.subject));
  }

  if (!candidates.length) {
    throw new Error(`no angle matches those constraints (${JSON.stringify(opts)})`);
  }

  const used = loadUsed();

  // An angle is the IDEA of a post. Coming back to the same idea with a
  // different voice or subject still reads as a repeat, so the cooldown counts
  // POSTS and ignores the other axes — otherwise "how you test people" and
  // "how he tests her" can land the same afternoon.
  //
  // Measured in posts rather than days because cadence varies: 60 posts is twelve
  // days at 5/day and two months at 1/day, which is the right shape either way.
  //
  // Scaled to HALF the available pool rather than hardcoded, because the two
  // numbers have to move together. A flat 60 was fine against 143 angles; once
  // the unpatterned ones were parked the pool dropped to 63 and a 60-post
  // cooldown left just 3 fresh candidates, which turns the roller into a fixed
  // cycle. Half the pool keeps roughly half of it eligible at any time, and it
  // scales back up on its own as angles are re-enabled.
  const cooldown =
    opts.angleCooldown == null ? Math.min(60, Math.floor(candidates.length / 2)) : opts.angleCooldown;
  if (cooldown > 0 && candidates.length > 1) {
    const cooling = new Set(used.slice(-cooldown).map((u) => u.angle));
    const fresh = candidates.filter((a) => !cooling.has(a));
    // A shallow bank can cool down everything; a repeat beats a crash.
    if (fresh.length) candidates = fresh;
  }
  const cutoff = Date.now() - (opts.avoidDays == null ? 60 : opts.avoidDays) * 86400000;
  const recentEntries = used.filter((u) => new Date(u.date).getTime() >= cutoff);
  const recent = new Set(recentEntries.map(comboKey));
  // Two different combinations can render the SAME hook when the pattern has no
  // {singular} in it — different slide content, word-for-word identical cover.
  // The reader only sees the cover, so the text has to be deduped too.
  const recentHooks = new Set(recentEntries.map((u) => u.hook));

  let built = null;
  // Re-roll past recently-used combinations; fall back to the last attempt
  // rather than failing, so a saturated bank still produces something.
  for (let attempt = 0; attempt < 60; attempt++) {
    const angleId = pickAngle(rng, candidates, angles);
    const angle = angles[angleId];

    const voice = opts.voice || pick(rng, angle.voices);
    if (!angle.hooks[voice]) continue;

    // Weighted, not uniform: the 12-item subjects are the staple and the
    // 4-5 item ones are variety. Uniform picking produced a whole batch of
    // short carousels and no staple format at all.
    //
    // Some angles only make grammatical sense on one subject — "I'm an Aries
    // so..." works, "I'm a January so..." does not. angle.subjects restricts
    // the pool before picking rather than the copy silently reading wrong.
    const subjectTable = angle.subjects
      ? Object.fromEntries(angle.subjects.map((s) => [s, subjects[s]]))
      : subjects;
    const subjectId = opts.subject || pickWeighted(rng, subjectTable);
    const subject = subjects[subjectId];
    const format = opts.format || pick(rng, angle.formats);

    const ctx = { subject, voice };
    const frame = pick(rng, angle.frames).map((f) => resolve(f, ctx));
    // itemTitle can be a bare string, a {voice: ...} map, or an array of
    // alternatives at either level. A bare string with no variation meant
    // EVERY carousel on an angle titled its slides identically forever — "I'm
    // an Aries" on every single post, no matter how many times it ran.
    let itemTitleRaw = angle.itemTitle;
    if (itemTitleRaw && typeof itemTitleRaw === 'object' && !Array.isArray(itemTitleRaw)) {
      itemTitleRaw = itemTitleRaw[voice];
    }
    if (Array.isArray(itemTitleRaw)) itemTitleRaw = pick(rng, itemTitleRaw);

    built = {
      angle: angleId,
      voice,
      subject: subjectId,
      format,
      mood: opts.mood || pick(rng, angle.moods),
      hook: resolve(pick(rng, angle.hooks[voice]), ctx),
      brief: angle.brief,
      voiceGuidance: voices[voice].guidance,
      frame,
      // "How You Grieve:" -> "How She Grieves:" needs verb agreement, which a
      // string substitution gets wrong. The labels are templates; the writing
      // step conjugates them.
      frameNote:
        voice === 'you'
          ? null
          : `Rewrite these labels for the "${voice}" voice, keeping their meaning and length.`,
      // Per-angle format switches, all optional:
      //   anaphora        every line opens with this phrase (deliberate device)
      //   bulletCount     reference set runs 5-11, not always 5
      //   nameItemInCopy  some formats repeat the sign name in every line
      // A brief says WHAT to write about. A pattern says what SHAPE the
      // sentence takes. Without the shape the model reaches for metaphor and
      // produces lines that sound meaningful and mean nothing.
      pattern: angle.pattern || null,
      patternNote: angle.patternNote || null,
      examples: angle.examples || null,
      // Can be a string, a {subject: ...} map, or either level can hold an
      // ARRAY of phrasings to roll from — the same account rotates catchphrase
      // wording ("that is why" vs "of course") over the same self-contradiction
      // content rule, and forcing one fixed phrase per subject was less true to
      // the source than the reference posts actually are.
      anaphora: resolveAnaphora(angle.anaphora, subjectId, rng),
      // Accepts a number or a list to roll from. The reference posts vary
      // within a single format - Girlfriend runs 6,6,6,7 and I-deserve runs
      // 7,5,6 - so a fixed count is less true to the source than a range.
      bulletCount: Array.isArray(angle.bulletCount)
        ? pick(rng, angle.bulletCount)
        : angle.bulletCount || 5,
      // true    = name the item in EVERY line (the repetition is the format)
      // 'allow' = the pattern says where; used by 4-section prose profiles that
      //           sign off a section with "Virgo doesn't flirt. Virgo helps."
      nameItemInCopy: angle.nameItemInCopy || false,
      // Index into cta.json. The reference set inflects the promo line per
      // format — "Secret Love Match:" on the secret-desire carousels, "Her
      // Best Matches:" on the her-voice ones — so an angle can pin its own.
      // Undefined leaves compose.js on the default variant.
      cta: angle.cta,
      // Opts each item into a generated first-person quote line under the
      // title — "I don't have an attitude, I have a personality you can't
      // handle." Off by default; only angles that declare it pay the cost.
      quote: angle.quote === true,
      quoteExamples: angle.quoteExamples || null,
      // A fixed sequence of bold labels, identical on every slide. Resolved
      // through the same placeholders as frames, so one angle can serve both
      // voices — "What She Hides:" for her, "What He Hides:" for him.
      bulletLabels: angle.bulletLabels ? angle.bulletLabels.map((l) => resolve(l, ctx)) : null,
      items: subject.items,
      itemTitle: itemTitleRaw || '{item}',
      date: opts.date || new Date().toISOString().slice(0, 10)
    };

    if (!recent.has(comboKey(built)) && !recentHooks.has(built.hook)) return built;
  }

  return built;
}

/** Appends a rolled seed to the used log so it is not repeated. */
function record(seed) {
  const used = loadUsed();
  used.push({
    date: seed.date,
    angle: seed.angle,
    voice: seed.voice,
    subject: seed.subject,
    hook: seed.hook
  });
  fs.writeFileSync(USED_FILE, JSON.stringify(used, null, 2) + '\n');
  return used.length;
}

function stats() {
  let combos = 0;
  const byMood = {};
  const subjectCount = Object.keys(subjects).filter((n) => !subjects[n].disabled).length;

  for (const [id, a] of Object.entries(angles)) {
    if (a.disabled) continue;
    const voicesWithHooks = a.voices.filter((v) => a.hooks[v]);
    const n = voicesWithHooks.length * subjectCount * a.formats.length;
    combos += n;
    for (const m of a.moods) byMood[m] = (byMood[m] || 0) + n;
    if (voicesWithHooks.length !== a.voices.length) {
      console.warn(`  ! ${id}: declares voices without hooks`);
    }
  }
  return { angles: Object.keys(angles).length, subjects: subjectCount, combos, byMood };
}

module.exports = { roll, record, stats, angles, subjects, voices };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };

  if (argv.includes('--stats')) {
    const s = stats();
    console.log(`${s.angles} angles x ${s.subjects} subjects`);
    console.log(`${s.combos} valid combinations`);
    for (const [m, n] of Object.entries(s.byMood)) console.log(`  ${m.padEnd(9)} ${n}`);
    process.exit(0);
  }

  const count = Number(flag('count') || 1);
  for (let i = 0; i < count; i++) {
    const seed = roll({
      mood: flag('mood'),
      angle: flag('angle'),
      voice: flag('voice'),
      subject: flag('subject'),
      format: flag('format'),
      date: flag('date')
    });
    console.log(`\n─── ${seed.mood} · ${seed.angle} · ${seed.voice} · ${seed.subject} · ${seed.format}`);
    console.log(`HOOK   ${seed.hook}`);
    console.log(`FRAME  ${seed.frame.join('  /  ')}`);
    console.log(`BRIEF  ${seed.brief}`);
    if (argv.includes('--record')) record(seed);
  }
}
