/**
 * cp437-encode.js
 * Encodes a Unicode string to a CP437 byte Buffer for transmission
 * over telnet/rlogin connections to BBS-compatible clients.
 *
 * CP437 (Code Page 437) is the original IBM PC character encoding.
 * Bytes 0x00-0x7F are identical to ASCII.
 * Bytes 0x80-0xFF map to box-drawing, block graphics, and special symbols.
 *
 * ANSI escape sequences (ESC [ ... ) are passed through byte-for-byte
 * since they are 7-bit ASCII and need no translation.
 *
 * Usage:
 *   const { encodeCP437 } = require('./cp437-encode');
 *   socket.write(encodeCP437('\u2588 Hello \u2554\u2550\u2557'));
 *   // → Buffer <db 20 48 65 6c 6c 6f 20 c9 cd bb>
 */

'use strict';

// ─── Unicode → CP437 byte mapping ─────────────────────────────────────────
// Only the upper half (0x80-0xFF) needs mapping; 0x00-0x7F are identity.
// Key = Unicode codepoint, Value = CP437 byte value.
// Built from the official IBM CP437 character set.

const UNICODE_TO_CP437 = new Map([
  // ── Box drawing — single line ───────────────────────────────────────────
  [0x2500, 0xC4], // ─  BOX DRAWINGS LIGHT HORIZONTAL
  [0x2502, 0xB3], // │  BOX DRAWINGS LIGHT VERTICAL
  [0x250C, 0xDA], // ┌  BOX DRAWINGS LIGHT DOWN AND RIGHT
  [0x2510, 0xBF], // ┐  BOX DRAWINGS LIGHT DOWN AND LEFT
  [0x2514, 0xC0], // └  BOX DRAWINGS LIGHT UP AND RIGHT
  [0x2518, 0xD9], // ┘  BOX DRAWINGS LIGHT UP AND LEFT
  [0x251C, 0xC3], // ├  BOX DRAWINGS LIGHT VERTICAL AND RIGHT
  [0x2524, 0xB4], // ┤  BOX DRAWINGS LIGHT VERTICAL AND LEFT
  [0x252C, 0xC2], // ┬  BOX DRAWINGS LIGHT DOWN AND HORIZONTAL
  [0x2534, 0xC1], // ┴  BOX DRAWINGS LIGHT UP AND HORIZONTAL
  [0x253C, 0xC5], // ┼  BOX DRAWINGS LIGHT VERTICAL AND HORIZONTAL

  // ── Box drawing — double line ───────────────────────────────────────────
  [0x2550, 0xCD], // ═  BOX DRAWINGS DOUBLE HORIZONTAL
  [0x2551, 0xBA], // ║  BOX DRAWINGS DOUBLE VERTICAL
  [0x2554, 0xC9], // ╔  BOX DRAWINGS DOUBLE DOWN AND RIGHT
  [0x2557, 0xBB], // ╗  BOX DRAWINGS DOUBLE DOWN AND LEFT
  [0x255A, 0xC8], // ╚  BOX DRAWINGS DOUBLE UP AND RIGHT
  [0x255D, 0xBC], // ╝  BOX DRAWINGS DOUBLE UP AND LEFT
  [0x2560, 0xCC], // ╠  BOX DRAWINGS DOUBLE VERTICAL AND RIGHT
  [0x2563, 0xB9], // ╣  BOX DRAWINGS DOUBLE VERTICAL AND LEFT
  [0x2566, 0xCB], // ╦  BOX DRAWINGS DOUBLE DOWN AND HORIZONTAL
  [0x2569, 0xCA], // ╩  BOX DRAWINGS DOUBLE UP AND HORIZONTAL
  [0x256C, 0xCE], // ╬  BOX DRAWINGS DOUBLE VERTICAL AND HORIZONTAL

  // ── Box drawing — mixed single/double ──────────────────────────────────
  [0x2552, 0xD5], // ╒
  [0x2553, 0xD6], // ╓
  [0x2555, 0xB8], // ╕
  [0x2556, 0xB7], // ╖
  [0x2558, 0xD4], // ╘
  [0x2559, 0xD3], // ╙
  [0x255B, 0xBE], // ╛
  [0x255C, 0xBD], // ╜
  [0x255E, 0xC6], // ╞
  [0x255F, 0xC7], // ╟
  [0x2561, 0xB5], // ╡
  [0x2562, 0xB6], // ╢
  [0x2564, 0xD1], // ╤
  [0x2565, 0xD2], // ╥
  [0x2567, 0xCF], // ╧
  [0x2568, 0xD0], // ╨
  [0x256A, 0xD8], // ╪
  [0x256B, 0xD7], // ╫

  // ── Block graphics ──────────────────────────────────────────────────────
  [0x2588, 0xDB], // █  FULL BLOCK
  [0x2580, 0xDF], // ▀  UPPER HALF BLOCK
  [0x2584, 0xDC], // ▄  LOWER HALF BLOCK
  [0x258C, 0xDD], // ▌  LEFT HALF BLOCK
  [0x2590, 0xDE], // ▐  RIGHT HALF BLOCK
  [0x2591, 0xB0], // ░  LIGHT SHADE
  [0x2592, 0xB1], // ▒  MEDIUM SHADE
  [0x2593, 0xB2], // ▓  DARK SHADE

  // ── Arrows ──────────────────────────────────────────────────────────────
  [0x2191, 0x18], // ↑
  [0x2193, 0x19], // ↓
  [0x2192, 0x1A], // →
  [0x2190, 0x1B], // ←
  [0x25B2, 0x1E], // ▲
  [0x25BC, 0x1F], // ▼
  [0x25BA, 0x10], // ►
  [0x25C4, 0x11], // ◄

  // ── Geometric shapes ────────────────────────────────────────────────────
  [0x25A0, 0xFE], // ■  BLACK SQUARE
  [0x25AA, 0xFE], // ▪  (approx)
  [0x25C6, 0x04], // ◆  BLACK DIAMOND SUIT (approx with diamond)
  [0x25CA, 0x04], // ◊  LOZENGE

  // ── Symbols ─────────────────────────────────────────────────────────────
  [0x263A, 0x01], // ☺  WHITE SMILING FACE
  [0x263B, 0x02], // ☻  BLACK SMILING FACE
  [0x2665, 0x03], // ♥  BLACK HEART SUIT
  [0x2666, 0x04], // ♦  BLACK DIAMOND SUIT
  [0x2663, 0x05], // ♣  BLACK CLUB SUIT
  [0x2660, 0x06], // ♠  BLACK SPADE SUIT
  [0x2022, 0x07], // •  BULLET
  [0x25D8, 0x08], // ◘
  [0x25CB, 0x09], // ○
  [0x25D9, 0x0A], // ◙
  [0x2642, 0x0B], // ♂  MALE SIGN
  [0x2640, 0x0C], // ♀  FEMALE SIGN
  [0x266A, 0x0D], // ♪  EIGHTH NOTE
  [0x266B, 0x0E], // ♫  BEAMED EIGHTH NOTES
  [0x263C, 0x0F], // ☼  WHITE SUN WITH RAYS
  [0x25BA, 0x10], // ►
  [0x25C4, 0x11], // ◄
  [0x2195, 0x12], // ↕
  [0x203C, 0x13], // ‼
  [0x00B6, 0x14], // ¶
  [0x00A7, 0x15], // §
  [0x25AC, 0x16], // ▬
  [0x21A8, 0x17], // ↨
  [0x2605, 0x04], // ★  (approx with diamond)
  [0x2606, 0x04], // ☆

  // ── Latin extended / accented characters ────────────────────────────────
  [0x00C7, 0x80], // Ç
  [0x00FC, 0x81], // ü
  [0x00E9, 0x82], // é
  [0x00E2, 0x83], // â
  [0x00E4, 0x84], // ä
  [0x00E0, 0x85], // à
  [0x00E5, 0x86], // å
  [0x00E7, 0x87], // ç
  [0x00EA, 0x88], // ê
  [0x00EB, 0x89], // ë
  [0x00E8, 0x8A], // è
  [0x00EF, 0x8B], // ï
  [0x00EE, 0x8C], // î
  [0x00EC, 0x8D], // ì
  [0x00C4, 0x8E], // Ä
  [0x00C5, 0x8F], // Å
  [0x00C9, 0x90], // É
  [0x00E6, 0x91], // æ
  [0x00C6, 0x92], // Æ
  [0x00F4, 0x93], // ô
  [0x00F6, 0x94], // ö
  [0x00F2, 0x95], // ò
  [0x00FB, 0x96], // û
  [0x00F9, 0x97], // ù
  [0x00FF, 0x98], // ÿ
  [0x00D6, 0x99], // Ö
  [0x00DC, 0x9A], // Ü
  [0x00A2, 0x9B], // ¢
  [0x00A3, 0x9C], // £
  [0x00A5, 0x9D], // ¥
  [0x20A7, 0x9E], // ₧
  [0x0192, 0x9F], // ƒ
  [0x00E1, 0xA0], // á
  [0x00ED, 0xA1], // í
  [0x00F3, 0xA2], // ó
  [0x00FA, 0xA3], // ú
  [0x00F1, 0xA4], // ñ
  [0x00D1, 0xA5], // Ñ
  [0x00AA, 0xA6], // ª
  [0x00BA, 0xA7], // º
  [0x00BF, 0xA8], // ¿
  [0x2310, 0xA9], // ⌐
  [0x00AC, 0xAA], // ¬
  [0x00BD, 0xAB], // ½
  [0x00BC, 0xAC], // ¼
  [0x00A1, 0xAD], // ¡
  [0x00AB, 0xAE], // «
  [0x00BB, 0xAF], // »

  // ── Math / technical ────────────────────────────────────────────────────
  [0x2248, 0xF7], // ≈
  [0x00B0, 0xF8], // °
  [0x2219, 0xF9], // ∙
  [0x00B7, 0xFA], // ·
  [0x221A, 0xFB], // √
  [0x207F, 0xFC], // ⁿ
  [0x00B2, 0xFD], // ²
  [0x25A0, 0xFE], // ■
  [0x00A0, 0xFF], // NBSP

  [0x03B1, 0xE0], // α
  [0x00DF, 0xE1], // ß
  [0x0393, 0xE2], // Γ
  [0x03C0, 0xE3], // π
  [0x03A3, 0xE4], // Σ
  [0x03C3, 0xE5], // σ
  [0x00B5, 0xE6], // µ
  [0x03C4, 0xE7], // τ
  [0x03A6, 0xE8], // Φ
  [0x0398, 0xE9], // Θ
  [0x03A9, 0xEA], // Ω
  [0x03B4, 0xEB], // δ
  [0x221E, 0xEC], // ∞
  [0x03C6, 0xED], // φ
  [0x03B5, 0xEE], // ε
  [0x2229, 0xEF], // ∩
  [0x2261, 0xF0], // ≡
  [0x00B1, 0xF1], // ±
  [0x2265, 0xF2], // ≥
  [0x2264, 0xF3], // ≤
  [0x2320, 0xF4], // ⌠
  [0x2321, 0xF5], // ⌡
  [0x00F7, 0xF6], // ÷
]);

