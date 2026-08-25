# Gemini prompts — poster artwork

## The rules

1. **One element per image.** A hand holding a chalice. A foot with a serpent.
   One object, its own PNG.
2. **Never cut the image.** It goes on the poster whole; only the poster border
   crops it.
3. **It comes in from a corner or edge.** Part visible, the rest running off the
   canvas.
4. **It never covers the text.** Art one side, type the other.
5. **No face.** Hands, arms, legs, feet, drapery, objects.

Text is always drawn in front of artwork — the renderer guarantees that.

## The prompt

Change the noun, keep everything else. Run it once per element.

> An antique engraving of **a hand holding an ornate jeweled chalice**, forearm
> included, cropped at the elbow. Nothing else in the image. Style: 19th-century
> steel-plate etching, fine crosshatching, engraved line shading, muted
> desaturated palette. Anatomically correct hand with five clearly defined
> fingers and natural knuckles. Isolated on a pure white background, no shadow,
> no border, no frame, no scenery, even flat lighting. Maximum resolution, sharp
> fine detail.

Elements worth having:

- a hand holding an ornate jeweled chalice
- a hand holding a red apple
- a hand holding a bronze mirror
- an open hand with a serpent coiled around the wrist
- a hand holding a burning candle
- a bare foot resting on a mossy stone
- a bare foot with a serpent across it
- a coiled serpent
- a cluster of grapes on the vine
- a laurel wreath
- a length of falling classical drapery
- a cracked marble bust *(object, not a face in frame)*

Ten of these gives ten hooks that share a world and repeat nothing.

## Keeping a set consistent

Generate the **first** image, then feed it back as a reference for the rest —
"same art style, same palette, same line weight as the reference image". Vary the
subject, hold the style. That is what avoids repetition without the feed looking
like it came from four different brands.

## Palette

A coloured accent ties an image to one theme. Neutral grey and white artwork sits
comfortably on all four backgrounds — ask for neutral unless the piece is meant
for one theme specifically.

## Resolution

The poster is 1080px wide. A decoration at `size: 40` renders about 430px wide,
so the source should be at least that natively, and comfortably more if you ever
place it larger. Undersized art shows soft edges and stair-stepped alpha.

Generate at the largest size the model offers, and upscale **before** background
removal — upscaling a cut-out amplifies edge halos.

## Prep checklist

1. Generate at maximum resolution, one element per image.
2. Upscale if needed, before background removal.
3. Remove the background → transparent PNG.
4. Trim the empty margin so the artwork fills its canvas — this makes positioning
   predictable. Do not cut into the artwork itself.
5. Save to `designpics/` named for what it shows: `hand-chalice.png`,
   `foot-snake.png`, `laurel.png`.
6. Use it:

```json
{ "src": "hand-chalice", "at": "bottom-left", "size": 40 }
```

## Placement

`at` picks the corner, `size` is width as a % of poster width, `bleed` is how far
it runs off the edge as a % of its own size. `flip` mirrors it so one asset can
serve both sides.

Keep art out of whichever corner the title occupies — each theme's `coverAlign`
decides that. Full field reference is in the main [README](../README.md).
