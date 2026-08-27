/**
 * Picks the concrete trait an item is written around, and remembers what was
 * picked so the next post doesn't reach for the same one.
 *
 * Different from imagery.js on purpose: imagery.js SUPPRESSES a repeat after
 * the fact (the model writes freely, then gets told what it already used).
 * This picks BEFORE writing — the model never free-associates into "fire" in
 * the first place, because it is handed a specific, different trait to build
 * around. Suppression narrows a bad default; this replaces it with material.
 *
 * Selection is random-excluding-recent, the same shape as the angle cooldown
 * in seed.js: filter out what was used in the last KEEP posts, pick randomly
 * from what's left, fall back to the full pool if that empties it out.
 */
const fs = require('fs');
const path = require('path');

const FACETS_FILE = path.join(__dirname, '..', 'seeds', 'facets.json');
const HISTORY_FILE = path.join(__dirname, '..', 'seeds', 'facet-history.json');
const KEEP = 4;

const norm = (s) => s.toLowerCase().trim();

function loadFacets() {
  return JSON.parse(fs.readFileSync(FACETS_FILE, 'utf8'));
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2) + '\n');
}

/**
 * @param {string} sign     e.g. "Aries" — must have an entry in facets.json
 * @param {string} mood     the post's mood; only facets tagged with it qualify
 * @returns {{facet: string}|null} null if this sign has no facet data, or
 *   none of its facets fit this mood
 */
function pickFacet(sign, mood) {
  const table = loadFacets();
  const all = table[sign];
  if (!all || !all.length) return null;

  const fits = all.filter((f) => f.moods.includes(mood));
  if (!fits.length) return null;

  const history = loadHistory();
  const recent = new Set((history[norm(sign)] || []).slice(-KEEP).map((e) => norm(e.facet)));
  const fresh = fits.filter((f) => !recent.has(norm(f.facet)));
  const pool = fresh.length ? fresh : fits;

  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Called AFTER a successful generation with the facet that was actually used
 * — unlike imagery.js, nothing is inferred from output, so this never fails
 * to record just because the model phrased something unexpectedly.
 */
function recordFacet(sign, facet, date) {
  const history = loadHistory();
  const k = norm(sign);
  const entries = history[k] || [];
  entries.push({ date, facet });
  history[k] = entries.slice(-KEEP);
  saveHistory(history);
}

module.exports = { pickFacet, recordFacet };
