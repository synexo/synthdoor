/**
 * screen.js
 *
 * DOS/BBS SCREEN LAYOUT CONVENTION:
 *
 *   Row  1:    Title bar
 *   Rows 2-24: Game area  (GAME_ROWS = 23 usable game rows)
 *   Row 25:    Status bar (protected — written via save/restore cursor)
 *
 * MATHEMATICAL BRIDGING & ERASE-EOL RENDERER:
 *   - Uses strict Absolute Cursor Moves and standard SGR colors. 
 *   - "Bridging": Dynamically calculates if it's cheaper to emit an absolute move 
 *     command, or to simply overdraw clean characters.
 *   - "Erase EOL": Linearly scans right; replaces contiguous blanks with `\x1b[K`.
 *   - Smart Chunk Buffering: Groups continuous writes to eliminate TCP fragmentation 
 *     and Input Lag, while preserving `write()` / `writeRaw()` encoding boundaries.
 */

'use strict';

const { Color } = require('./constants');

const COLS      = 80;
const GAME_ROWS = 24;   // framebuffer rows (rows 1-24 on screen)
const STATUS_ROW = 25;  // protected status line

const BLANK = ' ';

class Cell {
  constructor() { this.ch = BLANK; this.fg = Color.WHITE; this.bg = Color.BLACK; this.attr = 0; }
  
  matches(ch, fg, bg, attr) { 
    // OPTIMIZATION: If both cells are spaces, the foreground color is invisible.
    // As long as the background and attributes match, consider it identical.
    if (this.ch === ch && this.ch === BLANK && this.bg === bg && this.attr === attr) {
        return true;
    }
    return this.ch===ch && this.fg===fg && this.bg===bg && this.attr===attr; 
  }
  
  copyFrom(o) { this.ch=o.ch; this.fg=o.fg; this.bg=o.bg; this.attr=o.attr; }
}

class Screen {
  static SCROLL = 'scroll';
  static FIXED  = 'fixed';
  static ROWS   = GAME_ROWS;
  static COLS   = COLS;
  static ENABLE_STATS = false; 

  constructor(terminal) {
    this.terminal = terminal;
    this.mode     = Screen.SCROLL;
    this.cols     = COLS;
    this.rows     = GAME_ROWS;

    this._buf  = Array.from({ length: GAME_ROWS * COLS }, () => new Cell());
    this._prev = Array.from({ length: GAME_ROWS * COLS }, () => new Cell());

    this._statusBuf  = Array.from({ length: 79 }, () => new Cell());
    this._statusPrev = Array.from({ length: 79 }, () => new Cell());
    this._statusDirty = true;

    // Statistics
    this._statFrames = 0;
    this._statOldBytes = 0;
    this._statNewBytes = 0;
    this._statChunks = 0;
    this._statDrawMs = 0;
    this._statLastLog = Date.now();
  }

  setMode(mode) {
    this.mode = mode;
    const t = this.terminal;
    if (mode === Screen.FIXED) {
      t.writeRaw('\x1b[0m'); // reset attributes
      t.writeRaw('\x1b[2J'); // clear screen
      t.writeRaw('\x1b[3J'); // clear scrollback buffer
      t.writeRaw('\x1b[H'); // cursor home        
      t.writeRaw('\x1b[?25l'); // hide cursor
      this._markAllDirty();
    } else {
      t.writeRaw('\x1b[?25h'); // show cursor
      t.writeRaw('\x1b[0m'); // reset attributes
      t.writeRaw('\x1b[24;1H'); // cursor position Row 24, Column 1
      t.writeRaw('\x1b[J'); // erase down         
    }
    return this;
  }

  putChar(col, row, ch, fg = Color.WHITE, bg = Color.BLACK, attr = 0) {
    if (col < 1 || col > COLS || row < 1 || row > GAME_ROWS) return this;
    const cell = this._buf[(row - 1) * COLS + (col - 1)];
    cell.ch = ch || BLANK; cell.fg = fg; cell.bg = bg; cell.attr = attr;
    return this;
  }

  putString(col, row, str, fg = Color.WHITE, bg = Color.BLACK, attr = 0) {
    if (row < 1 || row > GAME_ROWS) return this;
    let c = col;
    for (const ch of str) {
      if (c > COLS) break;
      this.putChar(c, row, ch, fg, bg, attr);
      c++;
    }
    return this;
  }

