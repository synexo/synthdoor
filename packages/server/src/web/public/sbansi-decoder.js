/**
 * SBANSI decoder — reverses the SBANSI encoder, producing the original
 * ANSI/CP437 byte stream.
 *
 * Architecture: pure byte-to-byte transducer. The decoder takes binary
 * opcode-stream bytes and emits the original ANSI/CP437 bytes that were
 * fed into the encoder. The client then feeds the decoder's output into
 * its existing ANSIParser, exactly as if the bytes had arrived directly
 * from a telnet/rlogin transport.
 *
 * Byte-for-byte invariant: decoder output for any encoder input equals
 * the encoder's input verbatim.
 *
 * See sbansi-spec.js for the wire format.
 */

// Opcode constants — must mirror the server-side spec.
export const OP_LITERAL          = 0x00;
export const OP_MOVE_ABS         = 0x01;
export const OP_MOVE_HOME        = 0x02;
export const OP_ERASE_EOL        = 0x03;
export const OP_ERASE_DISP_END   = 0x04;
export const OP_ERASE_DISP_ALL   = 0x05;
export const OP_SGR_FG_BG        = 0x06;
export const OP_SGR_RESET        = 0x0E;
export const OP_SGR_FG           = 0x0F;
export const OP_SGR_BG           = 0x10;
export const OP_SGR_BOLD_ON      = 0x11;
export const OP_CURSOR_HIDE      = 0x12;
export const OP_CURSOR_SHOW      = 0x13;
export const OP_CURSOR_SAVE      = 0x14;
export const OP_CURSOR_RESTORE   = 0x15;
export const OP_PARK             = 0x16;

// Decoder states
const D_BIN              = 0;
const D_AWAIT_LITERAL    = 1;
const D_AWAIT_MOVE_ROW   = 2;
const D_AWAIT_MOVE_COL   = 3;
const D_AWAIT_SGR_FG_BG  = 4;
const D_AWAIT_SGR_FG     = 5;
const D_AWAIT_SGR_BG     = 6;
const D_ANSI_PASSTHROUGH = 7;  // 0x1B seen — copy bytes until escape ends

/**
 * Stateful byte-to-byte decoder. Feed bytes via decode(); receive original
 * ANSI bytes via the returned arrays (concatenate as needed for streaming).
 */
export class SBANSIDecoder {
  constructor() {
    this._state = D_BIN;
    this._row   = 0;

    // ANSI passthrough sub-state: lightweight ESC/CSI/MUSIC tracker so we
    // know when the passthrough sequence ends and we can return to D_BIN.
    this._passSub        = 'ESC';   // 'ESC' | 'CSI' | 'MUSIC'
    this._passCsiHasParams = false; // set when CSI accumulates any param byte
  }

