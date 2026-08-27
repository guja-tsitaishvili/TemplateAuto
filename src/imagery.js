/**
 * Cross-angle memory for the concrete IMAGE a sign gets written as — fire,
 * battle, wall — as opposed to seeds/history.js, which remembers the
 * psychological IDEA and is scoped per angle.
 *
 * The two are different bugs. Comparing two real generations for Aries:
 *   your-dark-gift  idea "destroys peace to force movement"
 *   your-karma      idea "creates emergencies to feel necessary"
 * Different ideas by the model's own label — history.js would not flag this
 * pair even scoped globally. What actually repeated was the imagery: both
 * reached for fire and battle, because that is Aries' single most reinforced
 * trope in training data and "do not mention the sign name" (so the model
 * cannot lean on the word "Aries" itself) pushes it straight at the next
 * strongest association instead. That association is the same regardless of
 * which angle is asking, so this has to be tracked without the angle in the
 * key — the opposite scoping from history.js, on purpose.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'seeds', 'imagery-history.json');
const KEEP = 4;

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

// No angle in the key — that is the entire point of this file existing
// alongside history.js rather than inside it.
function key(subject, itemName) {
  return `${subject}|${norm(itemName)}`;
}

/** @returns {Record<string, string[]>} item name -> recent images, any angle */
function priorImages(subject, itemNames) {
  const data = load();
  const out = {};
  for (const name of itemNames) {
    const entries = data[key(subject, name)];
    if (entries && entries.length) out[name] = entries.map((e) => e.image);
  }
  return out;
}

function findItem(items, name) {
  const needle = norm(name);
  return items.find((it) => norm(it.title || '').includes(needle));
}

/** Mirrors history.js recordIdeas: matched by name, skips items the model dropped. */
function recordImages(seed, items) {
  if (!items || !items.length) return;
  const data = load();
  seed.items.forEach((name) => {
    const match = findItem(items, name);
    const image = match && match.image && match.image.trim();
    if (!image) return;
    const k = key(seed.subject, name);
    const entries = data[k] || [];
    entries.push({ date: seed.date, image });
    data[k] = entries.slice(-KEEP);
  });
  save(data);
}

module.exports = { priorImages, recordImages };