  fill(col, row, width, height, ch = BLANK, fg = Color.WHITE, bg = Color.BLACK) {
    for (let r = row; r < row + height && r <= GAME_ROWS; r++)
      for (let c = col; c < col + width && c <= COLS; c++)
        this.putChar(c, r, ch, fg, bg);
    return this;
  }

  clear(fg = Color.WHITE, bg = Color.BLACK) {
    return this.fill(1, 1, COLS, GAME_ROWS, BLANK, fg, bg);
  }

  statusBar(text, fg = Color.BLACK, bg = Color.CYAN, padChar = ' ') {
    const padded = (text || '').substring(0, 79).padEnd(79, padChar);
    for (let c = 0; c < 79; c++) {
      const cell = this._statusBuf[c];
      cell.ch = padded[c]; cell.fg = fg; cell.bg = bg; cell.attr = 0;
    }
    this._statusDirty = true;
    return this;
  }

  statusBarLR(left, right, fg = Color.BLACK, bg = Color.CYAN) {
    const l   = (left  || '').substring(0, 79);
    const r   = (right || '').substring(0, 79 - l.length);
    const mid = Math.max(0, 79 - l.length - r.length);
    return this.statusBar(l + ' '.repeat(mid) + r, fg, bg);
  }

  clearStatusBar(bg = Color.BLACK) {
    return this.statusBar('', Color.WHITE, bg);
  }

  flush() {
    if (this.mode !== Screen.FIXED) return this;

    const tStart = Date.now();

    let oldBytes = 0;
    if (Screen.ENABLE_STATS) {
      oldBytes = this._calculateOldModelBytes();
    }

    // Smart Chunk Buffer to eliminate TCP fragmentation and input lag
    const buffer = {
      t: this.terminal,
      raw: "",
      cp: "",
      bytes: 0,
      chunks: 0,
      
      writeRaw(s) {
        if (!s) return;
        if (this.cp.length > 0) {
          this.t.write(this.cp);
          this.chunks++;
          this.cp = "";
        }
        this.raw += s;
        this.bytes += s.length;
      },
      write(s) {
        if (!s) return;
        if (this.raw.length > 0) {
          this.t.writeRaw(this.raw);
          this.chunks++;
          this.raw = "";
        }
        this.cp += s;
        this.bytes += s.length;
      },
      flushToNetwork() {
        if (this.raw.length > 0) { this.t.writeRaw(this.raw); this.chunks++; this.raw = ""; }
        if (this.cp.length > 0)  { this.t.write(this.cp); this.chunks++; this.cp = ""; }
      }
    };

    let gameChanged = this._flushGameOptimized(buffer);
    let statusChanged = this._flushStatusOptimized(buffer);

    // Park cursor if we modified the screen
    if (gameChanged || statusChanged) {
      buffer.writeRaw('\x1b[1;1H\x1b[0m');
    }

    // Send the final grouped operations over the wire
    buffer.flushToNetwork();

    if (Screen.ENABLE_STATS) {
      this._statFrames++;
      this._statOldBytes += oldBytes;
      this._statNewBytes += buffer.bytes;
      this._statChunks += buffer.chunks;
      this._statDrawMs += (Date.now() - tStart);

      const now = Date.now();
      const dt = now - this._statLastLog;
      
      if (dt >= 1000) {
        const fps = Math.round((this._statFrames * 1000) / dt);
        const avgOld = Math.round(this._statOldBytes / this._statFrames);
        const avgNew = Math.round(this._statNewBytes / this._statFrames);
        const avgChunks = Math.round(this._statChunks / this._statFrames);
        const avgCpu = (this._statDrawMs / this._statFrames).toFixed(2);
        const savings = avgOld > 0 ? ((1 - (avgNew / avgOld)) * 100).toFixed(1) : "0.0";
        
        console.log(`[Screen] FPS: ${fps.toString().padStart(2)} | CPU: ${avgCpu}ms | NetChunks: ${avgChunks} | Bytes: ${avgOld} -> ${avgNew} (${savings}%)`);
        
        this._statFrames = 0;
        this._statOldBytes = 0;
        this._statNewBytes = 0;
        this._statChunks = 0;
        this._statDrawMs = 0;
        this._statLastLog = now;
      }
    }

    return this;
  }

