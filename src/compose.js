#!/usr/bin/env node
/**
 * content.json -> renderer payload.
 *
 * The writing step produces meaning and mood only; it never picks a theme, a
 * font or a decoration position. This turns that editorial output into slides,
 * choosing the palette from the mood via the theme registry.
 *
 * Keeping the two apart means adding poster style #12 changes nothing about
 * what the writer has to produce.
 *
 * Usage: node src/compose.js <content.json> [outDir]
 */

const fs = require('fs');
const path = require('path');
const { pickThemeForMood, getTheme } = require('./themes');
const { resolveCta } = require('./cta');
const { voices } = require('./seed');

/**
 * The reference set inflects the promo line with the post's voice — "Your best
 * matches", "Her best matches", "Their best matches". The renderer has no idea
 * which voice a post used, so it is resolved here and passed down explicitly.
 */
function ctaForVoice(pick, voice) {
  const cta = resolveCta(pick);
  if (!cta || !cta.label) return cta;

  const possessive = ((voices[voice] || {}).pronouns || {}).possessive || 'your';
  const Poss = possessive.charAt(0).toUpperCase() + possessive.slice(1);
  return { ...cta, label: cta.label.replace(/\{Poss\}/g, Poss).replace(/\{poss\}/g, possessive) };
}

/**
 * @param {object} content
 *   mood      love | positive | negative | toxic
 *   theme     optional, overrides the mood lookup
 *   hook      string, or { top, bottom } for a split cover
 *   items     [{ title, sections | bullets }]
 *   art       optional decorations for the cover
 *   themeSeed optional, walks the themes matching the mood
 * @returns {{prefix: string, slides: object[], theme: string}}
 */
function compose(content) {
  if (!content.items || !content.items.length) {
    throw new Error('content.items must be a non-empty array');
  }

  const themeName =
    content.theme ||
    pickThemeForMood(content.mood || 'love', { seed: content.themeSeed || 0 });
  const theme = getTheme(themeName);

  const cover =
    typeof content.hook === 'object'
      ? { type: 'cover', theme: themeName, titleTop: content.hook.top, titleBottom: content.hook.bottom }
      : { type: 'cover', theme: themeName, title: content.hook };

  // Art is declined by light themes anyway, but skipping it here keeps the
  // payload honest about what will actually be drawn.
  if (content.art && theme.allowArt) cover.decorations = content.art;

  const slides = [cover];
  for (const item of content.items) {
    const slide = { type: 'content', theme: themeName, title: item.title };
    if (item.bullets) slide.bullets = item.bullets;
    else if (item.sections) slide.sections = item.sections;
    else throw new Error(`item "${item.title}" has neither bullets nor sections`);
    const voice = (content.seed || {}).voice || 'you';
    slide.cta = ctaForVoice(item.cta !== undefined ? item.cta : content.cta, voice);
    slides.push(slide);
  }

  return {
    prefix: content.id || 'post',
    theme: themeName,
    slides,
    caption: content.caption,
    hashtags: content.hashtags
  };
}

module.exports = { compose };

if (require.main === module) {
  const [input, outDir] = process.argv.slice(2);
  if (!input) {
    console.error('Usage: node src/compose.js <content.json> [outDir]');
    process.exit(1);
  }

  const content = JSON.parse(fs.readFileSync(input, 'utf8'));
  const payload = compose(content);

  const target = path.resolve(outDir || 'out');
  fs.mkdirSync(target, { recursive: true });

  const specPath = path.join(target, `${payload.prefix}.slides.json`);
  fs.writeFileSync(specPath, JSON.stringify(payload, null, 2) + '\n');

  console.log(`theme  : ${payload.theme}  (from mood "${content.mood}")`);
  console.log(`slides : ${payload.slides.length}  (1 cover + ${payload.slides.length - 1} content)`);
  console.log(`spec   : ${specPath}`);
  console.log(`\nrender it:\n  node src/cli.js ${specPath} ${outDir || 'out'}`);
}
