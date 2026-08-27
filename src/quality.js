/**
 * Deterministic quality checks.
 *
 * These run in code, not through the model. They are free, instant, and cannot
 * be talked out of a verdict. An AI judge costs a call and will happily miss
 * twelve slides that all open "You are allowed to" — a regex will not.
 */

const fs = require('fs');
const path = require('path');

const BANNED = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'seeds', 'banned.json'), 'utf8')
).phrases;

const LIMITS = {
  hook: 70,
  bullet: 80,
  section: 460,
  // Above this share of items opening with the same two words, the carousel
  // reads as a template being filled in rather than twelve separate thoughts.
  sameOpeningShare: 0.35
};

// Markdown bold is stripped first: the anaphora and bullet labels are wrapped
// in ** ** so they render bold, and leaving the asterisks in broke every
// ^-anchored match — a correct post failed all 12 slides.
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word-boundary matched, NOT substring. Plain `includes` flags "ick" inside
 * "quick", "thick" and "sick" — that fired twice on the first live run and
 * cost a needless rewrite call on copy that was fine.
 */
const BANNED_RE = BANNED.map((phrase) => ({
  phrase,
  re: new RegExp(`(^|[^a-z0-9])${escapeRe(norm(phrase))}(?![a-z0-9])`, 'i')
}));

function findBanned(text) {
  const haystack = norm(text);
  return BANNED_RE.filter(({ re }) => re.test(haystack)).map(({ phrase }) => phrase);
}

/** First two words, used to detect twelve slides built from one template. */
function opening(line) {
  return norm(line).split(' ').slice(0, 2).join(' ');
}

/**
 * @param {object[]} items  [{ title, bullets? , sections? }]
 * @returns {{ok: boolean, problems: string[], failed: string[], globalProblem: boolean}}
 *   `failed` lists the titles of individually-broken items, so a retry can
 *   rewrite only those. `globalProblem` means the fault is with the SET (wrong
 *   count, too many shared openings) and a partial rewrite cannot fix it.
 */
