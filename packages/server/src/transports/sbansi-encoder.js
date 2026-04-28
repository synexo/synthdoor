/**
 * SBANSI encoder — transduces ANSI/CP437 byte stream to binary opcode form.
 *
 * Used by the WebSocket transport to compress engine output before ws.send.
 * Telnet/rlogin transports do not use this — they emit raw ANSI/CP437.
 *
 * Byte-for-byte round-trip: decode(encode(X)) === X for any X.
 *
 * See sbansi-spec.js for the wire format.
 */
'use strict';

const path = require('path');
const SPEC = require(path.join(__dirname, 'sbansi-spec'));

// Encoder states
const S_CONTENT = 0;
const S_ESC     = 1;
const S_CSI     = 2;
const S_MUSIC   = 3;

class SBANSIEncoder {
  constructor() {
    this._state  = S_CONTENT;
    this._csiBuf = [];   // accumulated bytes between \x1B[ and the terminator
  }

  /**
   * Encode bytes. Returns a Buffer. Stateful — call repeatedly for streaming.
   */
  encode(input) {
    const inBuf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'binary');
    const out = [];
    for (let i = 0; i < inBuf.length; i++) this._consume(inBuf[i], out);
    return Buffer.from(out);
  }

  _consume(b, out) {
    switch (this._state) {
      case S_CONTENT: return this._content(b, out);
      case S_ESC:     return this._esc(b, out);
      case S_CSI:     return this._csi(b, out);
      case S_MUSIC:   return this._music(b, out);
    }
  }

  _content(b, out) {
    if (b === 0x1B) { this._state = S_ESC; return; }
    if (SPEC.isOpcodeByte(b)) { out.push(SPEC.OP_LITERAL, b); return; }
    out.push(b);
  }

  _esc(b, out) {
    if (b === 0x5B /* '[' */) {
      this._state  = S_CSI;
      this._csiBuf = [];
      return;
    }
    // Any other byte after ESC: pass through verbatim. Covers ESC 7, ESC 8,
    // ESC c, ESC D, ESC E, ESC M (=RI), and any unrecognised ESC variant.
    out.push(0x1B, b);
    this._state = S_CONTENT;
  }

  _csi(b, out) {
    // Accumulate body until terminator (0x40–0x7E).
    if (b >= 0x40 && b <= 0x7E) {
      const stateChanged = this._dispatchCsi(b, out);
      // _dispatchCsi may set the encoder into S_MUSIC for \x1B[M. Only reset
      // to S_CONTENT if it didn't change state itself.
      if (!stateChanged) this._state = S_CONTENT;
      this._csiBuf = [];
      return;
    }
    if ((b >= 0x20 && b <= 0x2F) || (b >= 0x30 && b <= 0x3F)) {
      this._csiBuf.push(b);
      // Defensive cap; engine never emits CSIs longer than ~16 bytes.
      if (this._csiBuf.length > 64) {
        this._emitCsiVerbatim(out, /* terminator */ null);
        this._state = S_CONTENT;
      }
      return;
    }
    // Malformed (a byte that's neither param/intermediate nor terminator):
    // emit what we have verbatim, treat current byte fresh.
    this._emitCsiVerbatim(out, null);
    this._state = S_CONTENT;
    this._content(b, out);
  }

  _music(b, out) {
    // Music payload passes through verbatim; terminators are 0x0E, 0x1E, 0x00, 0x07.
    out.push(b);
    if (b === 0x0E || b === 0x1E || b === 0x00 || b === 0x07) {
      this._state = S_CONTENT;
    }
  }

  // ─── CSI dispatch — must produce byte-for-byte equivalent on decode ────────
  // Returns true if it set a new encoder state that the caller must NOT
  // overwrite back to S_CONTENT (e.g. entering S_MUSIC after \x1B[M).
  _dispatchCsi(final, out) {
    const buf = this._csiBuf;
    const paramStr = String.fromCharCode(...buf);

    // ── ANSI music start: \x1B[M with no params ─────────────────────────────
    // Must enter music passthrough state. The CSI itself is emitted verbatim
    // so the decoder's ANSIParser recognises it.
    if (final === 0x4D /* M */ && paramStr === '') {
      out.push(0x1B, 0x5B, 0x4D);  // \x1B[M verbatim
      this._state = S_MUSIC;
      return true;
    }

    // ── Cursor position: only canonical \x1B[<r>;<c>H form ──────────────────
    // Engine always emits this exact shape from screen.flush. Other shapes
    // (e.g. \x1B[H, \x1B[<r>;<c>f, leading zeros) handled separately or
    // verbatim.
    if (final === 0x48 /* H */) {
      // Special case: \x1B[H (no params) → MOVE_HOME
      if (paramStr === '') {
        out.push(SPEC.OP_MOVE_HOME);
        return;
      }
      // \x1B[<r>;<c>H with no leading zeros, both 1-indexed and within range
      const m = /^([1-9]\d*);([1-9]\d*)$/.exec(paramStr);
      if (m) {
        const row = parseInt(m[1], 10);
        const col = parseInt(m[2], 10);
        if (row >= 1 && row <= 255 && col >= 1 && col <= 255) {
          // Special-case (1,1) — engine's screen.flush PARK sequence is
          // \x1B[1;1H\x1B[0m. We don't try to merge into PARK here (would
          // require lookahead); the decoder gets MOVE_ABS(1,1) + SGR_RESET
          // which encodes back to \x1B[1;1H + \x1B[0m — byte-for-byte.
          out.push(SPEC.OP_MOVE_ABS, row, col);
          return;
        }
      }
      // Anything else (unusual coords or shape) — verbatim.
    }

    // ── Erase line: only canonical \x1B[K form ──────────────────────────────
    // Note: \x1B[0K and \x1B[K behave identically but are different bytes.
    // For byte-for-byte round-trip, only the parameterless form gets the
    // opcode.
    if (final === 0x4B /* K */ && paramStr === '') {
      out.push(SPEC.OP_ERASE_EOL);
      return;
    }

    // ── Erase display: \x1B[J and \x1B[2J only ──────────────────────────────
    if (final === 0x4A /* J */) {
      if (paramStr === '')  { out.push(SPEC.OP_ERASE_DISP_END); return; }
      if (paramStr === '2') { out.push(SPEC.OP_ERASE_DISP_ALL); return; }
    }

    // ── SGR: only specific known shapes from _buildAttr ─────────────────────
    if (final === 0x6D /* m */) {
      if (this._tryDispatchSgr(paramStr, out)) return;
    }

    // ── Cursor save/restore ─────────────────────────────────────────────────
    if (paramStr === '') {
      if (final === 0x73 /* s */) { out.push(SPEC.OP_CURSOR_SAVE);    return; }
      if (final === 0x75 /* u */) { out.push(SPEC.OP_CURSOR_RESTORE); return; }
    }

    // ── Cursor visibility: \x1B[?25l and \x1B[?25h exactly ──────────────────
    if (paramStr === '?25') {
      if (final === 0x6C /* l */) { out.push(SPEC.OP_CURSOR_HIDE); return; }
      if (final === 0x68 /* h */) { out.push(SPEC.OP_CURSOR_SHOW); return; }
    }

    // ── Unrecognised — verbatim ─────────────────────────────────────────────
    this._emitCsiVerbatim(out, final);
  }

  _emitCsiVerbatim(out, final) {
    out.push(0x1B, 0x5B);
    for (const x of this._csiBuf) out.push(x);
    if (final !== null) out.push(final);
  }

  // ─── SGR shape recognition ────────────────────────────────────────────────
  // The engine's _buildAttr emits a small set of canonical shapes. Match
  // them exactly and emit the corresponding opcode. Anything else: caller
  // emits verbatim.
  //
  // Recognised shapes (where F = single digit 0–7, B = single digit 0–7):
  //   "0"                   → SGR_RESET
  //   "1"                   → SGR_BOLD_ON
  //   "3F"                  → SGR_FG, pack=0b00FFF000
  //   "1;3F"                → SGR_FG, pack=0b01FFF000
  //   "0;3F"                → SGR_FG, pack=0b10FFF000
  //   "0;1;3F"              → SGR_FG, pack=0b11FFF000
  //   "4B"                  → SGR_BG, b=B
  //   "3F;4B"               → SGR_FG_BG, pack=0b00FFFBBB
  //   "1;3F;4B"             → SGR_FG_BG, pack=0b01FFFBBB
  //   "0;3F;4B"             → SGR_FG_BG, pack=0b10FFFBBB
  //   "0;1;3F;4B"           → SGR_FG_BG, pack=0b11FFFBBB
  //
  // Returns true if recognised and emitted, false if caller should verbatim.
  _tryDispatchSgr(paramStr, out) {
    if (paramStr === '0') { out.push(SPEC.OP_SGR_RESET);    return true; }
    if (paramStr === '1') { out.push(SPEC.OP_SGR_BOLD_ON);  return true; }

    // Match each recognised shape.
    let m;

    // Single fg
    if ((m = /^3([0-7])$/.exec(paramStr))) {
      out.push(SPEC.OP_SGR_FG, (parseInt(m[1], 10) << 3) & 0xFF);
      return true;
    }
    // Single bg
    if ((m = /^4([0-7])$/.exec(paramStr))) {
      out.push(SPEC.OP_SGR_BG, parseInt(m[1], 10) & 0x07);
      return true;
    }
    // Bold + fg
    if ((m = /^1;3([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      out.push(SPEC.OP_SGR_FG, 0x40 | (fg << 3));
      return true;
    }
    // Reset + fg
    if ((m = /^0;3([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      out.push(SPEC.OP_SGR_FG, 0x80 | (fg << 3));
      return true;
    }
    // Reset + bold + fg
    if ((m = /^0;1;3([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      out.push(SPEC.OP_SGR_FG, 0xC0 | (fg << 3));
      return true;
    }
    // fg + bg
    if ((m = /^3([0-7]);4([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      const bg = parseInt(m[2], 10);
      out.push(SPEC.OP_SGR_FG_BG, (fg << 3) | bg);
      return true;
    }
    // Bold + fg + bg
    if ((m = /^1;3([0-7]);4([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      const bg = parseInt(m[2], 10);
      out.push(SPEC.OP_SGR_FG_BG, 0x40 | (fg << 3) | bg);
      return true;
    }
    // Reset + fg + bg
    if ((m = /^0;3([0-7]);4([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      const bg = parseInt(m[2], 10);
      out.push(SPEC.OP_SGR_FG_BG, 0x80 | (fg << 3) | bg);
      return true;
    }
    // Reset + bold + fg + bg
    if ((m = /^0;1;3([0-7]);4([0-7])$/.exec(paramStr))) {
      const fg = parseInt(m[1], 10);
      const bg = parseInt(m[2], 10);
      out.push(SPEC.OP_SGR_FG_BG, 0xC0 | (fg << 3) | bg);
      return true;
    }

    return false;
  }
}

module.exports = { SBANSIEncoder };
