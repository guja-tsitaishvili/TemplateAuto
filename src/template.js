/**
 * Builds the HTML document for a single slide.
 *
 * The page is a fixed WxH box. All type sizes are expressed as
 * calc(<px> * var(--fit)) so the in-page fitter can shrink everything
 * uniformly until the body fits without overflowing.
 */

const { getTheme } = require('./themes');
const { assetDataUri, spriteFor, spriteNames } = require('./assets');
const { resolveCta } = require('./cta');

/** Always present, top-right. The house mark. */
const SIGNATURE = 'by astraten AI';

/**
 * Noise tiles, generated once. Base64 avoids escaping the SVG inside a CSS
 * url().
 *
 * Raw feTurbulence output clusters around mid-grey, which an `overlay` blend
 * barely moves — that reads as no texture at all. feComponentTransfer stretches
 * it toward black and white first, which is what makes the grain actually show.
 *
 * @param {number} frequency  high = fine grain, low = broad paper mottling
 * @param {number} contrast   slope of the stretch
 */
function noiseTile(frequency, octaves, contrast) {
  const intercept = (1 - contrast) / 2;
  const funcs = ['R', 'G', 'B']
    .map((c) => `<feFunc${c} type="linear" slope="${contrast}" intercept="${intercept}"/>`)
    .join('');

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
       <filter id="n" x="0" y="0" width="100%" height="100%">
         <feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" stitchTiles="stitch"/>
         <feComponentTransfer>${funcs}</feComponentTransfer>
       </filter>
       <rect width="600" height="600" filter="url(#n)"/>
     </svg>`
  ).toString('base64');
}

const GRAIN = noiseTile(0.9, 3, 3.2); // fine tooth of the paper
const MOTTLE = noiseTile(0.02, 4, 2.4); // broad blotching across the sheet

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Allows **bold** inside body copy, matching the "Your fear:" labels. */
function inline(str) {
  return esc(str).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function fontLink(theme) {
  if (!theme.googleFonts || !theme.googleFonts.length) return '';
  const families = theme.googleFonts
    .map((f) => `family=${f.replace(/ /g, '+')}`)
    .join('&');
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=block">`;
}

function textureCss(theme) {
  // `texture` is either a bare name or { type, strength, vignette }, so a theme
  // can dial grain independently of how dark its vignette sits.
  const spec =
    typeof theme.texture === 'string' ? { type: theme.texture } : theme.texture || { type: 'none' };
  const strength = spec.strength == null ? 0.5 : spec.strength;
  const vignette = spec.vignette == null ? 0 : spec.vignette;

  const layer = `content:'';position:absolute;inset:0;pointer-events:none;z-index:1;`;

  switch (spec.type) {
    // Printed-paper feel rather than flat colour: broad mottling under fine
    // grain, optionally vignetted.
    case 'paper':
      return `.poster::before{${layer}
        background-image:url('data:image/svg+xml;base64,${MOTTLE}');
        background-size:100% 100%;mix-blend-mode:overlay;opacity:${(strength * 0.5).toFixed(3)};}
      .poster::after{${layer}
        background-image:url('data:image/svg+xml;base64,${GRAIN}');
        background-size:300px 300px;mix-blend-mode:overlay;opacity:${strength};}
      ${
        vignette > 0
          ? `.vig{position:absolute;inset:0;pointer-events:none;z-index:1;
             background:radial-gradient(ellipse at 50% 38%,transparent 42%,rgba(0,0,0,${vignette}) 100%);}`
          : ''
      }`;
    case 'linen':
      return `.poster::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;
        background-image:repeating-linear-gradient(90deg,rgba(0,0,0,.035) 0 1px,transparent 1px 3px),
                         repeating-linear-gradient(0deg,rgba(0,0,0,.025) 0 1px,transparent 1px 4px);}`;
    case 'vignette':
      return `.poster::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;
        background:radial-gradient(ellipse at 50% 40%,transparent 45%,rgba(0,0,0,.35) 100%);}`;
    default:
      return '';
  }
}

/**
 * Corner/edge artwork, bled slightly off-canvas so it reads as a crop
 * rather than a pasted sticker.
 *
 * @param {object} d { src, at, size, bleed, rotate, opacity, flip, x, y }
 */
