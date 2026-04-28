/**
 * SynthDoor Binary ANSI Wire Format (SBANSI v1)
 * ============================================================================
 *
 * A lossless transcoding of the ANSI/CP437 byte stream emitted by SynthDoor's
 * engine, designed for the WebSocket transport. Telnet and rlogin transports
 * are unaffected — they continue speaking raw ANSI/CP437.
 *
 * INVARIANT
 * ---------
 *   For any input byte stream X:  decode(encode(X)) === X    (byte-for-byte)
 *
 * No assumptions about what downstream parsers do with the bytes. Every byte
 * that enters the encoder must emerge from the decoder identically. This
 * holds for all of 0x00–0xFF.
 *
 * BYTE CLASSIFICATION
 * -------------------
 *   1. CONTROL CODES — pass through unchanged on the wire:
 *        0x07 BEL, 0x08 BS, 0x09 TAB, 0x0A LF, 0x0B VT, 0x0C FF, 0x0D CR,
 *        0x1B ESC (also marks start of an ANSI escape — see encoder logic)
 *
 *   2. OPCODES — bytes 0x00–0x06 and 0x0E–0x1A. Have binary-protocol
 *      semantics defined by the table below. When a byte in this range
 *      appears as content, the encoder emits LITERAL <byte> (2 bytes); the
 *      decoder reverses this.
 *
 *   3. CONTENT — bytes 0x1C–0x1F (reserved opcode space, currently
 *      unallocated, treated as content) and 0x20–0xFF. Pass through.
 *
 * OPCODE TABLE
 * ------------
 *   Byte  Name              Args         Decodes to (exact bytes)
 *   ----  ----------------  -----------  -------------------------------
 *   0x00  LITERAL           byte(1B)     <byte>           (escape mechanism)
 *   0x01  MOVE_ABS          row, col     "\x1B[<row>;<col>H"  (1-indexed)
 *   0x02  MOVE_HOME         —            "\x1B[H"
 *   0x03  ERASE_EOL         —            "\x1B[K"
 *   0x04  ERASE_DISP_END    —            "\x1B[J"
 *   0x05  ERASE_DISP_ALL    —            "\x1B[2J"
 *   0x06  SGR_FG_BG         pack(1B)     "\x1B[" (params) "m"  (see below)
 *   0x0E  SGR_RESET         —            "\x1B[0m"
 *   0x0F  SGR_FG            pack(1B)     "\x1B[" (params) "m"
 *   0x10  SGR_BG            bg(1B)       "\x1B[4<bg>m"
 *   0x11  SGR_BOLD_ON       —            "\x1B[1m"
 *   0x12  CURSOR_HIDE       —            "\x1B[?25l"
 *   0x13  CURSOR_SHOW       —            "\x1B[?25h"
 *   0x14  CURSOR_SAVE       —            "\x1B[s"
 *   0x15  CURSOR_RESTORE    —            "\x1B[u"
 *   0x16  PARK              —            "\x1B[1;1H\x1B[0m"
 *   0x17–0x1A: Reserved for future use.
 *
 * SGR_FG_BG pack byte
 * -------------------
 *   Bit 7:    hasReset   — include "0;" prefix
 *   Bit 6:    hasBold    — include "1;" prefix (after reset if present)
 *   Bits 5–3: fg (0–7)   — emits "3<fg>"
 *   Bits 2–0: bg (0–7)   — emits ";4<bg>"
 *
 *   pack=0b00FFFBBB → "\x1B[3F;4Bm"
 *   pack=0b01FFFBBB → "\x1B[1;3F;4Bm"
 *   pack=0b10FFFBBB → "\x1B[0;3F;4Bm"
 *   pack=0b11FFFBBB → "\x1B[0;1;3F;4Bm"
 *
 * SGR_FG pack byte
 * ----------------
 *   Bit 7:    hasReset
 *   Bit 6:    hasBold
 *   Bits 5–3: fg (0–7)
 *   Bits 2–0: unused (must be 0)
 *
 *   pack=0b00FFF000 → "\x1B[3Fm"
 *   pack=0b01FFF000 → "\x1B[1;3Fm"
 *   pack=0b10FFF000 → "\x1B[0;3Fm"
 *   pack=0b11FFF000 → "\x1B[0;1;3Fm"
 *
 * ENCODER PASS-THROUGH
 * --------------------
 * Anything the encoder doesn't have an exact-match opcode for is emitted as
 * raw ANSI starting with 0x1B. The decoder hands off to its embedded
 * ANSIParser for these. This covers:
 *   - Non-CSI escapes: ESC 7, ESC 8, ESC c, ESC D, ESC E, ESC M (=RI)
 *   - CSIs with terminators we don't have opcodes for (e.g. \x1B[3A)
 *   - SGRs with parameters we don't recognise (e.g. \x1B[5m, \x1B[7m,
 *     \x1B[38;5;200m, etc.)
 *   - Compound SGRs whose shape isn't in our SGR_FG_BG / SGR_FG table
 *   - ANSI music: \x1B[M followed by MML content + 0x0E/0x1E/0x00/0x07
 *     terminator. Encoder enters music passthrough on \x1B[M and exits
 *     on the terminator byte.
 *
 * COMPRESSION CHARACTERISTICS
 * ---------------------------
 * Engine SGR emissions from screen.flush()._buildAttr() use a fixed grammar
 * (param order: reset, bold, fg, bg; no leading zeros). This matches the
 * SGR opcodes exactly, so compression is high. Other ANSI sequences pass
 * through verbatim — no compression but no expansion either.
 *
 * Worst-case expansion: 2:1 only for content bytes that fall in the opcode
 * range (rare CP437 glyphs in 0x00–0x06 and 0x0E–0x1A — smileys, card
 * suits, music notes, low arrows). Most engine content (printable ASCII
 * and CP437 high bytes 0x1A, 0x20–0xFF) passes through 1:1.
 */

