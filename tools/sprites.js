#!/usr/bin/env node
/**
 * Finds the bounding box of every separate shape in a sprite sheet.
 * Uses the Chromium that Playwright already ships — no image library needed.
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const { chromium } = require(path.join(P, 'node_modules', 'playwright'));

const FILE = process.argv[2] || path.join(P, 'designpics', 'blackpanthera.png');
const MIN_AREA = Number(process.argv[3] || 400); // ignore specks

(async () => {
  const b64 = fs.readFileSync(FILE).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const result = await page.evaluate(async (dataUri) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const W = img.naturalWidth;
    const H = img.naturalHeight;

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;

    // ink = not transparent AND not near-white
    const ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const a = d[i * 4 + 3];
      const r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2];
      ink[i] = a > 16 && !(r > 240 && g > 240 && bl > 240) ? 1 : 0;
    }

    // connected components, 8-way, iterative so a big blob cannot blow the stack
    const label = new Int32Array(W * H).fill(-1);
    const boxes = [];
    for (let start = 0; start < W * H; start++) {
      if (!ink[start] || label[start] !== -1) continue;
      const id = boxes.length;
      let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
      const stack = [start];
      label[start] = id;
      while (stack.length) {
        const p = stack.pop();
        const x = p % W;
        const y = (p - x) / W;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const q = ny * W + nx;
            if (ink[q] && label[q] === -1) { label[q] = id; stack.push(q); }
          }
        }
      }
      boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
    return { W, H, boxes };
  }, `data:image/png;base64,${b64}`);

  await browser.close();

  const kept = result.boxes
    .filter((b) => b.area >= MIN_AREA)
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  console.log(`sheet: ${result.W} x ${result.H}`);
  console.log(`components: ${result.boxes.length} total, ${kept.length} above ${MIN_AREA}px`);
  kept.forEach((b, i) =>
    console.log(
      `  ${String(i).padStart(2)}  x=${String(b.x).padStart(4)} y=${String(b.y).padStart(4)} ` +
        `w=${String(b.w).padStart(4)} h=${String(b.h).padStart(4)}  area=${b.area}`
    )
  );
  fs.writeFileSync(
    path.join(__dirname, 'sprites.json'),
    JSON.stringify({ sheet: { w: result.W, h: result.H }, boxes: kept }, null, 2)
  );
})();
