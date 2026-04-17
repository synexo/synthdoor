/**
 * constants.js
 * ANSI color codes, text attributes, CP437 character definitions.
 * Everything a game needs to paint the screen beautifully.
 */

'use strict';

// ─── ANSI Foreground Colors ────────────────────────────────────────────────
const Color = {
  // Standard
  BLACK:          0,
  RED:            1,
  GREEN:          2,
  YELLOW:         3,
  BLUE:           4,
  MAGENTA:        5,
  CYAN:           6,
  WHITE:          7,
  // Bright
  BRIGHT_BLACK:   8,  // dark gray
  BRIGHT_RED:     9,
  BRIGHT_GREEN:   10,
  BRIGHT_YELLOW:  11,
  BRIGHT_BLUE:    12,
  BRIGHT_MAGENTA: 13,
  BRIGHT_CYAN:    14,
  BRIGHT_WHITE:   15,

  // Aliases for BBS aesthetics
  DARK_GRAY:    8,
  LIGHT_RED:    9,
  LIGHT_GREEN:  10,
  LIGHT_YELLOW: 11,
  LIGHT_BLUE:   12,
  LIGHT_MAGENTA:13,
  LIGHT_CYAN:   14,
  INTENSE_WHITE:15,
};

// ─── ANSI Text Attributes ─────────────────────────────────────────────────
const Attr = {
  RESET:      0,
  BOLD:       1,
  DIM:        2,
  UNDERLINE:  4,
  BLINK:      5,
  REVERSE:    7,
  HIDDEN:     8,
};

// ─── CP437 Special Characters ─────────────────────────────────────────────
// Named constants for commonly used CP437 glyphs.
// These are the Unicode equivalents that terminals with CP437 fonts render correctly.
const CP437 = {
  // ── Block graphics ──────────────────────────────────────────────────────
  FULL_BLOCK:         '\u2588', // █  219
  UPPER_HALF_BLOCK:   '\u2580', // ▀  220 - pseudo 80x50 top pixel
  LOWER_HALF_BLOCK:   '\u2584', // ▄  220 - pseudo 80x50 bottom pixel
  LEFT_HALF_BLOCK:    '\u258C', // ▌  221
  RIGHT_HALF_BLOCK:   '\u2590', // ▐  222
  LIGHT_SHADE:        '\u2591', // ░  176 - dither 25%
  MEDIUM_SHADE:       '\u2592', // ▒  177 - dither 50%
  DARK_SHADE:         '\u2593', // ▓  178 - dither 75%

  // ── Single-line box drawing ─────────────────────────────────────────────
  BOX_H:              '\u2500', // ─  196
  BOX_V:              '\u2502', // │  179
  BOX_TL:             '\u250C', // ┌  218
  BOX_TR:             '\u2510', // ┐  191
  BOX_BL:             '\u2514', // └  192
  BOX_BR:             '\u2518', // ┘  217
  BOX_T:              '\u252C', // ┬  194
  BOX_B:              '\u2534', // ┴  193
  BOX_L:              '\u251C', // ├  195
  BOX_R:              '\u2524', // ┤  180
  BOX_X:              '\u253C', // ┼  197

  // ── Double-line box drawing ─────────────────────────────────────────────
  BOX2_H:             '\u2550', // ═  205
  BOX2_V:             '\u2551', // ║  186
  BOX2_TL:            '\u2554', // ╔  201
  BOX2_TR:            '\u2557', // ╗  187
  BOX2_BL:            '\u255A', // ╚  200
  BOX2_BR:            '\u255D', // ╝  188
  BOX2_T:             '\u2566', // ╦  203
  BOX2_B:             '\u2569', // ╩  202
  BOX2_L:             '\u2560', // ╠  204
  BOX2_R:             '\u2563', // ╣  185
  BOX2_X:             '\u256C', // ╬  206

  // ── Mixed single/double ─────────────────────────────────────────────────
  BOX_SD_TL:          '\u2552', // ╒  (single top, double side)
  BOX_DS_TL:          '\u2553', // ╓  (double top, single side)

  // ── Arrows ───────────────────────────────────────────────────────────────
  ARROW_UP:           '\u2191', // ↑
  ARROW_DOWN:         '\u2193', // ↓
  ARROW_LEFT:         '\u2190', // ←
  ARROW_RIGHT:        '\u2192', // →
  ARROW_DBL_UP:       '\u25B2', // ▲
  ARROW_DBL_DOWN:     '\u25BC', // ▼
  ARROW_DBL_LEFT:     '\u25C4', // ◄
  ARROW_DBL_RIGHT:    '\u25BA', // ►

  // ── Miscellaneous ───────────────────────────────────────────────────────
  BULLET:             '\u00B7', // ·
  DIAMOND:            '\u25C6', // ◆
  DEGREE:             '\u00B0', // °
  PLUSMINUS:          '\u00B1', // ±
  MIDDLE_DOT:         '\u00B7', // ·
  SOLID_SQUARE:       '\u25A0', // ■
  SMALL_SQUARE:       '\u25AA', // ▪
  SMILEY:             '\u263A', // ☺
  HEART:              '\u2665', // ♥
  SPADE:              '\u2660', // ♠
  CLUB:               '\u2663', // ♣
  MUSIC_NOTE:         '\u266A', // ♪
  SUN:                '\u263C', // ☼
  STAR:               '\u2605', // ★

  // ── Shade helpers (array ordered light→dark) ────────────────────────────
  SHADES: [' ', '\u2591', '\u2592', '\u2593', '\u2588'],
};

// ─── Dithering palette helpers ────────────────────────────────────────────
/**
 * Returns a CP437 shade character for a 0.0–1.0 intensity value.
 * Useful for gradients and pseudo-grayscale fills.
 */
CP437.shade = function(intensity) {
  const idx = Math.round(Math.min(1, Math.max(0, intensity)) * 4);
  return CP437.SHADES[idx];
};

module.exports = { Color, Attr, CP437 };
