/**
 * Theme registry.
 *
 * Every theme is one JSON file in `themes/`. Dropping a new file in registers
 * it — no code change, no import list to update. That is what makes "add a
 * poster design" a one-file job rather than an edit across the codebase.
 *
 * A theme file is pure design data plus three pieces of metadata:
 *   label    — human name, shown by the API
 *   moods    — which subject matter it suits (see MOODS)
 *   allowArt — whether decoration art belongs on it at all
 *
 * Nothing here knows about slide content, so any theme renders any layout.
 */

const fs = require('fs');
const path = require('path');

const THEME_DIR = process.env.THEMES_DIR || path.join(__dirname, '..', 'themes');

/** The controlled vocabulary. A theme claiming anything else fails to load. */
const MOODS = ['love', 'positive', 'negative', 'toxic'];

const REQUIRED = ['bg', 'ink', 'titleColor', 'titleFont', 'bodyFont'];

let registry = null;

function validate(name, theme) {
  for (const key of REQUIRED) {
    if (!theme[key]) throw new Error(`theme "${name}" is missing required key "${key}"`);
  }
  const moods = theme.moods || [];
  if (!moods.length) throw new Error(`theme "${name}" must declare at least one mood`);
  for (const mood of moods) {
    if (!MOODS.includes(mood)) {
      throw new Error(
        `theme "${name}" declares unknown mood "${mood}"; allowed: ${MOODS.join(', ')}`
      );
    }
  }
  return theme;
}

function load() {
  if (registry) return registry;

  registry = { byName: new Map(), order: [] };

  const files = fs.existsSync(THEME_DIR)
    ? fs.readdirSync(THEME_DIR).filter((f) => f.endsWith('.json')).sort()
    : [];

  for (const file of files) {
    const name = path.basename(file, '.json');
    const theme = validate(
      name,
      JSON.parse(fs.readFileSync(path.join(THEME_DIR, file), 'utf8'))
    );
    theme.name = name;
    theme.allowArt = theme.allowArt !== false;

    registry.byName.set(name, theme);
    registry.order.push(name);
    for (const alias of theme.aliases || []) registry.byName.set(alias, theme);
  }

  if (!registry.order.length) throw new Error(`no theme JSON files found in ${THEME_DIR}`);
  return registry;
}

function getTheme(name) {
  const { byName, order } = load();
  const theme = byName.get(name);
  if (!theme) {
    throw new Error(`Unknown theme "${name}". Available: ${order.join(', ')}`);
  }
  return theme;
}

/** Every theme with its metadata — what the API advertises. */
function listThemes() {
  const { byName, order } = load();
  return order.map((name) => {
    const t = byName.get(name);
    return {
      name,
      label: t.label || name,
      moods: t.moods,
      allowArt: t.allowArt,
      bg: t.bg,
      ink: t.ink
    };
  });
}

/**
 * Themes suited to a mood, most-specific first: a theme that lists the mood
 * earlier is a stronger match, so `pink` (love first) beats a theme that only
 * mentions love as its third option.
 */
function themesForMood(mood) {
  if (!MOODS.includes(mood)) {
    throw new Error(`Unknown mood "${mood}". Allowed: ${MOODS.join(', ')}`);
  }
  const { byName, order } = load();
  return order
    .map((name) => byName.get(name))
    .filter((t) => t.moods.includes(mood))
    .sort((a, b) => a.moods.indexOf(mood) - b.moods.indexOf(mood))
    .map((t) => t.name);
}

/**
 * Picks a theme for a mood. `seed` walks the candidates so consecutive posts on
 * the same subject don't all land on the same colour.
 *
 * @param {string} mood
 * @param {object} [opts] { seed?: number, requireArt?: boolean }
 */
function pickThemeForMood(mood, opts = {}) {
  let candidates = themesForMood(mood);
  if (opts.requireArt) candidates = candidates.filter((n) => getTheme(n).allowArt);

  if (!candidates.length) {
    throw new Error(`no theme matches mood "${mood}"${opts.requireArt ? ' with art support' : ''}`);
  }
  const seed = Number.isInteger(opts.seed) ? opts.seed : 0;
  return candidates[Math.abs(seed) % candidates.length];
}

module.exports = {
  getTheme,
  listThemes,
  themesForMood,
  pickThemeForMood,
  MOODS,
  get themeNames() {
    return load().order;
  }
};
