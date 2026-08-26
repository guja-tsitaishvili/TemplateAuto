# The art catalog

`designpics/catalog.json` describes every decoration asset — what it is, what
mood it fits, and where it's physically safe to place it. It exists because a
picture's own pixels don't say any of that.

```json
"flail-chain": {
  "file": "flail-chain.png",
  "category": "object",
  "moods": ["toxic"],
  "canvas": { "w": 677, "h": 369 },
  "box": { "x": 172, "y": 0, "w": 311, "h": 329 },
  "fill": 0.228,
  "cutEdges": ["top"],
  "zones": ["top-left", "top-right"],
  "sizes": { "small": 19, "medium": 32, "big": 47 }
}
```

- **`moods`** — hand-assigned, from `{toxic, negative, love, positive}`. Read
  by looking at the picture, not derivable from pixels.
- **`box` / `fill` / `cutEdges`** — computed. `box` is the ink tight to the
  artwork inside its own canvas; `fill` is how much of that box is actually
  solid (a spindly branch is low, a skull is high); `cutEdges` lists which
  sides of the canvas the ink touches.
- **`zones`** — which poster corners the piece is allowed in, **derived from
  `cutEdges`**. A piece cut at the top of its own canvas (a chain whose top
  link is sliced off) only makes sense bleeding off the top of a poster — used
  bottom-left it would read as broken art rather than art running off the
  edge. A piece with no cut edge is a self-contained floating object and can
  go in any corner.

  **`center` is deliberately never a zone.** A render check put `hands-reaching`
  dead centre on a cover and it landed directly under the title, because the
  template centres cover text both ways — there is no text-safe centre in this
  template. Corners are the only zone the renderer keeps clear of text.

- **`sizes`** — three widths, as a percentage of poster width (the same units
  as the `size` field a decoration already takes). The cap on `big` is derived
  from the piece's own aspect ratio, not fixed the same for everyone: a piece
  far taller than it is wide would blow past a safe height at a flat
  percentage, so `big` is capped so the piece can never exceed about 40% of
  poster *height* at its largest.

## Using an entry

```js
const catalog = require('../designpics/catalog.json');
const art = catalog['flail-chain'];

decorations: [{
  src: art.file,
  at: art.zones[0],       // or any other entry in zones
  size: art.sizes.medium,
  bleed: 8
}]
```

Nothing enforces `zones` or `sizes` at render time — `decoration()` in
`src/template.js` still accepts any `at`/`size` you give it, the same as
before this catalog existed. The catalog is a lookup table for a caller to
consult, not a runtime constraint. If something places a piece outside its
listed zone, that is a choice made by the code calling it, not a bug in the
renderer.

## Choosing by mood

There's no picker function yet — `moods` is there to be filtered on:

```js
const forToxic = Object.entries(catalog).filter(([, a]) => a.moods.includes('toxic'));
```

Whether art gets auto-matched to a post's mood at compose time is a design
decision for `compose.js`/`generate.js`, not decided by this catalog.

## Adding new art

1. Drop the PNGs in `designpics/`, named however the export tool named them.
2. `node tools/geometry.js` — measures every PNG not already in the catalog.
   Safe to run repeatedly; it skips anything already catalogued.
3. `node tools/contact-sheet.js` — renders `tools/contact-sheet-N.png`, a
   labeled grid, paginated 20 per sheet. Look at it.
4. For each new item, add an entry to `tools/catalog-authored.json` keyed by
   the export filename: `{ "name": "...", "category": "...", "moods": [...] }`.
   This is the only step that needs a human — what a thing IS and what mood it
   fits cannot be computed from pixels.
5. `node tools/apply-catalog.js` — renames the files to the simple names and
   writes `designpics/catalog.json`. Safe to re-run; already-renamed files are
   detected and just get their catalog entry refreshed.

## The scripts, if something needs adjusting later

- `tools/geometry.js` — ink bounding box, edge-touch detection.
- `tools/contact-sheet.js` — the review grid.
- `tools/catalog-authored.json` — the one hand-written file. Identity and
  mood live here permanently; nothing regenerates it.
- `tools/apply-catalog.js` — merges geometry + authored data, renames files,
  writes the catalog. Contains the zone and size derivation logic.

For a multi-pose sheet like `blackpanthera.png` (one file, several subjects),
see [SPRITES.md](SPRITES.md) instead — that is a different mechanism (crop
regions within one image) from this catalog (one file per entry).
