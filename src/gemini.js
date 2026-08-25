/**
 * Gemini adapter.
 *
 * Every call is schema-constrained JSON, so there is no parsing of prose or
 * digging JSON out of markdown fences — the model either returns the shape or
 * the call fails loudly.
 *
 * Retries exist because 503 "high demand" is routine on the newer models. A
 * scheduled post that dies on a transient overload is a support ticket, so the
 * adapter absorbs it.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const USAGE_LOG = path.join(__dirname, '..', 'out', 'usage.jsonl');

/**
 * Appends one line per call: model, token counts, timestamp. Gemini returns
 * this on every response and it was being silently discarded — the only way
 * to answer "what did we spend it on" is to have actually kept it.
 */
function logUsage(model, usage) {
  if (!usage) return;
  try {
    fs.mkdirSync(path.dirname(USAGE_LOG), { recursive: true });
    fs.appendFileSync(
      USAGE_LOG,
      JSON.stringify({
        t: new Date().toISOString(),
        model,
        in: usage.promptTokenCount || 0,
        out: usage.candidatesTokenCount || 0,
        // Gemini 3.x "thinks" before answering and those tokens are BILLED,
        // typically at the output rate. They are not included in
        // candidatesTokenCount, so logging in+out alone understated real cost
        // by several times over.
        think: usage.thoughtsTokenCount || 0,
        total: usage.totalTokenCount || 0
      }) + '\n'
    );
  } catch {
    // Usage logging must never break a generation call.
  }
}

/**
 * @param {object} opts
 *   prompt       the full prompt text
 *   model        defaults to the fast model
 *   temperature  0-2; high for generation, low for judging
 *   schema       Gemini responseSchema — the shape to constrain output to
 *   tries        attempts before giving up (default 4)
 *   thinking     thinkingBudget: 0 disables (default), -1 unlimited, N a cap
 * @returns {Promise<object>} the parsed JSON response
 */
async function generate({ prompt, model, temperature = 1, schema, tries = 4, thinking }) {
  const target = model || config.fastModel;
  const url = `${ENDPOINT}/${target}:generateContent?key=${config.geminiKey}`;

  // Gemini 3.x thinks before answering unless told not to, and those tokens
  // are billed at the output rate. Measured on a real post: 10,633 thinking
  // tokens against 1,952 of actual output — 84% of billed output was thinking,
  // including 1,074 tokens spent choosing an array index.
  //
  // Default off. Steps that genuinely benefit opt in with a budget.
  const generationConfig = {
    temperature,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: thinking == null ? 0 : thinking }
  };
  if (schema) generationConfig.responseSchema = schema;

  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
      });
    } catch (err) {
      // Network-level failure — treat like a retryable status.
      lastError = err;
      await backoff(attempt);
      continue;
    }

    if (response.ok) {
      const body = await response.json();
      logUsage(target, body.usageMetadata);
      const candidate = body.candidates && body.candidates[0];
      if (!candidate) throw new Error(`${target}: no candidate returned`);

      const text = (candidate.content.parts || []).map((p) => p.text).join('');
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${target}: response was not valid JSON: ${text.slice(0, 200)}`);
      }
    }

    const detail = (await response.text()).slice(0, 200);
    lastError = new Error(`${target}: HTTP ${response.status} ${detail}`);
    if (!RETRYABLE.has(response.status)) throw lastError;
    await backoff(attempt);
  }

  throw lastError;
}

/** Exponential-ish backoff: 1s, 2s, 4s, 8s. */
function backoff(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
}

module.exports = { generate };
