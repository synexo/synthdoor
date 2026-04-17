'use strict';

/**
 * menu-renderer.js
 *
 * Renders a MenuDef to a Terminal using the SynthDoor Screen/Draw/Input APIs.
 * Returns the Selection the user chose, or a synthetic back/exit selection.
 *
 * ── Render modes ───────────────────────────────────────────────────────────
 *
 *  1. ANSI art mode   (MenuDef.ansifile is set)
 *     Draws the CP437 .ans file into rows 2-24.  No item highlight is drawn.
 *     Selection is entirely key-press driven.
 *
 *  2. Underlay mode   (MenuDef.underlay is set, ansifile is NOT set)
 *     Draws the CP437 .ans file into rows 2-24 as a background layer, then
 *     renders the standard arrow-selectable item list on top.
 *     Future enhancement: per-item hotspot coordinates could suppress the
 *     auto-layout list and position items over the art instead.
 *
 *  3. Auto-layout mode (neither ansifile nor underlay)
 *     Fills rows 2-24 with a clean, numbered, arrow-selectable item list.
 *     Items are distributed into columns left-first (top-to-bottom per column).
 *
 * ── Navigation ─────────────────────────────────────────────────────────────
 *   Arrow keys (UP/DOWN)  Move selection highlight (auto-layout + underlay)
 *   Number/letter keys    Jump directly to a keyed item (all modes)
 *   Enter / Space         Confirm selection
 *   Q (if no Q item)      Synthesise a 'back' action
 *   Escape                Synthesise a 'back' action
 *
 * ── Color resolution ───────────────────────────────────────────────────────
 *   Renderer checks MenuDef.colors for overrides; falls back to THEME defaults.
 *   Supported color keys (all optional):
 *     normal_fg, normal_bg     — unselected item text
 *     selected_fg, selected_bg — highlighted item text
 *     border_fg, border_bg     — box border
 *     title_fg,  title_bg      — title bar
 *     statusbar_fg, statusbar_bg
 *
 * ── Extension notes ────────────────────────────────────────────────────────
 *   • To add per-item hotspot positioning (for ANSI art overlays), add
 *     x/y fields to Selection and check sel._extra.x / sel._extra.y here.
 *   • To add per-item color overrides, check sel.colors before THEME.
 *   • The _renderItems() method is intentionally separated from _layout()
 *     so future renderers can override one without touching the other.
 */

const fs   = require('fs');
const path = require('path');

const enginePath = path.join(__dirname, '..', '..', 'engine', 'src', 'index.js');
const { Screen, Draw, Color } = require(enginePath);

// ─── Default theme ────────────────────────────────────────────────────────
// All values are Color constants.  Overridden by MenuDef.colors when present.
const THEME = {
  title_fg:      Color.BRIGHT_WHITE,
  title_bg:      Color.BLUE,
  statusbar_fg:  Color.BLACK,
  statusbar_bg:  Color.CYAN,
  border_fg:     Color.CYAN,
  border_bg:     Color.BLACK,
  normal_fg:     Color.WHITE,
  normal_bg:     Color.BLACK,
  selected_fg:   Color.BLACK,
  selected_bg:   Color.CYAN,
  number_fg:     Color.BRIGHT_YELLOW,   // key prefix  "1."
  number_sel_fg: Color.BRIGHT_WHITE,    // key prefix when selected
};

// ─── Synthetic selection objects for built-in navigation ─────────────────
const BACK_SEL = Object.freeze({
  key: '__back__', text: 'Back', type: 'action', target: 'back',
  inline: null, colors: null, _extra: {},
});
const EXIT_SEL = Object.freeze({
  key: '__exit__', text: 'Exit', type: 'action', target: 'exit',
  inline: null, colors: null, _extra: {},
});

// ─── Layout constants ─────────────────────────────────────────────────────
const SCREEN_COLS   = 80;
const GAME_ROW_TOP  = 2;   // first usable row below title bar
const GAME_ROW_BOT  = 24;  // last usable row above status bar
const USABLE_ROWS   = GAME_ROW_BOT - GAME_ROW_TOP + 1; // 23

class MenuRenderer {
  /**
   * @param {Terminal}   terminal
   * @param {MenuLoader} loader     Needed to resolve ansifile paths.
   */
  constructor(terminal, loader) {
    this.terminal = terminal;
    this.loader   = loader;
    this.screen   = new Screen(terminal);
  }

