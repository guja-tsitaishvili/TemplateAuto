#!/usr/bin/env node
/**
 * Generates and renders several posts in one run.
 *
 * This is the shape the scheduled workflow wants: fill a buffer ahead of time,
 * review it, then post from the queue — rather than generating in the minute
 * before publishing, where a bad batch or a provider outage reaches the feed.
 *
 * Usage:
 *   node src/batch.js --count 4
 *   node src/batch.js --count 5 --moods toxic,love,negative,positive
 *   node src/batch.js --count 3 --no-render        text only, much faster
 */

const fs = require('fs');
const path = require('path');
const { generatePost } = require('./generate');
const { record } = require('./seed');
const { compose } = require('./compose');
const { renderCarousel, closeBrowser } = require('./renderer');
const ollama = require('./ollama-service');

async function batch({ count = 3, moods = [], outDir = 'out', render = true, save = false }) {
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });

  const results = [];
  // Angles used so far in this run, so the batch does not repeat itself.
  const usedAngles = [];

  // Ollama does not autostart any more, so bring it up for the run and take it
  // back down after. One cold start per batch instead of a resident process.
  const startedOllama = await ollama.start().catch(() => false);
  if (startedOllama) console.log('ollama  : started for this run');

  for (let i = 0; i < count; i++) {
    const mood = moods.length ? moods[i % moods.length] : undefined;
    console.log(`\n──────── ${i + 1}/${count}${mood ? `  (${mood})` : ''}`);

    try {
      const post = await generatePost({ mood, exclude: usedAngles });
      usedAngles.push(post.seed.angle);
      const { _seed, ...clean } = post;

      const contentPath = path.join(target, `${post.id}.content.json`);
      fs.writeFileSync(contentPath, JSON.stringify(clean, null, 2) + '\n');
      if (save) record(_seed);

      const payload = compose(clean);
      let rendered = 0;
      if (render) {
        const files = await renderCarousel(payload.slides, {
          outDir: target,
          prefix: post.id
        });
        rendered = files.length;
      }

      results.push({
        id: post.id,
        seed: `${post.seed.angle} · ${post.seed.voice} · ${post.seed.subject} · ${post.seed.format}`,
        mood: post.mood,
        theme: payload.theme,
        hook: post.hook,
        score: post.hookScore,
        qa: post.qa === 'passed' ? 'passed' : `${post.qa.length} issue(s)`,
        slides: rendered || payload.slides.length
      });
    } catch (err) {
      // One failed post must not take the batch down with it.
      console.error(`  FAILED: ${err.message}`);
      results.push({ id: `#${i + 1}`, error: err.message });
    }
  }

  if (render) await closeBrowser();
  if (startedOllama) {
    await ollama.stop();
    console.log('ollama  : stopped');
  }
  return results;
}

module.exports = { batch };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };

  (async () => {
    const started = Date.now();
    const results = await batch({
      count: Number(flag('count') || 3),
      moods: (flag('moods') || '').split(',').filter(Boolean),
      outDir: flag('out') || 'out',
      render: !argv.includes('--no-render'),
      save: argv.includes('--record')
    });

    console.log(`\n════════ ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
    for (const r of results) {
      if (r.error) {
        console.log(`  ✗ ${r.id}  ${r.error}`);
        continue;
      }
      console.log(`  ${r.mood.padEnd(9)} ${r.theme.padEnd(8)} ${String(r.score).padStart(4)}/10  ${r.qa.padEnd(10)} ${r.slides} slides`);
      console.log(`     "${r.hook}"`);
      console.log(`     ${r.seed}\n`);
    }
  })().catch((err) => {
    console.error('batch failed:', err.message);
    process.exit(1);
  });
}
