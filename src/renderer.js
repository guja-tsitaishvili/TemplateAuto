/**
 * Renders slides to PNG with headless Chromium.
 *
 * The browser is launched once and reused across calls, which is what keeps
 * per-image cost down when this runs as a long-lived service behind n8n.
 */

const { chromium } = require('playwright');
const { buildHtml } = require('./template');

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--font-render-hinting=none', '--disable-lcd-text']
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}

/**
 * Scales every type size uniformly to the LARGEST value that still fits.
 *
 * Scaling up matters as much as scaling down: short copy left at 1.0 renders a
 * half-empty poster, which is the single biggest giveaway that a layout was
 * generated rather than designed.
 *
 * Runs in the page so it can use real layout measurements.
 */
async function fitText(page, minFit, maxFit) {
  await page.evaluate(([min, max]) => {
    const poster = document.querySelector('.poster');
    const target = document.querySelector('.body') || document.querySelector('.cover-inner');
    if (!target) return 1;

    const setFit = (v) => {
      poster.style.setProperty('--fit', String(v));
      // Force layout so the next measurement reflects the new size.
      void poster.offsetHeight;
    };

    // The title shares the flex column with the body, so when it grows the
    // body's clientHeight shrinks — height is handled. Width is not, so a long
    // title word has to be checked separately.
    const title = document.querySelector('.title');

    // scrollHeight/scrollWidth under-report when a centered flex child
    // overflows both edges, so measure the children directly instead.
    const overflows = () => {
      let height = 0;
      let width = 0;
      for (const child of target.children) {
        const cs = getComputedStyle(child);
        height +=
          child.offsetHeight +
          parseFloat(cs.marginTop || 0) +
          parseFloat(cs.marginBottom || 0);
        width = Math.max(width, child.scrollWidth);
      }
      if (height > target.clientHeight + 1 || width > target.clientWidth + 1) return true;
      return title ? title.scrollWidth > title.clientWidth + 1 : false;
    };

    // Even the floor overflows — nothing more to give.
    setFit(min);
    if (overflows()) return min;

    // Largest scale that still fits.
    let lo = min;
    let hi = max;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      setFit(mid);
      if (overflows()) hi = mid;
      else lo = mid;
    }
    setFit(lo);
    return lo;
  }, [minFit, maxFit]);
}

/**
 * @param {object} slide   slide spec (see README)
 * @param {object} [opts]  { width, height, theme, path, minFit }
 * @returns {Promise<Buffer>} PNG bytes
 */
async function renderSlide(slide, opts = {}) {
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: opts.scale || 1
  });
  const page = await context.newPage();

  try {
    await page.setContent(buildHtml(slide, { width, height, theme: opts.theme }), {
      waitUntil: 'networkidle'
    });
    // Web fonts must be resolved before measuring, or the fit pass measures
    // fallback metrics and the final image overflows.
    await page.evaluate(() => document.fonts.ready);

    // Covers are already tuned to a large display size and their box is the
    // full poster, so letting them grow would balloon a short hook to fill
    // every pixel. Content slides are the ones that need to grow into the page.
    const maxFit = slide.maxFit || (slide.type === 'cover' ? 1 : 1.35);
    await fitText(page, opts.minFit || 0.45, maxFit);

    return await page.screenshot({
      path: opts.path,
      type: 'png',
      clip: { x: 0, y: 0, width, height }
    });
  } finally {
    await context.close();
  }
}

/**
 * Finds one title size that keeps every content title on a single line.
 *
 * Returns a multiplier applied to all content slides so their titles share a
 * height. Cover slides are excluded — their titles are meant to wrap.
 *
 * @returns {Promise<number>} 1 when every title already fits
 */
async function measureTitleScale(page, slides, opts) {
  const content = slides.filter((s) => s.type !== 'cover' && s.title);
  if (content.length < 2) return 1;

  // The longest title decides for the whole set.
  const longest = content.reduce((a, b) => (b.title.length > a.title.length ? b : a));

  await page.setContent(buildHtml(longest, opts), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);

  const scale = await page.evaluate(() => {
    const title = document.querySelector('.title');
    if (!title) return 1;

    const style = getComputedStyle(title);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.03;
    // Already one line — nothing to correct.
    if (title.offsetHeight <= lineHeight * 1.2) return 1;

    // Shrink until it fits on one line, with a floor so a very long title
    // wraps rather than becoming unreadably small.
    const base = parseFloat(style.fontSize);
    for (let s = 0.95; s >= 0.6; s -= 0.025) {
      title.style.fontSize = `${base * s}px`;
      if (title.offsetHeight <= lineHeight * 1.2) return s;
    }
    return 0.6;
  });

  return scale;
}

/**
 * Renders a whole carousel through ONE page.
 *
 * A fresh context per slide re-fetched the webfonts every time and waited for
 * networkidle on each — 2.4s/slide. Reusing the page keeps the font cache warm
 * and drops it to ~1.4s before encoding.
 *
 * Format matters more than it looks: the grain texture is noise, and noise does
 * not compress, so PNG encoding of a textured slide costs ~890ms and 1.2MB
 * against ~90ms and 190KB for JPEG. Instagram re-encodes to JPEG regardless.
 *
 * @param {object[]} slides
 * @param {object} [opts] same as renderSlide, plus { outDir, prefix, format, quality }
 */
/** Applies the shared title scale to a content slide. */
function scaled(slide, titleScale) {
  if (titleScale >= 1 || slide.type === 'cover' || slide.titleSize) return slide;
  const { getTheme } = require('./themes');
  const theme = getTheme(slide.theme || 'pink');
  return { ...slide, titleSize: Math.round(theme.titleSize * titleScale) };
}

async function renderCarousel(slides, opts = {}) {
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const format = opts.format || 'jpeg';
  const quality = opts.quality || 92;
  const ext = format === 'jpeg' ? 'jpg' : 'png';

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: opts.scale || 1
  });
  const page = await context.newPage();

  // Content titles vary in length ("May Girlfriend" 14 chars, "September
  // Girlfriend" 20), so some wrap to two lines and some do not. Each slide
  // renders independently and cannot know that, which left the carousel with
  // titles at different heights. Measure them all first and size every slide
  // to whatever the LONGEST one needs.
  const titleScale = await measureTitleScale(page, slides, { width, height, theme: opts.theme });

  const results = [];
  try {
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const file = opts.outDir
        ? `${opts.outDir}/${opts.prefix || 'slide'}-${String(i + 1).padStart(2, '0')}.${ext}`
        : undefined;

      await page.setContent(buildHtml(scaled(slide, titleScale), { width, height, theme: opts.theme }), {
        waitUntil: 'domcontentloaded'
      });
      await page.evaluate(() => document.fonts.ready);

      const maxFit = slide.maxFit || (slide.type === 'cover' ? 1 : 1.35);
      await fitText(page, opts.minFit || 0.45, maxFit);

      const shot = { path: file, type: format, clip: { x: 0, y: 0, width, height } };
      if (format === 'jpeg') shot.quality = quality;

      results.push({ index: i, path: file, buffer: await page.screenshot(shot) });
    }
  } finally {
    await context.close();
  }
  return results;
}

module.exports = { renderSlide, renderCarousel, closeBrowser, getBrowser };
