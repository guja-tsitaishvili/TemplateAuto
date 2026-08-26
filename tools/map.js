#!/usr/bin/env node
/** Final sprite map: components, seam-split where a deep valley exists, tight boxes. */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const { chromium } = require(path.join(P, 'node_modules', 'playwright'));
const FILE = process.argv[2]
  ? (require('path').isAbsolute(process.argv[2]) ? process.argv[2] : path.join(process.cwd(), process.argv[2]))
  : path.join(P, 'designpics', 'blackpanthera.png');
const OUTMAP = FILE.replace(/\.[a-z]+$/i, '.sprites.json');

// Assigned by eye from the rendered sheet, keyed by where each box sits.
const NAMES = [
  { at: [200, 23], name: 'resting' },
  { at: [356, 7], name: 'standing' },
  { at: [556, 13], name: 'head' },
  { at: [34, 134], name: 'sitting' },
  { at: [179, 121], name: 'walking' },
  { at: [335, 121], name: 'crouching' },
  { at: [566, 143], name: 'rear' },
  { at: [180, 263], name: 'prowling' },
  { at: [404, 259], name: 'roaring' },
  { at: [553, 257], name: 'turning' }
];

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
    const ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const a = d[i * 4 + 3];
      ink[i] = a > 16 && !(d[i * 4] > 240 && d[i * 4 + 1] > 240 && d[i * 4 + 2] > 240) ? 1 : 0;
    }
    // components
    const label = new Int32Array(W * H).fill(-1);
    let boxes = [];
    for (let s = 0; s < W * H; s++) {
      if (!ink[s] || label[s] !== -1) continue;
      const id = boxes.length;
      let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
      const st = [s]; label[s] = id;
      while (st.length) {
        const p = st.pop(); const x = p % W; const y = (p - x) / W;
        area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (ink[q] && label[q] === -1) { label[q] = id; st.push(q); }
        }
      }
      if (area >= 400) boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
    // split any box holding a deep interior valley (two shapes joined by a tail)
    const colInk = (box, x) => { let n = 0; for (let y = box.y; y < box.y + box.h; y++) if (ink[y * W + x]) n++; return n; };
    const tight = (x0, x1, y0, y1) => {
      let minX = x1, minY = y1, maxX = x0, maxY = y0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ink[y * W + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    };
    const final = [];
    for (const b of boxes) {
      const cols = [];
      for (let x = b.x; x < b.x + b.w; x++) cols.push(colInk(b, x));
      const inner = cols.map((v, i) => ({ v, i })).slice(25, cols.length - 25);
      const med = [...cols].sort((a, z) => a - z)[Math.floor(cols.length / 2)];
      const low = inner.length ? inner.reduce((m, o) => (o.v < m.v ? o : m)) : null;
      if (low && med > 0 && low.v < med * 0.15) {
        const cut = b.x + low.i;
        final.push(tight(b.x, cut - 1, b.y, b.y + b.h - 1));
        final.push(tight(cut + 1, b.x + b.w - 1, b.y, b.y + b.h - 1));
      } else final.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
    return { W, H, final };
  }, `data:image/png;base64,${b64}`);
  await browser.close();

  const boxes = out.final.sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
  const named = boxes.map((b) => {
    const hit = NAMES.reduce((best, n) => {
      const d = Math.hypot(n.at[0] - b.x, n.at[1] - b.y);
      return d < best.d ? { d, name: n.name } : best;
    }, { d: 1e9, name: '?' });
    return { name: hit.name, ...b };
  });
  console.log(`sheet ${out.W} x ${out.H} — ${named.length} sprites`);
  named.forEach((b) => console.log(`  ${b.name.padEnd(10)} x=${String(b.x).padStart(3)} y=${String(b.y).padStart(3)} w=${String(b.w).padStart(3)} h=${String(b.h).padStart(3)}`));
  const dup = named.map((n) => n.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) console.log('WARNING duplicate names:', dup.join(', '));
  const sprites = Object.fromEntries(
    named.map((b) => [b.name, { x: b.x, y: b.y, w: b.w, h: b.h }])
  );
  // The note is emitted rather than hand-added, so regenerating the map does
  // not silently delete the only pointer to the documentation.
  fs.writeFileSync(
    OUTMAP,
    JSON.stringify(
      {
        note:
          'Generated by tools/map.js — re-run it rather than editing by hand. ' +
          'Coordinates are source pixels, tight to the ink. See designpics/SPRITES.md.',
        sheet: { w: out.W, h: out.H },
        sprites
      },
      null,
      2
    ) + '\n'
  );
  console.log(`wrote ${OUTMAP}`);
})();