  _flushGameOptimized(buffer) {
    let curState = { fg: -1, bg: -1, bold: -1, attr: -1 };
    let lastR = -1;
    let lastC = -1;
    let anyChanges = false;

    for (let r = 0; r < GAME_ROWS; r++) {
      // 1. Pre-calculate Erase-to-EOL boundary for this row
      let eraseEolStart = COLS;
      let eraseEolBg = -1;
      let spaceC = COLS - 1;
      
      while (spaceC >= 0) {
        if (r === GAME_ROWS - 1 && spaceC === COLS - 1) { spaceC--; continue; }
        let cell = this._buf[r * COLS + spaceC];
        
        // OPTIMIZATION: Removed `cell.fg >= 8`. Bright foregrounds on spaces 
        // do not affect the \x1b[K background clear.
        if (cell.ch !== ' ' || cell.attr > 0) break; 
        
        if (eraseEolBg === -1) eraseEolBg = cell.bg;
        else if (eraseEolBg !== cell.bg) break;
        spaceC--;
      }
      
      let candidateStart = spaceC + 1;
      let hasDirtyEol = false;
      
      // --- NEW COST ANALYSIS BLOCK ---
      let estimatedDrawCost = 0;
      let moveCmdLength = `\x1b[${r + 1};${candidateStart + 1}H`.length;

      for (let i = candidateStart; i < COLS; i++) {
        if (r === GAME_ROWS - 1 && i === COLS - 1) continue;
        let idx = r * COLS + i;
        let cell = this._buf[idx];
        let prev = this._prev[idx];

        if (!prev.matches(cell.ch, cell.fg, cell.bg, cell.attr)) {
          hasDirtyEol = true;
          // Estimate: 1 byte for char + ~3 bytes for potential attribute change
          estimatedDrawCost += 4; 
        }
      }

      // The cost of using Erase-to-EOL:
      // Move Command + Attribute Reset/Change + \x1b[K (3 bytes)
      // Calculate exactly if we need a color change for the erase
      let colorChangeCost = 0;
      if (curState.bg !== eraseEolBg || curState.attr !== 0) {
          // Approximate cost of a reset + new background color
          colorChangeCost = 8; 
      }

      // Exact cost of the optimization path
      let eraseCost = moveCmdLength + colorChangeCost + 3; 

      if (hasDirtyEol && candidateStart < COLS && eraseCost < estimatedDrawCost) {
        eraseEolStart = candidateStart;
      } else {
        eraseEolStart = COLS; 
      }

      // 2. Process cells
      let c = 0;
      while (c < COLS) {
        if (r === GAME_ROWS - 1 && c === COLS - 1) { c++; continue; }

        if (c >= eraseEolStart) {
          anyChanges = true;
          let moveStr = `\x1b[${r + 1};${c + 1}H`;
          
          if (lastR === -1 || r !== lastR || c !== lastC + 1) {
            buffer.writeRaw(moveStr);
          }
          
          let fakeCell = { fg: 7, bg: eraseEolBg, attr: 0 };
          let attrStr = this._buildAttr(curState, fakeCell);
          if (attrStr) buffer.writeRaw(attrStr);
          
          buffer.writeRaw('\x1b[K'); 
          
          for (let i = c; i < COLS; i++) {
            if (r === GAME_ROWS - 1 && i === COLS - 1) continue;
            let idx = r * COLS + i;
            this._prev[idx].ch = ' ';
            this._prev[idx].fg = 7;
            this._prev[idx].bg = eraseEolBg;
            this._prev[idx].attr = 0;
          }
          
          lastR = r;
          lastC = -1; // Unknown state after \x1b[K
          c = COLS; 
          continue;
        }

        let idx = r * COLS + c;
        let cell = this._buf[idx];
        let prev = this._prev[idx];

        if (prev.matches(cell.ch, cell.fg, cell.bg, cell.attr)) {
          c++;
          continue;
        }

        anyChanges = true;
        let moveStr = `\x1b[${r + 1};${c + 1}H`;
        let moveCost = moveStr.length;
        let bridged = false;

        if (lastR === r && lastC !== -1 && c > lastC + 1) {
          let tempState = { ...curState };
          let bridgeCost = 0;
          
          for (let i = lastC + 1; i < c; i++) {
            let bCell = this._buf[r * COLS + i];
            bridgeCost += this._buildAttr(tempState, bCell).length + 1; 
            if (bridgeCost >= moveCost) break; 
          }

          if (bridgeCost < moveCost) {
            bridged = true;
            for (let i = lastC + 1; i < c; i++) {
              let bCell = this._buf[r * COLS + i];
              let attrStr = this._buildAttr(curState, bCell);
              if (attrStr) buffer.writeRaw(attrStr);
              buffer.write(bCell.ch);
            }
          }
        }

        if (!bridged && (lastR === -1 || r !== lastR || c !== lastC + 1)) {
          buffer.writeRaw(moveStr);
        }

        let attrStr = this._buildAttr(curState, cell);
        if (attrStr) buffer.writeRaw(attrStr);
        buffer.write(cell.ch);

        prev.copyFrom(cell);
        lastR = r;
        lastC = c;
        c++;
      }
    }
    return anyChanges;
  }

