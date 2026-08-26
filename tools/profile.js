#!/usr/bin/env node
/** Prints the vertical ink profile inside a box, to find a seam to split on. */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const { chromium } = require(path.join(P, 'node_modules', 'playwright'));
const FILE = path.join(P, 'designpics', 'blackpanthera.png');

(async () => {
  const b64 = fs.readFileSync(FILE).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = await page.evaluate(async (dataUri) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const isInk = (x, y) => {
      const i = (y * W + x) * 4;
      const a = d[i + 3];
      return a > 16 && !(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240);
    };
    const prof = (box) => {
      const cols = [];
      for (let x = box.x; x < box.x + box.w; x++) {
        let n = 0;
        for (let y = box.y; y < box.y + box.h; y++) if (isInk(x, y)) n++;
        cols.push(n);
      }
      return cols;
    };
    return {
      W, H,
      box3: prof({ x: 179, y: 121, w: 309, h: 120 }),
      box8: prof({ x: 180, y: 263, w: 211, h: 98 })
    };
  }, `data:image/png;base64,${b64}`);
  await browser.close();

  const show = (name, cols, x0) => {
    console.log(`\n${name}  (x ${x0}..${x0 + cols.length - 1})`);
    const max = Math.max(...cols);
    // sparkline, 1 char per 4px
    let line = '';
    for (let i = 0; i < cols.length; i += 4) {
      const v = Math.max(...cols.slice(i, i + 4));
      line += v === 0 ? '.' : ' .:-=+*#%@'[Math.min(9, Math.ceil((v / max) * 9))];
    }
    console.log('  ' + line);
    // narrowest interior valleys
    const inner = cols.map((v, i) => ({ v, x: x0 + i })).slice(30, cols.length - 30);
    const sorted = [...inner].sort((a, b) => a.v - b.v).slice(0, 8);
    console.log('  thinnest interior columns: ' + sorted.map((s) => `x=${s.x}(${s.v})`).join('  '));
  };
  show('box3 middle pair', out.box3, 179);
  show('box8 bottom-left', out.box8, 180);
})();
