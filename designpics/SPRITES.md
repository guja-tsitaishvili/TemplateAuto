# Sprite sheets — many poses, one file

Some artwork arrives as a **contact sheet**: one PNG holding several poses of
the same subject. `blackpanthera.png` is ten poses of one panther.

Rather than splitting it into ten files, a sidecar map names each region and the
renderer crops to it. One file means one `data:` URI, cached once and shared by
every pose on the slide, no matter how many are placed.

## Using one

```js
decorations: [
  { src: 'blackpanthera.png', pose: 'prowling', at: 'bottom-left', size: 46 }
]
```

`pose` is the only new field. Everything else behaves exactly as it does for a
single-image decoration — `at`, `size`, `bleed`, `rotate`, `opacity`, `flip`,
`x`, `y` all still apply. Omit `pose` and the whole sheet is drawn, which is
almost never what you want.

An unknown pose throws and lists the valid ones, rather than silently drawing
the entire sheet.

### Poses in blackpanthera.png

| pose | what it is | shape |
|---|---|---|
| `resting` | lying down, head up | wide, low |
| `standing` | side-on, alert | square |
| `head` | head and shoulders, profile | square |
| `sitting` | seated, small, facing out | tall, narrow |
| `walking` | mid-stride, head level | wide |
| `crouching` | head down, drinking or stalking | wide |
| `rear` | seen from behind | tall, narrow |
| `prowling` | long low stride, the widest one | very wide |
| `roaring` | head thrown back, mouth open | tall |
| `turning` | seated, looking back over shoulder | square |

Aspect ratio matters more than the label when placing one. `prowling` is 211x98
and reads as a band along an edge; `roaring` is 84x110 and wants a corner.
`size` is a percentage of the poster WIDTH and the height follows the pose's own
ratio, so the same `size` gives very different visual weight across poses.

## Adding a new sheet

1. Drop the PNG in `designpics/`. Transparency is preferred; a white background
   also works, since detection treats near-white as empty.
2. Generate the map. Detection is connected-component labelling of non-empty
   pixels — no image library, it runs in the Chromium that Playwright already
   installs.
3. Save it beside the image as `<name>.sprites.json`:

```json
{
  "sheet": { "w": 677, "h": 369 },
  "sprites": { "walking": { "x": 179, "y": 149, "w": 155, "h": 88 } }
}
```

Coordinates are **source pixels**, and boxes are **tight to the ink** — no
padding. That matters: a box with its own margin shifts the subject away from
wherever it was placed, and the amount differs per pose, so a row of poses stops
lining up.

### Two things detection gets wrong

**Touching subjects merge.** Two poses joined by a whisker of tail come back as
one wide box. On this sheet the walking and crouching panthers were a single
309x120 component, because a tail bridged them. They were separated by taking a
vertical ink profile across the box and cutting at the seam — a valley of 6 ink
pixels against peaks over 100.

**A long subject looks like a merge.** `prowling` is 211x98, wide enough to look
like two panthers joined, and its thinnest interior column is 12 pixels. But
that is a tail rising into a body, not a gap. The test is whether the valley
approaches zero, not whether the box is wide — splitting on width alone would
have cut this animal in half.

So: read the profile before splitting. The scratch scripts that produced this
map print both the component boxes and an ASCII ink profile per box.

## Where art gets declined

Light themes set `allowArt: false` and drop decorations entirely, so a slide
spec can be re-themed without editing it. If a pose does not appear, check the
theme before checking the map.