/**
 * Encode a Unicode string to a CP437 Buffer.
 * - 7-bit ASCII characters (0x00-0x7F) pass through unchanged.
 * - ANSI escape sequences pass through unchanged (they are 7-bit).
 * - Known Unicode characters are mapped to their CP437 byte.
 * - Unknown characters outside ASCII are replaced with '?' (0x3F).
 *
 * @param  {string} str
 * @returns {Buffer}
 */
function encodeCP437(str) {
  // Fast path: if all characters are ASCII, return a plain Buffer directly
  let allAscii = true;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7F) { allAscii = false; break; }
  }
  if (allAscii) return Buffer.from(str, 'binary');

  // Full encode pass
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);

    // ASCII passthrough (including all ANSI escape sequence bytes)
    if (cp <= 0x7F) {
      bytes.push(cp);
      continue;
    }

    // Handle UTF-16 surrogate pairs (emoji etc.) — replace with '?'
    if (cp >= 0xD800 && cp <= 0xDBFF) {
      i++; // skip low surrogate
      bytes.push(0x3F);
      continue;
    }

    const mapped = UNICODE_TO_CP437.get(cp);
    if (mapped !== undefined) {
      bytes.push(mapped);
    } else {
      // Unknown — replace with '?'
      bytes.push(0x3F);
    }
  }

  return Buffer.from(bytes);
}

/**
 * Returns true if the character is a pure ASCII codepoint.
 * Useful for deciding whether to encode a string at all.
 */
function isAscii(str) {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7F) return false;
  }
  return true;
}

module.exports = { encodeCP437, isAscii, UNICODE_TO_CP437 };