function checkItems(items, { expectedCount, anaphora, bulletLabels, examples, secondPerson } = {}) {
  const problems = [];
  // Titles of items that individually failed. A retry can regenerate only
  // these instead of all twelve — the full rewrite was costing as much as the
  // original generation to fix one sign.
  const failed = new Set();
  // Problems that are about the SET rather than one item (wrong count, too
  // many shared openings). These cannot be fixed by rewriting one item.
  let globalProblem = false;

  if (expectedCount && items.length !== expectedCount) {
    problems.push(`expected ${expectedCount} items, got ${items.length}`);
    globalProblem = true;
  }

  const allLines = [];
  const openings = [];

  for (const item of items) {
    const lines = item.bullets || (item.sections || []).map((s) => s.text);
    if (!lines || !lines.length) {
      problems.push(`"${item.title}" has no body copy`);
      failed.add(item.title);
      continue;
    }

    for (const line of lines) {
      allLines.push({ title: item.title, line });

      const limit = item.bullets ? LIMITS.bullet : LIMITS.section;
      if (line.length > limit) {
        problems.push(`"${item.title}": line is ${line.length} chars (limit ${limit})`);
        failed.add(item.title);
      }

      const hits = findBanned(line);
      if (hits.length) {
        problems.push(`"${item.title}": banned phrase ${hits.map((h) => `"${h}"`).join(', ')}`);
        failed.add(item.title);
      }
    }

    // Compare items by how they START — that is where templating shows.
    openings.push({ title: item.title, text: opening(lines[0]) });
  }

  // Repeated openings across items — unless the angle is BUILT on anaphora.
  // "You deserve to... You deserve to..." is a deliberate rhetorical device in
  // this niche, and one of the best-performing formats. Flagging it as
  // templating rejects proven content, so anaphora angles opt out.
  // "Templated" is a claim about REPETITION ACROSS items. With fewer than 2
  // items there is nothing to repeat against, but the share-based check does
  // not know that — 1/1 items "sharing" an opening with itself is 100% no
  // matter what was written, so it failed every single-item post generated
  // this way, and the rewrite it triggers can never satisfy it either. Found
  // by generating real single-item posts (a token-saving pattern used for
  // quick tests), not a synthetic case.
  if (openings.length > 1 && !anaphora && !(bulletLabels && bulletLabels.length)) {
    const total = openings.length;
    // Most items may keep the shared opening — only the surplus has to change.
    // Reporting this as a whole-set fault forced a full rewrite of all twelve
    // items to fix a handful, which cost as much as the original generation.
    const maxAllowed = Math.floor(LIMITS.sameOpeningShare * total);

    const byOpening = new Map();
    for (const { title, text } of openings) {
      if (!byOpening.has(text)) byOpening.set(text, []);
      byOpening.get(text).push(title);
    }

    for (const [text, titles] of byOpening) {
      if (titles.length <= maxAllowed) continue;

      // One spare beyond the strict surplus, so a replacement that happens to
      // reuse the phrase does not immediately re-trip the check.
      const surplus = Math.min(titles.length, titles.length - maxAllowed + 1);
      const offenders = titles.slice(-surplus);
      offenders.forEach((t) => failed.add(t));

      problems.push(
        `${titles.length}/${total} items open with "${text}" — too templated; ` +
          `give these a different opening: ${offenders.join(', ')}`
      );
    }
  }

  // When an angle IS built on anaphora, the device has to actually be there —
  // a half-hearted version reads as an accident rather than a choice.
  if (anaphora) {
    // The fixed opening can contain the item name — "I was born in January,
    // that's why" changes per slide — so it is matched as a pattern rather
    // than a literal string.
    const stem = norm(anaphora);
    const stemRe = new RegExp(
      '^' +
        stem
          .split('{item}')
          .map(escapeRe)
          .join('.+?')
          // "a/an" in the anaphora means the writer picks the right article —
          // "I am an Aries" vs "I am a Taurus" — so accept either.
          .replace(/a\\?\/an/g, 'an?'),
      'i'
    );
    for (const item of items) {
      const lines = item.bullets || (item.sections || []).map((s) => s.text);
      if (!lines || !lines.length) continue;
      const hits = lines.filter((l) => stemRe.test(norm(l))).length;
      if (hits / lines.length < 0.7) {
        problems.push(
          `"${item.title}": only ${hits}/${lines.length} lines start with "${anaphora}" — the device is the format`
        );
        failed.add(item.title);
      }
    }
  }

  // Identical lines reused between items.
  const seen = new Map();
  for (const { title, line } of allLines) {
    const key = norm(line);
    if (seen.has(key)) {
      problems.push(`"${title}" repeats a line from "${seen.get(key)}"`);
      failed.add(title);
    }
    else seen.set(key, title);
  }

  // Lines lifted from the angle's own reference examples. When the examples
  // happen to contain every section of one item, they add up to a complete
  // filled-in slide and the model replays it near-verbatim — that shipped a
  // 6/8 copy of a reference poster once already. Authoring the examples in a
  // scrambled order was supposed to prevent it and did not: three angles
  // written the same day the rule was documented still had whole items in
  // them, because scrambling the LABELS while reusing the same ITEMS leaves
  // the item complete. Checking the output is the only defence that holds.
  if (examples && examples.length) {
    const exNorm = examples.map(stripLabel);
    for (const { title, line } of allLines) {
      const candidate = stripLabel(line);
      if (candidate.length < 25) continue;
      const hit = exNorm.find((ex) => ex.length >= 25 && overlap(candidate, ex) >= 0.7);
      if (hit) {
        problems.push(
          `"${title}" reuses a reference example almost verbatim: "${line.slice(0, 60)}..."`
        );
        failed.add(title);
      }
    }
  }

  // Self-portrait angles drifting into lines addressed at an ex, or vice versa.
  // This is not a style nit: it silently converts one angle into another. A run
  // of i-dont-care-but came back with 23 of 28 lines aimed at a "you" when all
  // 12 reference lines have none, which made it never-say-out-loud with an
  // anaphora on top — and it dragged the cover along with it, because the copy
  // was suddenly about one relationship rather than about themselves.
  // 'sparse': a "you" is allowed but must stay incidental. thats-why,
  // im-a-sign-so and your-truth all have a few reference lines that mention
  // another person ("I catch your lie before you finish it") without being
  // addressed AT anyone — 3/33, 4/21 and 1/6, so 9-19%. Forbidding it outright
  // would reject their own reference material, but leaving them unguarded
  // invites the drift that turned i-dont-care-but into never-say-out-loud at
  // 82% addressed. The cap sits between the two.
  if (secondPerson === 'sparse') {
    const addressed = allLines.filter(({ line }) =>
      /\b(you|your|yours|you're|youre)\b/i.test(norm(line))
    );
    const share = allLines.length ? addressed.length / allLines.length : 0;
    if (share > 0.4) {
      problems.push(
        `${addressed.length}/${allLines.length} lines (${Math.round(share * 100)}%) speak to a "you" — ` +
          `this angle is a self-portrait that only glances at other people; keep it under 40%`
      );
      // Target the worst offenders so a partial rewrite can fix it.
      const byItem = new Map();
      for (const { title } of addressed) byItem.set(title, (byItem.get(title) || 0) + 1);
      [...byItem.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.ceil(items.length / 2))
        .forEach(([title]) => failed.add(title));
    }
  }

  if (secondPerson === 'forbidden' || secondPerson === 'required') {
    for (const { title, line } of allLines) {
      const has = /\b(you|your|yours|you're|youre)\b/i.test(norm(line));
      if (secondPerson === 'forbidden' && has) {
        problems.push(
          `"${title}" speaks to someone ("you") — this angle is a self-portrait: "${line.slice(0, 60)}"`
        );
        failed.add(title);
      } else if (secondPerson === 'required' && !has) {
        problems.push(
          `"${title}" does not address anyone — this angle is spoken to a person: "${line.slice(0, 60)}"`
        );
        failed.add(title);
      }
    }
  }

  return { ok: problems.length === 0, problems, failed: [...failed], globalProblem };
}

/** Drops a leading "Label:" so a section is compared on its prose alone. */
function stripLabel(line) {
  return norm(String(line).replace(/^[^:]{0,40}:\s*/, ''));
}

/**
 * Fraction of the shorter string's word 5-grams that appear in the other. Word
 * shingles rather than whole-string equality because the replay is never exact
 * — it comes back with "do not" for "don't" and one clause reworded.
 */
function overlap(a, b) {
  const grams = (s) => {
    const w = s.split(' ');
    const out = new Set();
    for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  const [small, big] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
  let shared = 0;
  for (const g of small) if (big.has(g)) shared++;
  return shared / small.size;
}

/**
 * @param {string[]} hooks
 * @returns {string[]} the hooks worth scoring — over-length and cliché ones are
 *   dropped before they cost a judging call.
 */
function filterHooks(hooks) {
  const seen = new Set();
  return hooks.filter((h) => {
    if (!h || h.length > LIMITS.hook) return false;
    if (findBanned(h).length) return false;
    const key = norm(h);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { checkItems, filterHooks, findBanned, BANNED, LIMITS };

/**
 * A hook must name what the carousel is indexed by.
 *
 * Every hook in the reference set does this without exception — "your birth
 * month", "based on your zodiac sign", "what each zodiac sign". A hook without
 * it leaves the reader unable to place themselves, and strips the astrology
 * signal the audience is scrolling for. The first live run produced "They went
 * to get water but you ended the relationship" — good line, unusable hook.
 *
 * @param {string} hook
 * @param {string} axis  the subject's singular noun, e.g. "zodiac sign"
 */
function hookNamesAxis(hook, axis) {
  const h = norm(hook);
  const a = norm(axis);
  if (h.includes(a)) return true;
  // Accept the plural and the bare head noun ("sign", "month").
  if (h.includes(a + 's')) return true;
  const head = a.split(' ').pop();
  return new RegExp(`(^|[^a-z])${escapeRe(head)}s?([^a-z]|$)`).test(h);
}

module.exports.hookNamesAxis = hookNamesAxis;

/**
 * Words that carry no promise, so naming them in a hook constrains nothing.
 * The axis words are added per call — "sign" and "month" are in every hook by
 * design and must never be treated as a theme.
 */
const HOOK_STOP = new Set(
  ('a an the and or but of to in on for as into about with without your you yours' +
    ' her his their they them each every what why how who when it its is are was' +
    ' be been being do does did not no never always still just only really that' +
    ' this these those based one ones thing things most more less than then so' +
    ' if because keeps keep always actually really side sides way ways').split(/\s+/)
);

/**
 * The PAYOFF of a hook: the thing after "as", "for" or "into". "What each
 * zodiac sign misreads as passion" promises passion specifically. That is the
 * position where a hook stops describing the angle and starts naming one
 * value — which is exactly where over-promising happens.
 *
 * @returns {string[]} candidate payoff terms, most significant first
 */
function hookPayoffTerms(hook, axis) {
  const h = norm(hook);
  const axisWords = new Set(norm(axis).split(' '));
  // 4 rather than 5: the payoff is very often a short word — fine, love, cold,
  // hurt, safe. "What each birth month claims is fine" was missed entirely
  // because "fine" fell under a 5-character floor.
  const usable = (w) => w.length >= 4 && !HOOK_STOP.has(w) && !axisWords.has(w);

  // Detected by NAMING CONSTRUCTION, not by position. Two earlier versions got
  // this wrong in opposite directions: scanning every long word flagged "Her
  // birth month, her private world" on a coincidental match, while checking
  // only "as|into|for" missed the live failure "What each zodiac sign calls a
  // spark" over slides landing on passion, devotion, connection and intimacy —
  // "calls a" is not a preposition, and that shape turned out to be the common
  // one rather than an edge case.
  //
  // These verbs all mean "the reader gives this thing a name", which is exactly
  // where a hook stops describing the angle and commits to one value.
  //
  // Only ASSERTIVE forms qualify — "says", never bare "say". The infinitive is
  // not a naming construction, and including it flagged two good hooks on the
  // trailing word alone: "The exact words to say to each zodiac sign tonight"
  // on "tonight", and "...to say when they quiet down" on "down".
  const m = h.match(
    /\b(?:as|into|for|calls?|calling|called|misreads?|misread|mistakes?|mistook|reads?|confuses?|claims?|claiming|says|insists?|pretends?|swears?)\s+(?:it\s+|a\s+|an\s+|the\s+|is\s+|was\s+|are\s+)?(.+)$/
  );
  return m ? m[1].split(' ').filter(usable) : [];
}

/** Loose match so "passion" finds "passions" and "passionate". */
function mentions(text, term) {
  const stem = term.replace(/(ing|ed|es|s)$/, '');
  return stem.length >= 4 && new RegExp(`\\b${escapeRe(stem)}`).test(text);
}

/**
 * Does the hook's promise actually appear across the slides?
 *
 * The failure this catches, seen live: hook "What each zodiac sign misreads as
 * passion" over slides ending "you call constant conflict PASSION" (Aries),
 * "you call your isolation SAFETY" (Taurus), "you call chaos CONNECTION"
 * (Gemini). One item in three delivered the promise, and the cover is simply
 * wrong for the other two — each reader only ever sees the cover plus their
 * own slide, so a hook kept on a third of items is broken for most of them.
 *
 * Prompt instructions could not fix this because both the hook writer and the
 * hook judge run BEFORE any slide exists; asking either to predict coverage is
 * guesswork, and it was wrong twice. This measures it after the fact instead.
 *
 * Zero coverage IS a failure here, which an earlier version got wrong. The
 * reasoning then was that the slides might be delivering the promise in
 * synonyms; the live case that followed was "calls a spark" over four items
 * that named passion, devotion, connection and intimacy, where zero mentions
 * of "spark" meant the hook was simply wrong rather than paraphrased. Because
 * the term is only extracted from an explicit naming construction — the hook
 * asserting the reader calls it X — an X that appears nowhere is the strongest
 * signal available, not the weakest.
 *
 * @returns {{ok: boolean, problem?: string, term?: string, hits?: number}}
 */
function checkHookCoverage(hook, items, axis) {
  if (!items || items.length < 3) return { ok: true };

  const bodies = items.map((it) =>
    norm(
      (it.bullets || []).join(' ') +
        ' ' +
        (it.sections || []).map((s) => stripLabel(s.text || '')).join(' ')
    )
  );

  const half = Math.ceil(items.length / 2);
  for (const term of hookPayoffTerms(hook, axis)) {
    const hits = bodies.filter((b) => mentions(b, term)).length;
    if (hits < half) {
      return {
        ok: false,
        term,
        hits,
        problem:
          `hook promises "${term}" but only ${hits}/${items.length} items deliver it — ` +
          `the cover is wrong for the rest`
      };
    }
  }
  return { ok: true };
}

module.exports.checkHookCoverage = checkHookCoverage;
module.exports.hookPayoffTerms = hookPayoffTerms;
