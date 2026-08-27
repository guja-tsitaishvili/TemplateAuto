#!/usr/bin/env node
/**
 * Merges hard geometry (tools/geometry.json, computed) with authored identity
 * (tools/catalog-authored.json, a human/reviewer looked at each picture) into
 * designpics/catalog.json, and renames the Gemini-export filenames to the
 * simple names.
 *
 * Split this way on purpose: geometry can be recomputed any time new art
 * lands, by running tools/geometry.js again. Identity (what a thing IS, what
 * mood it fits) cannot be computed — it has to be looked at once and is then
 * permanent, so it lives in its own small file instead of being regenerated
 * and lost.
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const DIR = path.join(P, 'designpics');

const geometry = JSON.parse(fs.readFileSync(path.join(__dirname, 'geometry.json'), 'utf8'));
const authored = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-authored.json'), 'utf8'));
const CATALOG_PATH = path.join(DIR, 'catalog.json');
const catalog = fs.existsSync(CATALOG_PATH) ? JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) : {};

/**
 * Which corners a piece can physically be placed in. A floating object (no
 * edge touched) can bleed off any corner. A piece cut at one edge only makes
 * sense bleeding off THAT edge — a chain cut at the top of its own canvas is
 * a chain hanging from above; used bottom-left it would read as broken art,
 * not as artwork bleeding off the poster.
 */
// Categories that don't make sense resting on a surface: a hand is attached
// to an arm that isn't in frame, so it floating at bottom-centre reads as
// disembodied rather than grounded; an emblem (the sunburst) is a flat motif,
// not an object with a base; the wing is a single feather study, not a
// creature that stands. Everything else — skeleton, serpent, scorpion, skull,
// flora, the amphora, the candle — plausibly sits on a ground line.
const NOT_GROUNDED_CATEGORY = new Set(['hand', 'emblem']);
const NOT_GROUNDED_NAME = new Set(['wing']);

function zonesFor(touches, meta) {
  const sides = Object.entries(touches).filter(([, v]) => v).map(([k]) => k);
  // 'center' was in this list originally and it was wrong: a render check put
  // hands-reaching dead centre on a cover and it sat directly under the title,
  // because the template centres cover text both ways. Corners are the only
  // zone the renderer keeps clear of text — there is no text-safe centre.
  //
  // 'bottom' (bare, not 'bottom-left'/'bottom-right') is different: the
  // renderer already centres it horizontally and bleeds ONLY the bottom edge,
  // which reads as the object resting on a ground line rather than sitting
  // in the dead centre of the poster. Safe because covers keep their text
  // block vertically centred with real margin above and below it — confirmed
  // by rendering a 4-line hook against it before relying on that (see the
  // ground-placement render check).
  if (!sides.length) {
    const zones = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    const grounded =
      meta && !NOT_GROUNDED_CATEGORY.has(meta.category) && !NOT_GROUNDED_NAME.has(meta.name);
    if (grounded) zones.push('bottom');
    return zones;
  }
  const zones = new Set();
  for (const side of sides) {
    if (side === 'left') { zones.add('top-left'); zones.add('bottom-left'); }
    if (side === 'right') { zones.add('top-right'); zones.add('bottom-right'); }
    if (side === 'top') { zones.add('top-left'); zones.add('top-right'); }
    if (side === 'bottom') { zones.add('bottom-left'); zones.add('bottom-right'); }
  }
  // A piece cut ONLY at the bottom of its own canvas (a stem sliced at the
  // base) is already a thing rising from a ground line — centred-bottom is a
  // BETTER fit for it than either corner, not just an additional option.
  if (sides.length === 1 && sides[0] === 'bottom') {
    const grounded =
      meta && !NOT_GROUNDED_CATEGORY.has(meta.category) && !NOT_GROUNDED_NAME.has(meta.name);
    if (grounded) zones.add('bottom');
  }
  return [...zones];
}

/**
 * Three size presets as a percentage of POSTER WIDTH (matches the existing
 * `size` field on a decoration). The cap on "big" is derived from the piece's
 * own aspect ratio, not fixed, because `size` only constrains width — an
 * asset far taller than it is wide would blow past a safe height at a flat
 * 48% for everyone. Poster is a 4:5 card; a decoration is kept under ~40% of
 * poster HEIGHT at its largest so it can never dominate a slide on its own.
 */
function sizesFor(box) {
  const posterAspect = 4 / 5; // width / height
  const pieceAspect = box.w / box.h; // width / height
  const maxHeightShare = 0.4;
  // size% such that (size/100 * posterW) / pieceAspect <= maxHeightShare * posterH
  // => size <= maxHeightShare * pieceAspect * (posterH/posterW) * 100
  const cap = Math.round(maxHeightShare * pieceAspect * (1 / posterAspect) * 100);
  const big = Math.max(24, Math.min(52, cap));
  return {
    small: Math.round(big * 0.4),
    medium: Math.round(big * 0.68),
    big
  };
}

let renamed = 0;
let added = 0;

for (const g of geometry) {
  const meta = authored[g.file];
  if (!meta) {
    console.warn(`WARN no authored entry for ${g.file} — skipping, add it to catalog-authored.json`);
    continue;
  }
  if (meta.skip) continue; // already-named asset, geometry recorded but not renamed

  const newFile = `${meta.name}.png`;
  const oldPath = path.join(DIR, g.file);
  const newPath = path.join(DIR, newFile);

  // Re-running after a previous apply: geometry.json still names the OLD
  // (Gemini-export) file, but the rename already happened, so the old path is
  // gone. That is success, not an error — just re-derive the catalog entry.
  if (g.file !== newFile && !fs.existsSync(oldPath) && fs.existsSync(newPath)) {
    // fall through to the catalog write below, nothing to rename
  } else if (g.file !== newFile) {
    if (fs.existsSync(newPath)) {
      console.warn(`WARN ${newPath} already exists — leaving ${g.file} untouched`);
      continue;
    }
    fs.renameSync(oldPath, newPath);
    renamed++;
  }

  catalog[meta.name] = {
    file: newFile,
    category: meta.category,
    moods: meta.moods,
    canvas: g.canvas,
    box: g.box,
    fill: g.fill,
    cutEdges: Object.entries(g.touches).filter(([, v]) => v).map(([k]) => k),
    zones: zonesFor(g.touches, meta),
    sizes: sizesFor(g.box)
  };
  added++;
}

// Existing (skip:true) assets still get an entry so the catalog is complete,
// using whatever geometry was measured for them.
for (const g of geometry) {
  const meta = authored[g.file];
  if (!meta || !meta.skip) continue;
  catalog[meta.name] = catalog[meta.name] || {
    file: g.file,
    category: meta.category,
    moods: meta.moods,
    canvas: g.canvas,
    box: g.box,
    fill: g.fill,
    cutEdges: Object.entries(g.touches).filter(([, v]) => v).map(([k]) => k),
    zones: zonesFor(g.touches, meta),
    sizes: g.file === 'blackpanthera.png' ? undefined : sizesFor(g.box)
  };
}

fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
console.log(`renamed ${renamed} file(s), catalog now has ${Object.keys(catalog).length} entries`);
console.log(`-> ${CATALOG_PATH}`);
