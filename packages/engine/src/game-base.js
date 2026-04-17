/**
 * game-base.js
 * Base class for all SynthDoor games.
 *
 * Every game extends GameBase and implements:
 *   async run()  - main game loop (required)
 *   async onDisconnect()  - cleanup on player disconnect (optional)
 *
 * GameBase provides:
 *   - this.terminal  (Terminal instance)
 *   - this.screen    (Screen instance)
 *   - this.input     (Input instance)
 *   - this.audio     (Audio instance)
 *   - this.db        (DB instance - shared)
 *   - this.username  (string)
 *   - this.config    (game config object)
 *   - this.log(msg)  - structured game logging
 *
 * Usage:
 *   class MyGame extends GameBase {
 *     static get GAME_NAME() { return 'my_game'; }
 *     async run() {
 *       this.screen.setMode(Screen.FIXED);
 *       Draw.titleBar(this.screen, 'MY GAME');
 *       this.screen.flush();
 *       // ... game loop
 *     }
 *   }
 *   module.exports = MyGame;
 */

'use strict';

const Terminal    = require('./terminal');
const Screen      = require('./screen');
const Input       = require('./input');
const Audio       = require('./audio');

class GameBase {
  /**
   * Override in subclass to provide the game's unique identifier.
   * Used for DB namespacing, config lookup, and routing.
   */
  static get GAME_NAME() {
    return 'unnamed_game';
  }

  /**
   * @param {object} opts
   * @param {Terminal}  opts.terminal   - Terminal instance from transport
   * @param {DB}        opts.db         - shared DB instance
   * @param {object}    [opts.config]   - game-specific config from config file
   * @param {string}    [opts.username] - authenticated username
   * @param {string}    [opts.transport]- 'telnet'|'rlogin'|'web'
   */
  constructor(opts = {}) {
    this.terminal  = opts.terminal;
    this.db        = opts.db;
    this.config    = opts.config || {};
    this.username  = opts.terminal?.username || opts.username || 'anonymous';
    this.transport = opts.transport || 'telnet';

    this.screen    = new Screen(this.terminal);
    this.input     = new Input(this.terminal);
    this.audio     = new Audio(this.terminal, this.transport);

    this._running  = false;

    // Register player in DB
    if (this.db && this.username) {
      this.db.touchPlayer(this.username);
    }

    // Handle disconnect mid-game
    this.terminal?.on('disconnect', () => {
      this._running = false;
      this._cleanup().catch(() => {});
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────
  /**
   * Main entry point called by the transport.
   * Sets _running=true, calls run(), then _cleanup().
   */
  async start() {
    this._running = true;
    this.input.start();

    try {
      await this.run();
    } catch (err) {
      // Log full stack trace so errors are diagnosable
      this.log(`ERROR: ${err.message}`);
      this.log(`STACK:\n${err.stack}`);
    } finally {
      await this._cleanup();
    }
  }

  /**
   * Override this in your game. This is the main game loop.
   */
  async run() {
    throw new Error(`${this.constructor.name}: run() not implemented`);
  }

  /**
   * Called on exit or disconnect. Override for game-specific cleanup.
   * Always calls GameBase cleanup (input stop, cursor show, etc.)
   */
  async onDisconnect() {}

  async _cleanup() {
    this._running = false;
    this.input.stop();
    try {
      await this.onDisconnect();
      this.terminal?.showCursor();
      this.terminal?.resetAttrs();
      this.terminal?.moveTo(1, 1);
    } catch (_) {}
  }

  // ─── Logging ────────────────────────────────────────────────────────────
  log(msg) {
    const gameName = this.constructor.GAME_NAME;
    console.log(`[${gameName}] [${this.username}] ${msg}`);
  }

  // ─── Shared helper: splash screen with title ────────────────────────────
  async showSplash(title, subtitle = '', waitMs = 0) {
    const Draw  = require('./draw');
    const { Color } = require('./constants');

    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);

    // Calculate centering: 
    // Each char is 4 wide (3 for glyph + 1 space), minus 1 for the trailing space.
    const bannerWidth = (title.length * 4) - 1;
    const startX = Math.floor((80 - bannerWidth) / 2) + 1;

    // Pass startX as the 6th argument
    Draw.blockBanner(this.screen, 8, title, Color.CYAN, Color.BLACK, startX);

    if (subtitle) {
      Draw.centerText(this.screen, 15, subtitle, Color.YELLOW, Color.BLACK);
    }

    Draw.centerText(this.screen, 20, `Welcome, ${this.username}!`, Color.WHITE, Color.BLACK);
    this.screen.statusBar(' Press any key to continue...', Color.DARK_GRAY, Color.BLACK);
    this.screen.flush();

    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    } else {
      await this.terminal.waitKey();
    }
  }

  // ─── Shared helper: "Press any key" pause ────────────────────────────────
  async pressAnyKey() {
    const { Color } = require('./constants');
    this.screen.statusBar(' Press any key...', Color.BLACK, Color.CYAN);
    this.screen.flush();
    await this.terminal.waitKey();
  }

  // ─── Shared helper: leaderboard display ─────────────────────────────────
  async showLeaderboard(gameName, title = 'HIGH SCORES') {
    const Draw  = require('./draw');
    const { Color } = require('./constants');

    const scores = this.db?.getLeaderboard(gameName || this.constructor.GAME_NAME, 10) || [];

    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);

    const boxH = Math.max(scores.length + 6, 8);
    Draw.titledBox(this.screen, 20, 3, 42, boxH, title,
      Draw.BOX_DOUBLE, Color.YELLOW, Color.BLACK, Color.BRIGHT_WHITE, Color.BLACK);

    scores.forEach((entry, i) => {
      const rank  = `${i + 1}.`.padEnd(4);
      const name  = entry.username.substring(0, 15).padEnd(16);
      const score = String(entry.score).padStart(10);
      const line  = `${rank}${name}${score}`;
      const fg    = i === 0 ? Color.BRIGHT_YELLOW :
                    i === 1 ? Color.BRIGHT_WHITE   :
                    i === 2 ? Color.YELLOW          : Color.WHITE;
      this.screen.putString(22, 5 + i, line, fg, Color.BLACK);
    });

    if (scores.length === 0) {
      Draw.centerText(this.screen, 8, 'No scores yet!', Color.DARK_GRAY, Color.BLACK);
    }

    this.screen.statusBar(' Press any key to return...', Color.BLACK, Color.CYAN);
    this.screen.flush();
    await this.terminal.waitKey();
  }
}

module.exports = GameBase;
