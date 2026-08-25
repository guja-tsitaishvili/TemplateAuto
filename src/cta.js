/**
 * The promo line that closes every content slide.
 *
 * It is always rendered, so the space it occupies is part of the layout rather
 * than something that appears and disappears between slides. Edit
 * `cta.json` to change the wording or add variants.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'cta.json');

let cache = null;

function load() {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return cache;
}

/**
 * @param {number|string|object|false} pick
 *   - undefined  → the default variant
 *   - number     → index into cta.json variants
 *   - string     → used verbatim as the text, no label
 *   - object     → { label, text } used as-is
 *   - false      → no CTA on this slide
 * @returns {{label?: string, text: string}|null}
 */
function resolveCta(pick) {
  if (pick === false) return null;

  const config = load();

  if (pick && typeof pick === 'object') return pick;
  if (typeof pick === 'string') return { text: pick };

  const index = typeof pick === 'number' ? pick : config.default || 0;
  const variant = config.variants[index];
  if (!variant) {
    throw new Error(
      `cta index ${index} not found; cta.json has ${config.variants.length} variants`
    );
  }
  return variant;
}

module.exports = { resolveCta };
