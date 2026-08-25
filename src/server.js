/**
 * HTTP wrapper around the renderer, for n8n to call.
 *
 *   GET  /health              -> { ok: true }
 *   GET  /themes              -> { themes: [...] }
 *   POST /render              -> image/png  (body = one slide spec)
 *   POST /carousel            -> { slides: [{ index, filename, base64 }] }
 */

const express = require('express');
const { renderSlide, renderCarousel, getBrowser, closeBrowser } = require('./renderer');
const { listThemes, themesForMood, pickThemeForMood, MOODS } = require('./themes');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/themes', (req, res) => {
  const { mood } = req.query;
  try {
    const themes = listThemes();
    if (!mood) return res.json({ moods: MOODS, themes });

    const names = themesForMood(mood);
    res.json({ mood, themes: themes.filter((t) => names.includes(t.name)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/render', async (req, res, next) => {
  try {
    const { width, height, scale, ...slide } = req.body || {};
    const png = await renderSlide(slide, { width, height, scale });
    res.type('png').send(png);
  } catch (err) {
    next(err);
  }
});

app.post('/carousel', async (req, res, next) => {
  try {
    const { slides, theme, mood, seed, width, height, scale, prefix } = req.body || {};
    if (!Array.isArray(slides) || !slides.length) {
      return res.status(400).json({ error: 'body.slides must be a non-empty array' });
    }

    // A caller that knows the subject but not the palette sends a mood and lets
    // the registry choose — that is what keeps adding a theme a one-file job.
    const chosen = theme || (mood ? pickThemeForMood(mood, { seed }) : undefined);

    const results = await renderCarousel(slides, { theme: chosen, width, height, scale });
    res.json({
      count: results.length,
      theme: chosen || null,
      slides: results.map((r) => ({
        index: r.index,
        filename: `${prefix || 'slide'}-${String(r.index + 1).padStart(2, '0')}.png`,
        base64: r.buffer.toString('base64')
      }))
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 3001;

async function start() {
  // Warm the browser so the first real request isn't paying launch cost.
  await getBrowser();
  app.listen(port, () => console.log(`poster renderer listening on :${port}`));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await closeBrowser();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
