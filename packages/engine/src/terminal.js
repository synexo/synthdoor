/**
 * terminal.js
 * Low-level terminal abstraction. Wraps a duplex stream (telnet socket,
 * rlogin socket, or WebSocket bridge) and exposes a consistent API for
 * writing raw ANSI sequences and reading keystrokes.
 *
 * Games never talk to sockets directly — they talk to a Terminal instance.
 */

'use strict';

const { EventEmitter } = require('events');
const { Color, Attr } = require('./constants');
const { encodeCP437 } = require('./cp437-encode');

// ANSI escape prefix
const ESC = '\x1b[';

// Transports that require CP437 byte encoding (classic BBS clients)
const CP437_TRANSPORTS = new Set(['telnet', 'rlogin', 'web']);

// Regex to strip ANSI escape sequences from a string (for visual length measurement)
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b[^[]/g;

class Terminal extends EventEmitter {
  /**
   * @param {object} opts
   * @param {Writable}  opts.output     - stream to write ANSI sequences to
   * @param {Readable}  opts.input      - stream to read raw keystrokes from
   * @param {string}    opts.username   - authenticated username from transport
   * @param {string}    [opts.transport]  - 'telnet'|'rlogin'|'web'
   * @param {string}    [opts.encoding]   - force encoding: 'cp437' or 'utf8'
   */
  constructor(opts = {}) {
    super();
    this.output    = opts.output;
    this.input     = opts.input;
    this.username  = opts.username || 'anonymous';
    this.transport = opts.transport || 'telnet';
    this.width     = 80;
    this.height    = 25;
    this._inputBuf = '';
    this._col      = 0; // current column position (scroll mode only)

    if (opts.encoding) {
      this._cp437 = (opts.encoding === 'cp437');
    } else {
      this._cp437 = CP437_TRANSPORTS.has(this.transport);
    }

    if (this.input) {
      this.input.on('data', (chunk) => this._onData(chunk));
      this.input.on('end',  () => this.emit('disconnect'));
      this.input.on('error',() => this.emit('disconnect'));
    }
  }

  // ─── Raw write ────────────────────────────────────────────────────
  write(str) {
    if (!this.output || this.output.destroyed) return;
    if (this._cp437) {
      this.output.write(encodeCP437(str));
    } else {
      this.output.write(str, 'utf8');
    }
  }

  /**
   * Write a raw ASCII/binary string directly to the output stream,
   * bypassing CP437 encoding. Use for control sequences and ANSI music.
   */
  writeRaw(str) {
    if (!this.output || this.output.destroyed) return;
    this.output.write(Buffer.from(str, 'binary'));
  }

  // ─── Cursor movement ─────────────────────────────────────────────────────
  moveTo(col, row) { this.writeRaw(`\x1b[${row};${col}H`); this._col = col - 1; return this; }
  cursorUp(n = 1)    { this.writeRaw(`\x1b[${n}A`); return this; }
  cursorDown(n = 1)  { this.writeRaw(`\x1b[${n}B`); return this; }
  cursorRight(n = 1) { this.writeRaw(`\x1b[${n}C`); this._col += n; return this; }
  cursorLeft(n = 1)  { this.writeRaw(`\x1b[${n}D`); this._col = Math.max(0, this._col - n); return this; }
  saveCursor()       { this.writeRaw('\x1b[s');      return this; }
  restoreCursor()    { this.writeRaw('\x1b[u');      return this; }
  hideCursor()       { this.writeRaw('\x1b[?25l');   return this; }
  showCursor()       { this.writeRaw('\x1b[?25h');   return this; }

  // ─── Erase ────────────────────────────────────────────────────────────────
  clearScreen()   { this.writeRaw('\x1b[2J'); this._col = 0; return this; }
  clearToEOL()    { this.writeRaw('\x1b[0K');  return this; }
  clearToSOL()    { this.writeRaw('\x1b[1K');  return this; }
  clearLine()     { this.writeRaw('\x1b[2K');  return this; }
  clearToBottom() { this.writeRaw('\x1b[0J');  return this; }

  // ─── Color & attributes ───────────────────────────────────────────────────
  /**
   * Set foreground color, background color, and optional text attribute.
   *
   * @param {number} fg   - Color constant (0-15). Values 8-15 produce bold+bright.
   * @param {number} [bg] - Color constant (0-7).
   * @param {number} [attr] - Attr constant to include in the same SGR sequence.
   *                          Use Attr.BLINK (5) here rather than calling blink()
   *                          separately — blink() alone will be cancelled by the
   *                          next setColor() call's implicit reset.
   *
   * Examples:
   *   t.setColor(Color.BRIGHT_YELLOW, Color.BLACK);             // bold yellow
   *   t.setColor(Color.BRIGHT_WHITE, Color.BLACK, Attr.BLINK);  // blinking white
   */
  setColor(fg, bg, attr) {
    const parts = [];
    if (fg !== undefined) {
      if (fg >= 8) {
        // Bright color: bold flag (1) selects the bright variant.
        // No leading reset — preserves any existing screen state.
        // attr (e.g. blink=5) goes before bold so SGR reads: 5;1;33
        if (attr) parts.push(attr);
        parts.push(1);
        parts.push(30 + (fg - 8));
      } else {
        // Dim color: reset first (0) to clear any prior bold/blink.
        parts.push(0);
        if (attr) parts.push(attr);
        parts.push(30 + fg);
      }
    } else if (attr) {
      parts.push(attr);
    }
    if (bg !== undefined) parts.push(40 + (bg & 7));
    this.writeRaw(`\x1b[${parts.join(';')}m`);
    return this;
  }

  /**
   * Enable/disable blinking text (ANSI SGR 5 / SGR 25).
   *
   * NOTE: If you call blink(true) and then setColor(), the setColor() call
   * will emit SGR 0 (reset) for dim colors, cancelling the blink.
   * For bright colors setColor() does NOT reset, so blink survives.
   * The safest pattern is to pass Attr.BLINK as the third argument to
   * setColor() so blink is included in the same SGR sequence:
   *
   *   t.setColor(Color.BRIGHT_WHITE, Color.BLACK, Attr.BLINK);
   *   t.write('blinking text');
   *   t.resetAttrs();
   */
  blink(on = true) {
    this.writeRaw(on ? '\x1b[5m' : '\x1b[25m');
    return this;
  }

  resetAttrs() { this.writeRaw('\x1b[0m'); return this; }

  // ─── Convenience print methods ────────────────────────────────────────────
  print(text) {
    this.write(String(text));
    return this;
  }

  /**
   * Print text + CRLF.
   * In scroll mode, text is automatically clipped to the terminal width
   * (default 80) to prevent line overflow and double-printing on telnet.
   * Clipping is ANSI-sequence aware — escape codes don't count toward width.
   */
  println(text = '') {
    const s = String(text);
    this.write(this._clipToWidth(s) + '\r\n');
    this._col = 0;
    return this;
  }

  printAt(col, row, text, fg, bg) {
    this.moveTo(col, row);
    if (fg !== undefined) this.setColor(fg, bg);
    this.write(String(text));
    this.resetAttrs();
    return this;
  }

  reset() { this.writeRaw('\x1b[0m\x1b[2J\x1b[H'); this._col = 0; return this; }

  // ─── Width enforcement ────────────────────────────────────────────────────
  /**
   * Clip a string to at most `this.width` visible characters.
   * ANSI escape sequences are preserved but don't count toward the width.
   * If the string's visible length is within bounds, it is returned unchanged.
   */
  _clipToWidth(str) {
    const maxW = this.width || 80;
    // Fast path: ASCII-only strings with no ANSI sequences
    if (!str.includes('\x1b')) {
      return str.length <= maxW ? str : str.substring(0, maxW);
    }
    // Walk the string, count visible chars, preserve ANSI sequences
    const visual = str.replace(ANSI_RE, '').length;
    if (visual <= maxW) return str;

    let count = 0, result = '', i = 0;
    while (i < str.length && count < maxW) {
      if (str[i] === '\x1b') {
        // Consume the full escape sequence without counting it
        const m = str.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
        if (m) { result += m[0]; i += m[0].length; }
        else   { result += str[i]; i++; }
      } else {
        result += str[i++];
        count++;
      }
    }
    return result;
  }

  // ─── ANSI Music (MML) ────────────────────────────────────────────────────
  playMusic(mml) {
    if (this._musicEnabled) this.write(`\x1b[M${mml}`);
    return this;
  }

  enableMusic(enabled = true) { this._musicEnabled = enabled; return this; }

  // ─── Pager ───────────────────────────────────────────────────────────────
  /**
   * Display a list of lines with automatic "-- MORE --" pagination.
   *
   * @param {Array} lines  - Each entry is one of:
   *   - null / undefined         → blank line
   *   - string                   → printed in default color (WHITE on BLACK)
   *   - { text, color?, bg?, blink? }
   *
   * @param {object} [opts]
   *   opts.pageHeight  {number}  Lines per page before pausing (default 20).
   *   opts.prompt      {string}  Prompt shown at page break.
   *   opts.promptColor {number}  Color for the prompt (default DARK_GRAY).
   */
  async pager(lines, opts = {}) {
    const pageHeight  = opts.pageHeight  || 20;
    const promptText  = opts.prompt      || ' -- MORE -- (press any key)';
    const promptColor = opts.promptColor !== undefined ? opts.promptColor : Color.DARK_GRAY;

    let count = 0;

    for (const entry of lines) {
      if (entry === null || entry === undefined) {
        this.println();
      } else if (typeof entry === 'string') {
        this.setColor(Color.WHITE, Color.BLACK);
        this.println(entry);
        this.resetAttrs();
      } else {
        if (entry.blink) this.writeRaw('\x1b[5m');
        this.setColor(
          entry.color !== undefined ? entry.color : Color.WHITE,
          entry.bg    !== undefined ? entry.bg    : Color.BLACK
        );
        this.println(entry.text !== undefined ? String(entry.text) : '');
        if (entry.blink) this.writeRaw('\x1b[25m');
        this.resetAttrs();
      }
      count++;

      if (count >= pageHeight) {
        this.setColor(promptColor, Color.BLACK);
        this.write(promptText);
        this.resetAttrs();
        await this.waitKey();
        this.writeRaw('\r' + ' '.repeat(promptText.length) + '\r');
        count = 0;
      }
    }
  }

  // ─── Input handling ───────────────────────────────────────────────────────
  _onData(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];
      const ch   = String.fromCharCode(byte);

      if (byte === 0x00) continue;
      if (byte === 0xFF) continue;

      if (byte === 0x1B) {
        this._inputBuf = ch;
        setTimeout(() => {
          if (this._inputBuf) {
            this.emit('key', this._inputBuf);
            this._inputBuf = '';
          }
        }, 50);
        continue;
      }

      if (this._inputBuf.startsWith('\x1b')) {
        this._inputBuf += ch;
        if ('ABCDEFGHJKSTfmnsulh~PQRS'.includes(ch)) {
          this.emit('key', this._inputBuf);
          this._inputBuf = '';
        }
        continue;
      }

      if (byte === 0x0D || byte === 0x0A) {
        if (byte === 0x0D && i + 1 < buf.length &&
            (buf[i + 1] === 0x0A || buf[i + 1] === 0x00)) {
          i++;
        }
        this.emit('line', this._inputBuf);
        this._inputBuf = '';
        this.emit('key', '\r');
        this._col = 0;
        continue;
      }

      if (byte === 0x7F || byte === 0x08) {
        this.emit('key', 'BACKSPACE');
        if (this._inputBuf.length > 0) this._inputBuf = this._inputBuf.slice(0, -1);
        continue;
      }

      this._inputBuf += ch;
      this.emit('key', ch);
      this.emit('char', ch);
    }
  }

  waitKey() {
    return new Promise((resolve) => { this.once('key', resolve); });
  }

  readLine(opts = {}) {
    const { echo = true, maxLen = 78, mask = null } = opts;
    return new Promise((resolve) => {
      let buf = '';
      const onKey = (key) => {
        if (key === '\r' || key === '\n') {
          this.removeListener('key', onKey);
          if (echo) this.println();
          resolve(buf);
          return;
        }
        if (key === 'BACKSPACE') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            if (echo) this.write('\x08 \x08');
          }
          return;
        }
        if (key.length === 1 && buf.length < maxLen) {
          buf += key;
          if (echo) this.write(mask || key);
        }
      };
      this.on('key', onKey);
    });
  }

  async askYesNo(question, defaultYes = true) {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    this.print(`${question} ${hint}: `);
    const line = await this.readLine({ maxLen: 1 });
    if (line.trim() === '') return defaultYes;
    return line.trim().toLowerCase() === 'y';
  }

  async askChoice(prompt, choices) {
    const allowed = choices.map(c => c.toLowerCase());
    while (true) {
      this.print(prompt);
      const key = await this.waitKey();
      const k = key.toLowerCase();
      if (allowed.includes(k)) {
        this.println(key.toUpperCase());
        return k;
      }
    }
  }
}

module.exports = Terminal;
