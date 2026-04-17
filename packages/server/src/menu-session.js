'use strict';

/**
 * menu-session.js
 *
 * Per-connection menu navigation session.
 *
 * Manages a context stack so that navigating into sub-menus and games, then
 * exiting, naturally returns to the point of entry.
 *
 * ── Context stack model ────────────────────────────────────────────────────
 *
 *   Stack (bottom → top):
 *     [0] MenuContext(top)         ← always at the bottom
 *     [1] MenuContext(utils)       ← pushed when user selects a sub-menu
 *     [2] GameContext(meteoroid)   ← pushed when user selects a game
 *
 *   When a GameContext resolves (game exits): pop → back at utils menu.
 *   When a MenuContext resolves 'back': pop → back at top menu.
 *   When a MenuContext resolves 'exit': unwind entire stack → goodbye → done.
 *
 * ── Jumping ────────────────────────────────────────────────────────────────
 *   External code (e.g. a "teleconference" game) can call:
 *     session.jump(new GameContext('meteoroid', entry))
 *   which pushes a new context on top of whatever is currently running.
 *   When that context exits, the stack unwinds back to the caller's level.
 *
 *   This facility is available via MenuSession.jump() and is intentionally
 *   simple: any code that holds a reference to the running session can push
 *   contexts.  For now this is internal; a future API could expose it to
 *   GameBase via this.session.
 */

const MenuRenderer = require('./menu-renderer');

class MenuSession {
  /**
   * @param {GameRouter}  router
   * @param {Config}      config
   * @param {DB}          db
   * @param {MenuLoader}  loader
   */
  constructor(router, config, db, loader) {
    this.router   = router;
    this.config   = config;
    this.db       = db;
    this.loader   = loader;

    this._stack     = [];   // Array<MenuContext|GameContext>
    this._terminal  = null;
    this._transport = null;
    this._done      = false;
  }

  // ─── Public: main entry point ─────────────────────────────────────────────

  /**
   * Run the menu session for one connection.
   * Resolves when the user exits (or the connection drops).
   *
   * @param {Terminal} terminal
   * @param {string}   transport  'telnet'|'rlogin'|'web'
   */
  async run(terminal, transport) {
    this._terminal  = terminal;
    this._transport = transport;
    this._done      = false;

    // Load the top-level menu and push it
    let topDef;
    try {
      topDef = this.loader.loadTop(this.router.listGames());
    } catch (err) {
      console.error(`[MenuSession] Failed to load top menu: ${err.message}`);
      terminal.println('\r\nMenu system error.  Goodbye!');
      return;
    }

    this._stack = [new MenuContext(topDef)];

    // ── Main navigation loop ───────────────────────────────────────────────
    while (this._stack.length > 0 && !this._done) {
      const ctx    = this._stack[this._stack.length - 1];
      const result = await this._runContext(ctx);

      switch (result.action) {
        case 'select':
          await this._handleSelection(result.selection);
          break;

        case 'back':
          this._stack.pop();
          // If we've popped back past root, treat as exit
          if (this._stack.length === 0) {
            this._done = true;
          }
          break;

        case 'exit':
          this._done = true;
          break;

        default:
          // Unknown — treat as exit to avoid infinite loops
          console.warn(`[MenuSession] Unknown context result action: ${result.action}`);
          this._done = true;
      }
    }

    // ── Goodbye ───────────────────────────────────────────────────────────
    const renderer  = new MenuRenderer(terminal, this.loader);
    const goodbyeDef = this.loader.loadGoodbye();
    await renderer.showGoodbye(goodbyeDef);
  }

  // ─── Public: jump API ─────────────────────────────────────────────────────

  /**
   * Push an additional context onto the running stack.
   * Can be called from within a game (if the game holds a session reference)
   * to navigate to another game or menu mid-session.
   *
   * @param {MenuContext|GameContext} context
   */
  jump(context) {
    this._stack.push(context);
  }

  // ─── Context runner ───────────────────────────────────────────────────────

  /**
   * Run a single context until it produces a result.
   *
   * @param {MenuContext|GameContext} ctx
   * @returns {{ action: 'select'|'back'|'exit', selection?: Selection }}
   */
  async _runContext(ctx) {
    if (ctx instanceof GameContext) {
      return this._runGame(ctx);
    }
    return this._runMenu(ctx);
  }

  async _runMenu(ctx) {
    const renderer = new MenuRenderer(this._terminal, this.loader);
    const sel      = await renderer.present(ctx.def);

    // Handle synthetic back/exit selections from the renderer
    if (sel.target === 'back') {
      return { action: 'back' };
    }
    if (sel.target === 'exit') {
      return { action: 'exit' };
    }
    if (sel.target === 'disconnect') {
      return { action: 'exit' };
    }

    return { action: 'select', selection: sel };
  }

  async _runGame(ctx) {
    try {
      await this._launchEntry(ctx.entry);
    } catch (err) {
      console.error(`[MenuSession] Game error (${ctx.entry.name}): ${err.stack || err.message}`);
    }
    // Game exited — pop back to menu
    return { action: 'back' };
  }

  // ─── Selection handler ────────────────────────────────────────────────────

  async _handleSelection(sel) {
    switch (sel.type) {

      case 'game': {
        const entry = this.router.getGame(sel.target);
        if (!entry) {
          console.warn(`[MenuSession] Game not found: "${sel.target}"`);
          // Stay on current menu — show brief error on next render
          return;
        }
        this._stack.push(new GameContext(entry));
        break;
      }

      case 'menu': {
        let def;
        if (sel.inline) {
          // Inline nested menu definition
          def = sel.inline;
        } else {
          // External file reference
          try {
            def = this.loader.loadNested(sel.target);
          } catch (err) {
            console.error(`[MenuSession] Cannot load sub-menu "${sel.target}": ${err.message}`);
            return;
          }
        }
        this._stack.push(new MenuContext(def));
        break;
      }

      case 'action': {
        switch (sel.target) {
          case 'exit':       this._done = true; break;
          case 'disconnect': this._done = true; break;
          case 'back':
            this._stack.pop();
            if (this._stack.length === 0) this._done = true;
            break;
          default:
            console.warn(`[MenuSession] Unknown action: "${sel.target}"`);
        }
        break;
      }

      default:
        console.warn(`[MenuSession] Unknown selection type: "${sel.type}"`);
    }
  }

  // ─── Game launcher ────────────────────────────────────────────────────────

  async _launchEntry(entry) {
    const gameConfig = this.config.getGameConfig(entry.name);
    const game       = new entry.GameClass({
      terminal:  this._terminal,
      db:        this.db,
      config:    gameConfig,
      username:  this._terminal.username,
      transport: this._transport,
    });
    await game.start();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Context classes
// ═══════════════════════════════════════════════════════════════════════════

/** Represents a menu screen on the navigation stack. */
class MenuContext {
  constructor(def) {
    this.def = def;
  }
}

/** Represents a game instance on the navigation stack. */
class GameContext {
  constructor(entry) {
    this.entry = entry;
  }
}

module.exports = MenuSession;
module.exports.MenuContext = MenuContext;
module.exports.GameContext = GameContext;