  /**
   * Present a MenuDef and wait for the user to make a selection.
   *
   * @param {MenuDef} def
   * @returns {Promise<Selection>}  The chosen Selection object.
   *   Built-in navigation returns BACK_SEL or EXIT_SEL.
   */
  async present(def) {
    this.screen.setMode(Screen.FIXED);

    const theme    = this._buildTheme(def.colors);
    const keyMap   = this._buildKeyMap(def.selections);
    const hasQKey  = keyMap.has('q');

    // ── ANSI art mode ─────────────────────────────────────────────────────
    if (def.ansifile) {
      this._renderFrame(def, theme);
      this._renderAnsiArt(def.ansifile);
      this.screen.flush();
      return this._waitKeyOnly(keyMap, hasQKey);
    }

    // ── Auto-layout / underlay mode ───────────────────────────────────────
    const layout   = this._layout(def);
    let   selected = 0;
    let   dirty    = true;

    // Input handler — modifies selected, returns chosen Selection or null
    return new Promise((resolve) => {
      const onKey = async (key) => {
        const kl = key.toLowerCase();

        // Direct key hit
        if (keyMap.has(kl)) {
          cleanup();
          resolve(keyMap.get(kl));
          return;
        }

        // Back / escape
        if (key === '\x1b' || (!hasQKey && (kl === 'q'))) {
          cleanup();
          resolve(BACK_SEL);
          return;
        }

        // Arrow navigation
        if (key === '\x1b[A' || key === '\x1bOA') { // up
          selected = (selected - 1 + layout.length) % layout.length;
          dirty = true;
        } else if (key === '\x1b[B' || key === '\x1bOB') { // down
          selected = (selected + 1) % layout.length;
          dirty = true;
        } else if (key === '\r' || key === ' ') {
          cleanup();
          resolve(layout[selected].sel);
          return;
        }

        if (dirty) {
          this._renderFrame(def, theme);
          if (def.underlay) this._renderAnsiArt(def.underlay);
          this._renderItems(def, layout, selected, theme);
          this.screen.flush();
          dirty = false;
        }
      };

      const cleanup = () => {
        this.terminal.removeListener('key', onKey);
      };

      this.terminal.on('key', onKey);

      // Initial render
      this._renderFrame(def, theme);
      if (def.underlay) this._renderAnsiArt(def.underlay);
      this._renderItems(def, layout, selected, theme);
      this.screen.flush();
    });
  }

  /**
   * Display a goodbye screen.  No selections — just art/text, then returns.
   * Called by MenuSession before disconnecting on an 'exit' action.
   *
   * @param {MenuDef|null} goodbyeDef  null → render built-in goodbye screen
   */
  async showGoodbye(goodbyeDef) {
    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);

    if (goodbyeDef && goodbyeDef.ansifile) {
      // Custom goodbye art
      this._drawTitleBar(goodbyeDef.title || 'GOODBYE', {
        title_fg: Color.BRIGHT_WHITE, title_bg: Color.BLUE,
      });
      this._renderAnsiArt(goodbyeDef.ansifile);
      this.screen.statusBar(
        goodbyeDef.statusbar || ' Thank you for playing SynthDoor!',
        Color.BLACK, Color.CYAN
      );
    } else {
      // Built-in goodbye screen
      this._renderBuiltinGoodbye();
    }