function decoration(d) {
  const at = d.at || 'bottom-left';
  const size = d.size == null ? 30 : d.size;
  // Bleed is a share of the image's OWN size, not the poster's, so a small
  // decoration crops by the same visual amount as a large one.
  const bleed = d.bleed == null ? 12 : d.bleed;
  const pct = (v) => (typeof v === 'number' ? `${v}%` : v);

  const pos = [];
  let tx = '0';
  let ty = '0';

  if (d.x != null) pos.push(`left:${pct(d.x)}`);
  else if (at.includes('left')) {
    pos.push('left:0');
    tx = `-${bleed}%`;
  } else if (at.includes('right')) {
    pos.push('right:0');
    tx = `${bleed}%`;
  } else {
    pos.push('left:50%');
    tx = '-50%';
  }

  if (d.y != null) pos.push(`top:${pct(d.y)}`);
  else if (at.includes('top')) {
    pos.push('top:0');
    ty = `-${bleed}%`;
  } else if (at.includes('bottom')) {
    pos.push('bottom:0');
    ty = `${bleed}%`;
  } else {
    pos.push('top:50%');
    ty = '-50%';
  }

  const transforms = [`translate(${tx},${ty})`];
  if (d.flip) transforms.push('scaleX(-1)');
  if (d.rotate) transforms.push(`rotate(${d.rotate}deg)`);

  // A pose crops one region out of a multi-subject sheet. Done with
  // background-position rather than a clipped <img> so it scales with the
  // poster: both the size and the offset are percentages, so the same spec
  // works at any `size` without recomputing pixels.
  const sprite = d.pose ? spriteFor(d.src, d.pose) : null;
  if (d.pose && !sprite) {
    const available = spriteNames(d.src);
    throw new Error(
      `No sprite "${d.pose}" for ${d.src}.` +
        (available.length ? ` Available: ${available.join(', ')}` : ' No .sprites.json sidecar found.')
    );
  }

  if (sprite) {
    const { sheet, box } = sprite;
    // Percentages are relative to the ELEMENT for background-size, and to
    // (element - background) for background-position, which is why the
    // denominators differ.
    const bgW = (sheet.w / box.w) * 100;
    const bgH = (sheet.h / box.h) * 100;
    const posX = sheet.w === box.w ? 0 : (box.x / (sheet.w - box.w)) * 100;
    const posY = sheet.h === box.h ? 0 : (box.y / (sheet.h - box.h)) * 100;

    return `<div class="deco" style="
      ${pos.join(';')};
      width:${pct(size)};
      aspect-ratio:${box.w} / ${box.h};
      background-image:url('${assetDataUri(d.src)}');
      background-size:${bgW.toFixed(3)}% ${bgH.toFixed(3)}%;
      background-position:${posX.toFixed(3)}% ${posY.toFixed(3)}%;
      background-repeat:no-repeat;
      transform:${transforms.join(' ')};
      ${d.opacity != null ? `opacity:${d.opacity};` : ''}
    "></div>`;
  }

  return `<img class="deco" src="${assetDataUri(d.src)}" alt="" style="
    ${pos.join(';')};
    width:${pct(size)};
    transform:${transforms.join(' ')};
    ${d.opacity != null ? `opacity:${d.opacity};` : ''}
  ">`;
}

/**
 * The vignette needs a normal blend while both noise layers are on `overlay`,
 * and an element only gets one blend mode — so it rides on its own div rather
 * than a third pseudo-element.
 */
function textureMarkup(theme) {
  const spec = typeof theme.texture === 'string' ? { type: theme.texture } : theme.texture || {};
  return spec.type === 'paper' && spec.vignette > 0 ? '<div class="vig"></div>' : '';
}

function renderDecorations(slide, theme) {
  if (!Array.isArray(slide.decorations) || !slide.decorations.length) return '';
  // Light themes are meant to stay clean — art is declined rather than drawn,
  // so a shared slide spec can be re-themed without hand-editing it.
  if (!theme.allowArt) return '';
  return slide.decorations.map(decoration).join('\n');
}

