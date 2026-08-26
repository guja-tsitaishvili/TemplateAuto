#!/usr/bin/env node
/**
 * Composes single-subject PNGs into one sprite sheet with EXACT coordinates.
 *
 * The reverse of tools/map.js. That one scans a sheet somebody else laid out and
 * guesses where the subjects are; this one does the laying out, so the
 * coordinates are known by construction and never need detecting.
 *
 * Asking an image generator for a grid does not work — it will drift off the
 * cell, cross the lines and vary the scale, so the boxes still have to be
 * verified. Generate one subject per file and pack them here instead.
 *
 * Each input is trimmed to its own ink first, then centred in a uniform cell.
 * The recorded box is the TIGHT one, not the cell, because a box carrying its
 * own padding shifts the subject away from wherever it is placed, by a
 * different amount per pose.
 *
 * Usage:
 *   node tools/pack.js <outName> <in1.png> <in2.png> ...
 *   node tools/pack.js <outName> --dir path/to/folder
 *
 * Writes designpics/<outName>.png and designpics/<outName>.sprites.json.
 * Sprite names come from the input filenames.
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..');
const { chromium } = require(path.join(P, 'node_modules', 'playwright'));
const OUT_DIR = path.join(P, 'designpics');

const argv = process.argv.slice(2);
const outName = (argv[0] || '').replace(/\.png$/i, '');
if (!outName) {
  console.error('Usage: node tools/pack.js <outName> <images...> | --dir <folder>');
  process.exit(1);
}

let inputs;
const dirFlag = argv.indexOf('--dir');
if (dirFlag !== -1) {
  const dir = path.resolve(argv[dirFlag + 1]);
  inputs = fs
    .readdirSync(dir)
    .filter((f) => /\.(png|webp)$/i.test(f))
    .map((f) => path.join(dir, f));
} else {
  inputs = argv.slice(1).map((f) => path.resolve(f));
}
if (!inputs.length) {
  console.error('no input images found');
  process.exit(1);
}

const GAP = 8; // transparent gutter, so nothing can bleed between neighbours

(async () => {
  const files = inputs.map((f) => ({
    name: path.basename(f).replace(/\.[a-z]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    uri: `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`
  }));

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const result = await page.evaluate(
    async ({ files, gap }) => {
      // --- load every input and trim it to its own ink -------------------
      const trimmed = [];
      for (const f of files) {
        const img = new Image();
        img.src = f.uri;
        await img.decode();
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, W, H).data;

        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const solid =
              d[i + 3] > 16 && !(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240);
            if (!solid) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < 0) continue; // fully empty input
        trimmed.push({
          name: f.name,
          img,
          sx: minX,
          sy: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1
        });
      }

      // --- uniform cells, near-square grid ------------------------------
      const cellW = Math.max(...trimmed.map((t) => t.w));
      const cellH = Math.max(...trimmed.map((t) => t.h));
      const cols = Math.ceil(Math.sqrt(trimmed.length));
      const rows = Math.ceil(trimmed.length / cols);
      const sheetW = cols * cellW + (cols + 1) * gap;
      const sheetH = rows * cellH + (rows + 1) * gap;

      const sheet = document.createElement('canvas');
      sheet.width = sheetW;
      sheet.height = sheetH;
      const sctx = sheet.getContext('2d');

      const sprites = {};
      trimmed.forEach((t, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Centred in the cell, so a slightly larger pose is not biased to one
        // corner — but the RECORDED box is the tight one drawn below.
        const x = Math.round(gap + col * (cellW + gap) + (cellW - t.w) / 2);
        const y = Math.round(gap + row * (cellH + gap) + (cellH - t.h) / 2);
        sctx.drawImage(t.img, t.sx, t.sy, t.w, t.h, x, y, t.w, t.h);
        sprites[t.name] = { x, y, w: t.w, h: t.h };
      });

      return {
        png: sheet.toDataURL('image/png'),
        sheet: { w: sheetW, h: sheetH },
        cell: { w: cellW, h: cellH, cols, rows },
        sprites
      };
    },
    { files, gap: GAP }
  );

  await browser.close();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pngPath = path.join(OUT_DIR, `${outName}.png`);
  const mapPath = path.join(OUT_DIR, `${outName}.sprites.json`);

  fs.writeFileSync(pngPath, Buffer.from(result.png.split(',')[1], 'base64'));
  fs.writeFileSync(
    mapPath,
    JSON.stringify(
      {
        note:
          'Generated by tools/pack.js from single-subject images — coordinates ' +
          'are exact by construction, not detected. Re-run it rather than ' +
          'editing by hand. See designpics/SPRITES.md.',
        sheet: result.sheet,
        sprites: result.sprites
      },
      null,
      2
    ) + '\n'
  );

  const n = Object.keys(result.sprites).length;
  console.log(`packed ${n} sprites into ${result.sheet.w}x${result.sheet.h}`);
  console.log(`grid ${result.cell.cols}x${result.cell.rows}, cell ${result.cell.w}x${result.cell.h}, gap ${GAP}px`);
  for (const [name, b] of Object.entries(result.sprites)) {
    console.log(`  ${name.padEnd(14)} x=${String(b.x).padStart(4)} y=${String(b.y).padStart(4)} w=${String(b.w).padStart(4)} h=${String(b.h).padStart(4)}`);
  }
  console.log(`\n${pngPath}\n${mapPath}`);
})();
