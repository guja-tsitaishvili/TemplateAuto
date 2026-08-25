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
  hasGeminiKey: () => Boolean(process.env.GEMINI_API_KEY)
};