function ornateFrame(theme) {
  const c = theme.titleColor;
  return `<svg class="frame" viewBox="0 0 600 760" fill="none" aria-hidden="true">
    <path d="M300 12C420 12 560 150 560 380S420 748 300 748 40 610 40 380 180 12 300 12Z"
          stroke="${c}" stroke-width="3"/>
    <path d="M300 34C408 34 538 160 538 380S408 726 300 726 62 600 62 380 192 34 300 34Z"
          stroke="${c}" stroke-width="1.6" stroke-dasharray="1 11" stroke-linecap="round"/>
    <path d="M300 52C400 52 520 168 520 380S400 708 300 708 80 592 80 380 200 52 300 52Z"
          stroke="${c}" stroke-width="2"/>
    <g stroke="${c}" stroke-width="2" stroke-linecap="round" fill="none">
      <path d="M300 74c-26 14-46 6-58 22-10 13-2 27 12 27 12 0 20-9 20-22 0-16-14-24-30-24"/>
      <path d="M300 74c26 14 46 6 58 22 10 13 2 27-12 27-12 0-20-9-20-22 0-16 14-24 30-24"/>
      <path d="M300 686c-26-14-46-6-58-22-10-13-2-27 12-27 12 0 20 9 20 22 0 16-14 24-30 24"/>
      <path d="M300 686c26-14 46-6 58-22 10-13 2-27-12-27-12 0-20 9-20 22 0 16 14 24 30 24"/>
    </g>
  </svg>`;
}

function section(s) {
  return `<p class="section">${s.label ? `<strong>${inline(s.label)}</strong> ` : ''}${inline(s.text)}</p>`;
}

function renderBody(slide, theme) {
  // The promo line closes every content slide, so its space is always part of
  // the layout instead of appearing only on some slides.
  const cta = resolveCta(slide.cta);

  if (Array.isArray(slide.bullets) && slide.bullets.length) {
    const items = [...slide.bullets];
    if (cta) items.push(`**${cta.label || ''}** ${cta.text}`.trim());
    const rendered = items
      .map(
        (b) =>
          `<li><span class="dot">${esc(theme.bulletChar)}</span><span class="txt">${inline(b)}</span></li>`
      )
      .join('');
    return `<ul class="bullets">${rendered}</ul>`;
  }

  const sections = Array.isArray(slide.sections) && slide.sections.length
    ? [...slide.sections]
    : slide.text
      ? [{ text: slide.text }]
      : [];

  if (cta) sections.push(cta);
  return sections.map(section).join('');
}

