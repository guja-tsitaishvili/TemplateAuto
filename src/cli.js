#!/usr/bin/env node
/**
 * Usage: node src/cli.js <carousel.json> [outDir]
 *
 * carousel.json: { "theme": "pink", "prefix": "march", "slides": [ ... ] }
 */

const fs = require('fs');
const path = require('path');
const { renderCarousel, closeBrowser } = require('./renderer');

async function main() {
  const [input, outDirArg] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node src/cli.js <carousel.json> [outDir]');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(input, 'utf8'));
  const outDir = path.resolve(outDirArg || 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const started = Date.now();
  const results = await renderCarousel(spec.slides, {
    theme: spec.theme,
    width: spec.width,
    height: spec.height,
    prefix: spec.prefix,
    outDir
  });

  for (const r of results) console.log('wrote', r.path);
  console.log(`${results.length} slides in ${Date.now() - started}ms`);
  await closeBrowser();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