  _flushStatusOptimized(buffer) {
    let dirtyCells = [];
    for (let c = 0; c < 79; c++) {
      if (!this._statusPrev[c].matches(this._statusBuf[c].ch, this._statusBuf[c].fg, this._statusBuf[c].bg, this._statusBuf[c].attr)) {
        dirtyCells.push(c);
      }
    }

    if (dirtyCells.length === 0) return false;

    // Only use Save/Restore (\x1b[s and \x1b[u) if we have enough changes 
    // to justify the 8-byte 'entry fee'.
    const useSaveRestore = dirtyCells.length > 3; 

    if (useSaveRestore) {
        buffer.writeRaw('\x1b[s\x1b[0m'); 
    }

    let curState = { fg: -1, bg: -1, bold: 0, attr: 0 };
    let lastC = -1;

    for (let c = 0; c < 79; c++) {
      let cell = this._statusBuf[c];
      let prev = this._statusPrev[c];

      if (prev.matches(cell.ch, cell.fg, cell.bg, cell.attr)) continue;

      let moveStr = `\x1b[25;${c + 1}H`;
      let moveCost = moveStr.length;
      let bridged = false;

      if (lastC !== -1 && c > lastC + 1) {
        let tempState = { ...curState };
        let bridgeCost = 0;
        for (let i = lastC + 1; i < c; i++) {
          let bCell = this._statusBuf[i];
          bridgeCost += this._buildAttr(tempState, bCell).length + 1;
          if (bridgeCost >= moveCost) break;
        }
        if (bridgeCost < moveCost) {
          bridged = true;
          for (let i = lastC + 1; i < c; i++) {
            let bCell = this._statusBuf[i];
            let attrStr = this._buildAttr(curState, bCell);
            if (attrStr) buffer.writeRaw(attrStr);
            buffer.write(bCell.ch);
          }
        }
      }

      if (!bridged && (lastC === -1 || c !== lastC + 1)) {
        buffer.writeRaw(moveStr);
      }

      let attrStr = this._buildAttr(curState, cell);
      if (attrStr) buffer.writeRaw(attrStr);
      buffer.write(cell.ch);

      prev.copyFrom(cell);
      lastC = c;
    }

    if (useSaveRestore) {
        buffer.writeRaw('\x1b[u');
    } else {
        // If we didn't save the cursor, we should manually 'park' it 
        // so it doesn't stay stuck on the status line.
        buffer.writeRaw('\x1b[1;1H'); 
    }

    this._statusDirty = false;
    return true;
  }

  _buildAttr(state, cell) {
    let sFg = cell.fg != null ? cell.fg : 7;
    let sBg = cell.bg != null ? cell.bg : 0;
    let tBold = sFg >= 8 ? 1 : 0;
    let tFg = sFg % 8;
    let tBg = sBg & 7;
    let tAttr = cell.attr || 0;

    let parts = [];
    let forceReset = false;

    if ((state.bold === 1 && tBold === 0) || (state.attr > 0 && tAttr === 0)) {
      forceReset = true;
    }

    if (forceReset || state.fg === -1) {
      parts.push(0);
      state.fg = -1;
      state.bg = -1;
      state.bold = 0;
      state.attr = 0;
    }

    if (tBold === 1 && state.bold !== 1) {
      parts.push(1);
      state.bold = 1;
    }
    if (tAttr > 0 && state.attr !== tAttr) {
      parts.push(tAttr);
      state.attr = tAttr;
    }
    if (tFg !== state.fg) {
      parts.push(30 + tFg);
      state.fg = tFg;
    }
    if (tBg !== state.bg) {
      parts.push(40 + tBg);
      state.bg = tBg;
    }

    if (parts.length > 0) return `\x1b[${parts.join(';')}m`;
    return "";
  }