function buildHtml(slide, opts = {}) {
  const theme = getTheme(slide.theme || opts.theme || 'pink');
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const isCover = slide.type === 'cover';

  const titleSize = slide.titleSize || (isCover ? theme.coverTitleSize : theme.titleSize);
  const titleAlign = isCover ? theme.coverAlign : theme.titleAlign;

  const bgImage = slide.background
    ? `background-image:url('${assetDataUri(slide.background)}');background-size:cover;background-position:${slide.backgroundPosition || 'center'};`
    : '';

  const body = renderBody(slide, theme);

  // A framed cover has to keep its copy inside the ornament, so its text box
  // is inset well past the normal padding.
  const framed = isCover && theme.coverFrame === 'ornate';
  // Split covers park one title line at the top and one at the bottom, leaving
  // the middle open for the background artwork.
  const isSplit = isCover && (slide.titleTop || slide.titleBottom);
  const coverWidth = slide.titleWidth || (framed ? '64%' : '100%');
  const coverHeight = framed ? '74%' : '100%';
  const coverItems =
    titleAlign === 'left' ? 'flex-start' : titleAlign === 'right' ? 'flex-end' : 'center';

  return `<!doctype html>
<html><head><meta charset="utf-8">${fontLink(theme)}
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:${width}px;height:${height}px;overflow:hidden;}
  body{background:${theme.bg};}
  .poster{
    position:relative;width:${width}px;height:${height}px;
    background:${theme.bg};${bgImage}
    padding:${theme.padding}px;
    display:flex;flex-direction:column;
    ${isCover ? 'justify-content:center;align-items:center;' : ''}
    color:${theme.ink};
    -webkit-font-smoothing:antialiased;
  }
  ${textureCss(theme)}
  .deco{position:absolute;z-index:0;height:auto;pointer-events:none;}

  .signature{
    position:relative;z-index:3;
    font-family:${theme.titleFont};
    font-style:italic;font-weight:700;
    font-size:calc(26px * var(--fit));
    color:${theme.ink};opacity:.72;
    text-align:right;width:100%;
    margin-bottom:calc(16px * var(--fit));
  }
  /* On covers the text block is vertically centred, so the mark is pinned
     instead of pushing the composition down. */
  .signature.pinned{position:absolute;top:${theme.padding}px;right:${theme.padding}px;
    width:auto;margin:0;}
  .content{position:relative;z-index:2;width:100%;display:flex;flex-direction:column;
    ${isCover ? 'align-items:center;justify-content:center;flex:1;' : 'flex:1;min-height:0;'}}

  .title{
    font-family:${theme.titleFont};
    font-weight:${theme.titleWeight};
    ${theme.titleStyle ? `font-style:${theme.titleStyle};` : ''}
    font-size:calc(${titleSize}px * var(--fit));
    line-height:1.03;
    letter-spacing:${theme.titleLetterSpacing};
    text-transform:${isCover ? slide.titleTransform || theme.titleTransform : theme.titleTransform};
    color:${theme.titleColor};
    text-align:${titleAlign};
    white-space:pre-line;
    max-width:100%;
  }
  .subtitle{
    font-family:${theme.bodyFont};
    font-size:calc(${slide.subtitleSize || theme.bodySize}px * var(--fit));
    font-weight:${theme.bodyWeight};
    color:${theme.ink};
    text-align:${titleAlign};
    margin-top:calc(28px * var(--fit));
    max-width:88%;
    line-height:1.25;
  }

  .body{
    margin-top:calc(48px * var(--fit));
    font-family:${theme.bodyFont};
    font-weight:${theme.bodyWeight};
    font-size:calc(${slide.bodySize || theme.bodySize}px * var(--fit));
    line-height:${theme.bodyLineHeight};
    color:${theme.ink};
    flex:1;min-height:0;
  }
  .body strong{font-weight:700;}
  .section{text-align:${theme.bodyAlign};margin-bottom:calc(30px * var(--fit));hyphens:auto;}
  .section:last-child{margin-bottom:0;}
  .bullets{list-style:none;}
  .bullets li{display:flex;gap:calc(18px * var(--fit));margin-bottom:calc(26px * var(--fit));text-align:left;}
  .bullets li:last-child{margin-bottom:0;}
  .dot{flex:none;color:${theme.accent};}

  .frame{position:absolute;z-index:1;top:50%;left:50%;transform:translate(-50%,-50%);
    width:${Math.round(width * 0.88)}px;height:${Math.round(height * 0.86)}px;}
  .cover-inner{position:relative;z-index:2;display:flex;flex-direction:column;
    align-items:${coverItems};justify-content:${isSplit ? 'space-between' : 'center'};
    width:${coverWidth};height:${coverHeight};}
</style></head>
<body><div class="poster" style="--fit:1">
${textureMarkup(theme)}
${renderDecorations(slide, theme)}
${isCover && framed ? ornateFrame(theme) : ''}
<div class="signature${isCover ? ' pinned' : ''}">${esc(slide.signature || SIGNATURE)}</div>
${
  isCover
    ? `<div class="cover-inner">
         ${
           isSplit
             ? `<h1 class="title">${inline(slide.titleTop || '')}</h1>
                <h1 class="title">${inline(slide.titleBottom || '')}</h1>`
             : `<h1 class="title">${inline(slide.title)}</h1>
                ${slide.subtitle ? `<p class="subtitle">${inline(slide.subtitle)}</p>` : ''}`
         }
       </div>`
    : `<div class="content">
         <h1 class="title">${inline(slide.title)}</h1>
         ${
           // A short italic first-person line under the title — "I don't have
           // an attitude, I have a personality you can't handle" — sitting
           // between the sign name and the third-person bullets below it.
           // Reuses the cover's .subtitle rule; nothing else needed it before.
           slide.quote ? `<p class="subtitle" style="font-style:italic;">"${inline(slide.quote)}"</p>` : ''
         }
         <div class="body">${body}</div>
       </div>`
}
</div></body></html>`;
}

module.exports = { buildHtml };
