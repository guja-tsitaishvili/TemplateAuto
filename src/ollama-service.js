/**
 * Starts Ollama only while it is needed, and stops it afterwards.
 *
 * Ollama's autostart has been disabled so nothing sits in RAM between runs
 * (the idle server alone held ~154MB, and the loaded model is another ~1.9GB
 * on a 4GB card). A batch starts the server once, uses it, then shuts it down.
 *
 * Safe to call when Ollama is already running — start() detects it and stop()
 * leaves anything it did not start alone.
 */

const { spawn, execFile } = require('child_process');
const { ENDPOINT } = require('./local');

let startedByUs = null;

async function isUp() {
  try {
    const r = await fetch(`${ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** @returns {Promise<boolean>} true once the server is reachable */
async function start({ timeoutMs = 30000 } = {}) {
  if (await isUp()) return true;

  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    shell: true
  });
  child.unref();
  startedByUs = child;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isUp()) return true;
  }
  return false;
}

/**
 * Stops the server, but only if this process started it — otherwise a run
 * would kill a session the user had open themselves.
 */
async function stop() {
  if (!startedByUs) return false;
  startedByUs = null;

  return new Promise((resolve) => {
    // taskkill by image name: `ollama serve` spawns children, and killing the
    // wrapper alone leaves the runner holding memory.
    execFile('taskkill', ['/F', '/IM', 'ollama.exe', '/T'], () => resolve(true));
  });
}

module.exports = { start, stop, isUp };