  _calculateOldModelBytes() {
    let oldBytes = 0;
    let anyChanges = false;
    let lastFg = -1, lastBg = -1, lastAttr = -1;
    let lastRow = -1, lastCol = -1;

    for (let r = 0; r < GAME_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r === GAME_ROWS - 1 && c === COLS - 1) continue;
        let idx = r * COLS + c;
        let cell = this._buf[idx];
        let prev = this._prev[idx];
        if (prev.matches(cell.ch, cell.fg, cell.bg, cell.attr)) continue;

        anyChanges = true;
        if (r !== lastRow || c !== lastCol + 1) {
          oldBytes += `\x1b[${r + 1};${c + 1}H`.length;
        }
        lastRow = r; lastCol = c;

        if (cell.fg !== lastFg || cell.bg !== lastBg || cell.attr !== lastAttr) {
          const parts = [0];
          if (cell.fg >= 8) { parts.push(1); parts.push(30 + cell.fg - 8); }
          else { parts.push(30 + cell.fg); }
          if (cell.bg !== undefined && cell.bg >= 0) parts.push(40 + (cell.bg & 7));
          if (cell.attr) parts.push(cell.attr);
          oldBytes += `\x1b[${parts.join(';')}m`.length;
          lastFg = cell.fg; lastBg = cell.bg; lastAttr = cell.attr;
        }
        oldBytes += 1;
      }
    }

    let anyStatus = false;
    for (let c = 0; c < 79; c++) {
      if (!this._statusPrev[c].matches(this._statusBuf[c].ch, this._statusBuf[c].fg, this._statusBuf[c].bg, this._statusBuf[c].attr)) {
        anyStatus = true; break;
      }
    }
    
    if (anyStatus) {
      anyChanges = true;
      oldBytes += 2; 
      oldBytes += `\x1b[25;1H`.length; 
      let sLastFg = -1, sLastBg = -1, sLastCol = -1;
      for (let c = 0; c < 79; c++) {
        let cell = this._statusBuf[c];
        let prev = this._statusPrev[c];
        if (c !== sLastCol + 1) {
          oldBytes += `\x1b[25;${c + 1}H`.length;
        }
        sLastCol = c;

        if (cell.fg !== sLastFg || cell.bg !== sLastBg) {
          const parts = [0];
          if (cell.fg >= 8) { parts.push(1); parts.push(30 + cell.fg - 8); }
          else { parts.push(30 + cell.fg); }
          if (cell.bg !== undefined && cell.bg >= 0) parts.push(40 + (cell.bg & 7));
          oldBytes += `\x1b[${parts.join(';')}m`.length;
          sLastFg = cell.fg; sLastBg = cell.bg;
        }
        oldBytes += 1;
      }
      oldBytes += 6; 
    }

    if (anyChanges) oldBytes += 10; 
    return oldBytes;
  }

  _markAllDirty() {
    for (const cell of this._prev)       cell.ch = null;
    for (const cell of this._statusPrev) cell.ch = null;
    this._statusDirty = true;
    return this;
  }

  forceRedraw() { return this._markAllDirty(); }

  scrollPrint(text) {
    if (this.mode === Screen.SCROLL) this.terminal.println(text);
    return this;
  }

  putPixel(x, y, fg = Color.WHITE) {
    if (x < 1 || x > 80 || y < 1 || y > 48) return this;
    const termRow = Math.ceil(y / 2);
    const isUpper = (y % 2 === 1);
    const cell    = this._buf[(termRow - 1) * COLS + (x - 1)];
    if (isUpper) {
      cell.ch = (cell.ch === '\u2584') ? '\u2588' : '\u2580';
      cell.fg = fg;
    } else {
      cell.ch = (cell.ch === '\u2580') ? '\u2584' : '\u2584';
      if (cell.ch !== '\u2580') cell.fg = Color.BLACK;
      cell.bg = fg;
    }
    return this;
  }

  clearPixels() { return this.clear(Color.BLACK, Color.BLACK); }
}

module.exports = Screen;