'use strict';

// ─── Opcode constants ────────────────────────────────────────────────────────
const OP_LITERAL          = 0x00;
const OP_MOVE_ABS         = 0x01;
const OP_MOVE_HOME        = 0x02;
const OP_ERASE_EOL        = 0x03;
const OP_ERASE_DISP_END   = 0x04;
const OP_ERASE_DISP_ALL   = 0x05;
const OP_SGR_FG_BG        = 0x06;
// 0x07–0x0D: control codes (BEL/BS/TAB/LF/VT/FF/CR) — pass through
const OP_SGR_RESET        = 0x0E;
const OP_SGR_FG           = 0x0F;
const OP_SGR_BG           = 0x10;
const OP_SGR_BOLD_ON      = 0x11;
const OP_CURSOR_HIDE      = 0x12;
const OP_CURSOR_SHOW      = 0x13;
const OP_CURSOR_SAVE      = 0x14;
const OP_CURSOR_RESTORE   = 0x15;
const OP_PARK             = 0x16;
// 0x17–0x1A: reserved for future opcodes. Currently NOT escaped by the
// encoder and NOT dispatched by the decoder — they pass through as content
// bytes (their natural CP437 glyphs). When a future protocol version
// allocates one of these, both encoder's escape set AND decoder's dispatch
// must be updated together AND the wire-format version bumped.
//
// 0x1B: ESC — pass through, marks start of ANSI escape sequence.
// 0x1C–0x1F: content (CP437 glyphs ∟ ↔ ▲ ▼) — pass through unchanged.

// ─── Helper: which content-byte values must be escaped via LITERAL? ──────────
// Exactly the set the decoder dispatches as opcodes today. Reserved opcodes
// (0x17–0x1A) are NOT in this set — they pass through as content. If a
// future version allocates them, the wire format version bumps.
function isOpcodeByte(b) {
  if (b === 0x00)             return true;  // LITERAL
  if (b >= 0x01 && b <= 0x06) return true;  // MOVE_ABS..SGR_FG_BG
  if (b >= 0x0E && b <= 0x16) return true;  // SGR_RESET..PARK
  if (b === 0x1B)             return true;  // ESC — triggers ANSI passthrough
  return false;
}

module.exports = {
  OP_LITERAL,
  OP_MOVE_ABS,
  OP_MOVE_HOME,
  OP_ERASE_EOL,
  OP_ERASE_DISP_END,
  OP_ERASE_DISP_ALL,
  OP_SGR_FG_BG,
  OP_SGR_RESET,
  OP_SGR_FG,
  OP_SGR_BG,
  OP_SGR_BOLD_ON,
  OP_CURSOR_HIDE,
  OP_CURSOR_SHOW,
  OP_CURSOR_SAVE,
  OP_CURSOR_RESTORE,
  OP_PARK,

  isOpcodeByte,
};
