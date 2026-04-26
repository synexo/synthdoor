'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const { GameBase, Screen, Draw, Color, Attr, CP437 } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

// ─────────────────────────────────────────────────────────────────────────────
// FILE PATHS
// ─────────────────────────────────────────────────────────────────────────────
const SPLASH_ANS_PATH  = path.join(__dirname, '..', 'art', 'splash.ans');
const BASE_OUTPUT_DIR  = path.join(__dirname, '..', 'output');
const BASE_DATA_DIR    = path.join(__dirname, '..', 'data');
const BBS_GALLERY_PATH = path.join(__dirname, '..', 'bbs-gallery.json');
const BBS_CACHE_DIR    = path.join(__dirname, '..', 'cache', 'bbs');
const USER_CACHE_BASE  = path.join(__dirname, '..', 'cache', 'users');

// ─────────────────────────────────────────────────────────────────────────────
// SCREENSAVER CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const SCREENSAVER_MIN_MS      = 5000;   // min ms before switching to next URL
const SCREENSAVER_MAX_MS      = 10000;  // max ms before switching to next URL
const CACHE_MAX_USER_ENTRIES  = 100;    // max cached images per user (LRU eviction)

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
const TERM_COLS  = 80;
const TERM_ROWS  = 24;   // rows 1–24 (row 25 = status bar)

// CP437 cell aspect ratio: 8px wide × 16px tall → cells are ~0.5:1 (w:h)
// To map source image correctly, terminal canvas effective pixel size is:
const CANVAS_PX_W = TERM_COLS * 8;   // 640
const CANVAS_PX_H = TERM_ROWS * 16;  // 384

// Logical pixel grid (half-block vertical resolution)
const LOGICAL_W = TERM_COLS;         // 80  (one per cell horizontally)
const LOGICAL_H = TERM_ROWS * 2;     // 48  (two per cell vertically via ▀/▄)

// ─────────────────────────────────────────────────────────────────────────────
// CGA PALETTE
// Index → { r, g, b } in 0–255, plus pre-computed Oklab { L, a, b }
// Order matches ANSI color codes 0–15
// ─────────────────────────────────────────────────────────────────────────────
const CGA_RGB = [
  { r:   0, g:   0, b:   0 },  //  0 BLACK
  { r: 170, g:   0, b:   0 },  //  1 RED (dark red)
  { r:   0, g: 170, b:   0 },  //  2 GREEN
  { r: 170, g: 170, b:   0 },  //  3 YELLOW (brown/olive)
  { r:   0, g:   0, b: 170 },  //  4 BLUE
  { r: 170, g:   0, b: 170 },  //  5 MAGENTA
  { r: 170, g:  85, b:   0 },  //  6 BROWN
  { r: 170, g: 170, b: 170 },  //  7 LIGHT GRAY
  { r:  85, g:  85, b:  85 },  //  8 DARK GRAY
  { r: 255, g:  85, b:  85 },  //  9 BRIGHT RED
  { r:  85, g: 255, b:  85 },  // 10 BRIGHT GREEN
  { r: 255, g: 255, b:  85 },  // 11 BRIGHT YELLOW
  { r:  85, g:  85, b: 255 },  // 12 BRIGHT BLUE
  { r: 255, g:  85, b: 255 },  // 13 BRIGHT MAGENTA
  { r:  85, g: 255, b: 255 },  // 14 BRIGHT CYAN
  { r: 255, g: 255, b: 255 },  // 15 WHITE
];

// Background colors are indices 0–7 only
const BG_COUNT = 8;
const FG_COUNT = 16;

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK CHARACTER STRATEGIES
// Each strategy describes: the CP437 character, and a function that takes
// a FG color index, a BG color index, and returns an array of 4 rendered
// Oklab colors for the 4 logical pixel positions in the cell
// (order: top-left, top-right, bottom-left, bottom-right)
// ─────────────────────────────────────────────────────────────────────────────
const STRATEGIES = [
  // ── Solid ──────────────────────────────────────────────────────────────
  { id: 'solid_fg', ch: '█', render: (fg, bg, pal) => [pal[fg], pal[fg], pal[fg], pal[fg]] },
  { id: 'solid_bg', ch: ' ', render: (fg, bg, pal) => [pal[bg], pal[bg], pal[bg], pal[bg]] },

  // ── Vertical split (▀ = upper half FG, lower half BG) ──────────────────
  // For ▀: top pixels = FG color, bottom pixels = BG color
  { id: 'upper_half', ch: '▀', render: (fg, bg, pal) => [pal[fg], pal[fg], pal[bg], pal[bg]] },
  // For ▄: top pixels = BG color, bottom pixels = FG color
  { id: 'lower_half', ch: '▄', render: (fg, bg, pal) => [pal[bg], pal[bg], pal[fg], pal[fg]] },

  // ── Horizontal split ────────────────────────────────────────────────────
  // For ▌: left pixels = FG, right pixels = BG
  { id: 'left_half',  ch: '▌', render: (fg, bg, pal) => [pal[fg], pal[bg], pal[fg], pal[bg]] },
  // For ▐: left pixels = BG, right pixels = FG
  { id: 'right_half', ch: '▐', render: (fg, bg, pal) => [pal[bg], pal[fg], pal[bg], pal[fg]] },

  // ── Shade blend (all 4 pixels = lerp of BG→FG at fixed coverage) ────────
  { id: 'shade_25',   ch: '░', render: (fg, bg, pal) => { const c = lerpOklab(pal[bg], pal[fg], 0.25); return [c,c,c,c]; } },
  { id: 'shade_50',   ch: '▒', render: (fg, bg, pal) => { const c = lerpOklab(pal[bg], pal[fg], 0.50); return [c,c,c,c]; } },
  { id: 'shade_75',   ch: '▓', render: (fg, bg, pal) => { const c = lerpOklab(pal[bg], pal[fg], 0.75); return [c,c,c,c]; } },
];

// ─────────────────────────────────────────────────────────────────────────────
// KNOB DEFAULTS & RANGES
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CONTRAST        = 1.0;
const DEFAULT_SATURATION      = 1.1;
const DEFAULT_BRIGHTNESS      = 0.0;
const DEFAULT_COLOR_TEMP      = 0.0;
const DEFAULT_DITHER_STRENGTH = 0.75;
const DEFAULT_SHADE_BIAS      = 0.5;
const DEFAULT_EDGE_ENHANCE    = 0.2;
const DEFAULT_FIDELITY        = 1;     // 1=Faithful … 5=PixelArt
const DEFAULT_ZOOM            = 1.0;
const DEFAULT_PAN_X           = 0.5;
const DEFAULT_PAN_Y           = 0.5;
const DEFAULT_FILL_COLOR_IDX  = 0;     // index into CGA 0–7
const DEFAULT_FILL_CHAR_IDX   = 0;     // index into FILL_CHARS

const MIN_CONTRAST            = 0.0;
const MAX_CONTRAST            = 2.0;
const MIN_SATURATION          = 0.0;
const MAX_SATURATION          = 2.0;
const MIN_BRIGHTNESS          = -0.5;
const MAX_BRIGHTNESS          = 0.5;
const MIN_COLOR_TEMP          = -1.0;
const MAX_COLOR_TEMP          = 1.0;
const MIN_DITHER               = 0.0;
const MAX_DITHER               = 1.0;
const MIN_SHADE_BIAS           = 0.0;
const MAX_SHADE_BIAS           = 1.0;
const MIN_EDGE_ENHANCE         = 0.0;
const MAX_EDGE_ENHANCE         = 1.0;
const MIN_FIDELITY             = 1;
const MAX_FIDELITY             = 5;
const MIN_ZOOM                 = 1.0;
const MAX_ZOOM                 = 8.0;

// ─────────────────────────────────────────────────────────────────────────────
// KNOB STEP SIZES
// ─────────────────────────────────────────────────────────────────────────────
const STEP_CONTRAST      = 0.1;
const STEP_SATURATION    = 0.1;
const STEP_BRIGHTNESS    = 0.05;
const STEP_COLOR_TEMP    = 0.1;
const STEP_DITHER        = 0.05;
const STEP_SHADE_BIAS    = 0.1;
const STEP_EDGE_ENHANCE  = 0.1;
const STEP_ZOOM          = 0.25;
const PAN_STEP_BASE      = 0.05;  // fraction of image per keypress at zoom=1

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATE MODE CONSTANTS
// Controls the speed and behaviour of the A key zoom/pan tour.
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_ZOOM_MIN      = 1.0;   // starting zoom level
const AUTO_ZOOM_MAX      = 4.0;   // maximum zoom reached during tour
const AUTO_ZOOM_SPEED    = 0.004; // zoom units added per frame (~30ms tick)
const AUTO_PAN_SPEED     = 0.003; // pan fraction moved per frame
const AUTO_RENDER_MS     = 120;   // ms between auto-rendered frames (lower = faster)

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-VARY CONSTANTS
// One knob steps by one human-scale increment at a time, then waits.
// The image settles between steps so the user can react and stop (0 key).
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_VARY_STEP_MS_MIN    = 500;  // minimum ms to hold a value before next step
const AUTO_VARY_STEP_MS_MAX    = 1500; // maximum ms to hold a value before next step
const AUTO_VARY_CONTRAST_MIN   = 1.0;
const AUTO_VARY_CONTRAST_MAX   = 2.0;
const AUTO_VARY_SATURATION_MIN = 0.1;
const AUTO_VARY_SATURATION_MAX = 2.0;
const AUTO_VARY_BRIGHTNESS_MIN = -0.2;
const AUTO_VARY_BRIGHTNESS_MAX =  0.2;
const AUTO_VARY_EDGE_MIN       = 0.0;
const AUTO_VARY_EDGE_MAX       = 1.0;
const AUTO_VARY_FIDELITY_MIN   = 1;
const AUTO_VARY_FIDELITY_MAX   = 5;

// ─────────────────────────────────────────────────────────────────────────────
// FIDELITY MODE NAMES
// ─────────────────────────────────────────────────────────────────────────────
const FIDELITY_NAMES = [
  '',             // placeholder (1-indexed)
  'Faithful',
  'Naturalistic',
  'Interpreted',
  'Stylized',
  'Pixel Art',
];

// ─────────────────────────────────────────────────────────────────────────────
// FILL CHARACTER CYCLE
// Cycles through: space, full block, light shade, medium shade, dark shade
// ─────────────────────────────────────────────────────────────────────────────
const FILL_CHARS = [' ', '█', '░', '▒', '▓'];

// ─────────────────────────────────────────────────────────────────────────────
// PRESET DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
const PRESETS = [
  {
    name: 'Photo',
    contrast: 1.1, saturation: 1.2, brightness: 0.0, colorTemp: 0.0,
    dither: 0.85, shadeBias: 0.5, edgeEnhance: 0.1, fidelity: 1,
  },
  {
    name: 'Graphic',
    contrast: 1.2, saturation: 1.4, brightness: 0.0, colorTemp: 0.0,
    dither: 0.6, shadeBias: 0.3, edgeEnhance: 0.6, fidelity: 3,
  },
  {
    name: 'Portrait',
    contrast: 1.0, saturation: 1.1, brightness: 0.0, colorTemp: 0.0,
    dither: 0.75, shadeBias: 0.6, edgeEnhance: 0.2, fidelity: 2,
  },
  {
    name: 'Line Art',
    contrast: 1.3, saturation: 1.0, brightness: 0.0, colorTemp: 0.0,
    dither: 0.4, shadeBias: 0.2, edgeEnhance: 0.9, fidelity: 4,
  },
  {
    name: 'Pixel Art',
    contrast: 1.1, saturation: 1.3, brightness: 0.0, colorTemp: 0.0,
    dither: 0.5, shadeBias: 0.4, edgeEnhance: 0.7, fidelity: 5,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function lerp(a, b, t) { return a + (b - a) * t; }

// sRGB component → linear light
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// linear light → sRGB component (0–255)
function linearToSrgb(v) {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(clamp(c * 255, 0, 255));
}

// sRGB { r, g, b } (0–255) → Oklab { L, a, b }
function rgbToOklab({ r, g, b }) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L:  0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a:  1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b:  0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

// Oklab { L, a, b } → sRGB { r, g, b } (0–255)
function oklabToRgb({ L, a, b }) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.2914855480 * b;

  const lr = l*l*l, mr = m*m*m, sr = s*s*s;

  return {
    r: linearToSrgb( 4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr),
    g: linearToSrgb(-1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr),
    b: linearToSrgb(-0.0041960863 * lr - 0.7034186147 * mr + 1.7076147010 * sr),
  };
}

// Perceptual distance squared between two Oklab colors
function oklabDistSq(c1, c2) {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return dL*dL + da*da + db*db;
}

// Hue angle in Oklab (atan2 of a,b axes) — for red-region tiebreaking
function oklabHue({ a, b }) {
  return Math.atan2(b, a);
}

// Lerp between two Oklab colors
function lerpOklab(c1, c2, t) {
  return { L: lerp(c1.L, c2.L, t), a: lerp(c1.a, c2.a, t), b: lerp(c1.b, c2.b, t) };
}

// Is a hue angle in the red-orange-brown range? (0°–50° and 330°–360°)
function isRedRegion(hue) {
  const deg = ((hue * 180 / Math.PI) + 360) % 360;
  return deg <= 50 || deg >= 330;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-COMPUTED PALETTE IN OKLAB
// ─────────────────────────────────────────────────────────────────────────────
const CGA_OKLAB = CGA_RGB.map(rgbToOklab);

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE LOADING
// ─────────────────────────────────────────────────────────────────────────────
// URL → deterministic cache filename (md5 hex)
function urlCacheHash(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

function urlCacheFile(cacheDir, url) {
  return path.join(cacheDir, urlCacheHash(url) + '.imgcache');
}

// Load image from cache if available, otherwise fetch and cache.
// cacheDir: directory to use for this image's cache (BBS or user-specific)
// onCached(hash, url, byteLength): called after a successful network fetch+cache write
// onCacheHit(hash): called after a successful cache read (for LRU update)
async function loadImageFromUrl(url, cacheDir, onCached, onCacheHit) {
  let Jimp;
  try {
    ({ Jimp } = require('jimp'));
  } catch {
    throw new Error('Jimp not installed. Run: npm install jimp (from synthdoor root)');
  }

  // Check cache first
  if (cacheDir) {
    const cf = urlCacheFile(cacheDir, url);
    if (fs.existsSync(cf)) {
      const buf = fs.readFileSync(cf);
      if (onCacheHit) onCacheHit(urlCacheHash(url));
      return await Jimp.fromBuffer(buf);
    }
  }

  // Fetch from network
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const buf = Buffer.from(await res.arrayBuffer());

  // Write to cache
  if (cacheDir) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(urlCacheFile(cacheDir, url), buf);
      if (onCached) onCached(urlCacheHash(url), url, buf.length);
    } catch { /* cache write failure is non-fatal */ }
  }

  return await Jimp.fromBuffer(buf);
}

// Extract RGBA pixel data from Jimp image as flat Uint8Array [r,g,b,a, r,g,b,a ...]
// Resizes image to targetW × targetH using cover/contain as appropriate
function extractPixels(jimpImg, targetW, targetH) {
  // Jimp v1 API
  const clone = jimpImg.clone();
  clone.resize({ w: targetW, h: targetH });
  const { data, width, height } = clone.bitmap;
  // data is a Buffer of RGBA bytes
  const pixels = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      row.push({ r: data[i], g: data[i+1], b: data[i+2], a: data[i+3] });
    }
    pixels.push(row);
  }
  return pixels;  // [row][col] of {r,g,b,a}
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE PRE-PROCESSING (applied to sRGB pixel array before Oklab conversion)
// All adjustments operate on {r,g,b} 0–255
// ─────────────────────────────────────────────────────────────────────────────

