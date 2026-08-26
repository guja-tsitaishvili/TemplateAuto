# Generating artwork for posters

## Do not ask for a grid

The tempting request is "one image, twelve poses, each centred in its own
256x256 cell, tell me the coordinates". Image models do not work that way. You
get subjects drifting off centre, crossing the cell lines, at inconsistent
scale, and sometimes two in one cell. The coordinates then have to be verified
anyway, so the constraint buys nothing and fights the model.

**Generate one subject per image. Stitch afterwards.** Then coordinates are
exact because `tools/pack.js` chose them.

## The prompt

Send this once per pose, changing only the POSE line. Everything above it stays
byte-identical — that repetition is what keeps the animal the same animal.

```
A single black panther, full body, isolated on a pure white background.

POSE: walking in profile, mid-stride, head level, tail extended low behind

Photorealistic. Matte black fur with subtle blue-grey highlights along the
spine and shoulder. Adult male, lean and muscular, medium build. Neutral even
studio lighting from the front-left, soft shadows, no dramatic rim light.
Eye level camera, straight-on, no perspective distortion, no foreshortening.

The whole animal must be inside the frame with a small even margin. Nothing
cropped. Nothing touching the edges.

Pure white background only. No ground, no shadow cast on the floor, no grass,
no rocks, no foliage, no sky, no props, no text, no watermark, no border, no
vignette, no other animals, no second panther, no reflection.
```

Then ask for the background to be removed, or run the result through a
background remover — the packer treats near-white as empty, so a clean white
backdrop works even without an alpha channel.

### Poses worth having

Swap only the POSE line:

- `standing square to camera, head up, alert, tail down`
- `walking in profile, mid-stride, head level, tail extended low behind`
- `prowling low to the ground, shoulders high, head down, long stride`
- `crouched with head lowered as if drinking, hindquarters raised`
- `sitting upright, facing the camera, tail curled around the front paws`
- `lying down at rest, head raised and facing left, front paws extended`
- `seen from directly behind, sitting, head turned slightly to the left`
- `seated, head turned back over the right shoulder toward the camera`
- `head and shoulders only, profile facing left, mouth closed`
- `head thrown back, mouth wide open mid-roar, teeth visible`

### Why each line is there

- **"isolated on a pure white background"** plus the long no-list. Generators
  add ground shadow, grass and rocks by default, and a cast shadow becomes ink
  the trimmer keeps, so the box grows and the animal sits off centre.
- **The fur and build description, repeated verbatim.** Without it you get ten
  different panthers — different mass, different fur sheen. This is the whole
  consistency mechanism.
- **"Neutral even studio lighting"** from a fixed direction. Poses lit from
  different sides do not read as one animal once they are on the same poster.
- **"Eye level, straight-on, no perspective distortion."** Mixed camera heights
  are the other thing that breaks a set.
- **"No second panther."** Worth stating outright — a "poses" prompt invites the
  model to helpfully supply several, and two touching subjects are exactly what
  made the first sheet need seam-splitting.
- **"Nothing touching the edges."** A subject clipped at the frame edge cannot
  be trimmed correctly, and it will bleed when placed.

## Then pack it

```bash
node tools/pack.js blackpanthera --dir path/to/generated
```

Writes `designpics/blackpanthera.png` and `designpics/blackpanthera.sprites.json`
with exact coordinates. Sprite names come from the filenames, so name the files
after the poses: `walking.png`, `roaring.png`.

Use it as documented in [SPRITES.md](SPRITES.md):

```js
decorations: [{ src: 'blackpanthera.png', pose: 'walking', at: 'bottom-left', size: 46 }]
```

## When you would still use tools/map.js

Only for a sheet somebody else laid out, where the coordinates are unknown and
have to be recovered. It scans for connected regions of non-empty pixels and
guesses. It also names poses by hardcoded positions specific to the original
panther sheet, so on any other sheet the boxes are right and the NAMES are
meaningless — rename them by hand, or use the packer and avoid the problem.