    this.screen.flush();
    // Brief pause so the player can read the goodbye screen
    await _sleep(1800);
  }

  // ─── Frame rendering ──────────────────────────────────────────────────────

  /** Render title bar + clear game area + status bar. */
  _renderFrame(def, theme) {
    this.screen.clear(Color.BLACK, Color.BLACK);

    // Title bar (row 1)
    this._drawTitleBar(def.title || 'SYNTHDOOR', theme);

    // Status bar (row 25)
    this.screen.statusBar(
      ' ' + (def.statusbar || THEME.statusbar || ''),
      theme.statusbar_fg, theme.statusbar_bg
    );
  }

  _drawTitleBar(title, theme) {
    Draw.titleBar(this.screen, title, theme.title_fg, theme.title_bg);
  }

  // ─── ANSI art helper ──────────────────────────────────────────────────────

  /**
   * Render a CP437 .ans file into rows 2-24 only.
   * We move the cursor to row 2 col 1 first so the art lands in the right
   * place between the title and status bars.
   *
   * The art is rendered via terminal.write() (goes through CP437 encoder)
   * which is correct for .ans file content.
   */
  _renderAnsiArt(ansifile) {
    const artPath = this._resolveArtPath(ansifile);
    if (!artPath) return;

    let art;
    try {
      art = fs.readFileSync(artPath);
    } catch (e) {
      console.warn(`[MenuRenderer] Cannot read ansifile: ${artPath} — ${e.message}`);
      return;
    }

    // Position cursor at row 2 before injecting art
    this.terminal.writeRaw('\x1b[2;1H');
    // Art is raw CP437/ANSI bytes — write as binary, bypassing UTF-8 encoder
    this.terminal.output.write(art);
  }

  _resolveArtPath(ansifile) {
    if (!ansifile) return null;
    // If absolute, use as-is
    if (path.isAbsolute(ansifile)) return ansifile;
    // Relative to the menus/art/ directory
    return path.join(this.loader.menusDir, 'art', ansifile);
  }

  // ─── Auto-layout ──────────────────────────────────────────────────────────

  /**
   * Calculate column layout for menu items.
   * Items are distributed left-first (column 0 fills top-to-bottom, then col 1…).
   *
   * Returns an array of { sel, col, row, labelWidth } objects.
   * col and row are 1-based screen coordinates.
   */
  _layout(def) {
    const items   = def.selections;
    const numCols = Math.max(1, Math.min(def.columns || 1, 4));
    const n       = items.length;

    if (n === 0) return [];

    // Calculate rows per column (left columns get the extra item if uneven)
    const rowsPerCol = Math.ceil(n / numCols);

    // Available screen estate: rows 2-24, cols 1-80
    // Leave 1 row of padding top/bottom inside the usable area
    const areaTop  = GAME_ROW_TOP + 1;   // row 3
    const areaBot  = GAME_ROW_BOT - 1;   // row 23
    const areaRows = areaBot - areaTop + 1;

    // Column width (equal split with 2-char gutter)
    const colWidth = Math.floor((SCREEN_COLS - 2) / numCols) - 2;

    const positions = [];

    for (let i = 0; i < n; i++) {
      const colIdx  = Math.floor(i / rowsPerCol);
      const rowIdx  = i % rowsPerCol;
      const colLeft = 2 + colIdx * Math.floor((SCREEN_COLS - 2) / numCols);
      const row     = areaTop + rowIdx;

      positions.push({
        sel:        items[i],
        col:        colLeft,
        row:        Math.min(row, areaBot),
        labelWidth: colWidth,
      });
    }

    return positions;
  }

  /**
   * Render the item list onto the screen framebuffer.
   * Colours are applied from per-item sel.colors first, then theme.
   */
  _renderItems(def, layout, selectedIdx, theme) {
    layout.forEach(({ sel, col, row, labelWidth }, idx) => {
      const isSelected = idx === selectedIdx;

      // Resolve colors: per-item override → theme
      const c = sel.colors || {};
      const normalFg   = c.normal_fg   ?? theme.normal_fg;
      const normalBg   = c.normal_bg   ?? theme.normal_bg;
      const selectedFg = c.selected_fg ?? theme.selected_fg;
      const selectedBg = c.selected_bg ?? theme.selected_bg;
      const numberFg   = isSelected
        ? (c.number_sel_fg ?? theme.number_sel_fg)
        : (c.number_fg     ?? theme.number_fg);

      const fg = isSelected ? selectedFg : normalFg;
      const bg = isSelected ? selectedBg : normalBg;

      // Build label: "1. Text" padded to labelWidth
      const keyPart  = `${sel.key}.`;
      const textPart = ` ${sel.text}`;
      const full     = (keyPart + textPart).substring(0, labelWidth);
      const padded   = full.padEnd(labelWidth);

      if (isSelected) {
        // Fill entire label width with highlight background
        this.screen.fill(col, row, labelWidth, 1, ' ', fg, bg);
      }

      // Draw key prefix in accent color, then text in item color
      this.screen.putString(col, row, keyPart,  numberFg, bg);
      this.screen.putString(col + keyPart.length, row,
        textPart.substring(0, labelWidth - keyPart.length).padEnd(labelWidth - keyPart.length),
        fg, bg);
    });
  }

  // ─── Key-only waiting (ANSI art mode) ─────────────────────────────────────

  _waitKeyOnly(keyMap, hasQKey) {
    return new Promise((resolve) => {
      const onKey = (key) => {
        const kl = key.toLowerCase();
        if (keyMap.has(kl)) {
          this.terminal.removeListener('key', onKey);
          resolve(keyMap.get(kl));
          return;
        }
        if (key === '\x1b' || (!hasQKey && kl === 'q')) {
          this.terminal.removeListener('key', onKey);
          resolve(BACK_SEL);
        }
      };
      this.terminal.on('key', onKey);
    });
  }

  // ─── Built-in goodbye screen ──────────────────────────────────────────────

  _renderBuiltinGoodbye() {
    Draw.titleBar(this.screen, 'GOODBYE', Color.BRIGHT_WHITE, Color.BLUE);

    // Simple centered goodbye message using block characters
    const lines = [
      '',
      '',
      '  Thank you for visiting SynthDoor BBS!',
      '',
      '  We hope to see you again soon.',
      '',
    ];

    // Draw a double-line box centered on screen
    Draw.shadowBox(
      this.screen, 18, 8, 46, lines.length + 4,
      'GOODBYE', Draw.BOX_DOUBLE, Color.CYAN, Color.BLACK
    );

    lines.forEach((line, i) => {
      if (line) {
        this.screen.putString(20, 10 + i, line, Color.WHITE, Color.BLACK);
      }
    });

    Draw.centerText(this.screen, 10 + lines.length + 2,
      '[ Disconnecting... ]', Color.DARK_GRAY, Color.BLACK);

    this.screen.statusBar(
      ' Thank you for playing!  Visit us again.',
      Color.BLACK, Color.CYAN
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Build key → Selection map (case-insensitive). */
  _buildKeyMap(selections) {
    const map = new Map();
    for (const sel of selections) {
      map.set(sel.key.toLowerCase(), sel);
    }
    return map;
  }

  /**
   * Merge MenuDef.colors (integer values already resolved by loader) into a
   * copy of the default THEME.
   */
  _buildTheme(defColors) {
    if (!defColors) return { ...THEME };
    return Object.assign({ ...THEME }, defColors);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────
MenuRenderer.BACK_SEL = BACK_SEL;
MenuRenderer.EXIT_SEL = EXIT_SEL;

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = MenuRenderer;