// Apply pre-processing knobs to a single pixel (composite alpha against fillRgb first)
function preprocessPixel(px, fillRgb, contrast, saturation, brightness, colorTemp) {
  // 1. Alpha composite against fill color
  const alpha = px.a / 255;
  let r = Math.round(alpha * px.r + (1 - alpha) * fillRgb.r);
  let g = Math.round(alpha * px.g + (1 - alpha) * fillRgb.g);
  let b = Math.round(alpha * px.b + (1 - alpha) * fillRgb.b);

  // 2. Brightness (additive, pre-clamp)
  const bAdj = brightness * 255;
  r = clamp(r + bAdj, 0, 255);
  g = clamp(g + bAdj, 0, 255);
  b = clamp(b + bAdj, 0, 255);

  // 3. Contrast (pivot around 128)
  r = clamp((r - 128) * contrast + 128, 0, 255);
  g = clamp((g - 128) * contrast + 128, 0, 255);
  b = clamp((b - 128) * contrast + 128, 0, 255);

  // 4. Saturation via luminance-based desaturation
  const lum = 0.2126 * r/255 + 0.7152 * g/255 + 0.0722 * b/255;
  r = clamp(lum * 255 + (r - lum * 255) * saturation, 0, 255);
  g = clamp(lum * 255 + (g - lum * 255) * saturation, 0, 255);
  b = clamp(lum * 255 + (b - lum * 255) * saturation, 0, 255);

  // 5. Color temperature (warm = +R-B, cool = -R+B)
  if (colorTemp !== 0) {
    const shift = colorTemp * 30;
    r = clamp(r + shift, 0, 255);
    b = clamp(b - shift, 0, 255);
  }

  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOBEL EDGE DETECTION (optional, for edge enhancement)
// Returns a 2D array of edge strength 0.0–1.0
// ─────────────────────────────────────────────────────────────────────────────
function sobelEdges(oklabGrid, rows, cols) {
  const edges = Array.from({ length: rows }, () => new Float32Array(cols));
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const lum = (c) => c.L;
      const gx = (
        -lum(oklabGrid[y-1][x-1]) + lum(oklabGrid[y-1][x+1])
        -2*lum(oklabGrid[y][x-1]) + 2*lum(oklabGrid[y][x+1])
        -lum(oklabGrid[y+1][x-1]) + lum(oklabGrid[y+1][x+1])
      );
      const gy = (
        -lum(oklabGrid[y-1][x-1]) - 2*lum(oklabGrid[y-1][x]) - lum(oklabGrid[y-1][x+1])
        +lum(oklabGrid[y+1][x-1]) + 2*lum(oklabGrid[y+1][x]) + lum(oklabGrid[y+1][x+1])
      );
      edges[y][x] = Math.min(1.0, Math.sqrt(gx*gx + gy*gy) * 2.0);
    }
  }
  return edges;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOYD-STEINBERG ERROR DIFFUSION
// errBuf: [row][col] of {L,a,b} accumulated error (same size as logical grid)
// ─────────────────────────────────────────────────────────────────────────────
function diffuseError(errBuf, row, col, errL, rows, cols, kernel) {
  // kernel: array of [dr, dc, weight] where weights sum to 1
  for (const [dr, dc, w] of kernel) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
      errBuf[nr][nc].L += errL.L * w;
      errBuf[nr][nc].a += errL.a * w;
      errBuf[nr][nc].b += errL.b * w;
    }
  }
}

const FS_KERNEL = [
  [0, 1, 7/16],
  [1,-1, 3/16],
  [1, 0, 5/16],
  [1, 1, 1/16],
];

// Jarvis-Judice-Ninke kernel (wider spread, better for red regions)
const JJN_KERNEL = [
  [0, 1, 7/48], [0, 2, 5/48],
  [1,-2, 3/48], [1,-1, 5/48], [1, 0, 7/48], [1, 1, 5/48], [1, 2, 3/48],
  [2,-2, 1/48], [2,-1, 3/48], [2, 0, 5/48], [2, 1, 3/48], [2, 2, 1/48],
];

// ─────────────────────────────────────────────────────────────────────────────
// NEAREST COLOR HELPERS
// Used by the fidelity=4-5 optimal half-block assignment
// ─────────────────────────────────────────────────────────────────────────────

