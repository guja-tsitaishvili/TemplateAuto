#!/usr/bin/env node
/**
 * Renders a post TWICE — once with no cover art, once with a pick from the
 * catalog — so a person chooses between them by looking, rather than the
 * pipeline committing to a design decision on its own.
 *
 * This costs nothing beyond the render itself: no API call, since it works
 * from a content.json that generation already produced. Run it as many times
 * as needed to see different art picks for the same text.
 *
 * Usage:
 *   node tools/preview.js <content.json> [outDir]
 */
const fs = require('fs');
const path = require('path');
const { compose } = require('../src/compose');
const { renderCarousel, closeBrowser } = require('../src/renderer');
const { pickArt } = require('../src/artpick');

const [input, outDirArg] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node tools/preview.js <content.json> [outDir]');
  process.exit(1);
}

(async () => {
  const content = JSON.parse(fs.readFileSync(input, 'utf8'));
  const outDir = path.resolve(outDirArg || path.join(path.dirname(input), 'preview'));
  fs.mkdirSync(outDir, { recursive: true });

  // Mirrors compose.js's own theme resolution exactly (same mood, same
  // themeSeed) so the theme pickArt reasons about is the theme the render
  // actually uses — compose() would otherwise make this same choice again
  // internally and the two could disagree if themeSeed were ignored here.
  const themeName =
    content.theme ||
    require('../src/themes').pickThemeForMood(content.mood || 'love', { seed: content.themeSeed || 0 });

  const baseId = content.id || 'post';

  // Variant A: exactly what generation produced, art or not.
  const plain = compose(content);
  // Variant B: force one catalog pick onto the cover, overriding whatever
  // content.art already had, so the two variants are always different.
  const art = pickArt(content.mood, themeName);
  const withArt = compose({ ...content, art: art ? [art] : content.art });

  const plainFiles = await renderCarousel(plain.slides.slice(0, 1), {
    theme: plain.theme,
    prefix: `${baseId}-plain`,
    outDir
  });
  const artFiles = art
    ? await renderCarousel(withArt.slides.slice(0, 1), {
        theme: withArt.theme,
        prefix: `${baseId}-art`,
        outDir
      })
    : [];

  await closeBrowser();

  console.log(`no-art  : ${plainFiles[0].path}`);
  if (art) {
    console.log(`with-art: ${artFiles[0].path}  (${art.src}, at ${art.at})`);
  } else {
    console.log(`with-art: (none — theme "${themeName}" declines art, or no piece matches mood "${content.mood}")`);
  }
})();