  /**
   * Feed encoder output bytes; return the corresponding original ANSI bytes.
   * @param {Uint8Array|Buffer|number[]} bytes
   * @returns {Uint8Array}
   */
  decode(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) this._consume(bytes[i], out);
    return new Uint8Array(out);
  }

  _consume(b, out) {
    switch (this._state) {
      case D_BIN:              return this._bin(b, out);
      case D_AWAIT_LITERAL:    out.push(b); this._state = D_BIN; return;
      case D_AWAIT_MOVE_ROW:   this._row = b; this._state = D_AWAIT_MOVE_COL; return;
      case D_AWAIT_MOVE_COL:   this._emitMoveAbs(this._row, b, out); this._state = D_BIN; return;
      case D_AWAIT_SGR_FG_BG:  this._emitSgrFgBg(b, out); this._state = D_BIN; return;
      case D_AWAIT_SGR_FG:     this._emitSgrFg(b, out);   this._state = D_BIN; return;
      case D_AWAIT_SGR_BG:     this._emitSgrBg(b, out);   this._state = D_BIN; return;
      case D_ANSI_PASSTHROUGH: return this._passthrough(b, out);
    }
  }

  _bin(b, out) {
    switch (b) {
      case OP_LITERAL:        this._state = D_AWAIT_LITERAL;   return;
      case OP_MOVE_ABS:       this._state = D_AWAIT_MOVE_ROW;  return;
      case OP_MOVE_HOME:      pushStr(out, '\x1B[H');          return;
      case OP_ERASE_EOL:      pushStr(out, '\x1B[K');          return;
      case OP_ERASE_DISP_END: pushStr(out, '\x1B[J');          return;
      case OP_ERASE_DISP_ALL: pushStr(out, '\x1B[2J');         return;
      case OP_SGR_FG_BG:      this._state = D_AWAIT_SGR_FG_BG; return;
      case OP_SGR_RESET:      pushStr(out, '\x1B[0m');         return;
      case OP_SGR_FG:         this._state = D_AWAIT_SGR_FG;    return;
      case OP_SGR_BG:         this._state = D_AWAIT_SGR_BG;    return;
      case OP_SGR_BOLD_ON:    pushStr(out, '\x1B[1m');         return;
      case OP_CURSOR_HIDE:    pushStr(out, '\x1B[?25l');       return;
      case OP_CURSOR_SHOW:    pushStr(out, '\x1B[?25h');       return;
      case OP_CURSOR_SAVE:    pushStr(out, '\x1B[s');          return;
      case OP_CURSOR_RESTORE: pushStr(out, '\x1B[u');          return;
      case OP_PARK:           pushStr(out, '\x1B[1;1H\x1B[0m'); return;

      case 0x1B:
        // ANSI passthrough — copy 0x1B and subsequent bytes verbatim until
        // the escape sequence ends. Track sub-state to know when we're done.
        out.push(0x1B);
        this._state             = D_ANSI_PASSTHROUGH;
        this._passSub           = 'ESC';
        this._passCsiHasParams  = false;
        return;
    }

    // Anything else: pass through unchanged. Includes:
    //   0x07–0x0D: terminal control codes
    //   0x17–0x1A: reserved opcode space, currently treated as content
    //              (CP437 glyphs)
    //   0x1C–0x1F: content (CP437 glyphs ∟ ↔ ▲ ▼)
    //   0x20–0xFF: regular content
    out.push(b);
  }

  _passthrough(b, out) {
    out.push(b);
    if (this._passSub === 'ESC') {
      if (b === 0x5B /* '[' */) {
        this._passSub = 'CSI';
      } else {
        // Single-byte ESC sequence (ESC 7, ESC 8, ESC c, etc.) — done.
        this._state = D_BIN;
      }
      return;
    }
    if (this._passSub === 'CSI') {
      // Param (0x30–0x3F) or intermediate (0x20–0x2F) byte: keep accumulating.
      if ((b >= 0x20 && b <= 0x2F) || (b >= 0x30 && b <= 0x3F)) {
        this._passCsiHasParams = true;
        return;
      }
      // Final byte of CSI is in 0x40–0x7E.
      if (b >= 0x40 && b <= 0x7E) {
        // \x1B[M with no params is ANSI music start; payload follows until
        // a music terminator (0x0E, 0x1E, 0x00, 0x07).
        if (b === 0x4D /* M */ && !this._passCsiHasParams) {
          this._passSub = 'MUSIC';
          return;
        }
        // Otherwise CSI is complete.
        this._state = D_BIN;
      }
      // Anything else (out of spec): stay in CSI; ANSIParser will sort it out.
      return;
    }
    if (this._passSub === 'MUSIC') {
      if (b === 0x0E || b === 0x1E || b === 0x00 || b === 0x07) {
        this._state = D_BIN;
      }
      return;
    }
  }

  // ─── Reconstruction emitters (byte-for-byte original sequence) ──────────────

  _emitMoveAbs(row, col, out) {
    pushStr(out, `\x1B[${row};${col}H`);
  }

  _emitSgrFgBg(pack, out) {
    const reset = (pack >> 7) & 1;
    const bold  = (pack >> 6) & 1;
    const fg    = (pack >> 3) & 7;
    const bg    =  pack       & 7;
    const parts = [];
    if (reset) parts.push('0');
    if (bold)  parts.push('1');
    parts.push('3' + fg);
    parts.push('4' + bg);
    pushStr(out, '\x1B[' + parts.join(';') + 'm');
  }

  _emitSgrFg(pack, out) {
    const reset = (pack >> 7) & 1;
    const bold  = (pack >> 6) & 1;
    const fg    = (pack >> 3) & 7;
    const parts = [];
    if (reset) parts.push('0');
    if (bold)  parts.push('1');
    parts.push('3' + fg);
    pushStr(out, '\x1B[' + parts.join(';') + 'm');
  }

  _emitSgrBg(bg, out) {
    pushStr(out, `\x1B[4${bg & 7}m`);
  }
}

function pushStr(out, s) {
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
}
