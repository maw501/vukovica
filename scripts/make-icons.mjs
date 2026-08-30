#!/usr/bin/env node
/**
 * Regenerate the app's icon set.
 *
 * The artwork is a placeholder wordmark — "Вук" (Vuk, for Vuk Karadžić, who
 * gave Serbian its Cyrillic alphabet and this app its name) in white on the
 * theme's deep blue. Everything is drawn here as SVG and rasterised with
 * macOS's built-in `qlmanage`, so the repo needs no image-processing
 * dependency. Run it on a Mac when the artwork changes:
 *
 *   node scripts/make-icons.mjs
 *
 * The generated PNGs are committed; this script is only needed to change them.
 * On a non-Mac, render the same SVG strings with any tool you like.
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = path.join(root, 'assets', 'images');
const webIcons = path.join(root, 'public', 'icons');
const tmp = path.join(root, '.icon-build');

// Kept in step with lib/theme.ts by hand — this script must not import from the
// app (it runs under plain node, with no Metro/TS pipeline).
const PRIMARY = '#17427A';
const ON_PRIMARY = '#FFFFFF';

/** Serif, because the wordmark is set in Cyrillic and sans-serif Вук reads as BYK. */
const FONT = "Georgia, 'Times New Roman', serif";

/**
 * @param {object} o
 * @param {string|null} o.background  fill for the plate, or null for transparent
 * @param {string} o.text             wordmark colour
 * @param {number} o.radius           corner radius, in the 1024 viewBox
 * @param {number} o.scale            wordmark size relative to the full-bleed default
 */
function icon({ background, text, radius = 224, scale = 1 }) {
  const size = Math.round(360 * scale);
  const plate = background
    ? `<rect width="1024" height="1024" rx="${radius}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${plate}
  <text x="512" y="512" fill="${text}" font-family="${FONT}" font-size="${size}"
        font-weight="700" text-anchor="middle" dominant-baseline="central">Вук</text>
</svg>`;
}

/** The full-bleed app icon: wordmark on the theme blue. */
const PLATE = icon({ background: PRIMARY, text: ON_PRIMARY });
/** Android/PWA maskable: same plate, square corners, wordmark inside the safe circle. */
const MASKABLE = icon({ background: PRIMARY, text: ON_PRIMARY, radius: 0, scale: 0.72 });
/** Wordmark alone, for layered Android icons and the splash screen. */
const GLYPH = icon({ background: null, text: ON_PRIMARY, scale: 0.72 });
/** Splash wants the mark on the light background the app itself uses. */
const SPLASH = icon({ background: null, text: PRIMARY, scale: 1 });
/** Android's background layer is a flat colour. */
const SOLID = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${PRIMARY}"/></svg>`;

/** [svg, output path, pixel size] */
const TARGETS = [
  [PLATE, path.join(images, 'icon.png'), 1024],
  [PLATE, path.join(images, 'favicon.png'), 48],
  [SPLASH, path.join(images, 'splash-icon.png'), 1024],
  [SOLID, path.join(images, 'android-icon-background.png'), 512],
  [GLYPH, path.join(images, 'android-icon-foreground.png'), 512],
  [GLYPH, path.join(images, 'android-icon-monochrome.png'), 432],
  [PLATE, path.join(webIcons, 'icon-192.png'), 192],
  [PLATE, path.join(webIcons, 'icon-512.png'), 512],
  [MASKABLE, path.join(webIcons, 'maskable-512.png'), 512],
  // iOS home-screen icon: no transparency, iOS applies its own mask.
  [MASKABLE, path.join(webIcons, 'apple-touch-icon.png'), 180],
];

await mkdir(tmp, { recursive: true });
await mkdir(webIcons, { recursive: true });

for (const [index, [svg, out, size]] of TARGETS.entries()) {
  const src = path.join(tmp, `${index}.svg`);
  await writeFile(src, svg);
  await run('qlmanage', ['-t', '-s', String(size), '-o', tmp, src]);

  // qlmanage names its output `<input>.png` and offers no way to change that.
  const produced = (await readdir(tmp)).find((f) => f === `${index}.svg.png`);
  if (!produced) throw new Error(`qlmanage produced no thumbnail for ${out}`);
  await rename(path.join(tmp, produced), out);
  console.log(`${path.relative(root, out)} (${size}px)`);
}

await rm(tmp, { recursive: true, force: true });