// Find nearest color index and error from a palette slice
function nearestInPalette(pixel, paletteOklab, start, count) {
  let bestIdx = start, bestErr = Infinity;
  for (let i = start; i < start + count; i++) {
    const e = oklabDistSq(pixel, paletteOklab[i]);
    if (e < bestErr) { bestErr = e; bestIdx = i; }
  }
  return { idx: bestIdx, err: bestErr };
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-CELL CONVERSION
// Given 4 Oklab source pixels (tl, tr, bl, br) + current settings,
// returns the best { ch, fg, bg } for this cell.
// ─────────────────────────────────────────────────────────────────────────────
function evaluateCell(srcPixels, shadeBiasWeight, edgeStrength, edgeEnhance, fidelity) {
  const [tl, tr, bl, br] = srcPixels;

  // ── Fidelity 1-3: reference approach ─────────────────────────────────────
  // Single unified loop over all STRATEGIES. Score all 4 logical pixels.
  // Brute-force 128 FG×BG combos for vsplits. Shades compete on equal footing.
  // This produces the best naturalistic / faithful rendering.
  if (fidelity <= 3) {
    const lums     = srcPixels.map(p => p.L);
    const mean     = lums.reduce((s, v) => s + v, 0) / 4;
    const variance = lums.reduce((s, v) => s + (v - mean) ** 2, 0) / 4;

    const vertGrad  = Math.abs((tl.L + tr.L) / 2 - (bl.L + br.L) / 2);
    const horizGrad = Math.abs((tl.L + bl.L) / 2 - (tr.L + br.L) / 2);

    const fidT            = (fidelity - 1) / 4;
    const shadePenaltyBase = fidT * 0.08;
    const shadePenaltyVar  = variance * (1.0 - shadeBiasWeight) * 0.2;
    const shadePenalty     = shadePenaltyBase + shadePenaltyVar;
    const splitBonusScale  = fidT * 0.05;
    const hSplitBasePenalty = 0.015 + fidT * 0.025;
    const edgePenalty      = edgeStrength * edgeEnhance;

    let bestScore = Infinity;
    let bestCh = ' ', bestFg = 0, bestBg = 0;

    for (const strat of STRATEGIES) {
      const isShade  = strat.id.startsWith('shade_');
      const isSolid  = strat.id.startsWith('solid_');
      const isVSplit = strat.id === 'upper_half' || strat.id === 'lower_half';
      const isHSplit = strat.id === 'left_half'  || strat.id === 'right_half';

      const fgRange = (strat.id === 'solid_bg') ? [0] : Array.from({ length: FG_COUNT }, (_, i) => i);
      const bgRange = (strat.id === 'solid_fg') ? [0] : Array.from({ length: BG_COUNT }, (_, i) => i);

      for (const fg of fgRange) {
        for (const bg of bgRange) {
          if (bg > 7) continue;
          if (strat.id === 'solid_fg' && fg === bg) continue;

          const rendered = strat.render(fg, bg, CGA_OKLAB);

          let score = 0;
          for (let i = 0; i < 4; i++) score += oklabDistSq(srcPixels[i], rendered[i]);

          if (isShade) score += shadePenalty;

          if (isVSplit && vertGrad > horizGrad) score -= splitBonusScale * vertGrad;
          if (isHSplit) {
            score += hSplitBasePenalty;
            if (horizGrad > vertGrad * 2) score -= splitBonusScale * horizGrad;
          }

          if (edgePenalty > 0 && !isSolid && !isShade) {
            const fgBgDist = oklabDistSq(CGA_OKLAB[fg], CGA_OKLAB[bg]);
            score += edgePenalty * (0.5 - Math.min(0.5, fgBgDist * 2));
          }

          if (fidelity >= 2 && score < bestScore * 1.05) {
            const srcHue = oklabHue(tl);
            if (isRedRegion(srcHue)) {
              score += Math.abs(srcHue - oklabHue(rendered[0])) * 0.3;
            }
          }

          if (score < bestScore) { bestScore = score; bestCh = strat.ch; bestFg = fg; bestBg = bg; }
        }
      }
    }

    return { ch: bestCh, fg: bestFg, bg: bestBg, score: bestScore };
  }

  // ── Fidelity 4: optimal half-block + topPx/botPx basis ───────────────────
  // Uses the O(24) optimal vsplit assignment and 2-pixel scoring basis.
  // Shades and horizontal splits still compete but on the averaged pixel basis.
  // Produces a stylized look that bridges naturalistic and pixel art.
  const topPx = { L: (tl.L+tr.L)/2, a: (tl.a+tr.a)/2, b: (tl.b+tr.b)/2 };
  const botPx = { L: (bl.L+br.L)/2, a: (bl.a+br.a)/2, b: (bl.b+br.b)/2 };

  const mean     = (topPx.L + botPx.L) / 2;
  const variance = ((topPx.L-mean)**2 + (botPx.L-mean)**2) / 2;

  const vertGrad  = Math.abs(topPx.L - botPx.L);
  const horizGrad = Math.abs((tl.L + bl.L)/2 - (tr.L + br.L)/2);

  const fidT            = (fidelity - 1) / 4;
  const shadePenaltyBase = fidT * 0.08;
  const shadePenaltyVar  = variance * (1.0 - shadeBiasWeight) * 0.2;
  const shadePenalty     = shadePenaltyBase + shadePenaltyVar;
  const splitBonusScale  = fidT * 0.05;
  const hSplitBasePenalty = 0.015 + fidT * 0.025;
  const edgePenalty      = edgeStrength * edgeEnhance;

  let bestScore = Infinity;
  let bestCh = ' ', bestFg = 0, bestBg = 0;

  // Optimal vertical split: O(24) instead of brute-force 128
  {
    const topFg = nearestInPalette(topPx, CGA_OKLAB, 0, FG_COUNT);
    const botFg = nearestInPalette(botPx, CGA_OKLAB, 0, FG_COUNT);
    const topBg = nearestInPalette(topPx, CGA_OKLAB, 0, BG_COUNT);
    const botBg = nearestInPalette(botPx, CGA_OKLAB, 0, BG_COUNT);

    if (topFg.idx !== botBg.idx) {
      let vScore = topFg.err + botBg.err;
      if (vertGrad > horizGrad) vScore -= splitBonusScale * vertGrad;
      if (isRedRegion(oklabHue(topPx)))
        vScore += Math.abs(oklabHue(topPx) - oklabHue(CGA_OKLAB[topFg.idx])) * 0.3;
      if (vScore < bestScore) { bestScore = vScore; bestCh = '▀'; bestFg = topFg.idx; bestBg = botBg.idx; }
    }

    if (botFg.idx !== topBg.idx) {
      let vScore = botFg.err + topBg.err;
      if (vertGrad > horizGrad) vScore -= splitBonusScale * vertGrad;
      if (isRedRegion(oklabHue(topPx)))
        vScore += Math.abs(oklabHue(topPx) - oklabHue(CGA_OKLAB[botFg.idx])) * 0.3;
      if (vScore < bestScore) { bestScore = vScore; bestCh = '▄'; bestFg = botFg.idx; bestBg = topBg.idx; }
    }
  }

  // Solid, shade, horizontal split — scored on topPx/botPx averages
  for (const strat of STRATEGIES) {
    const isShade  = strat.id.startsWith('shade_');
    const isSolid  = strat.id.startsWith('solid_');
    const isVSplit = strat.id === 'upper_half' || strat.id === 'lower_half';
    const isHSplit = strat.id === 'left_half'  || strat.id === 'right_half';

    if (isVSplit) continue;  // handled above

    const fgRange = (strat.id === 'solid_bg') ? [0] : Array.from({ length: FG_COUNT }, (_, i) => i);
    const bgRange = (strat.id === 'solid_fg') ? [0] : Array.from({ length: BG_COUNT }, (_, i) => i);

    for (const fg of fgRange) {
      for (const bg of bgRange) {
        if (bg > 7) continue;
        if (strat.id === 'solid_fg' && fg === bg) continue;

        const rendered = strat.render(fg, bg, CGA_OKLAB);
        let score = oklabDistSq(topPx, rendered[0]) + oklabDistSq(botPx, rendered[2]);

        if (isShade) score += shadePenalty;

        if (isHSplit) {
          score += hSplitBasePenalty;
          if (horizGrad > vertGrad * 2) score -= splitBonusScale * horizGrad;
        }

        if (edgePenalty > 0 && !isSolid && !isShade) {
          const fgBgDist = oklabDistSq(CGA_OKLAB[fg], CGA_OKLAB[bg]);
          score += edgePenalty * (0.5 - Math.min(0.5, fgBgDist * 2));
        }

        if (score < bestScore * 1.05 && isRedRegion(oklabHue(topPx))) {
          score += Math.abs(oklabHue(topPx) - oklabHue(rendered[0])) * 0.3;
        }

        if (score < bestScore) { bestScore = score; bestCh = strat.ch; bestFg = fg; bestBg = bg; }
      }
    }
  }

  return { ch: bestCh, fg: bestFg, bg: bestBg, score: bestScore };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSI COLOR CODE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
// Map our 0–15 color index to ANSI fg/bg codes
function ansiSetColor(fg, bg) {
  // FG: colors 0–7 → 30–37, colors 8–15 → bold + 30–37
  // BG: colors 0–7 → 40–47
  const parts = [0];
  if (fg >= 8) { parts.push(1); parts.push(30 + fg - 8); }
  else          { parts.push(30 + fg); }
  parts.push(40 + (bg & 7));
  return `\x1b[${parts.join(';')}m`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAUCE RECORD (Standard Architecture for Universal Comment Extensions)
// 128-byte binary trailer appended to .ANS files
// ─────────────────────────────────────────────────────────────────────────────
function buildSauceRecord(title, author, width = 80, height = 24) {
  const buf = Buffer.alloc(128, 0);
  // ID
  buf.write('SAUCE', 0, 'ascii');
  // Version
  buf.write('00', 5, 'ascii');
  // Title (35 bytes, space-padded)
  buf.write((title || '').substring(0, 35).padEnd(35, ' '), 7, 'ascii');
  // Author (20 bytes)
  buf.write((author || '').substring(0, 20).padEnd(20, ' '), 42, 'ascii');
  // Group (20 bytes)
  buf.write('SynthDoor'.padEnd(20, ' '), 62, 'ascii');
  // Date (8 bytes YYYYMMDD)
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  buf.write(dateStr, 82, 'ascii');
  // FileSize (4 bytes LE) — we'll write 0, updated after
  buf.writeUInt32LE(0, 90);
  // DataType: 1 = Character
  buf.writeUInt8(1, 94);
  // FileType: 1 = ANSI
  buf.writeUInt8(1, 95);
  // TInfo1: width (2 bytes LE)
  buf.writeUInt16LE(width,  96);
  // TInfo2: height (2 bytes LE)
  buf.writeUInt16LE(height, 98);
  // TFlags: ANSiFlags byte — bit 0 = non-blink (iCE colors), bit 3 = UTF-8 (we don't set)
  buf.writeUInt8(0, 104);
  // Comments: 0
  buf.writeUInt8(0, 100);
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN GAME CLASS
// ─────────────────────────────────────────────────────────────────────────────
class Img2Ansi extends GameBase {
  static get GAME_NAME()  { return 'img2ansi'; }
  static get GAME_TITLE() { return 'IMG2ANSI'; }

  // ─── State initialisation ────────────────────────────────────────────────
  _initState() {
    // Knobs
    this._contrast      = DEFAULT_CONTRAST;
    this._saturation    = DEFAULT_SATURATION;
    this._brightness    = DEFAULT_BRIGHTNESS;
    this._colorTemp     = DEFAULT_COLOR_TEMP;
    this._dither        = DEFAULT_DITHER_STRENGTH;
    this._shadeBias     = DEFAULT_SHADE_BIAS;
    this._edgeEnhance   = DEFAULT_EDGE_ENHANCE;
    this._fidelity      = DEFAULT_FIDELITY;
    this._zoom          = DEFAULT_ZOOM;
    this._panX          = DEFAULT_PAN_X;
    this._panY          = DEFAULT_PAN_Y;
    this._fillColorIdx  = DEFAULT_FILL_COLOR_IDX;
    this._fillCharIdx   = DEFAULT_FILL_CHAR_IDX;
    this._presetIdx     = -1;  // -1 = custom

    // Runtime
    this._jimpImg       = null;   // loaded Jimp image
    this._imageUrl      = '';
    this._frameCache    = null;   // last rendered cell grid
    this._dirty         = true;
    this._loading       = false;
    this._loadError     = '';
    this._showHud       = false;
    this._showHelp      = false;
    this._automate      = false;  // automate zoom/pan tour active
    this._autoZoomDir   = 1;      // 1 = zooming in, -1 = zooming out
    this._autoPanDX     = AUTO_PAN_SPEED;
    this._autoPanDY     = AUTO_PAN_SPEED * 0.7; // slightly different X/Y for lissajous feel
    this._autoLastRender = 0;
    this._autoVary          = false; // auto-vary settings active (0 key)
    this._autoVaryNextMs    = 0;     // timestamp when next step fires
    this._autoVaryKnob      = 0;     // which knob is currently being stepped (0-4)
    this._autoVaryDir       = 1;     // current step direction (+1 or -1)
    this._autoVaryLastTickMs = 0;
    this._screensaver       = false; // screensaver mode active
    this._screensaverNextMs = 0;     // when to switch to next URL
    this._screensaverUrls   = [];    // shuffled URL list for screensaver
    this._screensaverIdx    = 0;     // current position in shuffled list
  }

  // ─── Entry point ─────────────────────────────────────────────────────────
  async run() {
    this.screen.setMode(Screen.FIXED);
    this.input.start();

    // Unbind conflicting default engine key mappings
    this.input.unbind('H');
    this.input.unbind('h');
    this.input.unbind('S');
    this.input.unbind('s');
    // Also unbind vim L (RIGHT) since L is our saturation up key
    this.input.unbind('L');

    let keepRunning = true;

    while (keepRunning) {
      this._initState();
      await this._showSplash();

      // Start screen: load saved data, offer load/new/screensaver
      const startResult = await this._startScreen();

      if (!startResult) { keepRunning = false; break; }

      if (startResult.action === 'screensaver') {
        const ssUrl = await this._runScreensaver(startResult.urls, startResult.isBbs);
        if (ssUrl) {
          // Screensaver stopped on a live image — drop into main loop on it
          await this._mainLoop(ssUrl);
          const again = await this._convertAnotherPrompt();
          if (!again) { keepRunning = false; break; }
        }
        continue;
      }

      const url = startResult.url;
      if (!url) { keepRunning = false; break; }

      await this._mainLoop(url);

      const again = await this._convertAnotherPrompt();
      if (!again) keepRunning = false;
    }

    this.input.stop();
    this.screen.setMode(Screen.SCROLL);
    this.terminal.resetAttrs();
    this.terminal.println('');
    this.terminal.println('Thanks for using IMG2ANSI. Goodbye!');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPLASH SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  async _showSplash() {
    this.screen.clear(Color.BLACK, Color.BLACK);

    // Try loading .ANS splash file
    let splashLoaded = false;
    if (fs.existsSync(SPLASH_ANS_PATH)) {
      try {
        const ansiStr = fs.readFileSync(SPLASH_ANS_PATH, 'binary');
        // ANS files go through the terminal directly in scroll mode
        // We switch momentarily, write, then switch back
        this.screen.setMode(Screen.SCROLL);
        this.terminal.writeRaw('\x1b[2J\x1b[H');
        Draw.ansiArt(this.terminal, ansiStr);
        splashLoaded = true;
      } catch {
        splashLoaded = false;
        this.screen.setMode(Screen.FIXED);
        this.screen.clear(Color.BLACK, Color.BLACK);
      }
    }

    if (!splashLoaded) {
      // Fallback: programmatic splash in FIXED mode
      this.screen.setMode(Screen.FIXED);
      this.screen.clear(Color.BLACK, Color.BLACK);
      this._drawFallbackSplash();
      this.screen.flush();
    }

    this.screen.statusBar(' IMG2ANSI  |  SynthDoor  |  Press any key to continue...', Color.BLACK, Color.CYAN);
    if (splashLoaded) {
      // statusBar needs FIXED mode
      this.screen.setMode(Screen.FIXED);
      this.screen.flush();
    }

    await this.terminal.waitKey();
  }

  _drawFallbackSplash() {
    // Full-block decorative border
    const W  = Color.BRIGHT_WHITE;
    const CY = Color.BRIGHT_CYAN;
    const BK = Color.BLACK;
    const YL = Color.BRIGHT_YELLOW;
    const GR = Color.BRIGHT_GREEN;

    // Top/bottom border rows
    for (let c = 1; c <= 80; c++) {
      this.screen.putChar(c, 1,  '█', Color.BLUE, BK);
      this.screen.putChar(c, 24, '█', Color.BLUE, BK);
    }
    for (let r = 2; r <= 23; r++) {
      this.screen.putChar(1,  r, '█', Color.BLUE, BK);
      this.screen.putChar(80, r, '█', Color.BLUE, BK);
    }

    // Title using blockBanner
    Draw.blockBanner(this.screen, 4, 'IMG2ANSI', CY, BK, 9);

    // Subtitle
    const sub = 'CP437 / ANSI Image Converter';
    const subCol = Math.floor((80 - sub.length) / 2) + 1;
    this.screen.putString(subCol, 12, sub, YL, BK);

    // Decorative shade line
    for (let c = 10; c <= 71; c++) {
      const ch = ['░', '▒', '▓', '▒', '░'][(c - 10) % 5];
      this.screen.putChar(c, 14, ch, Color.CYAN, BK);
    }

    // Feature bullets
    const features = [
      '16 FG / 8 BG Colors  \u00b7  80\u00d724 Terminal  \u00b7  Half-Block Resolution',
      'Perceptual Oklab Color Matching  \u00b7  Error Diffusion Dithering',
    ];
    for (let i = 0; i < features.length; i++) {
      const col = Math.floor((80 - features[i].length) / 2) + 1;
      this.screen.putString(col, 16 + i, features[i], W, BK);
    }

    // Version / credits
    const credit = 'SynthDoor Edition  \u00b7  synthdoor.net';
    const creditCol = Math.floor((80 - credit.length) / 2) + 1;
    this.screen.putString(creditCol, 21, credit, GR, BK);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // URL ENTRY SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  async _urlEntryScreen() {
    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);

    Draw.titleBar(this.screen, ' IMG2ANSI  \u00b7  Enter Image URL', Color.BRIGHT_WHITE, Color.BLUE);

    this.screen.putString(3, 5,  'Enter the full URL of an image to convert.', Color.WHITE, Color.BLACK);
    this.screen.putString(3, 6,  'Supported formats: JPEG, PNG, GIF (first frame), TIFF, BMP', Color.DARK_GRAY, Color.BLACK);

    this.screen.putString(3, 9,  'URL:', Color.BRIGHT_YELLOW, Color.BLACK);

    // Underline-style input guide — a row of dots showing available input space
    this.screen.putString(3, 10, '\u00b7'.repeat(76), Color.DARK_GRAY, Color.BLACK);

    this.screen.putString(3, 14, 'Leave blank and press ENTER to exit.', Color.DARK_GRAY, Color.BLACK);

    this.screen.statusBar(' IMG2ANSI  |  Type URL and press ENTER  |  Blank = Exit', Color.BLACK, Color.CYAN);
    this.screen.flush();

    // Position cursor at start of input area, below the label
    this.terminal.moveTo(3, 11);
    this.terminal.showCursor();

    let url = '';
    try {
      url = await this.terminal.readLine({ maxLen: 200, echo: true });
    } catch {
      url = '';
    }

    this.terminal.hideCursor();
    return (url || '').trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN INTERACTIVE LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  async _mainLoop(url) {
    this._imageUrl = url;
    this._running  = true;

    this.screen.setMode(Screen.FIXED);

    // Show loading indicator while fetching
    await this._showLoading('Fetching image...');

    try {
      this._jimpImg = await loadImageFromUrl(
        url,
        this._userCacheDir(),
        (h, u, b) => this._onUserCached(h, u, b),
        (h)       => this._onUserCacheHit(h)
      );
      this._loadError = '';
    } catch (err) {
      this._loadError = err.message;
      await this._showError(this._loadError);
      return;
    }

    this._dirty   = true;
    this._running = true;

    const onAction = (action) => {
      if (!this._running) return;
      if (this._showHelp) {
        this._showHelp = false;
        this._dirty    = true;
        return;
      }
      switch (action) {
        case 'UP':    this._pan(0, -1); break;
        case 'DOWN':  this._pan(0,  1); break;
        case 'LEFT':  this._pan(-1, 0); break;
        case 'RIGHT': this._pan( 1, 0); break;
        case 'QUIT':  this._running = false; break;
      }
    };

    const onKey = (key) => {
      if (!this._running) return;

      // Help screen closes on any key (full-screen overlay)
      if (this._showHelp) {
        this._showHelp = false;
        this._dirty    = true;
        return;
      }

      const k = key.toLowerCase ? key.toLowerCase() : key;

      switch (key) {
        // ── Zoom ──────────────────────────────────────────────────────────
        case '=': case '+':
          this._zoom = clamp(this._zoom + STEP_ZOOM, MIN_ZOOM, MAX_ZOOM);
          this._dirty = true; break;
        case '-': case '_':
          this._zoom = clamp(this._zoom - STEP_ZOOM, MIN_ZOOM, MAX_ZOOM);
          this._dirty = true; break;

        // ── Contrast O/P ──────────────────────────────────────────────────
        case 'o': case 'O':
          this._contrast = clamp(this._contrast - STEP_CONTRAST, MIN_CONTRAST, MAX_CONTRAST);
          this._dirty = true; break;
        case 'p': case 'P':
          this._contrast = clamp(this._contrast + STEP_CONTRAST, MIN_CONTRAST, MAX_CONTRAST);
          this._dirty = true; break;

        // ── Saturation K/L ────────────────────────────────────────────────
        case 'k': case 'K':
          this._saturation = clamp(this._saturation - STEP_SATURATION, MIN_SATURATION, MAX_SATURATION);
          this._dirty = true; break;
        case 'l': case 'L':
          this._saturation = clamp(this._saturation + STEP_SATURATION, MIN_SATURATION, MAX_SATURATION);
          this._dirty = true; break;

        // ── Brightness , / . ──────────────────────────────────────────────
        case ',':
          this._brightness = clamp(this._brightness - STEP_BRIGHTNESS, MIN_BRIGHTNESS, MAX_BRIGHTNESS);
          this._dirty = true; break;
        case '.':
          this._brightness = clamp(this._brightness + STEP_BRIGHTNESS, MIN_BRIGHTNESS, MAX_BRIGHTNESS);
          this._dirty = true; break;

        // ── Color Temp [ / ] ──────────────────────────────────────────────
        case '[':
          this._colorTemp = clamp(this._colorTemp - STEP_COLOR_TEMP, MIN_COLOR_TEMP, MAX_COLOR_TEMP);
          this._dirty = true; break;
        case ']':
          this._colorTemp = clamp(this._colorTemp + STEP_COLOR_TEMP, MIN_COLOR_TEMP, MAX_COLOR_TEMP);
          this._dirty = true; break;

        // ── Dither E/R ────────────────────────────────────────────────────
        case 'e': case 'E':
          this._dither = clamp(this._dither - STEP_DITHER, MIN_DITHER, MAX_DITHER);
          this._dirty = true; break;
        case 'r': case 'R':
          this._dither = clamp(this._dither + STEP_DITHER, MIN_DITHER, MAX_DITHER);
          this._dirty = true; break;

        // ── Shade Bias Z/X ────────────────────────────────────────────────
        case 'z': case 'Z':
          this._shadeBias = clamp(this._shadeBias - STEP_SHADE_BIAS, MIN_SHADE_BIAS, MAX_SHADE_BIAS);
          this._dirty = true; break;
        case 'x': case 'X':
          this._shadeBias = clamp(this._shadeBias + STEP_SHADE_BIAS, MIN_SHADE_BIAS, MAX_SHADE_BIAS);
          this._dirty = true; break;

        // ── Edge Enhancement N/M ──────────────────────────────────────────
        case 'n': case 'N':
          this._edgeEnhance = clamp(this._edgeEnhance - STEP_EDGE_ENHANCE, MIN_EDGE_ENHANCE, MAX_EDGE_ENHANCE);
          this._dirty = true; break;
        case 'm': case 'M':
          this._edgeEnhance = clamp(this._edgeEnhance + STEP_EDGE_ENHANCE, MIN_EDGE_ENHANCE, MAX_EDGE_ENHANCE);
          this._dirty = true; break;

        // ── Fidelity F/G ──────────────────────────────────────────────────
        // Note: numeric keys 1-5 are NOT bound — they conflict with numpad pan.
        // Use F/G to step fidelity, or Tab to cycle presets.
        case 'f': case 'F':
          this._fidelity = clamp(this._fidelity - 1, MIN_FIDELITY, MAX_FIDELITY);
          this._presetIdx = -1;
          this._dirty = true; break;
        case 'g': case 'G':
          this._fidelity = clamp(this._fidelity + 1, MIN_FIDELITY, MAX_FIDELITY);
          this._presetIdx = -1;
          this._dirty = true; break;

        // ── Fill Color V ──────────────────────────────────────────────────
        case 'v': case 'V':
          this._fillColorIdx = (this._fillColorIdx + 1) % BG_COUNT;
          this._dirty = true; break;

        // ── Fill Char B ───────────────────────────────────────────────────
        case 'b': case 'B':
          this._fillCharIdx = (this._fillCharIdx + 1) % FILL_CHARS.length;
          this._dirty = true; break;

        // ── Preset Tab ────────────────────────────────────────────────────
        case '\t':
          this._presetIdx = (this._presetIdx + 1) % PRESETS.length;
          this._applyPreset(PRESETS[this._presetIdx]);
          this._dirty = true; break;

        // ── Reset viewport ────────────────────────────────────────────────
        case '5':
          this._zoom = DEFAULT_ZOOM;
          this._panX = DEFAULT_PAN_X;
          this._panY = DEFAULT_PAN_Y;
          this._dirty = true; break;

        // ── HUD overlay ───────────────────────────────────────────────────
        case '/': case '?':
          this._showHud  = !this._showHud;
          this._showHelp = false;
          this._dirty    = true; break;

        // ── Help screen ───────────────────────────────────────────────────
        case 'h': case 'H':
          this._showHelp = !this._showHelp;
          this._showHud  = false;
          this._dirty    = true; break;

        // ── Save ──────────────────────────────────────────────────────────
        case 's': case 'S':
          // Save is async; fire-and-forget into the loop by setting flag
          this._running = false;
          this._doSave  = true; break;

        // ── Automate tour ─────────────────────────────────────────────────
        case 'a': case 'A':
          this._automate = !this._automate;
          if (this._automate) {
            this._panX = 0.0;
            this._panY = 0.0;
            this._zoom = AUTO_ZOOM_MIN;
            this._autoZoomDir = 1;
            this._autoPanDX = AUTO_PAN_SPEED;
            this._autoPanDY = AUTO_PAN_SPEED * 0.7;
            this._autoLastRender = 0;
          }
          this._dirty = true; break;

        // ── Auto-vary settings ────────────────────────────────────────────
        case '0':
          this._autoVary = !this._autoVary;
          if (this._autoVary) {
            // Pick a random knob and fire the first step immediately
            this._autoVaryKnob   = Math.floor(Math.random() * 5);
            this._autoVaryDir    = Math.random() < 0.5 ? 1 : -1;
            this._autoVaryNextMs = 0;
          }
          this._dirty = true; break;

        // ── Quit ──────────────────────────────────────────────────────────
        case 'q': case 'Q':
          this._running = false; break;
      }
    };

    this.input.on('action', onAction);
    this.terminal.on('key', onKey);

    // Main render loop
    while (this._running) {
      // Automate: advance zoom/pan and schedule re-renders at AUTO_RENDER_MS rate
      if (this._automate) {
        const now = Date.now();
        if (now - this._autoLastRender >= AUTO_RENDER_MS) {
          this._tickAutomate();
          this._dirty          = true;
          this._autoLastRender = now;
        }
      }

      if (this._autoVary) {
        const now = Date.now();
        if (now >= this._autoVaryNextMs) {
          this._tickAutoVary(now);
          this._dirty = true;
        }
      } else {
        this._autoVaryLastTickMs = 0;
      }

      if (this._dirty) {
        await this._renderFrame();
        this._dirty = false;
      }
      await sleep(30);
    }

    this.input.removeListener('action', onAction);
    this.terminal.removeListener('key', onKey);

    // Handle save if triggered
    if (this._doSave) {
      this._doSave = false;
      await this._saveAnsi();
      this._running = false;
    }
  }

  // ─── Pan helper ──────────────────────────────────────────────────────────
  _pan(dx, dy) {
    const step = PAN_STEP_BASE / this._zoom;
    this._panX = clamp(this._panX + dx * step, 0, 1);
    this._panY = clamp(this._panY + dy * step, 0, 1);
    this._dirty = true;
  }

  // ─── Automate tick ───────────────────────────────────────────────────────
  _tickAutomate() {
    this._zoom += AUTO_ZOOM_SPEED * this._autoZoomDir;
    if (this._zoom >= AUTO_ZOOM_MAX) {
      this._zoom        = AUTO_ZOOM_MAX;
      this._autoZoomDir = -1;
    } else if (this._zoom <= AUTO_ZOOM_MIN) {
      this._zoom        = AUTO_ZOOM_MIN;
      this._autoZoomDir = 1;
      // Pick a new random pan direction each time we zoom back out
      const angle       = Math.random() * Math.PI * 2;
      this._autoPanDX   = AUTO_PAN_SPEED * Math.cos(angle);
      this._autoPanDY   = AUTO_PAN_SPEED * Math.sin(angle) * 0.7;
    }

    // Pan speed scales with zoom so motion always feels substantial.
    // At zoom=1 panning has no effect (no overflow), so we drift the target
    // position continuously and it kicks in as soon as zoom > 1.
    // Speed is multiplied by zoom so higher zoom = faster apparent pan.
    const panScale = Math.max(1.0, this._zoom);
    this._panX += this._autoPanDX * panScale;
    this._panY += this._autoPanDY * panScale;

    // Bounce off edges
    if (this._panX >= 1.0) { this._panX = 1.0; this._autoPanDX = -Math.abs(this._autoPanDX); }
    if (this._panX <= 0.0) { this._panX = 0.0; this._autoPanDX =  Math.abs(this._autoPanDX); }
    if (this._panY >= 1.0) { this._panY = 1.0; this._autoPanDY = -Math.abs(this._autoPanDY); }
    if (this._panY <= 0.0) { this._panY = 0.0; this._autoPanDY =  Math.abs(this._autoPanDY); }
  }

  // ─── Capture / apply current knob settings ──────────────────────────────
  _captureSettings() {
    return {
      contrast:    this._contrast,
      saturation:  this._saturation,
      brightness:  this._brightness,
      colorTemp:   this._colorTemp,
      dither:      this._dither,
      shadeBias:   this._shadeBias,
      edgeEnhance: this._edgeEnhance,
      fidelity:    this._fidelity,
      zoom:        this._zoom,
      panX:        this._panX,
      panY:        this._panY,
      fillColorIdx: this._fillColorIdx,
      fillCharIdx:  this._fillCharIdx,
    };
  }

  _applySettings(s) {
    if (!s) return;
    if (s.contrast    !== undefined) this._contrast    = s.contrast;
    if (s.saturation  !== undefined) this._saturation  = s.saturation;
    if (s.brightness  !== undefined) this._brightness  = s.brightness;
    if (s.colorTemp   !== undefined) this._colorTemp   = s.colorTemp;
    if (s.dither      !== undefined) this._dither      = s.dither;
    if (s.shadeBias   !== undefined) this._shadeBias   = s.shadeBias;
    if (s.edgeEnhance !== undefined) this._edgeEnhance = s.edgeEnhance;
    if (s.fidelity    !== undefined) this._fidelity    = s.fidelity;
    if (s.zoom        !== undefined) this._zoom        = s.zoom;
    if (s.panX        !== undefined) this._panX        = s.panX;
    if (s.panY        !== undefined) this._panY        = s.panY;
    if (s.fillColorIdx !== undefined) this._fillColorIdx = s.fillColorIdx;
    if (s.fillCharIdx  !== undefined) this._fillCharIdx  = s.fillCharIdx;
    this._presetIdx = -1;
    this._dirty     = true;
  }

  // ─── Auto-vary tick ──────────────────────────────────────────────────────
  // Steps one knob by one human-scale increment, then schedules the next step
  // after a random delay (AUTO_VARY_STEP_MS_MIN to MAX). When a knob hits its
  // range boundary, direction reverses and a new random knob is selected.
  // Knobs: 0=contrast 1=saturation 2=brightness 3=edgeEnhance 4=fidelity
  _tickAutoVary(now) {
    const KNOBS = [
      {
        get: ()  => this._contrast,
        set: (v) => { this._contrast    = v; },
        min: AUTO_VARY_CONTRAST_MIN,   max: AUTO_VARY_CONTRAST_MAX,
        step: STEP_CONTRAST,
      },
      {
        get: ()  => this._saturation,
        set: (v) => { this._saturation  = v; },
        min: AUTO_VARY_SATURATION_MIN, max: AUTO_VARY_SATURATION_MAX,
        step: STEP_SATURATION,
      },
      {
        get: ()  => this._brightness,
        set: (v) => { this._brightness  = v; },
        min: AUTO_VARY_BRIGHTNESS_MIN, max: AUTO_VARY_BRIGHTNESS_MAX,
        step: STEP_BRIGHTNESS,
      },
      {
        get: ()  => this._edgeEnhance,
        set: (v) => { this._edgeEnhance = v; },
        min: AUTO_VARY_EDGE_MIN,       max: AUTO_VARY_EDGE_MAX,
        step: STEP_EDGE_ENHANCE,
      },
      {
        get: ()  => this._fidelity,
        set: (v) => { this._fidelity    = v; },
        min: AUTO_VARY_FIDELITY_MIN,   max: AUTO_VARY_FIDELITY_MAX,
        step: 1,
      },
    ];

    const knob = KNOBS[this._autoVaryKnob];
    let   val  = knob.get();

    // Apply one step in current direction
    val = val + knob.step * this._autoVaryDir;

    // Clamp and detect boundary
    if (val >= knob.max) {
      val = knob.max;
      // Reverse direction and pick a new knob for next step
      this._autoVaryDir  = -1;
      this._autoVaryKnob = Math.floor(Math.random() * KNOBS.length);
    } else if (val <= knob.min) {
      val = knob.min;
      // Reverse direction and pick a new knob for next step
      this._autoVaryDir  = 1;
      this._autoVaryKnob = Math.floor(Math.random() * KNOBS.length);
    }

    // Round floats to avoid drift accumulation
    if (this._autoVaryKnob === 4) {
      val = Math.round(val);  // fidelity is integer
    } else {
      val = Math.round(val * 1000) / 1000;
    }

    knob.set(val);
    this._presetIdx = -1;

    // Also randomly cycle fill color OR fill character
    if (Math.random() < 0.5) {
      this._fillColorIdx = Math.floor(Math.random() * 8);
    } else {
      this._fillCharIdx  = Math.floor(Math.random() * FILL_CHARS.length);
    }

    // Schedule next step: random wait between MIN and MAX
    const wait = AUTO_VARY_STEP_MS_MIN +
                 Math.random() * (AUTO_VARY_STEP_MS_MAX - AUTO_VARY_STEP_MS_MIN);
    this._autoVaryNextMs = now + wait;
  }

  // ─── Apply preset ─────────────────────────────────────────────────────────
  _applyPreset(preset) {
    this._contrast     = preset.contrast;
    this._saturation   = preset.saturation;
    this._brightness   = preset.brightness;
    this._colorTemp    = preset.colorTemp;
    this._dither       = preset.dither;
    this._shadeBias    = preset.shadeBias;
    this._edgeEnhance  = preset.edgeEnhance;
    this._fidelity     = preset.fidelity;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER FRAME
  // ═══════════════════════════════════════════════════════════════════════════
  async _renderFrame() {
    if (!this._jimpImg) return;

    // Convert runs synchronously but may be slow for large images;
    // show a brief "thinking" indicator if re-render takes > 1 frame
    const cells = this._convert();
    this._frameCache = cells;

    this.screen.clear(Color.BLACK, Color.BLACK);

    // Write converted cells into framebuffer
    for (let row = 0; row < TERM_ROWS; row++) {
      for (let col = 0; col < TERM_COLS; col++) {
        const cell = cells[row][col];
        this.screen.putChar(col + 1, row + 1, cell.ch, cell.fg, cell.bg);
      }
    }

    // Overlays
    if (this._showHud)  this._drawHud();
    if (this._showHelp) this._drawHelp();

    // Status bar
    this._drawStatusBar();

    this.screen.flush();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSION PIPELINE
  // Returns a 24×80 array of {ch, fg, bg}
  // ═══════════════════════════════════════════════════════════════════════════
  _convert() {
    const img = this._jimpImg;
    const fillRgb = CGA_RGB[this._fillColorIdx];
    const fillColor = FILL_CHARS[this._fillCharIdx];

    // Stage 1: Compute fit layout.
    // zoom=1  → whole image fits inside terminal, centred with padding.
    // zoom>1  → image larger than terminal; pan to explore.
    // Zoom never distorts aspect ratio — it only changes how much of the
    // source is visible. baseScale ensures zoom=1 shows the whole image.
    const srcW = img.bitmap.width;
    const srcH = img.bitmap.height;

    // baseScale: largest scale that fits the whole image at zoom=1.
    // Canvas is 640×384 effective pixels (80 cols×8px, 24 rows×16px).
    const baseScale = Math.min(CANVAS_PX_W / srcW, CANVAS_PX_H / srcH);

    // scaledCols/Rows: how many terminal cells the image occupies at this zoom.
    // May exceed 80×24 when zoomed in.
    const scaledCols = (srcW * baseScale * this._zoom) / 8;
    const scaledRows = (srcH * baseScale * this._zoom) / 16;

    // Padding: centres image when smaller than terminal (letterbox/pillarbox).
    // Clamps to zero when image overflows terminal.
    const padCols = Math.max(0, (TERM_COLS - scaledCols) / 2);
    const padRows = Math.max(0, (TERM_ROWS - scaledRows) / 2);

    // Overflow: how many extra cells the image extends beyond the terminal.
    // Pan moves the viewport across this overflow range.
    const overflowCols = Math.max(0, scaledCols - TERM_COLS);
    const overflowRows = Math.max(0, scaledRows - TERM_ROWS);
    const panOffCols   = this._panX * overflowCols;  // cells panned from left
    const panOffRows   = this._panY * overflowRows;  // cells panned from top

    // ── Stage 2: Build logical pixel grid (80×48) ───────────────────────────
    // For each logical pixel position (lx, ly):
    //   - Compute its position in scaled-image space (accounting for padding+pan)
    //   - If outside [0, scaledCols) × [0, scaledRows*2) → fill cell
    //   - Otherwise map to source pixel via area-average sampling
    const logW = LOGICAL_W;  // 80
    const logH = LOGICAL_H;  // 48

    const fillChar = FILL_CHARS[this._fillCharIdx];
    const fillCgaIdx = this._fillColorIdx;

    const srcData   = img.bitmap.data;
    const srcStride = img.bitmap.width;

    // isFill[ly][lx] — true if this logical pixel is in the padding region
    const isFill = [];

    // Build logical pixel grid in sRGB (pre-processed)
    const logicalSRGB = [];
    for (let ly = 0; ly < logH; ly++) {
      const fillRow = [];
      const row = [];
      for (let lx = 0; lx < logW; lx++) {
        // Position of this logical pixel within the scaled image coordinate space.
        // padCols/padRows offset: logical px 0 sits at -padCols in scaled space.
        // panOffCols/Rows shift the viewport when zoomed in.
        // ly maps to half-rows: ly/2 gives the cell row.
        const scaledX = lx       - padCols + panOffCols;  // position in scaled cols
        const scaledY = ly / 2   - padRows + panOffRows;  // position in scaled rows

        // Out of bounds → fill
        if (scaledX < 0 || scaledX >= scaledCols ||
            scaledY < 0 || scaledY >= scaledRows) {
          fillRow.push(true);
          row.push({ ...fillRgb });
          continue;
        }
        fillRow.push(false);

        // Map scaled position to source pixel fraction
        const fx0 = (scaledX    ) / scaledCols;
        const fx1 = (scaledX + 1) / scaledCols;
        const fy0 = (scaledY    ) / scaledRows;
        const fy1 = (scaledY + 0.5) / scaledRows;  // half-row step

        // Source pixel area (area-average sampling)
        const sx0 = fx0 * srcW,  sx1 = fx1 * srcW;
        const sy0 = fy0 * srcH,  sy1 = fy1 * srcH;

        let sr = 0, sg = 0, sb = 0, sa = 0, count = 0;
        const ix0 = Math.max(0, Math.floor(sx0));
        const ix1 = Math.min(srcW - 1, Math.ceil(sx1));
        const iy0 = Math.max(0, Math.floor(sy0));
        const iy1 = Math.min(srcH - 1, Math.ceil(sy1));

        for (let py = iy0; py <= iy1; py++) {
          for (let px = ix0; px <= ix1; px++) {
            const i = (py * srcStride + px) * 4;
            sr += srcData[i]; sg += srcData[i+1]; sb += srcData[i+2]; sa += srcData[i+3];
            count++;
          }
        }
        const raw = count > 0
          ? { r: sr/count, g: sg/count, b: sb/count, a: sa/count }
          : { r: 0, g: 0, b: 0, a: 255 };

        row.push(preprocessPixel(raw, fillRgb,
          this._contrast, this._saturation, this._brightness, this._colorTemp));
      }
      isFill.push(fillRow);
      logicalSRGB.push(row);
    }

    // Convert to Oklab
    const logicalOklab = logicalSRGB.map(row => row.map(rgbToOklab));

    // ── Stage 3: Edge detection (if edge enhancement active) ─────────────────
    let edgeGrid = null;
    if (this._edgeEnhance > 0) {
      edgeGrid = sobelEdges(logicalOklab, logH, logW);
    }

    // ── Stage 4: Error diffusion buffer ──────────────────────────────────────
    const errBuf = Array.from({ length: logH }, () =>
      Array.from({ length: logW }, () => ({ L: 0, a: 0, b: 0 }))
    );

    // ── Stage 5: Per-cell evaluation ─────────────────────────────────────────
    const cells = Array.from({ length: TERM_ROWS }, () =>
      Array.from({ length: TERM_COLS }, () => ({ ch: ' ', fg: 0, bg: 0 }))
    );

    const useJJN = this._fidelity >= 2;

    const applyFill = (cellRow, cellCol) => {
      cells[cellRow][cellCol] = fillChar === ' '
        ? { ch: ' ',      fg: 0,          bg: fillCgaIdx }
        : { ch: fillChar, fg: fillCgaIdx, bg: 0 };
    };

    if (this._fidelity >= 5) {
      // ── Pixel Art path ────────────────────────────────────────────────────
      // Quantise each of the 80x48 logical pixels independently with FS dither,
      // then assemble cells from quantised pixel pairs. This is the correct
      // model: resolve pixels first, then map pairs to block characters.

      const quantised = Array.from({ length: logH }, () => new Int8Array(logW).fill(-1));

      for (let ly = 0; ly < logH; ly++) {
        for (let lx = 0; lx < logW; lx++) {
          if (isFill[ly][lx]) continue;

          const src = logicalOklab[ly][lx];
          const err = errBuf[ly][lx];
          const px  = { L: src.L + err.L, a: src.a + err.a, b: src.b + err.b };

          // Quantise to nearest of all 16 FG colors
          const best = nearestInPalette(px, CGA_OKLAB, 0, FG_COUNT);
          quantised[ly][lx] = best.idx;

          // Diffuse residual
          if (this._dither > 0) {
            const chosen = CGA_OKLAB[best.idx];
            const residual = {
              L: (px.L - chosen.L) * this._dither,
              a: (px.a - chosen.a) * this._dither,
              b: (px.b - chosen.b) * this._dither,
            };
            const kernel = (useJJN && isRedRegion(oklabHue(src))) ? JJN_KERNEL : FS_KERNEL;
            diffuseError(errBuf, ly, lx, residual, logH, logW, kernel);
          }
        }
      }

      // Assemble cells from quantised pixel pairs
      for (let cellRow = 0; cellRow < TERM_ROWS; cellRow++) {
        for (let cellCol = 0; cellCol < TERM_COLS; cellCol++) {
          const ly_top = cellRow * 2;
          const ly_bot = cellRow * 2 + 1;
          const lx     = cellCol;

          if (isFill[ly_top][lx] && isFill[ly_bot][lx]) { applyFill(cellRow, cellCol); continue; }

          const tIdx = quantised[ly_top][lx] !== -1 ? quantised[ly_top][lx]
                     : (quantised[ly_bot][lx] !== -1 ? quantised[ly_bot][lx] : 0);
          const bIdx = quantised[ly_bot][lx] !== -1 ? quantised[ly_bot][lx] : tIdx;

          if (tIdx === bIdx) {
            // Same color — solid block. Use dark half as BG where possible.
            cells[cellRow][cellCol] = { ch: '\u2588', fg: tIdx, bg: tIdx & 7 };
          } else {
            // Different colors — assign FG/BG respecting the constraint that
            // BG can only be 0-7. Bright colors (8-15) must go to FG.
            const topBright = tIdx >= 8;
            const botBright = bIdx >= 8;
            let ch, fg, bg;

            if (topBright && !botBright) {
              // Top must be FG (bright) -> upper half block
              ch = '\u2580'; fg = tIdx; bg = bIdx;
            } else if (botBright && !topBright) {
              // Bot must be FG (bright) -> lower half block
              ch = '\u2584'; fg = bIdx; bg = tIdx;
            } else if (!topBright && !botBright) {
              // Both dark (0-7) — both valid as BG. Pick ▀ vs ▄ based on
              // which puts the better match on FG.
              // Since both are exact matches, just pick ▀ by convention.
              ch = '\u2580'; fg = tIdx; bg = bIdx;
            } else {
              // Both bright — neither can be exact BG. Find closest dark
              // approximation for whichever is the lesser loss.
              const tDark = nearestInPalette(CGA_OKLAB[tIdx], CGA_OKLAB, 0, BG_COUNT);
              const bDark = nearestInPalette(CGA_OKLAB[bIdx], CGA_OKLAB, 0, BG_COUNT);
              if (tDark.err <= bDark.err) {
                ch = '\u2584'; fg = bIdx; bg = tDark.idx;
              } else {
                ch = '\u2580'; fg = tIdx; bg = bDark.idx;
              }
            }
            cells[cellRow][cellCol] = { ch, fg, bg };
          }
        }
      }

    } else {
      // ── Fidelity 1-4: holistic per-cell evaluation with error diffusion ────
      for (let cellRow = 0; cellRow < TERM_ROWS; cellRow++) {
        for (let cellCol = 0; cellCol < TERM_COLS; cellCol++) {
          const ly_top = cellRow * 2;
          const ly_bot = cellRow * 2 + 1;
          const lx     = cellCol;

          if (isFill[ly_top][lx] && isFill[ly_bot][lx]) { applyFill(cellRow, cellCol); continue; }

          const addErr = (ok, err) => ({ L: ok.L + err.L, a: ok.a + err.a, b: ok.b + err.b });

          const srcPixels = [
            addErr(logicalOklab[ly_top][lx], errBuf[ly_top][lx]),
            addErr(logicalOklab[ly_top][lx], errBuf[ly_top][lx]),
            addErr(logicalOklab[ly_bot][lx], errBuf[ly_bot][lx]),
            addErr(logicalOklab[ly_bot][lx], errBuf[ly_bot][lx]),
          ];

          const edgeStrength = edgeGrid
            ? Math.max(edgeGrid[ly_top][lx], edgeGrid[ly_bot][lx])
            : 0;

          const result = evaluateCell(
            srcPixels, this._shadeBias, edgeStrength, this._edgeEnhance, this._fidelity
          );

          cells[cellRow][cellCol] = { ch: result.ch, fg: result.fg, bg: result.bg };

          if (this._dither > 0) {
            const rendered = STRATEGIES.find(s => s.ch === result.ch);
            if (rendered) {
              const renderedPx = rendered.render(result.fg, result.bg, CGA_OKLAB);
              const errTop = {
                L: (srcPixels[0].L - renderedPx[0].L) * this._dither,
                a: (srcPixels[0].a - renderedPx[0].a) * this._dither,
                b: (srcPixels[0].b - renderedPx[0].b) * this._dither,
              };
              const errBot = {
                L: (srcPixels[2].L - renderedPx[2].L) * this._dither,
                a: (srcPixels[2].a - renderedPx[2].a) * this._dither,
                b: (srcPixels[2].b - renderedPx[2].b) * this._dither,
              };
              const srcHue = oklabHue(logicalOklab[ly_top][lx]);
              const kernel = (useJJN && isRedRegion(srcHue)) ? JJN_KERNEL : FS_KERNEL;
              diffuseError(errBuf, ly_top, lx, errTop, logH, logW, kernel);
              diffuseError(errBuf, ly_bot, lx, errBot, logH, logW, kernel);
            }
          }
        }
      }
    }

    return cells;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUD OVERLAY (? key)
  // ═══════════════════════════════════════════════════════════════════════════
  _drawHud() {
    const BK = Color.BLACK;
    const CY = Color.CYAN;
    const YL = Color.BRIGHT_YELLOW;
    const W  = Color.WHITE;
    const GR = Color.BRIGHT_GREEN;

    const col = 49;  // right-side overlay
    const row = 2;

    // Box: 32 wide × 13 tall
    Draw.titledBox(this.screen, col, row, 32, 14, ' IMG2ANSI ', Draw.BOX_DOUBLE, CY, BK, W, BK);

    const presetName = this._presetIdx >= 0 ? PRESETS[this._presetIdx].name : 'Custom';
    const varyStr = this._autoVary ? 'ON ' : 'off';
    const lines = [
      [`Preset  `, presetName],
      [`F\u2192PA    `, `${this._fidelity} ${FIDELITY_NAMES[this._fidelity]}`],
      [`Contrast`, `${this._contrast.toFixed(1)}   Bright ${this._brightness.toFixed(2)}`],
      [`Sat     `, `${this._saturation.toFixed(1)}   Temp   ${this._colorTemp.toFixed(1)}`],
      [`Dither  `, `${this._dither.toFixed(2)}  Shade  ${this._shadeBias.toFixed(1)}`],
      [`Edge    `, `${this._edgeEnhance.toFixed(1)}   Zoom   ${this._zoom.toFixed(2)}`],
      [`Fill    `, `${['Black','DkRed','DkGrn','Brown','DkBlu','DkMag','Teal','Gray'][this._fillColorIdx]} / ${FILL_CHARS[this._fillCharIdx] === ' ' ? 'Space' : FILL_CHARS[this._fillCharIdx]}`],
      [`Pan     `, `${Math.round(this._panX*100)}% / ${Math.round(this._panY*100)}%`],
      [`AutoVary`, varyStr],
    ];

    for (let i = 0; i < lines.length; i++) {
      const [label, value] = lines[i];
      this.screen.putString(col + 2, row + 2 + i, label, CY, BK);
      this.screen.putString(col + 10, row + 2 + i, value, YL, BK);
    }

    this.screen.putString(col + 2, row + 12, 'Press ? to close', Color.DARK_GRAY, BK);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELP SCREEN (H key)
  // ═══════════════════════════════════════════════════════════════════════════
  _drawHelp() {
    const BK = Color.BLACK;
    const CY = Color.CYAN;
    const YL = Color.BRIGHT_YELLOW;
    const W  = Color.WHITE;
    const GR = Color.BRIGHT_GREEN;
    const GY = Color.DARK_GRAY;

    this.screen.clear(BK, BK);
    // Title bar
    Draw.titleBar(this.screen, ' IMG2ANSI  KEY BINDINGS', Color.BRIGHT_WHITE, Color.BLUE);

    // Helper: print a section heading + items in one column
    // col=start col (1-based), row=start row, items=[[keys,desc],...]
    // key field is 9 chars, desc follows — total per item <= 39 chars per column
    const section = (title, col, row, items) => {
      this.screen.putString(col, row, title, YL, BK);
      for (let i = 0; i < items.length; i++) {
        const [k, d] = items[i];
        // Empty key = descriptor row (preset names, fidelity levels): white text
        if (k === '') {
          this.screen.putString(col + 2, row + 1 + i, d, W, BK);
        } else if (d === '') {
          // Key-only descriptor row (fidelity level number + name)
          this.screen.putString(col,     row + 1 + i, k.padEnd(3), GY, BK);
          this.screen.putString(col + 3, row + 1 + i, '', W, BK);
        } else {
          this.screen.putString(col,     row + 1 + i, k.padEnd(9), GR, BK);
          this.screen.putString(col + 9, row + 1 + i, d, W, BK);
        }
      }
    };

    // ── Left column (col 1) ──────────────────────────────────────────────────
    section('VIEWPORT', 1, 2, [
      ['Arrows',  'Pan image'],
      ['+ =',     'Zoom in'],
      ['- _',     'Zoom out'],
      ['5',       'Reset zoom & pan'],
    ]);

    section('COLOR', 1, 8, [
      ['O / P',   'Contrast -/+'],
      ['K / L',   'Saturation -/+'],
      [', / .',   'Brightness -/+'],
      ['[ / ]',   'Color temp cool/warm'],
    ]);

    section('CONVERSION', 1, 14, [
      ['E / R',   'Dither -/+'],
      ['Z / X',   'Shade bias -/+'],
      ['N / M',   'Edge enhance -/+'],
      ['F / G',   'Faithful->PixelArt -/+'],
    ]);

    // ── Right column (col 41) ────────────────────────────────────────────────
    section('LETTERBOX', 41, 2, [
      ['V',   'Cycle fill color'],
      ['B',   'Cycle fill char'],
    ]);

    // Preset names listed as reference under Tab
    this.screen.putString(41, 6, 'PRESETS  Tab', YL, BK);
    const presetNames = ['Photo','Graphic','Portrait','Line Art','Pixel Art'];
    for (let i = 0; i < presetNames.length; i++) {
      this.screen.putString(43, 7 + i, presetNames[i], W, BK);
    }

    section('APPLICATION', 41, 13, [
      ['H',   'This help screen'],
      ['? /', 'Toggle HUD (stays up)'],
      ['S',   'Save .ANS (V=vis / W=whole)'],
      ['A',   'Automate zoom/pan tour'],
      ['0',   'Auto-vary settings'],
      ['Q',   'Quit'],
    ]);

    // Fidelity level names as descriptors only — no number keys
    // Fidelity levels — shown as reference only, not as active key bindings
    this.screen.putString(41, 20, 'FIDELITY  F / G', YL, BK);
    const fidNames = ['Faithful','Naturalistic','Interpreted','Stylized','Pixel Art'];
    for (let i = 0; i < fidNames.length; i++) {
      this.screen.putString(41,    21 + i, String(i+1), GY, BK);
      this.screen.putString(43,    21 + i, fidNames[i], W,  BK);
    }

    this.screen.putString(1, 23, 'Press any key to close', GY, BK);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS BAR
  // ═══════════════════════════════════════════════════════════════════════════
  _drawStatusBar() {
    // Compact mode indicator (right-side, no brackets — space is tight)
    // Priority: screensaver > auto+vary > auto > vary
    const modeTag = this._screensaver               ? ' SCRN'
                  : (this._automate && this._autoVary) ? ' A+V'
                  : this._automate                  ? ' AUTO'
                  : this._autoVary                  ? ' VARY'
                  : '';
    const left  = ' H/?=HUD S/Q=Save/Quit O/P=Con K/L=Sat ,/.=Bri N/M=Edge F/G=F→PA V/B=Fill';
    const bar   = (left + modeTag).substring(0, 79);
    const bgCol = this._screensaver ? Color.DARK_MAGENTA
                : this._autoVary   ? Color.DARK_GREEN
                : this._automate   ? Color.BLUE
                : Color.CYAN;
    this.screen.statusBar(bar, Color.BLACK, bgCol);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING & ERROR SCREENS
  // ═══════════════════════════════════════════════════════════════════════════
  async _showLoading(msg) {
    this.screen.clear(Color.BLACK, Color.BLACK);
    const spin = ['|', '/', '\u2500', '\\'];
    let i = 0;
    // Just show a static loading screen (conversion will happen synchronously after)
    Draw.centerText(this.screen, 11, msg, Color.BRIGHT_CYAN, Color.BLACK);
    Draw.centerText(this.screen, 12, spin[0], Color.BRIGHT_WHITE, Color.BLACK);
    this.screen.statusBar(' Loading...', Color.BLACK, Color.CYAN);
    this.screen.flush();
  }

  async _showError(msg) {
    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.centerText(this.screen, 10, 'Error loading image:', Color.BRIGHT_RED, Color.BLACK);
    Draw.centerText(this.screen, 12, msg.substring(0, 76), Color.WHITE, Color.BLACK);
    Draw.centerText(this.screen, 14, 'Press any key to return...', Color.DARK_GRAY, Color.BLACK);
    this.screen.statusBar(' Error  |  Press any key...', Color.BRIGHT_RED, Color.BLACK);
    this.screen.flush();
    await this.terminal.waitKey();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE MODE SELECTION
  // ═══════════════════════════════════════════════════════════════════════════
  async _chooseSaveMode() {
    const BK = Color.BLACK;
    const YL = Color.BRIGHT_YELLOW;
    const W  = Color.WHITE;
    const GY = Color.DARK_GRAY;

    this.screen.clear(BK, BK);
    Draw.titleBar(this.screen, ' IMG2ANSI  \u00b7  Save', Color.BRIGHT_WHITE, Color.BLUE);
    this.screen.putString(3, 5, 'Choose save action:', W, BK);

    this.screen.putString(3,  8, 'V', YL, BK);
    this.screen.putString(5,  8, 'Visible  \u2014  Current 80\u00d724 view as displayed', W, BK);
    this.screen.putString(5,  9, 'Includes letterbox/pillarbox fill', GY, BK);

    this.screen.putString(3, 11, 'W', YL, BK);
    this.screen.putString(5, 11, 'Whole    \u2014  Full image at current zoom (may be >80\u00d724)', W, BK);
    this.screen.putString(5, 12, 'Tiled render at current knob settings', GY, BK);

    this.screen.putString(3, 14, 'U', YL, BK);
    this.screen.putString(5, 14, 'URL      \u2014  Bookmark this URL to your profile', W, BK);
    this.screen.putString(5, 15, 'Saved for future sessions', GY, BK);

    this.screen.putString(3, 19, 'ESC', GY, BK);
    this.screen.putString(7, 19, 'Cancel', GY, BK);

    this.screen.statusBar(' V=Visible  W=Whole  U=Save URL  ESC=Cancel', Color.BLACK, Color.CYAN);
    this.screen.flush();

    return new Promise((resolve) => {
      const cleanup = () => this.terminal.removeListener('key', onKey);
      const onKey = (key) => {
        const k = key.toLowerCase ? key.toLowerCase() : key;
        if (k === 'v') { cleanup(); resolve('visible'); }
        else if (k === 'w') { cleanup(); resolve('whole'); }
        else if (k === 'u') { cleanup(); resolve('url'); }
        else if (key === '\x1b' || key === '\r') { cleanup(); resolve(null); }
      };
      this.terminal.on('key', onKey);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVE .ANS FILE
  // ═══════════════════════════════════════════════════════════════════════════
  async _saveAnsi() {
    if (!this._frameCache) {
      await this._showError('No frame to save. Convert an image first.');
      return;
    }

    const saveMode = await this._chooseSaveMode();
    if (!saveMode) {
      this._running = true; this._dirty = true;
      await this._mainLoop(this._imageUrl);
      return;
    }

    // ── URL bookmark save ──────────────────────────────────────────────────
    if (saveMode === 'url') {
      await this._saveUrlBookmark();
      this._running = true; this._dirty = true;
      await this._mainLoop(this._imageUrl);
      return;
    }

    // ── ANS file save (visible or whole) ──────────────────────────────────
    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.titleBar(this.screen, ' IMG2ANSI  \u00b7  Save .ANS File', Color.BRIGHT_WHITE, Color.BLUE);
    this.screen.putString(3, 5, 'Enter a filename for the .ANS file.', Color.WHITE, Color.BLACK);
    this.screen.putString(3, 6, 'The .ans extension will be added automatically.', Color.DARK_GRAY, Color.BLACK);
    const modeLabel = saveMode === 'whole' ? 'Whole image at current zoom' : 'Visible (80\u00d724)';
    this.screen.putString(3, 7, 'Mode: ' + modeLabel, Color.BRIGHT_CYAN, Color.BLACK);
    this.screen.putString(3, 9, 'Filename:', Color.BRIGHT_YELLOW, Color.BLACK);
    this.screen.putString(3, 10, '\u00b7'.repeat(40), Color.DARK_GRAY, Color.BLACK);
    this.screen.putString(3, 14, 'Leave blank and press ENTER to cancel.', Color.DARK_GRAY, Color.BLACK);
    this.screen.statusBar(' Enter filename and press ENTER  |  Blank = Cancel', Color.BLACK, Color.CYAN);
    this.screen.flush();

    this.terminal.moveTo(3, 11);
    this.terminal.showCursor();
    let filename = '';
    try { filename = await this.terminal.readLine({ maxLen: 40, echo: true }); } catch { filename = ''; }
    this.terminal.hideCursor();
    filename = (filename || '').trim();

    if (!filename) {
      this._running = true; this._dirty = true;
      await this._mainLoop(this._imageUrl);
      return;
    }
    if (!filename.toLowerCase().endsWith('.ans')) filename += '.ans';

    // ── Generate cell grid ─────────────────────────────────────────────────
    let cellGrid, saveRows, saveCols;

    if (saveMode === 'visible') {
      cellGrid = this._frameCache;
      saveRows = TERM_ROWS;
      saveCols = TERM_COLS;
    } else {
      // Whole image at current zoom: tile-render across the full scaled extent.
      // At zoom=1: single tile (scCols<=80, scRows<=24). At zoom>1: multiple tiles.
      const img       = this._jimpImg;
      const srcW      = img.bitmap.width;
      const srcH      = img.bitmap.height;
      const baseScale = Math.min(CANVAS_PX_W / srcW, CANVAS_PX_H / srcH);
      const scCols    = (srcW * baseScale * this._zoom) / 8;
      const scRows    = (srcH * baseScale * this._zoom) / 16;

      const tilesX = Math.max(1, Math.ceil(scCols / TERM_COLS));
      const tilesY = Math.max(1, Math.ceil(scRows / TERM_ROWS));
      saveCols     = Math.min(Math.ceil(scCols), tilesX * TERM_COLS);
      saveRows     = Math.min(Math.ceil(scRows), tilesY * TERM_ROWS);

      cellGrid = Array.from({ length: saveRows }, () =>
        Array.from({ length: saveCols }, () => ({ ch: ' ', fg: 0, bg: 0 }))
      );

      const savedPanX = this._panX;
      const savedPanY = this._panY;

      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          // Position pan so this tile occupies the viewport
          this._panX = tilesX > 1 ? tx / (tilesX - 1) : 0.5;
          this._panY = tilesY > 1 ? ty / (tilesY - 1) : 0.5;

          this.screen.clear(Color.BLACK, Color.BLACK);
          Draw.centerText(this.screen, 12,
            `Rendering tile ${ty * tilesX + tx + 1} of ${tilesX * tilesY}...`,
            Color.BRIGHT_CYAN, Color.BLACK);
          this.screen.statusBar(' Rendering...', Color.BLACK, Color.CYAN);
          this.screen.flush();

          const tile = this._convert();

          const colStart = tx * TERM_COLS;
          const rowStart = ty * TERM_ROWS;
          for (let r = 0; r < TERM_ROWS; r++) {
            for (let c = 0; c < TERM_COLS; c++) {
              const gr = rowStart + r;
              const gc = colStart + c;
              if (gr < saveRows && gc < saveCols) cellGrid[gr][gc] = tile[r][c];
            }
          }
        }
      }

      this._panX = savedPanX;
      this._panY = savedPanY;
    }

    // ── Write ANS file ─────────────────────────────────────────────────────
    const userOutDir = path.join(BASE_OUTPUT_DIR, this.username || 'guest');
    fs.mkdirSync(userOutDir, { recursive: true });
    const outPath = path.join(userOutDir, filename);

    let ansiOut = '\x1b[0m\x1b[2J\x1b[H';
    let lastFg = -1, lastBg = -1;
    for (let row = 0; row < saveRows; row++) {
      for (let col = 0; col < saveCols; col++) {
        const cell = cellGrid[row][col];
        if (cell.fg !== lastFg || cell.bg !== lastBg) {
          ansiOut += ansiSetColor(cell.fg, cell.bg);
          lastFg = cell.fg; lastBg = cell.bg;
        }
        ansiOut += cell.ch;
      }
      if (row < saveRows - 1) ansiOut += '\r\n';
    }
    ansiOut += '\x1b[0m';

    const sauceMark = Buffer.from([0x1A]);
    const sauce     = buildSauceRecord(filename.replace('.ans', ''), this.username, saveCols, saveRows);
    const fileBuf   = Buffer.concat([Buffer.from(ansiOut, 'binary'), sauceMark, sauce]);

    try {
      fs.writeFileSync(outPath, fileBuf);
      const ud = this._loadUserData();
      ud.savedFiles.push({ filename, url: this._imageUrl, savedAt: new Date().toISOString(), settings: this._captureSettings() });
      this._saveUserData(ud);

      this.screen.clear(Color.BLACK, Color.BLACK);
      Draw.centerText(this.screen, 10, 'File saved!', Color.BRIGHT_GREEN, Color.BLACK);
      Draw.centerText(this.screen, 12, filename, Color.BRIGHT_WHITE, Color.BLACK);
      Draw.centerText(this.screen, 16, 'Press any key to continue...', Color.DARK_GRAY, Color.BLACK);
      this.screen.statusBar(' Saved!  |  Press any key...', Color.BLACK, Color.CYAN);
      this.screen.flush();
      await this.terminal.waitKey();
    } catch (err) {
      await this._showError(`Save failed: ${err.message}`);
    }

    this._running = true; this._dirty = true;
    await this._mainLoop(this._imageUrl);
  }

  // ── Save URL bookmark ──────────────────────────────────────────────────────
  async _saveUrlBookmark() {
    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.titleBar(this.screen, ' IMG2ANSI  \u00b7  Save URL', Color.BRIGHT_WHITE, Color.BLUE);
    this.screen.putString(3, 5,  'Enter a name for this URL bookmark.', Color.WHITE, Color.BLACK);
    this.screen.putString(3, 6,  this._imageUrl.substring(0, 74), Color.DARK_GRAY, Color.BLACK);
    this.screen.putString(3, 9,  'Name:', Color.BRIGHT_YELLOW, Color.BLACK);
    this.screen.putString(3, 10, '\u00b7'.repeat(40), Color.DARK_GRAY, Color.BLACK);
    this.screen.putString(3, 14, 'Leave blank to cancel.', Color.DARK_GRAY, Color.BLACK);
    this.screen.statusBar(' Enter name and press ENTER  |  Blank = Cancel', Color.BLACK, Color.CYAN);
    this.screen.flush();

    this.terminal.moveTo(3, 11);
    this.terminal.showCursor();
    let name = '';
    try { name = await this.terminal.readLine({ maxLen: 40, echo: true }); } catch { name = ''; }
    this.terminal.hideCursor();
    name = (name || '').trim();
    if (!name) return;

    const ud = this._loadUserData();
    ud.savedUrls.push({ name, url: this._imageUrl, savedAt: new Date().toISOString(), settings: this._captureSettings() });
    this._saveUserData(ud);

    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.centerText(this.screen, 12, `URL saved as "${name}"`, Color.BRIGHT_GREEN, Color.BLACK);
    this.screen.statusBar(' Saved!  |  Press any key...', Color.BLACK, Color.CYAN);
    this.screen.flush();
    await this.terminal.waitKey();
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // USER DATA
  // ═══════════════════════════════════════════════════════════════════════════
  _userDataPath() {
    const uname = this.username || 'guest';
    return path.join(BASE_DATA_DIR, uname + '.json');
  }

  _loadUserData() {
    try {
      const p = this._userDataPath();
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!d.cache) d.cache = [];
        return d;
      }
    } catch {}
    return { savedUrls: [], savedFiles: [], cache: [] };
  }

  // Cache helpers — used by loadImageFromUrl callbacks
  _userCacheDir() {
    return path.join(USER_CACHE_BASE, this.username || 'guest');
  }

  _onUserCached(hash, url, byteLength) {
    const ud = this._loadUserData();
    // Remove existing entry for same hash if any
    ud.cache = ud.cache.filter(e => e.hash !== hash);
    ud.cache.push({ hash, url, lastUsed: new Date().toISOString(), bytes: byteLength });
    // LRU eviction: if over limit, remove oldest entries from disk and metadata
    if (ud.cache.length > CACHE_MAX_USER_ENTRIES) {
      ud.cache.sort((a, b) => new Date(a.lastUsed) - new Date(b.lastUsed));
      const toEvict = ud.cache.splice(0, ud.cache.length - CACHE_MAX_USER_ENTRIES);
      for (const e of toEvict) {
        try {
          const cf = path.join(this._userCacheDir(), e.hash + '.imgcache');
          if (fs.existsSync(cf)) fs.unlinkSync(cf);
        } catch {}
      }
    }
    this._saveUserData(ud);
  }

  _onUserCacheHit(hash) {
    const ud = this._loadUserData();
    const entry = ud.cache.find(e => e.hash === hash);
    if (entry) {
      entry.lastUsed = new Date().toISOString();
      this._saveUserData(ud);
    }
  }

  _saveUserData(data) {
    const p = this._userDataPath();
    fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BBS GALLERY HELPER
  // ═══════════════════════════════════════════════════════════════════════════
  _loadBbsGallery() {
    try {
      if (fs.existsSync(BBS_GALLERY_PATH)) {
        // Strip trailing commas before closing brackets/braces (common JSON5-style mistake)
        let raw = fs.readFileSync(BBS_GALLERY_PATH, 'utf8');
        raw = raw.replace(/,\s*([\]}])/g, '$1');
        const d = JSON.parse(raw);
        return Array.isArray(d.urls) ? d.urls : [];
      }
    } catch (e) {
      // Log to stderr so sysop can diagnose bbs-gallery.json parse errors
      process.stderr.write(`[img2ansi] bbs-gallery.json parse error: ${e.message}\n`);
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // START SCREEN
  // Returns: { action:'url', url } | { action:'screensaver', urls, isBbs } | null
  // ═══════════════════════════════════════════════════════════════════════════
  async _startScreen() {
    const ud      = this._loadUserData();
    const bbsUrls = this._loadBbsGallery();
    const hasAny  = bbsUrls.length > 0 || ud.savedUrls.length > 0 || ud.savedFiles.length > 0;

    if (!hasAny) {
      const url = await this._urlEntryScreen();
      return url ? { action: 'url', url } : null;
    }

    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.titleBar(this.screen, ' IMG2ANSI  \u00b7  Welcome Back', Color.BRIGHT_WHITE, Color.BLUE);

    const uname = this.username || 'guest';
    this.screen.putString(3, 5, `Welcome back, ${uname}!`, Color.BRIGHT_CYAN, Color.BLACK);
    this.screen.putString(3, 7,
      `BBS Gallery: ${bbsUrls.length}  |  My URLs: ${ud.savedUrls.length}  |  My Files: ${ud.savedFiles.length}`,
      Color.WHITE, Color.BLACK);

    this.screen.putString(3, 10, 'N', Color.BRIGHT_YELLOW, Color.BLACK);
    this.screen.putString(5, 10, 'New URL  \u2014  Enter a new image URL', Color.WHITE, Color.BLACK);
    this.screen.putString(3, 12, 'L', Color.BRIGHT_YELLOW, Color.BLACK);
    this.screen.putString(5, 12, 'Load     \u2014  Browse gallery and saved items', Color.WHITE, Color.BLACK);
    this.screen.putString(3, 14, 'Q', Color.BRIGHT_YELLOW, Color.BLACK);
    this.screen.putString(5, 14, 'Quit', Color.WHITE, Color.BLACK);

    this.screen.statusBar(' N=New URL  L=Load / Gallery  Q=Quit', Color.BLACK, Color.CYAN);
    this.screen.flush();

    const choice = await new Promise((resolve) => {
      const cleanup = () => this.terminal.removeListener('key', onKey);
      const onKey = (key) => {
        const k = key.toLowerCase ? key.toLowerCase() : key;
        if (k === 'n') { cleanup(); resolve('new'); }
        else if (k === 'l') { cleanup(); resolve('load'); }
        else if (k === 'q' || key === '\x1b') { cleanup(); resolve('quit'); }
      };
      this.terminal.on('key', onKey);
    });

    if (choice === 'quit') return null;
    if (choice === 'new') {
      const url = await this._urlEntryScreen();
      return url ? { action: 'url', url } : null;
    }

    return await this._loadScreen(ud, bbsUrls);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD SCREEN — three tabs: BBS Gallery / My URLs / My Files
  // Returns: { action:'url', url, isBbs? } | { action:'screensaver', urls, isBbs } | null
  // ═══════════════════════════════════════════════════════════════════════════
  async _loadScreen(ud, bbsUrls) {
    const MAX_VISIBLE = 16;
    const LIST_ROW    = 5;
    const LIST_COL    = 3;

    // Tab 0=BBS Gallery, 1=My URLs, 2=My Files
    let tab     = 0;
    let selIdx  = [0, 0, 0];
    let scrollY = [0, 0, 0];

    // Tab 0 items have { name, url } only. Tab 1 { name, url, settings }. Tab 2 { filename, url, settings }.
    const lists     = [bbsUrls, ud.savedUrls, ud.savedFiles];
    const tabLabels = ['BBS GALLERY', 'MY URLs', 'MY FILES'];
    // Tab col start positions (roughly spaced across ~60 chars)
    const tabCols   = [3, 18, 29];

    const draw = () => {
      this.screen.clear(Color.BLACK, Color.BLACK);
      Draw.titleBar(this.screen, ' IMG2ANSI  \u00b7  Load', Color.BRIGHT_WHITE, Color.BLUE);

      // Tab headers
      for (let t = 0; t < 3; t++) {
        const label = ` ${tabLabels[t]} `;
        const fg    = t === tab ? Color.BRIGHT_WHITE : Color.DARK_GRAY;
        const bg    = t === tab ? Color.BLUE         : Color.BLACK;
        this.screen.putString(tabCols[t], 3, label, fg, bg);
      }

      const list = lists[tab];
      const si   = selIdx[tab];
      const sy   = scrollY[tab];

      if (list.length === 0) {
        const emptyMsg = tab === 0 ? '(No BBS gallery entries — edit bbs-gallery.json)'
                       : tab === 1 ? '(No saved URLs — use S from main screen)'
                       :             '(No saved files)';
        this.screen.putString(LIST_COL, LIST_ROW + 2, emptyMsg, Color.DARK_GRAY, Color.BLACK);
      } else {
        const visible = Math.min(MAX_VISIBLE, list.length);
        for (let i = 0; i < visible; i++) {
          const idx  = sy + i;
          if (idx >= list.length) break;
          const item = list[idx];
          const label = tab === 2 ? item.filename : item.name;
          const isSel = idx === si;
          const fg    = isSel ? Color.BLACK : Color.WHITE;
          const bg    = isSel ? Color.CYAN  : Color.BLACK;
          this.screen.putString(LIST_COL, LIST_ROW + i,
            ((isSel ? '> ' : '  ') + label).substring(0, 76).padEnd(76), fg, bg);
        }
        // Scroll indicators
        if (sy > 0)
          this.screen.putString(78, LIST_ROW, '\u2191', Color.BRIGHT_YELLOW, Color.BLACK);
        if (sy + MAX_VISIBLE < list.length)
          this.screen.putString(78, LIST_ROW + Math.min(MAX_VISIBLE, list.length) - 1, '\u2193', Color.BRIGHT_YELLOW, Color.BLACK);
        // URL preview for BBS/MyURLs tabs
        if (tab < 2 && list[si]) {
          const urlPrev = (list[si].url || '').substring(0, 74);
          this.screen.putString(LIST_COL, LIST_ROW + MAX_VISIBLE + 1, urlPrev, Color.DARK_GRAY, Color.BLACK);
        }
      }

      // Status bar differs by tab
      const sBar = tab === 0
        ? ' Tab=Switch  \u2191\u2193=Select  Enter=Load  S=Screensaver  Q=Back'
        : tab === 1
        ? ' Tab=Switch  \u2191\u2193=Select  Enter=Load  S=Screensaver  D=Delete  Q=Back'
        : ' Tab=Switch  \u2191\u2193=Select  Enter=View  D=Delete  Q=Back';
      this.screen.statusBar(sBar, Color.BLACK, Color.CYAN);
      this.screen.flush();
    };

    draw();

    return new Promise((resolve) => {
      const cleanup = () => {
        this.input.removeListener('action', onAction);
        this.terminal.removeListener('key', onKey);
      };

      const onAction = (action) => {
        const list = lists[tab];
        if (action === 'UP') {
          if (selIdx[tab] > 0) {
            selIdx[tab]--;
            if (selIdx[tab] < scrollY[tab]) scrollY[tab] = selIdx[tab];
            draw();
          }
        } else if (action === 'DOWN') {
          if (selIdx[tab] < Math.max(0, list.length - 1)) {
            selIdx[tab]++;
            if (selIdx[tab] >= scrollY[tab] + MAX_VISIBLE) scrollY[tab] = selIdx[tab] - MAX_VISIBLE + 1;
            draw();
          }
        }
      };

      const onKey = (key) => {
        const k    = key.toLowerCase ? key.toLowerCase() : key;
        const list = lists[tab];
        const si   = selIdx[tab];

        if (key === '\t') {
          tab = (tab + 1) % 3;
          draw();
        } else if (k === 'q' || key === '\x1b') {
          cleanup(); resolve(null);
        } else if (key === '\r') {
          if (list.length === 0) return;
          const item = list[si];
          if (tab === 2) {
            // View saved ANS file
            cleanup();
            this._viewSavedFile(item, ud).then(resolve);
          } else {
            // Load URL (BBS or user)
            if (item.settings) this._applySettings(item.settings);
            cleanup();
            resolve({ action: 'url', url: item.url, isBbs: tab === 0 });
          }
        } else if (k === 's' && tab < 2) {
          // Screensaver — tabs 0 and 1 only, need at least 1 entry
          if (list.length >= 1) {
            cleanup();
            resolve({
              action: 'screensaver',
              urls:   list.map(u => u.url),
              isBbs:  tab === 0,
            });
          }
        } else if (k === 'd' && tab > 0) {
          // Delete — not available on BBS Gallery tab
          if (list.length === 0) return;
          this._confirmDelete(ud, tab - 1, si).then((newUd) => {
            if (newUd) {
              ud.savedUrls  = newUd.savedUrls;
              ud.savedFiles = newUd.savedFiles;
              lists[1] = ud.savedUrls;
              lists[2] = ud.savedFiles;
              if (selIdx[tab] >= lists[tab].length)
                selIdx[tab] = Math.max(0, lists[tab].length - 1);
            }
            draw();
          });
        }
      };

      this.input.on('action', onAction);
      this.terminal.on('key', onKey);
    });
  }
  // ── View a saved ANS file ──────────────────────────────────────────────────
  // Uses SCROLL mode so the image scrolls naturally in the terminal buffer.
  // Wide files (>80 cols) are displayed clipped to the centre 80 columns.
  async _viewSavedFile(item, ud) {
    const filePath = path.join(BASE_OUTPUT_DIR, this.username || 'guest', item.filename);
    if (!fs.existsSync(filePath)) {
      await this._showError(`File not found: ${item.filename}`);
      return null;
    }

    let ansiStr;
    try {
      ansiStr = fs.readFileSync(filePath, 'binary');
    } catch (e) {
      await this._showError(`Could not read file: ${e.message}`);
      return null;
    }

    // Check SAUCE record for width (last 128 bytes, starts with 'SAUCE')
    const buf = Buffer.from(ansiStr, 'binary');
    let fileWidth = 80;
    const sauceOff = buf.length - 128;
    if (sauceOff >= 0 && buf.slice(sauceOff, sauceOff + 5).toString('ascii') === 'SAUCE') {
      fileWidth = buf.readUInt16LE(sauceOff + 96) || 80;
    }

    // If wider than 80 cols, rebuild line-by-line stripping wide excess.
    // Strip trailing SAUCE (everything after 0x1A EOF marker) before display.
    let displayStr = ansiStr;
    const eofIdx = ansiStr.indexOf('\x1a');
    if (eofIdx !== -1) displayStr = ansiStr.substring(0, eofIdx);

    // For wide files, we display as-is but cap render — the terminal will wrap
    // harmlessly. A full per-line ANSI parser is out of scope here; the file
    // will simply display scrolled and the user can scroll back up.

    // Switch to SCROLL mode and display
    this.screen.setMode(Screen.SCROLL);
    this.terminal.resetAttrs();
    this.terminal.writeRaw('\x1b[2J\x1b[H');

    try {
      Draw.ansiArt(this.terminal, displayStr);
    } catch (e) {
      this.screen.setMode(Screen.FIXED);
      await this._showError(`Could not display file: ${e.message}`);
      return null;
    }

    // Print prompt below the image in SCROLL mode
    this.terminal.resetAttrs();
    const hasUrl = !!(item.url);
    const hint = hasUrl
      ? '\r\n\x1b[0;36m [ Any key to return  |  R = Re-convert ] \x1b[0m'
      : '\r\n\x1b[0;36m [ Any key to return ] \x1b[0m';
    this.terminal.writeRaw(hint);

    const choice = await new Promise((resolve) => {
      const cleanup = () => this.terminal.removeListener('key', onKey);
      const onKey = (key) => {
        const k = key.toLowerCase ? key.toLowerCase() : key;
        if (k === 'r' && hasUrl) { cleanup(); resolve('reconvert'); }
        else { cleanup(); resolve('back'); }
      };
      this.terminal.on('key', onKey);
    });

    // Restore FIXED mode for the rest of the app
    this.screen.setMode(Screen.FIXED);

    if (choice === 'reconvert' && item.url) {
      if (item.settings) this._applySettings(item.settings);
      return { action: 'url', url: item.url };
    }
    return null;
  }

  // ── Confirm and execute deletion ──────────────────────────────────────────
  async _confirmDelete(ud, tab, idx) {
    const list = tab === 0 ? ud.savedUrls : ud.savedFiles;
    if (idx >= list.length) return null;
    const item = list[idx];
    const label = tab === 0 ? item.name : item.filename;

    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.centerText(this.screen, 10, 'Delete this entry?', Color.BRIGHT_YELLOW, Color.BLACK);
    Draw.centerText(this.screen, 12, label.substring(0, 74), Color.WHITE, Color.BLACK);
    Draw.centerText(this.screen, 15, 'Y = Delete   N = Cancel', Color.DARK_GRAY, Color.BLACK);
    this.screen.statusBar(' Y = Confirm Delete   N = Cancel', Color.BLACK, Color.CYAN);
    this.screen.flush();

    const confirmed = await new Promise((resolve) => {
      const cleanup = () => this.terminal.removeListener('key', onKey);
      const onKey = (key) => {
        const k = key.toLowerCase ? key.toLowerCase() : key;
        if (k === 'y') { cleanup(); resolve(true); }
        else { cleanup(); resolve(false); }
      };
      this.terminal.on('key', onKey);
    });

    if (!confirmed) return null;

    if (tab === 0) {
      ud.savedUrls.splice(idx, 1);
    } else {
      // Also delete the ANS file from disk
      try {
        const fp = path.join(BASE_OUTPUT_DIR, this.username || 'guest', item.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch {}
      ud.savedFiles.splice(idx, 1);
    }
    this._saveUserData(ud);
    return ud;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREENSAVER
  // Shuffle-and-cycle through saved URLs with automate + autovary.
  // Any keypress stops screensaver but leaves image on screen (cancel auto modes).
  // ═══════════════════════════════════════════════════════════════════════════
  async _runScreensaver(urls, isBbs) {
    this._screensaver = true;

    // For cache routing: isBbs means use BBS_CACHE_DIR permanently
    const cacheDir  = isBbs ? BBS_CACHE_DIR : this._userCacheDir();
    const onCached  = isBbs ? null : (h, u, b) => this._onUserCached(h, u, b);
    const onCacheHit = isBbs ? null : (h) => this._onUserCacheHit(h);

    // Build shuffled cycle list
    const shuffled = [...urls].sort(() => Math.random() - 0.5);
    let   urlIdx   = 0;

    const loadNext = async () => {
      const url = shuffled[urlIdx % shuffled.length];
      urlIdx++;
      // If we've used all, reshuffle for next cycle
      if (urlIdx >= shuffled.length) {
        shuffled.sort(() => Math.random() - 0.5);
        urlIdx = 0;
      }

      // Load silently — no loading screen between images
      try {
        const nextImg  = await loadImageFromUrl(url, cacheDir, onCached, onCacheHit);
        this._jimpImg  = nextImg;
        this._imageUrl = url;
        this._loadError = '';
      } catch (err) {
        this._loadError = err.message;
        // Skip bad URL silently, will try next on next cycle
      }
    };

    await loadNext();

    // Enable automate + autovary
    this._automate        = true;
    this._autoVary        = true;
    this._zoom            = AUTO_ZOOM_MIN;
    this._panX            = 0.5;
    this._panY            = 0.5;
    this._autoZoomDir     = 1;
    this._autoPanDX       = AUTO_PAN_SPEED;
    this._autoPanDY       = AUTO_PAN_SPEED * 0.7;
    this._autoLastRender  = 0;
    this._autoVaryNextMs  = 0;
    this._autoVaryKnob    = 0;
    this._autoVaryDir     = 1;
    this._dirty           = true;
    this._running         = true;
    let nextUrlMs         = Date.now() + SCREENSAVER_MIN_MS +
                            Math.random() * (SCREENSAVER_MAX_MS - SCREENSAVER_MIN_MS);

    // Screensaver render loop — exits on any keypress
    let exitScreensaver = false;

    const onKey = () => { exitScreensaver = true; };
    const onAction = (a) => { if (a === 'QUIT') exitScreensaver = true; };
    this.terminal.on('key', onKey);
    this.input.on('action', onAction);

    while (!exitScreensaver) {
      // Automate tick
      const now = Date.now();
      if (now - this._autoLastRender >= AUTO_RENDER_MS) {
        this._tickAutomate();
        this._dirty         = true;
        this._autoLastRender = now;
      }
      // Auto-vary tick
      if (now >= this._autoVaryNextMs) {
        this._tickAutoVary(now);
        this._dirty = true;
      }
      // URL switch tick
      if (now >= nextUrlMs && this._jimpImg) {
        await loadNext();
        nextUrlMs = Date.now() + SCREENSAVER_MIN_MS +
                    Math.random() * (SCREENSAVER_MAX_MS - SCREENSAVER_MIN_MS);
        this._dirty = true;
      }

      if (this._dirty && this._jimpImg) {
        await this._renderFrame();
        this._dirty = false;
      }
      await sleep(30);
    }

    this.terminal.removeListener('key', onKey);
    this.input.removeListener('action', onAction);

    // Leave current image on screen; cancel screensaver modes, keep all else
    this._automate    = false;
    this._autoVary    = false;
    this._screensaver = false;
    this._dirty       = true;
    // Return the current URL so run() can drop into _mainLoop
    return this._imageUrl;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERT ANOTHER PROMPT
  // ═══════════════════════════════════════════════════════════════════════════
  async _convertAnotherPrompt() {
    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.centerText(this.screen, 11, '  Convert another image?  (Y / N)  ', Color.BRIGHT_YELLOW, Color.BLACK);
    this.screen.statusBar(' Y = New image   N = Exit', Color.BLACK, Color.CYAN);
    this.screen.flush();

    return new Promise((resolve) => {
      const cleanup = () => {
        this.input.removeListener('action', onAction);
        this.terminal.removeListener('key', onKey);
      };
      const yes = () => { cleanup(); resolve(true);  };
      const no  = () => { cleanup(); resolve(false); };

      const onKey = (k) => {
        const kl = k.toLowerCase ? k.toLowerCase() : k;
        if (kl === 'y') yes();
        if (kl === 'n' || kl === 'q') no();
      };
      const onAction = (a) => {
        if (a === 'QUIT') no();
      };

      this.input.on('action', onAction);
      this.terminal.on('key', onKey);
    });
  }
}

module.exports = Img2Ansi;
