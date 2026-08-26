#!/usr/bin/env node
/**
 * Renders a labeled grid of every image in tools/geometry.json, so a human (or
 * a vision-capable reviewer) can identify subjects from one page instead of
 * opening 40 files one at a time. Paginated because a single sheet with 40+
 * tiles becomes illegible.
 *
 * Each tile shows the trimmed artwork on a mid-grey ground (so white and
 * near-white edges are visible against it), its index, filename, and the
 * geometry already computed: box size, fill ratio, which edges it touches.
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const { chromium } = require(path.join(P, 'node_modules', 'playwright'));
const DIR = path.join(P, 'designpics');

const PER_PAGE = 20;
const COLS = 5;
const TILE = 260;

(async () => {
  const geo = JSON.parse(fs.readFileSync(path.join(__dirname, 'geometry.json'), 'utf8'));
  if (!geo.length) {
    console.log('tools/geometry.json is empty — run tools/geometry.js first');
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (let p = 0; p < Math.ceil(geo.length / PER_PAGE); p++) {
    const slice = geo.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
    const rows = Math.ceil(slice.length / COLS);

    const tiles = await Promise.all(
      slice.map(async (item, i) => ({
        i: p * PER_PAGE + i,
        file: item.file,
        touches: item.touches,
        fill: item.fill,
        box: item.box,
        b64: fs.readFileSync(path.join(DIR, item.file)).toString('base64')
      }))
    );

    const html = `<!doctype html><html><head><style>
      body{margin:0;background:#fff;font-family:Arial,sans-serif}
      .grid{display:grid;grid-template-columns:repeat(${COLS},${TILE}px);gap:14px;padding:14px}
      .tile{width:${TILE}px}
      .imgbox{width:${TILE}px;height:${TILE}px;background:#8a8a8a;border:1px solid #333;
        display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
      .imgbox img{max-width:92%;max-height:92%}
      .idx{position:absolute;top:4px;left:6px;background:#000;color:#fff;font-size:20px;
        font-weight:bold;padding:2px 8px;border-radius:4px}
      .meta{font-size:11px;color:#111;margin-top:4px;line-height:1.4;word-break:break-all}
      .touch{color:#c0392b;font-weight:bold}
    </style></head><body><div class="grid">
      ${tiles
        .map(
          (t) => `<div class="tile">
            <div class="imgbox">
              <span class="idx">${t.i}</span>
              <img src="data:image/png;base64,${t.b64}">
            </div>
            <div class="meta">${t.file}<br>box ${t.box.w}x${t.box.h} · fill ${t.fill} · <span class="touch">${
              Object.entries(t.touches).filter(([, v]) => v).map(([k]) => k).join(',') || 'floating'
            }</span></div>
          </div>`
        )
        .join('')}
    </div></body></html>`;

    await page.setContent(html);
    await page.setViewportSize({
      width: COLS * (TILE + 14) + 14,
      height: rows * (TILE + 46) + 28
    });
    const out = path.join(__dirname, `contact-sheet-${p + 1}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`wrote ${out}  (items ${p * PER_PAGE}-${p * PER_PAGE + slice.length - 1})`);
  }

  await browser.close();
})();
