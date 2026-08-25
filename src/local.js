/**
 * Local model adapter (Ollama).
 *
 * Same shape as src/gemini.js so the chain can swap providers per step. Used
 * for the mechanical steps — picking a hook index, writing a caption — where
 * the work is simple and a 3B model on a 4GB card is enough. The body-writing
 * step stays on the stronger model until measured otherwise.
 *
 * Runs fully offline. Ollama's sign-in is for their hosted models; nothing
 * here touches them, and using them would defeat the point.
 */

const ENDPOINT = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.LOCAL_MODEL || 'qwen2.5:3b';

/** True if a local server is up AND the model is present. */
async function available(model = MODEL) {
  try {
    const r = await fetch(`${ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const { models = [] } = await r.json();
    return models.some((m) => m.name === model || m.name.startsWith(model.split(':')[0]));
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 *   prompt       full prompt text
 *   schema       JSON schema — Ollama constrains output to it, same as Gemini
 *   temperature  0-2
 *   model        defaults to LOCAL_MODEL
 * @returns {Promise<object>} parsed JSON
 */
async function generateLocal({ prompt, schema, temperature = 1, model = MODEL }) {
  const body = {
    model,
    prompt,
    stream: false,
    options: { temperature },
    // Unload from RAM/VRAM as soon as the call returns. The model otherwise
    // sits resident for minutes on a 4GB card doing nothing. Costs a cold
    // start on the next call, which is the right trade for a machine that is
    // not a dedicated inference box.
    keep_alive: process.env.OLLAMA_KEEP_ALIVE || 0
  };
  // Ollama accepts a JSON schema for constrained decoding, which is what keeps
  // a small model from wandering off-format the way it otherwise would.
  if (schema) body.format = schema;

  const r = await fetch(`${ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    throw new Error(`local: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }

  const data = await r.json();
  try {
    return JSON.parse(data.response);
  } catch {
    throw new Error(`local: response was not valid JSON: ${String(data.response).slice(0, 200)}`);
  }
}

module.exports = { generateLocal, available, MODEL, ENDPOINT };
