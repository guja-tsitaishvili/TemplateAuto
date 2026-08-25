/**
 * Semantic similarity for idea-level repetition.
 *
 * The text-level history forbids ideas by literal string. That cannot tell
 * that "pre-empts abandonment by leaving first" and "starts a fight to avoid
 * being left" are the same thought. Embeddings turn that judgement into a
 * number.
 *
 * IMPORTANT — embed the idea TAG, never the finished sentence. Measured on
 * real overlaps from generated posts:
 *
 *              SAME idea      DIFFERENT idea
 *   sentences  0.667-0.932    0.610-0.664   <- overlaps, no usable threshold
 *   tags       0.724-0.754    0.563-0.645   <- clean gap
 *
 * Full sentences share too much surface structure ("I [verb] so [clause]"),
 * and that form dominates the signal. The 3-6 word tags are semantically
 * concentrated, which is what makes a threshold possible at all.
 */

const config = require('./config');

const MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// 256 instead of the default: same separation for a fraction of the storage.
const DIMENSIONS = 256;

// Midpoint of the measured gap (0.645 diff max / 0.724 same min), nudged low
// so a near-miss is caught rather than shipped. Raise it if good ideas start
// being rejected.
const SIMILARITY_THRESHOLD = 0.69;

/** Stored rounded — full float precision triples the file size for no benefit. */
const round = (v) => Math.round(v * 10000) / 10000;

/**
 * @param {string[]} texts
 * @returns {Promise<number[][]>} one vector per input, in order
 */
async function embedMany(texts) {
  if (!texts.length) return [];

  const response = await fetch(
    `${ENDPOINT}/${MODEL}:batchEmbedContents?key=${config.geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: DIMENSIONS
        }))
      })
    }
  );

  if (!response.ok) {
    throw new Error(`embed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  const body = await response.json();
  return (body.embeddings || []).map((e) => e.values.map(round));
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * @param {number[]} vec        candidate idea vector
 * @param {number[][]} priorVecs vectors of ideas already used for this item
 * @returns {{similar: boolean, score: number, index: number}}
 */
function closestPrior(vec, priorVecs) {
  let best = { similar: false, score: 0, index: -1 };
  (priorVecs || []).forEach((prior, index) => {
    const score = cosine(vec, prior);
    if (score > best.score) best = { similar: score >= SIMILARITY_THRESHOLD, score, index };
  });
  return best;
}

module.exports = { embedMany, cosine, closestPrior, SIMILARITY_THRESHOLD, MODEL, DIMENSIONS };
