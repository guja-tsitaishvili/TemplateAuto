/**
 * Picks one decoration for a post's cover, from designpics/catalog.json.
 *
 * Design is the part hardest to get right by rule, so this never ships
 * unreviewed — see preview.js, which renders WITH and WITHOUT this pick
 * side by side so a person chooses. This module only has to produce one
 * reasonable candidate, not a correct one.
 */
const fs = require('fs');
const path = require('path');
const { getTheme } = require('./themes');

const CATALOG_PATH = path.join(__dirname, '..', 'designpics', 'catalog.json');

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

// coverAlign says which side the TITLE sits on. Art goes in a corner on the
// opposite side so the two never compete for the same half of the poster.
// 'center' (sage) has no opposite side, so any corner is fine, and 'ground'
// (bottom, centred) is fine against any coverAlign — the title is vertically
// centred with real margin, not anchored to the bottom.
const OPPOSITE = { left: 'right', right: 'left' };

/**
 * @param {string} mood      love | positive | negative | toxic
 * @param {string} themeName a theme from themes/*.json
 * @returns {{src: string, at: string, size: number, bleed: number}|null}
 *   null when the theme declines art (allowArt: false) or nothing matches.
 */
function pickArt(mood, themeName) {
  const theme = getTheme(themeName);
  if (!theme.allowArt) return null;

  const catalog = loadCatalog();
  const pool = Object.entries(catalog).filter(
    ([, e]) => e.category !== 'sprite-sheet' && e.moods && e.moods.includes(mood)
  );
  if (!pool.length) return null;

  const [, entry] = pool[Math.floor(Math.random() * pool.length)];

  // Prefer a ground placement when this piece has one — it reads as the
  // object resting on a surface rather than bleeding off a poster corner,
  // and it works regardless of which side the title sits on.
  const wantSide = OPPOSITE[theme.coverAlign] || null;
  const cornerZones = entry.zones.filter((z) => z !== 'bottom');
  const sideMatch = wantSide ? cornerZones.filter((z) => z.includes(wantSide)) : [];

  let at;
  if (entry.zones.includes('bottom') && Math.random() < 0.5) at = 'bottom';
  else if (sideMatch.length) at = sideMatch[Math.floor(Math.random() * sideMatch.length)];
  else at = cornerZones[Math.floor(Math.random() * cornerZones.length)] || entry.zones[0];

  // Ground placement sits directly under a title that is vertically CENTRED
  // and can run 3-4 lines — a render check at medium size put grapes right
  // across the last line of a real hook. A corner only competes with the
  // half of the poster on its own side, so it can stay at medium; centred
  // ground has no side to hide on and needs to stay small.
  const size = at === 'bottom' ? entry.sizes.small : entry.sizes.medium;

  return { src: entry.file, at, size, bleed: 8 };
}

module.exports = { pickArt, loadCatalog };
