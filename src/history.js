/**
 * Per-item idea memory.
 *
 * Wording variety alone does not prevent repetition. "I run ahead so no one
 * can leave me behind" and "I sprint forward so no one can see how tired I
 * am" are different sentences and the SAME idea — Aries always picks the
 * fight, Virgo always fixes others, Scorpio always tests loyalty. That is a
 * training-data gravity well: it is each sign's single most reinforced trope,
 * and no amount of "be creative" prompting beats it on its own.
 *
 * The fix is a negative constraint with memory: record the core idea used for
 * each (angle, subject, item) the last few times, and forbid it explicitly on
 * the next generation. Wording variety still matters for polish, but this is
 * what actually stops the SAME thought recurring.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'seeds', 'idea-history.json');
const KEEP = 3; // ideas remembered per item — enough to forbid, small enough to stay cheap in the prompt

const norm = (s) => s.toLowerCase().trim();

function load() {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
}

function key(angle, subject, itemName) {
  return `${angle}|${subject}|${norm(itemName)}`;
}

/**
 * The item's core idea.
 *
 * Prefers the model's own `idea` label — a 3-6 word summary it returns
 * alongside the copy. That targets the THOUGHT rather than one sentence, which
 * matters because the repetition being prevented is at the idea level: "I run
 * ahead so no one can leave me behind" and "I sprint forward so no one sees how
 * tired I am" are different sentences carrying the same idea.
 *
 * Falls back to the first line for anything generated before the label existed.
 */
function gist(item) {
  if (item.idea && item.idea.trim()) return item.idea.trim();
  if (item.bullets && item.bullets.length) return item.bullets[0];
  if (item.sections && item.sections.length) {
    const text = item.sections[0].text || '';
    const firstSentence = text.split(/(?<=[.!?])\s/)[0];
    return firstSentence || text.slice(0, 90);
  }
  return null;
}

/**
 * Finds the generated item belonging to a subject item by NAME.
 *
 * Position-based pairing silently recorded ideas against the wrong sign
 * whenever the model reordered its output. Titles carry the item name even
 * when decorated ("I'm an Aries", "January Girlfriend"), so matching on a
 * contained name is both safer and tolerant of itemTitle patterns.
 */
function findItem(items, name) {
  const needle = norm(name);
  return items.find((it) => norm(it.title || '').includes(needle));
}

/**
 * @param {string[]} itemNames  the raw subject items, e.g. seed.items
 * @returns {Record<string, string[]>} item name -> prior ideas, only for items with history
 */
function priorIdeas(angle, subject, itemNames) {
  const data = load();
  const out = {};
  for (const name of itemNames) {
    const entries = data[key(angle, subject, name)];
    if (entries && entries.length) out[name] = entries.map((e) => e.gist);
  }
  return out;
}

/**
 * Same lookup, but returning the stored vectors for semantic comparison.
 * Entries recorded before embeddings existed have no vector and are skipped.
 *
 * @returns {Record<string, number[][]>} item name -> prior idea vectors
 */
function priorVectors(angle, subject, itemNames) {
  const data = load();
  const out = {};
  for (const name of itemNames) {
    const entries = data[key(angle, subject, name)] || [];
    const vecs = entries.map((e) => e.vec).filter(Boolean);
    if (vecs.length) out[name] = vecs;
  }
  return out;
}

/**
 * Records each generated item's idea against the subject item it belongs to,
 * matched by NAME. Items the model dropped are simply skipped; a partial
 * record is still useful, and no entry can land against the wrong sign.
 */
function recordIdeas(seed, items, vectors) {
  if (!items || !items.length) return;

  const data = load();
  seed.items.forEach((name) => {
    const match = findItem(items, name);
    if (!match) return;
    const g = gist(match);
    if (!g) return;

    const k = key(seed.angle, seed.subject, name);
    const entries = data[k] || [];
    const entry = { date: seed.date, gist: g };
    if (vectors && vectors[name]) entry.vec = vectors[name];
    entries.push(entry);
    data[k] = entries.slice(-KEEP);
  });
  save(data);
}

module.exports = { priorIdeas, priorVectors, recordIdeas };
