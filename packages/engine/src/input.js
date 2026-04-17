/**
 * input.js
 * Input handler. Translates raw terminal key events from Terminal
 * into named game actions. Supports configurable key bindings.
 *
 * NUMPAD support (two modes):
 *   NumLock ON  → terminal sends literal digit chars '8','4','6','2' etc.
 *                 Cardinals + diagonals are mapped to directional actions.
 *   NumLock OFF → terminal sends ANSI escape sequences (\x1bOA etc.)
 *                 which are also mapped to the same actions.
 *
 * Diagonal actions (UP_LEFT, UP_RIGHT, DOWN_LEFT, DOWN_RIGHT) are available
 * for roguelikes and MUDs. Arcade games can ignore them safely.
 */

'use strict';

const { EventEmitter } = require('events');

// ─── Default key → action bindings ───────────────────────────────────────
const DEFAULT_BINDINGS = {
  // ── Cursor arrow keys (standard ANSI) ──────────────────────────────────
  '\x1b[A': 'UP',
  '\x1b[B': 'DOWN',
  '\x1b[C': 'RIGHT',
  '\x1b[D': 'LEFT',

  // ── Numpad — NumLock ON (literal digit characters sent by terminal) ─────
  '8': 'UP',
  '2': 'DOWN',
  '4': 'LEFT',
  '6': 'RIGHT',
  // Diagonals
  '7': 'UP_LEFT',
  '9': 'UP_RIGHT',
  '1': 'DOWN_LEFT',
  '3': 'DOWN_RIGHT',
  // Centre / confirm
  '5': 'CONFIRM',

  // ── Numpad — NumLock OFF (application/cursor-key mode escape sequences) ─
  // Sent by SyncTERM, NetRunner, mTelnet and most BBS clients
  '\x1bOA': 'UP',       // Numpad 8
  '\x1bOB': 'DOWN',     // Numpad 2
  '\x1bOC': 'RIGHT',    // Numpad 6
  '\x1bOD': 'LEFT',     // Numpad 4
  '\x1b[E':  'CONFIRM', // Numpad 5 centre (normal mode)
  '\x1bOM':  'CONFIRM', // Numpad Enter (application mode)

  // ── WASD (uppercase to avoid conflict with single-key game bindings) ────
  'w': 'UP',    'W': 'UP',
  'S': 'DOWN',
  'A': 'LEFT',
  'D': 'RIGHT',

  // ── Vim-style (uppercase only) ──────────────────────────────────────────
  'K': 'UP',
  'J': 'DOWN',
  'H': 'LEFT',
  'L': 'RIGHT',

  // ── Action keys ──────────────────────────────────────────────────────────
  '\r':        'CONFIRM',
  ' ':         'CONFIRM',
  '\x1b':      'CANCEL',
  '\t':        'TAB',
  'BACKSPACE': 'BACKSPACE',

  // ── Navigation ───────────────────────────────────────────────────────────
  '\x1b[H':  'HOME',
  '\x1b[F':  'END',
  '\x1b[5~': 'PAGEUP',
  '\x1b[6~': 'PAGEDOWN',
  '\x1b[2~': 'INSERT',
  '\x1b[3~': 'DELETE',

  // ── Function keys ─────────────────────────────────────────────────────────
  '\x1bOP':   'F1',
  '\x1bOQ':   'F2',
  '\x1bOR':   'F3',
  '\x1bOS':   'F4',
  '\x1b[15~': 'F5',
  '\x1b[17~': 'F6',
  '\x1b[18~': 'F7',
  '\x1b[19~': 'F8',
  '\x1b[20~': 'F9',
  '\x1b[21~': 'F10',

  // ── Quit / pause ─────────────────────────────────────────────────────────
  'q': 'QUIT', 'Q': 'QUIT',
  'p': 'PAUSE','P': 'PAUSE',
};

class Input extends EventEmitter {
  /**
   * @param {Terminal} terminal
   * @param {object}   [bindings] - override or extend default key→action map
   */
  constructor(terminal, bindings = {}) {
    super();
    this.terminal = terminal;
    this.bindings = Object.assign({}, DEFAULT_BINDINGS, bindings);
    this._active  = false;

    terminal.on('key', (key) => {
      if (!this._active) return;
      const action = this.bindings[key] || null;
      this.emit('key', key);
      if (action) this.emit('action', action, key);
    });
  }

  start()  { this._active = true;  return this; }
  stop()   { this._active = false; return this; }

  waitAction() {
    return new Promise((resolve) => { this.once('action', resolve); });
  }

  waitKey() {
    return new Promise((resolve) => { this.once('key', resolve); });
  }

  waitFor(...actions) {
    return new Promise((resolve) => {
      const handler = (action) => {
        if (actions.includes(action)) {
          this.removeListener('action', handler);
          resolve(action);
        }
      };
      this.on('action', handler);
    });
  }

  bind(key, action)  { this.bindings[key] = action; return this; }
  unbind(key)        { delete this.bindings[key];    return this; }
}

module.exports = Input;
