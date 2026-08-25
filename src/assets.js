/**
 * Resolves decoration images from the designpics folder and inlines them
 * as data URIs, so the renderer never depends on file:// access or a host.
 */

const fs = require('fs');
const path = require('path');

const ASSET_DIR = process.env.DESIGNPICS_DIR || path.join(__dirname, '..', 'designpics');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

const cache = new Map();

function listAssets() {
  if (!fs.existsSync(ASSET_DIR)) return [];
  return fs.readdirSync(ASSET_DIR).filter((f) => MIME[path.extname(f).toLowerCase()]);
}

function loadAliases() {
  const file = path.join(ASSET_DIR, 'aliases.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Accepts a short alias ("skull"), a bare filename, a loose substring of one,
 * or an absolute path. Returns the absolute file path.
 */
function resolveAsset(name) {
  if (!name) throw new Error('decoration is missing "src"');
  if (path.isAbsolute(name) && fs.existsSync(name)) return name;

  const aliases = loadAliases();
  const key = String(name).toLowerCase();
  const target = aliases[key] || aliases[name] || name;

  const files = listAssets();
  const exact = files.find((f) => f === target || f.toLowerCase() === String(target).toLowerCase());
  if (exact) return path.join(ASSET_DIR, exact);

  const stem = String(target).toLowerCase().replace(/\.[a-z]+$/, '');
  const fuzzy = files.find((f) => f.toLowerCase().includes(stem));
  if (fuzzy) return path.join(ASSET_DIR, fuzzy);

  throw new Error(
    `No image matching "${name}" in ${ASSET_DIR}. Available: ${files.join(', ') || '(none)'}`
  );
}

/** @returns {string} a data: URI for the given asset name. */
function assetDataUri(name) {
  if (/^(data:|https?:)/.test(name)) return name;

  const file = resolveAsset(name);
  if (cache.has(file)) return cache.get(file);

  const mime = MIME[path.extname(file).toLowerCase()] || 'image/png';
  const uri = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  cache.set(file, uri);
  return uri;
}

module.exports = { assetDataUri, resolveAsset, listAssets, ASSET_DIR };
