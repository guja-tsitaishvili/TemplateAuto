#!/usr/bin/env node
/**
 * Computes hard geometry for every PNG in designpics/ that isn't already
 * catalogued: canvas size, the tight ink bounding box, and which edges of the
 * canvas the art touches.
 *
 * Edge-touching is the load-bearing fact here. A piece cut off at one edge
 * (a wing, a hand entering frame) is only physically sensible bleeding off a
 * poster edge on the SAME side it's already cut — that's geometry, not
 * opinion, and it doesn't need a human to look at the picture. What the
 * object actually IS still does.
 *
 * Output feeds tools/contact-sheet.js. Run again any time new PNGs land in
 * designpics/ — it skips names already in catalog.json.
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const { chromium } = require(path.join(P, 'node_modules', 'playwright'));
const DIR = path.join(P, 'designpics');
const CATALOG = path.join(DIR, 'catalog.json');

const EDGE_TOLERANCE = 3; // px of ink within this of a canvas edge counts as touching

function listPngs() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /\.png$/i.test(f))
    .filter((f) => !/\.sprites\.json$/i.test(f));
}

(async () => {
  const existing = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : {};
  const known = new Set(Object.values(existing).map((e) => e.file));

  const files = listPngs().filter((f) => !known.has(f));
  if (!files.length) {
    console.log('nothing new — every PNG in designpics/ is already in catalog.json');
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const results = [];
  for (const file of files) {
    const b64 = fs.readFileSync(path.join(DIR, file)).toString('base64');
    const geo = await page.evaluate(
      async ({ uri, tol }) => {
        const img = new Image();
        img.src = uri;
        await img.decode();
        const W = img.naturalWidth,
          H = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, W, H).data;
        const ink = (x, y) => {
          const i = (y * W + x) * 4;
          return d[i + 3] > 16 && !(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240);
        };
        let minX = W,
          minY = H,
          maxX = -1,
          maxY = -1,
          area = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!ink(x, y)) continue;
            area++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < 0) return null; // empty file

        const touches = {
          left: minX <= tol,
          right: maxX >= W - 1 - tol,
          top: minY <= tol,
          bottom: maxY >= H - 1 - tol
        };
        const bw = maxX - minX + 1,
          bh = maxY - minY + 1;
        return {
          canvas: { w: W, h: H },
          box: { x: minX, y: minY, w: bw, h: bh },
          fill: +(area / (bw * bh)).toFixed(3), // solid shape vs spindly/branching
          touches
        };
      },
      { uri: `data:image/png;base64,${b64}`, tol: EDGE_TOLERANCE }
    );

    if (!geo) {
      console.log(`SKIP ${file} — fully empty/transparent`);
      continue;
    }
    results.push({ file, ...geo });
    const sides = Object.entries(geo.touches)
      .filter(([, v]) => v)
      .map(([k]) => k);
    console.log(
      `${file}  canvas=${geo.canvas.w}x${geo.canvas.h}  box=${geo.box.w}x${geo.box.h}` +
        `  fill=${geo.fill}  touches=${sides.length ? sides.join(',') : '(none — floating object)'}`
    );
  }

  await browser.close();

  fs.writeFileSync(
    path.join(__dirname, 'geometry.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
  console.log(`\n${results.length} new image(s) measured -> tools/geometry.json`);
  console.log('next: node tools/contact-sheet.js');
})();
