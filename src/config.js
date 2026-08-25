/**
 * Loads .env and exposes configuration.
 *
 * Node 21+ can read .env natively, so there is no dotenv dependency.
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_FILE) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(ENV_FILE);
}

/**
 * @param {string} name
 * @returns {string} the value, or throws with instructions rather than a
 *   confusing 401 later on.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set.\n` +
        `  1. Copy .env.example to .env\n` +
        `  2. Put your key on the ${name}= line\n` +
        `  (.env is gitignored, so the key stays local)`
    );
  }
  return value;
}

module.exports = {
  get geminiKey() {
    return required('GEMINI_API_KEY');
  },
  fastModel: process.env.GEMINI_MODEL_FAST || 'gemini-3.5-flash',
  strongModel: process.env.GEMINI_MODEL_STRONG || 'gemini-3.5-flash',
  hasGeminiKey: () => Boolean(process.env.GEMINI_API_KEY),
  // OFF by default after a measured head-to-head (2026-08-25). Routing hook
  // scoring and captions to qwen2.5:3b saved only ~470 tokens of ~3,840 per
  // post (12%) because it only ever handled the two CHEAPEST calls — and it
  // cost real quality: given an IDENTICAL list of 12 hooks it picked one it
  // scored 5/10 while the API found an 8.5/10 in the same list, and its
  // caption came back as "I do not care, but you make my inbox warm" — the
  // body format copied into the caption slot. Set USE_LOCAL_MODEL=1 to
  // re-enable both steps; the code path is intact, just not the default.
  useLocalModel: process.env.USE_LOCAL_MODEL === '1'
};
