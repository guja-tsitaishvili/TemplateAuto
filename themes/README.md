# Adding a poster design

One theme = one JSON file in this folder. Drop the file in and it is registered:
no code change, no import list, no restart beyond the server. The filename minus
`.json` is the theme's name.

This file is written to be followed literally — hand it to an AI along with the
design you want and it can produce a valid theme unaided.

## Minimum viable theme

```json
{
  "label": "Navy / cream",
  "moods": ["negative"],
  "allowArt": true,

  "googleFonts": ["Playfair Display:wght@700", "Lora:wght@400;700"],

  "bg": "#101F3C",
  "ink": "#F2E9DC",
  "titleColor": "#FFFFFF",
  "accent": "#F2E9DC",

  "titleFont": "'Playfair Display', Georgia, serif",
  "titleWeight": 700,
  "titleSize": 104,
  "titleTransform": "none",
  "titleLetterSpacing": "0",
  "titleAlign": "left",

  "bodyFont": "'Lora', Georgia, serif",
  "bodyWeight": 400,
  "bodySize": 38,
  "bodyLineHeight": 1.36,
  "bodyAlign": "justify",

  "bulletChar": "•",
  "coverTitleSize": 104,
  "coverAlign": "right",
  "padding": 86,
  "texture": { "type": "paper", "strength": 0.6, "vignette": 0.3 }
}
```

Required keys: `bg`, `ink`, `titleColor`, `titleFont`, `bodyFont`, and at least
one mood. Loading fails loudly if any is missing — a broken theme never renders
a broken poster.

## Metadata

| Key | Meaning |
| --- | --- |
| `label` | Human name, returned by `GET /themes` |
| `moods` | Which subject matter this design suits. See below. |
| `allowArt` | `false` means decorations are silently declined on this theme |
| `aliases` | Old names that should keep working (`yellow` answers to `mustard`) |

### Moods

The controlled vocabulary is **`love`**, **`positive`**, **`negative`**,
**`toxic`**. Anything else fails to load, which keeps the set from drifting into
thirty synonyms as designs are added.

Order matters: list the mood the design fits *best* first. `GET /themes?mood=x`
and the `mood` field on `POST /carousel` both rank by that position, so a theme
listing `love` first wins over one listing it third.

Current spread:

| Theme | Moods | Art |
| --- | --- | --- |
| `yellow` | negative, toxic | yes |
| `crimson` | toxic, negative | yes |
| `pink` | love, positive, negative | yes |
| `blush` | love, positive | no |
| `sage` | positive, love | yes |

### `allowArt`

Light backgrounds are meant to stay clean, so `blush` sets `allowArt: false`.
A slide carrying `decorations` still renders on it — the art is just dropped.
That means one slide spec can be re-themed freely without hand-editing it.

## Design keys

| Key | Notes |
| --- | --- |
| `bg` / `ink` | Background and body text colour |
| `titleColor` / `accent` | Title, and bullet dots |
| `googleFonts` | Families to load, in Google Fonts CSS2 syntax |
| `titleFont` / `bodyFont` | Full CSS stacks — always end with a generic family |
| `titleStyle` | `"italic"` if wanted, otherwise omit |
| `titleSize` / `bodySize` | Base px at 1080×1350; the fitter scales from here |
| `titleAlign` / `bodyAlign` | `bodyAlign: "justify"` gives the dense editorial block |
| `coverTitleSize` / `coverAlign` | Cover-only overrides |
| `padding` | Poster margin in px |
| `coverFrame` | `"ornate"` draws the SVG oval; omit for none |
| `texture` | See below |

Sizes are *starting points*, not final values — the fitter scales all type to
fill the frame, so what matters is the **ratio** between title and body, not the
absolute numbers.

## Texture

```json
"texture": { "type": "paper", "strength": 0.7, "vignette": 0.34 }
```

- `type` — `paper` (grain + mottling), `linen`, `vignette`, or `none`
- `strength` — 0–1, how visible the grain is
- `vignette` — 0–1, darkness at the edges; `0` for none

Dark themes carry texture well (`crimson` runs 0.7). Light themes need much less
before it turns to dirt — `blush` runs 0.22.

## Checking your work

```bash
node src/cli.js samples/core4.json out
```

Add a slide using the new theme to a sample file, render, and look at it. Both
content kinds — `sections` (prose) and `bullets` — should be checked, since a
theme that reads well as prose can be too heavy as bullets.
