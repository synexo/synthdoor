/**
 * app.js — SynthDoor application controller
 *
 * Reads window.SYNTHDOOR_CONFIG (set in index.html) for all runtime options.
 */

import { Terminal, ANSIParser, TelnetFilter, CP437 } from './terminal.js';
import { Renderer, CHAR_W, CHAR_H }                  from './renderer.js';
import { WSConnection }                               from './connection.js';
import { ANSIMusic }                                  from './music.js';

// ── Config with defaults ──────────────────────────────────────────────────
const CFG = Object.assign({
  NAME:              'SYNTHDOOR',
  WSURL:             'auto',
  AUTOCONNECT:       true,
  TERMSIZE:          '80x25',
  SCROLLBACK:        5000,
  ICECOLORS:         false,
  SHOWICEBTN:        false,
  SCALING:           'auto',
  SCALINGCAP:        3,
  IMAGERENDERING:    'pixelated',
  WHEEL_THROTTLE_MS: 80, // Throttle for wheel arrow keys in live view (ms)
}, window.SYNTHDOOR_CONFIG || {});

function resolveWsUrl(raw) {
  if (raw !== 'auto') return raw;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

// ── Scaling and rendering cycle tables ───────────────────────────────────
const SCALE_MODES = ['integer', 'integerish', 'any', 'fit'];
const SCALE_LABELS = { integer: 'INTEGER', integerish: 'CLOSE', any: 'ANY', fit: 'FIT' };

const RENDER_MODES = ['pixelated', 'crisp-edges', 'auto', '-webkit-optimize-contrast'];
const RENDER_LABELS = {
  'pixelated':                   'PIXEL',
  'crisp-edges':                 'CRISP',
  'auto':                        'AUTO',
  '-webkit-optimize-contrast':   'LEGACY',
};

export class App {
  constructor() {
    this._canvas      = document.getElementById('terminal-canvas');
    this._canvasWrap  = document.getElementById('canvas-wrap');
    this._hiddenInput = document.getElementById('hidden-input');
    this._scrollbar   = document.getElementById('scrollbar');
    this._sbThumb     = document.getElementById('scrollbar-thumb');

    const [cols, rows] = CFG.TERMSIZE.split('x').map(Number);
    this._cols = cols || 80;
    this._rows = rows || 50;

    this._term     = new Terminal(this._cols, this._rows);
    this._renderer = new Renderer(this._canvas, this._cols, this._rows);
    this._telnet   = new TelnetFilter();
    this._parser   = new ANSIParser(this._term);
    this._conn     = new WSConnection({
      onData:   (b) => this._onData(b),
      onStatus: (t, l) => this._updateStatus(t, l),
    });
    this._music = new ANSIMusic();

    this._term.iceColors      = CFG.ICECOLORS;
    this._term.MAX_SCROLLBACK = CFG.SCROLLBACK;

    this._telnet.onData = (bytes) => {
      this._parser.feed(bytes);
      this._term.scanURLs();
      this._dirty = true;
    };
    this._telnet.onSend = (bytes) => this._conn.sendBytes(bytes);
    this._term.onSend      = (s) => this._conn.sendString(s);
    this._term.onANSIMusic = (s) => this._music.play(s);

    // Render/blink state
    this._blinkPhase = true;
    this._cursorOn   = true;
    this._dirty      = true;
    this._scale      = 1;
    this._rafId      = null;
    this._blinkTimer = null;

    // Active scaling/rendering modes (may differ from CFG if toggled at runtime)
    this._scalingMode  = CFG.SCALING;
    this._renderMode   = CFG.IMAGERENDERING;

    // Selection state
    this._selStart      = null;
    this._selEnd        = null;
    this._selecting     = false;
    this._selClearTimer = null;

    // Ctrl latch (mobile)
    this._ctrlMode = false;

    // Scrollbar drag
    this._sbDragging        = false;
    this._sbDragStartY      = 0;
    this._sbDragStartOffset = 0;

    // Mouse-down tracking for click-vs-drag discrimination
    this._mouseDownCol = -1;
    this._mouseDownRow = -1;

    // Mouse wheel throttle and character toggling
    this._lastWheelTime    = 0;
    this._lastLoneClickCol = -1;
    this._lastLoneClickRow = -1;

    this._init();
  }

  async _init() {
    await this._renderer.init();
    this._applyRenderMode(this._renderMode);

    document.getElementById('title-name').textContent = CFG.NAME;
    document.title = CFG.NAME + ' Terminal';
    document.getElementById('btn-ice').style.display = CFG.SHOWICEBTN ? '' : 'none';
    document.getElementById('ws-url').value = resolveWsUrl(CFG.WSURL);
    this._preselectSize(CFG.TERMSIZE);

    // Initialise toggle button labels
    this._updateScaleBtn();
    this._updateRenderBtn();

    this._bindUI();
    this._bindCanvas();
    this._bindKeyboard();
    this._bindMobileToolbar();
    this._bindScrollbar();
    this._scaleCanvas();

    window.addEventListener('resize', () => this._scaleCanvas());
    window.addEventListener('orientationchange', () => setTimeout(() => this._scaleCanvas(), 250));

    this._startLoops();

    if (CFG.AUTOCONNECT) {
      this._doConnect();
    } else {
      this._showModal();
      this._showWelcome();
    }
  }

  // ── Data ingestion ────────────────────────────────────────────
  _onData(bytes) { this._telnet.process(bytes); }

  // ── Render + blink loop ───────────────────────────────────────
  _startLoops() {
    const renderLoop = () => {
      if (this._dirty || !this._term.isLive()) {
        const cells = this._term.getDisplayCells();
        const sel = (this._selStart && this._selEnd)
          ? { start: this._selStart, end: this._selEnd } : null;
        this._renderer.drawFrame(
          cells,
          this._term.cx, this._term.cy,
          this._term.cursorVisible && this._term.isLive(),
          this._cursorOn,
          this._term.iceColors,
          this._blinkPhase,
          sel
        );
        this._dirty = false;
      }
      this._updateScrollbarThumb();
      this._rafId = requestAnimationFrame(renderLoop);
    };
    this._rafId = requestAnimationFrame(renderLoop);

    this._blinkTimer = setInterval(() => {
      this._cursorOn   = !this._cursorOn;
      this._blinkPhase = !this._blinkPhase;
      this._dirty = true;
    }, 530);
  }

  // ── Canvas scaling ────────────────────────────────────────────
  _scaleCanvas() {
    const wrap = this._canvasWrap;
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (availW === 0 || availH === 0) return;

    const termW = this._cols * CHAR_W;
    const termH = this._rows * CHAR_H;
    const exactX = availW / termW;
    const exactY = availH / termH;
    const exactFit = Math.min(exactX, exactY);

    let scale;
    switch (this._scalingMode) {
      case 'integer':
        scale = Math.max(1, Math.floor(exactFit));
        break;
      case 'integerish': {
        const base = Math.max(1, Math.floor(exactFit));
        const half = base + 0.5;
        scale = half <= exactFit ? half : base;
        break;
      }
      case 'any':
        scale = Math.max(0.5, exactFit);
        break;
      case 'fit': {
        const sx = Math.min(exactX, CFG.SCALINGCAP);
        const sy = Math.min(exactY, CFG.SCALINGCAP);
        this._scale = Math.min(sx, sy);
        this._canvas.style.width  = Math.floor(termW * sx) + 'px';
        this._canvas.style.height = Math.floor(termH * sy) + 'px';
        return;
      }
      default:
        scale = Math.max(0.5, exactFit);
    }
    scale = Math.min(scale, CFG.SCALINGCAP);
    this._scale = scale;
    this._canvas.style.width  = Math.floor(termW * scale) + 'px';
    this._canvas.style.height = Math.floor(termH * scale) + 'px';
  }

  _applyRenderMode(mode) {
    this._renderMode = mode;
    this._canvas.style.imageRendering        = mode;
    this._canvas.style.webkitImageRendering  = mode;
  }

  _updateScaleBtn() {
    const btn = document.getElementById('btn-scale');
    if (btn) btn.textContent = 'SCALE: ' + (SCALE_LABELS[this._scalingMode] || this._scalingMode.toUpperCase());
  }

  _updateRenderBtn() {
    const btn = document.getElementById('btn-render');
    if (btn) btn.textContent = 'RENDER: ' + (RENDER_LABELS[this._renderMode] || this._renderMode.toUpperCase());
  }

  // ── Welcome banner ────────────────────────────────────────────
  _showWelcome() {
    const name = CFG.NAME;
    const header = ('  ' + name + ' TERMINAL EMULATOR  \xB7  CP437/ANSI/TELNET             ').slice(0, 78);
    const lines = [
      '\x1B[2J\x1B[H',
      '\x1B[1;34m\xC9' + '\xCD'.repeat(78) + '\xBB\r\n',
      '\x1B[1;34m\xBA\x1B[1;36m' + header + '\x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xCC' + '\xCD'.repeat(78) + '\xB9\r\n',
      '\x1B[1;34m\xBA\x1B[0;37m  Press \x1B[1;33mCONNECT\x1B[0;37m to open a WebSocket connection.                                \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xBA                                                                              \xBA\r\n',
      '\x1B[1;34m\xBA\x1B[1;32m  \xFB \x1B[0;37mBitmap VGA 8\xD716 ROM font \x96 authentic IBM CP437 glyphs                       \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xBA\x1B[1;32m  \xFB \x1B[0;37mFull ANSI escape sequences: cursor, erase, SGR, scroll region               \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xBA\x1B[1;32m  \xFB \x1B[0;37mTelnet IAC negotiation (WILL/WONT/DO/DONT, NAWS)                           \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xBA\x1B[1;32m  \xFB \x1B[0;37mScrollback buffer \xB7 mouse selection \xB7 clipboard copy / right-click paste    \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xBA\x1B[1;32m  \xFB \x1B[0;37mURL detection \xB7 iCE colours \xB7 ANSI music via Web Audio API                 \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xBA\x1B[1;32m  \xFB \x1B[0;37mScrollbar \xB7 mouse click-to-type \xB7 mobile keyboard toolbar                   \x1B[1;34m\xBA\r\n',
      '\x1B[1;34m\xC8' + '\xCD'.repeat(78) + '\xBC\r\n',
      '\x1B[0m\r\n\x1B[0;36m  Awaiting connection\x1B[5m...\x1B[0m\r\n',
    ];
    const str = lines.join('');
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    this._parser.feed(bytes);
    this._term.scanURLs();
    this._dirty = true;
  }

  // ── Scrollbar ─────────────────────────────────────────────────
  _updateScrollbarThumb() {
    const thumb = this._sbThumb;
    const sb    = this._scrollbar;
    const sbLen = this._term.scrollbackLength;
    const total = sbLen + this._rows;

    if (sbLen === 0) {
      thumb.style.height = '100%';
      thumb.style.top    = '0%';
      sb.classList.remove('active');
      return;
    }
    sb.classList.add('active');

    const viewFrac = this._rows / total;
    const thumbH   = Math.max(viewFrac * 100, 4);
    thumb.style.height = thumbH + '%';

    const viewTop = sbLen - this._term._scrollOffset;
    const maxTop  = 100 - thumbH;
    thumb.style.top = Math.min((viewTop / total) * 100, maxTop) + '%';
  }

  _bindScrollbar() {
    const sb    = this._scrollbar;
    const thumb = this._sbThumb;

    sb.addEventListener('mousedown', (e) => {
      if (e.target === thumb) return;
      e.preventDefault();
      const rect = sb.getBoundingClientRect();
      this._jumpScrollFrac((e.clientY - rect.top) / rect.height);
    });

    thumb.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._sbDragging        = true;
      this._sbDragStartY      = e.clientY;
      this._sbDragStartOffset = this._term._scrollOffset;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._sbDragging) return;
      this._doScrollbarDrag(e.clientY);
    });
    window.addEventListener('mouseup', () => { this._sbDragging = false; });

    thumb.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._sbDragging        = true;
      this._sbDragStartY      = e.touches[0].clientY;
      this._sbDragStartOffset = this._term._scrollOffset;
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this._sbDragging) return;
      this._doScrollbarDrag(e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchend', () => { this._sbDragging = false; });
  }

  _doScrollbarDrag(clientY) {
    const rect  = this._scrollbar.getBoundingClientRect();
    const dy    = clientY - this._sbDragStartY;
    const total = this._term.scrollbackLength + this._rows;
    const lineH = rect.height / total;
    const delta = Math.round(dy / lineH);
    const newOff = Math.max(0, Math.min(
      this._term.scrollbackLength,
      this._sbDragStartOffset + delta
    ));
    if (newOff !== this._term._scrollOffset) {
      this._term._scrollOffset = newOff;
      this._renderer.invalidateAll();
      this._dirty = true;
      this._showScrollbackIndicator();
    }
  }

  _jumpScrollFrac(frac) {
    const total  = this._term.scrollbackLength + this._rows;
    const newOff = Math.max(0, Math.min(
      this._term.scrollbackLength,
      this._term.scrollbackLength - Math.floor(frac * total)
    ));
    this._term._scrollOffset = newOff;
    this._renderer.invalidateAll();
    this._dirty = true;
    this._showScrollbackIndicator();
  }

  // ── UI bindings ───────────────────────────────────────────────
  _bindUI() {
    document.getElementById('btn-connect').addEventListener('click', () => {
      if (CFG.AUTOCONNECT) {
        this._conn.disconnect();
        this._term.reset();
        this._renderer.invalidateAll();
        this._dirty = true;
        this._doConnect();
      } else {
        this._showModal();
      }
    });

    document.getElementById('btn-disconnect').addEventListener('click', () => {
      this._conn.disconnect();
    });

    document.getElementById('btn-ice').addEventListener('click', () => {
      this._term.iceColors = !this._term.iceColors;
      document.getElementById('btn-ice').textContent =
        this._term.iceColors ? 'iCE: BRIGHT' : 'iCE: BLINK';
      this._renderer.invalidateAll();
      this._dirty = true;
    });

    document.getElementById('btn-music').addEventListener('click', () => {
      this._music.enabled = !this._music.enabled;
      document.getElementById('btn-music').textContent =
        '\u266A MUSIC: ' + (this._music.enabled ? 'ON' : 'OFF');
    });

    // ── Scale toggle ─────────────────────────────────────────────
    document.getElementById('btn-scale').addEventListener('click', () => {
      const idx = SCALE_MODES.indexOf(this._scalingMode);
      this._scalingMode = SCALE_MODES[(idx + 1) % SCALE_MODES.length];
      this._updateScaleBtn();
      this._scaleCanvas();
    });

    // ── Render toggle ─────────────────────────────────────────────
    document.getElementById('btn-render').addEventListener('click', () => {
      const idx = RENDER_MODES.indexOf(this._renderMode);
      this._renderMode = RENDER_MODES[(idx + 1) % RENDER_MODES.length];
      this._applyRenderMode(this._renderMode);
      this._updateRenderBtn();
    });

    document.getElementById('modal-connect').addEventListener('click', () => this._doConnect());
    document.getElementById('modal-cancel').addEventListener('click',  () => this._hideModal());
    document.getElementById('ws-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._doConnect();
    });
    document.getElementById('term-size').addEventListener('change', (e) => {
      const [c, r] = e.target.value.split('x').map(Number);
      if (c && r) {
        this._cols = c; this._rows = r;
        this._term.resize(c, r);
        this._renderer.resize(c, r);
        this._scaleCanvas();
      }
    });
  }

  _preselectSize(sizeStr) {
    const sel = document.getElementById('term-size');
    for (const opt of sel.options) {
      if (opt.value === sizeStr) { opt.selected = true; return; }
    }
    const opt = document.createElement('option');
    opt.value = sizeStr;
    opt.text  = sizeStr.replace('x', ' × ') + '  (config)';
    opt.selected = true;
    sel.insertBefore(opt, sel.firstChild);
  }

  _showModal() {
    document.getElementById('conn-modal').classList.remove('hidden');
    document.getElementById('ws-url').focus();
  }
  _hideModal() {
    document.getElementById('conn-modal').classList.add('hidden');
  }

  _doConnect() {
    this._hideModal();
    let url = document.getElementById('ws-url').value.trim();
    if (!url) url = resolveWsUrl(CFG.WSURL);

    const sizeVal = document.getElementById('term-size').value;
    const [c, r] = sizeVal.split('x').map(Number);
    if (c && r && (c !== this._cols || r !== this._rows)) {
      this._cols = c; this._rows = r;
      this._term.resize(c, r);
      this._renderer.resize(c, r);
      this._scaleCanvas();
    }

    this._term.reset();
    this._renderer.invalidateAll();
    this._dirty = true;
    this._conn.connect(url);
    document.getElementById('server-label').textContent = url.replace(/^wss?:\/\//, '');
    document.getElementById('btn-disconnect').style.display = '';
    document.getElementById('btn-connect').style.display = 'none';
  }

  _updateStatus(type, label) {
    const dot = document.getElementById('conn-dot');
    const lbl = document.getElementById('conn-label');
    dot.className   = type;
    lbl.textContent = label;
    if (type === 'disconnected' || type === 'error') {
      document.getElementById('btn-disconnect').style.display = 'none';
      document.getElementById('btn-connect').style.display = '';
    }
  }

  // ── Char classification helpers ───────────────────────────────

  /**
   * Return the Unicode character at (col, row) on the live screen.
   */
  _charAt(col, row) {
    if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) return null;
    const cell = this._term.screen.get(col, row);
    return CP437[cell.ch] || null;
  }

  /**
   * Return true if the string is a single alphanumeric character (letter or digit).
   */
  _isAlphaNum(ch) {
    return ch !== null && /^[A-Za-z0-9]$/.test(ch);
  }

  /**
   * Return true if (col, row) is a lone alphanumeric —
   * i.e. it IS alphanumeric but neither of its horizontal neighbours is.
   */
  _isLoneAlphaNum(col, row) {
    const ch = this._charAt(col, row);
    if (!this._isAlphaNum(ch)) return false;
    const left  = this._charAt(col - 1, row);
    const right = this._charAt(col + 1, row);
    return !this._isAlphaNum(left) && !this._isAlphaNum(right);
  }

  // ── Canvas mouse bindings ─────────────────────────────────────
  _bindCanvas() {
    const canvas = this._canvas;
    let mouseDown = false;

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      clearTimeout(this._selClearTimer);
      const [col, row] = this._pixelToCell(e.clientX, e.clientY);
      this._mouseDownCol = col;
      this._mouseDownRow = row;
      this._selStart  = [row, col];
      this._selEnd    = [row, col];
      this._selecting = true;
      mouseDown = true;
      this._dirty = true;
    });

    canvas.addEventListener('mousemove', (e) => {
      const [col, row] = this._pixelToCell(e.clientX, e.clientY);

      // If the mouse focus moves off the last clicked lone alphanumeric char, reset its memory
      if (col !== this._lastLoneClickCol || row !== this._lastLoneClickRow) {
        this._lastLoneClickCol = -1;
        this._lastLoneClickRow = -1;
      }

      if (this._selecting && mouseDown) {
        this._selEnd = [row, col];
        this._dirty  = true;
      }

      // Cursor: pointer for URLs, pointer for lone-alphanum, default otherwise
      const url  = this._term.getURLAt(col, row);
      const lone = !url && this._isLoneAlphaNum(col, row);
      canvas.style.cursor = (url || lone) ? 'pointer' : 'default';
    });

    window.addEventListener('mouseup', (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      this._selecting = false;

      const isTrivial = !this._selStart || !this._selEnd ||
        (this._selStart[0] === this._selEnd[0] &&
         this._selStart[1] === this._selEnd[1]);

      if (!isTrivial) {
        // Real drag-selection — copy text, flash then clear
        const text = this._term.getSelectionText(this._selStart, this._selEnd);
        if (text.trim()) navigator.clipboard.writeText(text).catch(() => {});
        this._dirty = true;
        clearTimeout(this._selClearTimer);
        this._selClearTimer = setTimeout(() => this._clearSelection(), 350);
        return;
      }

      // Trivial click — clear selection immediately
      this._clearSelection();

      // Single-click action (only when connected)
      if (!this._conn.connected) return;

      const [col, row] = [this._mouseDownCol, this._mouseDownRow];

      // 1. URL click → open in new tab
      const url = this._term.getURLAt(col, row);
      if (url) {
        window.open(url.url, '_blank', 'noopener,noreferrer');
        return;
      }

      // 2. Lone alphanumeric → send that character
      if (this._isLoneAlphaNum(col, row)) {
        // If clicked again without moving the mouse off the character, send Enter instead.
        if (col === this._lastLoneClickCol && row === this._lastLoneClickRow) {
          this._conn.sendString('\r');
          this._lastLoneClickCol = -1;
          this._lastLoneClickRow = -1;
          return;
        }

        const ch = this._charAt(col, row);
        if (ch) {
          this._conn.sendString(ch);
          this._lastLoneClickCol = col;
          this._lastLoneClickRow = row;
          return;
        }
      }

      // 3. Anything else → send Enter
      this._conn.sendString('\r');
    });

    canvas.addEventListener('dblclick', () => { this._hiddenInput.focus(); });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      navigator.clipboard.readText()
        .then(text => { if (text) this._conn.sendString(text); })
        .catch(() => {});
    });

    // ── Mouse wheel ────────────────────────────────────────────────────
    // If scrollback exists: scroll through it.
    // If no scrollback (or at live view): send arrow keys to server.
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const hasScrollback = this._term.scrollbackLength > 0;

      if (hasScrollback) {
        // Scrollback mode
        const lines = Math.max(1, Math.ceil(Math.abs(e.deltaY) / 24));
        if (e.deltaY < 0) this._term.scrollbackUp(lines);
        else               this._term.scrollbackDown(lines);
        this._showScrollbackIndicator();
        this._renderer.invalidateAll();
        this._dirty = true;
      } else {
        // No scrollback — send arrow keys to the server (throttled)
        const now = Date.now();
        if (now - this._lastWheelTime < CFG.WHEEL_THROTTLE_MS) return;
        this._lastWheelTime = now;

        const seq = e.deltaY < 0 ? '\x1B[A' : '\x1B[B';
        this._conn.sendString(seq); // Only sending one arrow per throttled event
      }
    }, { passive: false });

    // Touch swipe: scrollback
    let touchStartY = 0;
    canvas.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      const dy = touchStartY - e.touches[0].clientY;
      if (Math.abs(dy) > 15) {
        e.preventDefault();
        if (dy > 0) this._term.scrollbackUp(1);
        else         this._term.scrollbackDown(1);
        touchStartY = e.touches[0].clientY;
        this._showScrollbackIndicator();
        this._renderer.invalidateAll();
        this._dirty = true;
      }
    }, { passive: false });

    // Mobile: tap canvas to summon keyboard
    canvas.addEventListener('click', () => {
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        this._hiddenInput.focus();
      }
    });
  }

  _clearSelection() {
    if (!this._selStart && !this._selEnd) return;
    this._renderer.invalidateSelection(this._selStart, this._selEnd);
    this._selStart = null;
    this._selEnd   = null;
    this._dirty    = true;
  }

  _pixelToCell(clientX, clientY) {
    const rect = this._canvas.getBoundingClientRect();
    const col  = Math.max(0, Math.min(this._cols - 1,
                   Math.floor((clientX - rect.left) / (CHAR_W * this._scale))));
    const row  = Math.max(0, Math.min(this._rows - 1,
                   Math.floor((clientY - rect.top)  / (CHAR_H * this._scale))));
    return [col, row];
  }

  _showScrollbackIndicator() {
    const ind = document.getElementById('scrollback-indicator');
    if (!this._term.isLive()) {
      ind.textContent = `\u2191 SCROLLBACK  \u2212${this._term._scrollOffset}`;
      ind.classList.add('visible');
    } else {
      ind.classList.remove('visible');
    }
    clearTimeout(this._sbIndTimer);
    this._sbIndTimer = setTimeout(() => {
      if (this._term.isLive()) ind.classList.remove('visible');
    }, 2500);
  }

  // ── Keyboard ──────────────────────────────────────────────────
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => this._handleKeydown(e));
    this._hiddenInput.addEventListener('input', () => {
      const v = this._hiddenInput.value;
      if (v.length > 0) { this._conn.sendString(v); this._hiddenInput.value = ''; }
    });
  }

  _handleKeydown(e) {
    if (!this._term.isLive()) {
      this._term.scrollbackEnd();
      this._renderer.invalidateAll();
      this._showScrollbackIndicator();
      this._dirty = true;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      this._term.scrollbackUp(this._rows);
      this._renderer.invalidateAll();
      this._showScrollbackIndicator();
      this._dirty = true;
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      this._term.scrollbackDown(this._rows);
      this._renderer.invalidateAll();
      this._showScrollbackIndicator();
      this._dirty = true;
      return;
    }
    const seq = this._keyToSequence(e);
    if (seq === null) return;
    e.preventDefault();
    if (this._ctrlMode && seq.length === 1) {
      const code = seq.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) this._conn.sendString(String.fromCharCode(code - 64));
      this._ctrlMode = false;
      this._updateCtrlButton();
      return;
    }
    this._conn.sendString(seq);
  }

  _keyToSequence(e) {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = e.key.toUpperCase();
      if (k.length === 1 && k >= 'A' && k <= 'Z') return String.fromCharCode(k.charCodeAt(0) - 64);
      if (e.key === '[')  return '\x1B';
      if (e.key === '\\') return '\x1C';
      if (e.key === ']')  return '\x1D';
    }
    switch (e.key) {
      case 'Enter':      return '\r';
      case 'Backspace':  return '\x7F';
      case 'Delete':     return '\x1B[3~';
      case 'Tab':        return e.shiftKey ? '\x1B[Z' : '\t';
      case 'Escape':     return '\x1B';
      case 'Insert':     return '\x1B[2~';
      case 'Home':       return '\x1B[1~';
      case 'End':        return '\x1B[4~';
      case 'ArrowUp':    return '\x1B[A';
      case 'ArrowDown':  return '\x1B[B';
      case 'ArrowRight': return '\x1B[C';
      case 'ArrowLeft':  return '\x1B[D';
      case 'F1':  return '\x1B[11~'; case 'F2':  return '\x1B[12~';
      case 'F3':  return '\x1B[13~'; case 'F4':  return '\x1B[14~';
      case 'F5':  return '\x1B[15~'; case 'F6':  return '\x1B[17~';
      case 'F7':  return '\x1B[18~'; case 'F8':  return '\x1B[19~';
      case 'F9':  return '\x1B[20~'; case 'F10': return '\x1B[21~';
      case 'F11': return '\x1B[23~'; case 'F12': return '\x1B[24~';
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) return e.key;
    return null;
  }

  // ── Mobile toolbar ────────────────────────────────────────────
  _bindMobileToolbar() {
    const keyMap = {
      'ESC':'\x1B', 'TAB':'\t',
      'UP':'\x1B[A', 'DOWN':'\x1B[B', 'LEFT':'\x1B[D', 'RIGHT':'\x1B[C',
      'PGUP':'\x1B[5~', 'PGDN':'\x1B[6~',
      'HOME':'\x1B[1~', 'END':'\x1B[4~',
      'DEL':'\x1B[3~', 'INS':'\x1B[2~',
      'F1':'\x1B[11~', 'F2':'\x1B[12~', 'F3':'\x1B[13~', 'F4':'\x1B[14~',
      'F5':'\x1B[15~', 'F10':'\x1B[21~',
    };
    document.querySelectorAll('.mkey').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._hiddenInput.focus();
        const key = btn.dataset.key;
        if (key === 'CTRL') { this._ctrlMode = !this._ctrlMode; this._updateCtrlButton(); return; }
        if (!this._term.isLive()) {
          this._term.scrollbackEnd(); this._renderer.invalidateAll(); this._dirty = true;
        }
        const seq = keyMap[key];
        if (seq) this._conn.sendString(seq);
      });
    });
  }

  _updateCtrlButton() {
    const btn = document.querySelector('.mkey[data-key="CTRL"]');
    if (btn) btn.style.background = this._ctrlMode ? '#1a2d6e' : '';
  }
}