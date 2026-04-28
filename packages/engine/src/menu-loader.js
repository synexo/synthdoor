'use strict';

/**
 * menu-loader.js
 *
 * Loads, parses, validates, and normalises SynthDoor menu definitions from
 * YAML files.  Also auto-generates top.yaml when it does not yet exist.
 *
 * ── File layout ────────────────────────────────────────────────────────────
 *   config/menus/
 *     top.yaml          ← top-level menu (auto-generated from discovered games
 *                          on first run if absent; written to disk)
 *     utils.yaml        ← any additional menu, referenced by target: utils
 *     goodbye.yaml      ← optional goodbye screen config (ansifile override)
 *     art/
 *       top_menu.ans    ← optional CP437 ANSI art files
 *       goodbye.ans
 *
 * ── YAML schema ────────────────────────────────────────────────────────────
 * See docs/MENU.md for the authoritative reference.  Quick summary:
 *
 *   title:     string | null          Titlebar text (Draw.titleBar).
 *                                     null → default "SYNTHDOOR" bar.
 *   statusbar: string                 Row-25 text.
 *   ansifile:  string | null          CP437 .ans file, rows 2-24 only.
 *                                     When set, selection highlight is
 *                                     suppressed (key-press only).
 *   underlay:  string | null          CP437 .ans drawn BEHIND the auto-layout
 *                                     menu items (rows 2-24).  Unlike ansifile,
 *                                     the standard arrow/number nav still
 *                                     renders on top.
 *   columns:   1-4                    Auto-layout columns (left-first fill).
 *                                     Ignored when ansifile is set.
 *   colors:                           Optional color overrides.
 *     normal_fg:   Color constant name (e.g. "WHITE")
 *     normal_bg:   Color constant name
 *     selected_fg: Color constant name
 *     selected_bg: Color constant name
 *     border_fg:   Color constant name
 *     title_fg:    Color constant name
 *     title_bg:    Color constant name
 *   selections: []                    Array of selection objects.
 *     - key:    string                Key the user presses ('1', 'a', 'x'…).
 *                                     Must be exactly a single character.
 *       text:   string                Display label.
 *       type:   game | menu | action
 *       target: string                GAME_NAME, yaml basename, or action id.
 *       inline: <MenuDef>             Inline nested menu (overrides target for
 *                                     type:menu).
 *
 * ── Built-in actions ───────────────────────────────────────────────────────
 *   exit        Show goodbye screen, then disconnect.
 *   back        Pop to parent menu (or exit if at root).
 *   disconnect  Immediate disconnect, no goodbye screen.
 *
 * ── Future extension points ────────────────────────────────────────────────
 *   • colors block is parsed and forwarded; renderer uses it if present.
 *   • underlay is parsed and forwarded; renderer draws it before menu items.
 *   • Additional selection types (e.g. 'door', 'url') can be added without
 *     schema changes — the loader preserves unknown fields in _extra.
 *   • Per-selection color overrides can be added under selections[].colors.
 */

const { getLogger } = require('./logger');
const fs   = require('fs');
const path = require('path');

let yaml;
try {
  yaml = require('js-yaml');
} catch (_) {
  // Graceful degradation: if js-yaml isn't installed yet, provide a minimal
  // synchronous parser that handles the simple subset we auto-generate.
  yaml = { load: _minimalYamlLoad };
}

// ─── Color name → integer map (mirrors constants.js) ─────────────────────
const COLOR_NAMES = {
  BLACK: 0, RED: 1, GREEN: 2, YELLOW: 3, BLUE: 4,
  MAGENTA: 5, CYAN: 6, WHITE: 7,
  BRIGHT_BLACK: 8, DARK_GRAY: 8,
  BRIGHT_RED: 9, LIGHT_RED: 9,
  BRIGHT_GREEN: 10, LIGHT_GREEN: 10,
  BRIGHT_YELLOW: 11, LIGHT_YELLOW: 11,
  BRIGHT_BLUE: 12, LIGHT_BLUE: 12,
  BRIGHT_MAGENTA: 13, LIGHT_MAGENTA: 13,
  BRIGHT_CYAN: 14, LIGHT_CYAN: 14,
  BRIGHT_WHITE: 15, INTENSE_WHITE: 15,
};

// ─── Built-in action ids ──────────────────────────────────────────────────
const BUILTIN_ACTIONS = new Set(['exit', 'back', 'disconnect']);

// ─── Valid selection types ────────────────────────────────────────────────
const VALID_TYPES = new Set(['game', 'menu', 'action']);

// ─── Defaults ─────────────────────────────────────────────────────────────
const DEFAULTS = {
  title:     null,
  statusbar: 'Use arrow keys or press a number to select.  Q = quit',
  ansifile:  null,
  underlay:  null,
  columns:   1,
  colors:    null,
};

// ═══════════════════════════════════════════════════════════════════════════
// MenuLoader
// ═══════════════════════════════════════════════════════════════════════════
class MenuLoader {
  /**
   * @param {string} menusDir  Absolute path to config/menus/
   */
  constructor(menusDir) {
    this.menusDir = menusDir;
    this._cache   = new Map(); // basename → MenuDef (cleared on reload)
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Load (and cache) a menu by base name.
   * e.g. load('top') reads config/menus/top.yaml
   *
   * @param {string} name  Filename without .yaml extension.
   * @returns {MenuDef}
   * @throws  {Error} on file-not-found or parse/validation errors.
   */
  load(name) {
    if (this._cache.has(name)) return this._cache.get(name);
    const filePath = path.join(this.menusDir, `${name}.yaml`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Menu file not found: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const def = this._parseAndValidate(raw, filePath);
    this._cache.set(name, def);
    return def;
  }

  /**
   * Load the top-level menu, auto-generating top.yaml if it doesn't exist.
   *
   * @param {Array<{name:string, title:string}>} discoveredGames
   * @returns {MenuDef}
   */
  /**
   * Load the top-level menu, auto-generating top.yaml if it doesn't exist.
   *
   * @param {Array} publicGames   Games without role restriction (for auto-gen and filtering)
   * @param {Array} [allGames]    All registered games (to identify restricted ones in existing YAML)
   * @returns {MenuDef}
   */
  loadTop(publicGames, allGames) {
    const topPath = path.join(this.menusDir, 'top.yaml');

    if (!fs.existsSync(topPath)) {
      this._autoGenerateTop(topPath, publicGames);
    }

    const def = this.load('top');

    // Strip role-restricted games from an existing top.yaml.
    // Any game in allGames but NOT in publicGames is restricted.
    if (def && def.selections && allGames) {
      const publicNames     = new Set(publicGames.map(g => g.name));
      const restrictedNames = new Set(
        allGames.filter(g => !publicNames.has(g.name)).map(g => g.name)
      );
      if (restrictedNames.size > 0) {
        def.selections = def.selections.filter(
          sel => !(sel.type === 'game' && restrictedNames.has(sel.target))
        );
      }
    }

    return def;
  }

  /**
   * Load the goodbye screen definition.
   * Returns a minimal MenuDef (ansifile only, no selections) or null if
   * config/menus/goodbye.yaml doesn't exist.
   *
   * @returns {MenuDef|null}
   */
  loadGoodbye() {
    const goodbyePath = path.join(this.menusDir, 'goodbye.yaml');
    if (!fs.existsSync(goodbyePath)) return null;
    try {
      return this.load('goodbye');
    } catch (_) {
      return null;
    }
  }

  /**
   * Resolve a menu referenced by name from a selection's target field.
   * Tries the cache first, then disk.
   *
   * @param {string} name
   * @returns {MenuDef}
   */
  loadNested(name) {
    return this.load(name);
  }

  /** Clear the parse cache (e.g. for live-reload). */
  clearCache() {
    this._cache.clear();
  }

  // ─── Auto-generation ─────────────────────────────────────────────────────

  /**
   * Generate top.yaml from the list of discovered games and write it to disk.
   * Emits a prominent log message so operators know the file was created.
   */
  _autoGenerateTop(topPath, games) {
    const lines = [
      '# top.yaml — SynthDoor top-level menu',
      '# Auto-generated by SynthDoor on first run.',
      '# Edit this file to customise your menu.  See docs/MENU.md for full reference.',
      '#',
      '# Tip: add ansifile: "art/top_menu.ans" to show custom ANSI art (rows 2-24).',
      '# Tip: add underlay: "art/top_menu.ans" to show art behind the menu items.',
      '# Tip: add a colors: block to customise item colours.',
      '',
      'title: "SynthDoor BBS"',
      'statusbar: "Use arrows/numbers to select a game.  Q = quit"',
      'columns: 1',
      '',
      'selections:',
    ];

    // Auto-generate keys sequence: 1-9, then A-Z (skipping Q and X)
    const AUTO_KEYS = '123456789ABCDEFGHIJKLMNOPRSTUVWYZ';

    games.forEach((g, i) => {
      let keyChar;
      if (i < AUTO_KEYS.length) {
        keyChar = AUTO_KEYS[i];
      } else {
        getLogger().info("Exceeded available keys for menu autogeneration, only the first 33 games populated."); 
      }

      lines.push(`  - key: "${keyChar}"`);
      // Escape any double-quotes in the title
      const safeTitle = (g.title || g.name).replace(/"/g, '\\"');
      lines.push(`    text: "${safeTitle}"`);
      lines.push(`    type: game`);
      lines.push(`    target: ${g.name}`);
    });

    // Always append a quit entry
    lines.push(`  - key: "Q"`);
    lines.push(`    text: "Goodbye"`);
    lines.push(`    type: action`);
    lines.push(`    target: exit`);
    lines.push('');

    const content = lines.join('\n');

    // Ensure directory exists
    fs.mkdirSync(this.menusDir, { recursive: true });
    fs.writeFileSync(topPath, content, 'utf8');

    getLogger().info('');
    getLogger().info('╔══════════════════════════════════════════════════════════╗');
    getLogger().info('║  MENU SYSTEM: top.yaml not found — auto-generated.       ║');
    getLogger().info(`║  Created: ${topPath.padEnd(46)} ║`);
    getLogger().info('║  Edit this file to customise your top-level menu.        ║');
    getLogger().info('║  See docs/MENU.md for the full schema reference.         ║');
    getLogger().info('╚══════════════════════════════════════════════════════════╝');
    getLogger().info('');
  }

  // ─── Parse & validate ─────────────────────────────────────────────────────

  /**
   * Parse a YAML string and return a normalised, validated MenuDef.
   *
   * @param {string} raw       Raw YAML text.
   * @param {string} filePath  Used only for error messages.
   * @returns {MenuDef}
   */
  _parseAndValidate(raw, filePath) {
    let doc;
    try {
      doc = yaml.load(raw);
    } catch (e) {
      throw new Error(`Menu YAML parse error in ${filePath}: ${e.message}`);
    }

    if (!doc || typeof doc !== 'object') {
      throw new Error(`Menu file is empty or invalid: ${filePath}`);
    }

    return this._normaliseMenuDef(doc, filePath, 0);
  }

  /**
   * Recursively normalise a raw YAML object into a typed MenuDef.
   *
   * @param {object} raw
   * @param {string} filePath   For error messages.
   * @param {number} depth      Nesting depth (0 = top-level).
   * @returns {MenuDef}
   */
  _normaliseMenuDef(raw, filePath, depth) {
    const def = {
      // ── Display ────────────────────────────────────────────────────────
      title:     _str(raw.title,     DEFAULTS.title),
      statusbar: _str(raw.statusbar, DEFAULTS.statusbar),
      ansifile:  _str(raw.ansifile,  DEFAULTS.ansifile),
      underlay:  _str(raw.underlay,  DEFAULTS.underlay),
      columns:   _clamp(parseInt(raw.columns) || 1, 1, 4),

      // ── Colors (optional block, forwarded to renderer) ─────────────────
      // Stored as resolved integer values so the renderer doesn't need to
      // know about Color name strings.
      colors:    this._normaliseColors(raw.colors, filePath),

      // ── Selections ────────────────────────────────────────────────────
      selections: [],

      // ── Internal metadata ─────────────────────────────────────────────
      _source: filePath,
      _depth:  depth,
    };

    // Validate ansifile/underlay mutual exclusivity at render time (not here),
    // but warn if both are set — underlay wins in that case.
    if (def.ansifile && def.underlay) {
      getLogger().warn(`[MenuLoader] ${filePath}: both ansifile and underlay set; ansifile takes precedence.`);
      def.underlay = null;
    }

    // Selections are required unless this is a goodbye/art-only def
    const rawSel = raw.selections;
    if (!rawSel && !def.ansifile) {
      // No selections and no ansifile: not inherently fatal (e.g. a splash
      // screen without choices), but log a warning.
      getLogger().warn(`[MenuLoader] ${filePath}: no selections defined.`);
    }

    if (Array.isArray(rawSel)) {
      rawSel.forEach((item, idx) => {
        def.selections.push(
          this._normaliseSelection(item, filePath, depth, idx)
        );
      });
    }

    return def;
  }

  /**
   * Normalise a single selection entry.
   */
  _normaliseSelection(raw, filePath, depth, idx) {
    const loc = `${filePath} selections[${idx}]`;

    if (!raw || typeof raw !== 'object') {
      throw new Error(`${loc}: selection must be an object`);
    }

    const key  = String(raw.key  ?? '').trim().toLowerCase();
    const text = String(raw.text ?? '').trim();
    const type = String(raw.type ?? '').trim().toLowerCase();

    if (!key)  throw new Error(`${loc}: missing required field "key"`);
    if (key.length !== 1) throw new Error(`${loc}: key must be exactly a single character`);
    if (!text) throw new Error(`${loc}: missing required field "text"`);
    if (!VALID_TYPES.has(type)) {
      throw new Error(`${loc}: invalid type "${type}" — must be game, menu, or action`);
    }

    const sel = {
      key,
      text,
      type,
      target:  _str(raw.target, null),
      inline:  null,   // populated below for type:menu with inline block

      // ── Per-selection color overrides (future use) ─────────────────────
      // Stored raw for now; renderer can choose to apply them.
      colors: this._normaliseColors(raw.colors, filePath),

      // ── Extension: preserve unrecognised fields for future use ─────────
      _extra: {},
    };

    // Copy any unrecognised fields into _extra so they survive round-trips
    const knownFields = new Set(['key','text','type','target','inline','colors']);
    for (const [k, v] of Object.entries(raw)) {
      if (!knownFields.has(k)) sel._extra[k] = v;
    }

    // ── Type-specific validation ──────────────────────────────────────────
    if (type === 'game') {
      if (!sel.target) throw new Error(`${loc}: type:game requires a target (GAME_NAME)`);
    }

    if (type === 'action') {
      if (!sel.target) throw new Error(`${loc}: type:action requires a target`);
      if (!BUILTIN_ACTIONS.has(sel.target)) {
        getLogger().warn(`[MenuLoader] ${loc}: unknown action "${sel.target}" — will be ignored at runtime`);
      }
    }

    if (type === 'menu') {
      // Inline nested menu definition takes priority over external file target
      if (raw.inline && typeof raw.inline === 'object') {
        if (depth >= 8) {
          throw new Error(`${loc}: menu nesting depth limit (8) exceeded`);
        }
        sel.inline = this._normaliseMenuDef(raw.inline, filePath, depth + 1);
      } else if (!sel.target) {
        throw new Error(`${loc}: type:menu requires either a target (yaml basename) or an inline: block`);
      }
    }

    return sel;
  }

  /**
   * Normalise a colors block.  Input is an object with Color name strings;
   * output has the same keys mapped to integer values (or null for missing).
   *
   * Supported keys:
   *   normal_fg, normal_bg, selected_fg, selected_bg,
   *   border_fg, border_bg, title_fg, title_bg, statusbar_fg, statusbar_bg
   *
   * This list is intentionally open — unrecognised keys are preserved so
   * future renderer features can use them without a loader change.
   */
  _normaliseColors(raw, filePath) {
    if (!raw || typeof raw !== 'object') return null;

    const result = {};
    for (const [key, val] of Object.entries(raw)) {
      const name = String(val).toUpperCase().trim();
      if (name in COLOR_NAMES) {
        result[key] = COLOR_NAMES[name];
      } else {
        const n = parseInt(val);
        if (!isNaN(n) && n >= 0 && n <= 15) {
          result[key] = n;
        } else {
          getLogger().warn(`[MenuLoader] ${filePath}: unknown color value "${val}" for "${key}" — ignored`);
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function _str(v, fallback) {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length > 0 ? s : fallback;
}

function _clamp(v, min, max) {
  return Math.max(min, Math.min(max, isNaN(v) ? min : v));
}

// ─── Minimal YAML fallback (no js-yaml) ───────────────────────────────────
// Handles only the simple flat + list format that _autoGenerateTop produces.
// Inline nested menus and color blocks require js-yaml.

function _minimalYamlLoad(text) {
  const lines  = text.split('\n');
  const result = {};
  let   current = result;
  let   inSelections = false;
  let   currentSel   = null;
  const selections   = [];

  for (let line of lines) {
    // Strip comments
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) line = line.slice(0, commentIdx);
    if (!line.trim()) continue;

    // Selections list item
    if (/^\s{2}-\s+key:/.test(line)) {
      if (currentSel) selections.push(currentSel);
      currentSel = {};
      currentSel.key = _minYamlVal(line);
      continue;
    }
    if (currentSel && /^\s{4}/.test(line)) {
      const m = line.trim().match(/^(\w+):\s*(.*)$/);
      if (m) currentSel[m[1]] = _minYamlVal(line);
      continue;
    }

    if (currentSel) { selections.push(currentSel); currentSel = null; }

    if (line.trim() === 'selections:') { inSelections = true; continue; }

    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) result[m[1]] = _minYamlVal(line);
  }

  if (currentSel) selections.push(currentSel);
  if (selections.length) result.selections = selections;

  return result;
}

function _minYamlVal(line) {
  const m = line.match(/:\s*(.*)$/);
  if (!m) return '';
  let v = m[1].trim();
  // Strip surrounding quotes
  if ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

module.exports = MenuLoader;