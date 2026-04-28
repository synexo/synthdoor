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
const { getRole, getRoleMenuName } = require('./roles');
const { getLogger } = require('./logger');

class MenuSession {
  /**
   * @param {GameRouter}  router
   * @param {Config}      config
   * @param {DB}          db
   * @param {MenuLoader}  loader
   * @param {string}      authMode  'naive' | 'authenticated'
   */
  constructor(router, config, db, loader, authMode, registry, sessionId) {
    this.router    = router;
    this.config    = config;
    this.db        = db;
    this.loader    = loader;
    this.authMode  = authMode  || 'naive';
    this.registry  = registry  || null;
    this.sessionId = sessionId || null;

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

    const username = terminal.username;
    const role     = getRole(username, this.config, this.db, this.authMode);
    const roleName = getRoleMenuName(role);
    getLogger().info(`[MenuSession] username=${username} authMode=${this.authMode} role=${role} roleMenu=${roleName || 'none'}`);

    // ── Load role menu (if any) ────────────────────────────────────────────
    let roleDef = null;
    if (roleName) {
      try {
        roleDef = this.loader.load(roleName);
      } catch (err) {
        getLogger().warn(`[MenuSession] Role menu "${roleName}" not found for role "${role}" (username: ${username}): ${err.message}`);
      }
    }

    // ── Load the top-level menu ────────────────────────────────────────────
    let topDef;
    try {
      topDef = this.loader.loadTop(this.router.listPublicGames(), this.router.listGames());
    } catch (err) {
      getLogger().error(`[MenuSession] Failed to load top menu: ${err.message}`);
      terminal.println('\r\nMenu system error.  Goodbye!');
      return;
    }

    // ── Build initial stack ────────────────────────────────────────────────
    // Stack is popped from the end, so the role menu must be on top (last).
    // When the user selects "Continue", the role menu pops and the top menu
    // is revealed beneath it. On exit from the top menu, the role menu is
    // re-pushed for the pre-logoff pass.
    if (roleDef) {
      this._stack = [new MenuContext(topDef), new RoleMenuContext(roleDef)];
    } else {
      this._stack = [new MenuContext(topDef)];
    }

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
          // On exit from top menu, show role menu one final time (pre-logoff)
          if (roleDef) {
            this._stack = [new RoleMenuContext(roleDef)];
            this._done  = false;
          } else {
            this._done = true;
          }
          break;

        case 'role_exit':
          // Role menu explicitly dismissed — actually exit now
          this._done = true;
          break;

        default:
          getLogger().warn(`[MenuSession] Unknown context result action: ${result.action}`);
          this._done = true;
      }
    }

    // ── Goodbye ───────────────────────────────────────────────────────────
    const renderer   = new MenuRenderer(terminal, this.loader);
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
      // If this is the role menu (pre-logoff pass), signal true exit
      if (ctx instanceof RoleMenuContext) {
        return { action: 'role_exit' };
      }
      return { action: 'exit' };
    }
    if (sel.target === 'disconnect') {
      return { action: 'role_exit' };
    }

    return { action: 'select', selection: sel };
  }

  async _runGame(ctx) {
    try {
      await this._launchEntry(ctx.entry);
    } catch (err) {
      getLogger().error(`[MenuSession] Game error (${ctx.entry.name}): ${err.stack || err.message}`);
    }
    return { action: 'back' };
  }

  async _handleSelection(sel) {
    switch (sel.type) {

      case 'game': {
        const entry = this.router.getGame(sel.target);
        if (!entry) {
          getLogger().warn(`[MenuSession] Game not found: "${sel.target}"`);
          return;
        }
        this._stack.push(new GameContext(entry));
        break;
      }

      case 'menu': {
        let def;
        if (sel.inline) {
          def = sel.inline;
        } else {
          try {
            def = this.loader.loadNested(sel.target);
          } catch (err) {
            getLogger().error(`[MenuSession] Cannot load sub-menu "${sel.target}": ${err.message}`);
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
            getLogger().warn(`[MenuSession] Unknown action: "${sel.target}"`);
        }
        break;
      }

      default:
        getLogger().warn(`[MenuSession] Unknown selection type: "${sel.type}"`);
    }
  }

  async _launchEntry(entry) {
    const username  = this._terminal.username;
    const gameName  = entry.name;
    const startedAt = Date.now();

    // ── Role access check ────────────────────────────────────────────────
    const requiredRole = this.router.getRequiredRole(gameName);
    if (requiredRole) {
      const { getRole } = require('./roles');
      const userRole = getRole(username, this.config, this.db, this.authMode);
      if (userRole !== requiredRole) {
        getLogger().warn(`[MenuSession] ACCESS DENIED game=${gameName} username=${username} role=${userRole} required=${requiredRole}`);
        return;
      }
    }

    // Update registry location
    if (this.sessionId && this.registry) {
      this.registry.setLocation(this.sessionId, gameName);
    }

    getLogger().info(`[Game] ENTER username=${username} game=${gameName} transport=${this._transport}`);
    try { this.db.incrementGamePlayCount(gameName); } catch (_) {}

    const gameConfig     = this.config.getGameConfig(gameName);
    const enrichedConfig = Object.assign({}, gameConfig, {
      authMode:    this.authMode,
      sysop_users: this.config.get('sysop_users', 'sysop'),
      _router:     this.router,
      _registry:   this.registry,
    });

    const game = new entry.GameClass({
      terminal:  this._terminal,
      db:        this.db,
      config:    enrichedConfig,
      username,
      transport: this._transport,
    });

    try {
      await game.start();
    } finally {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      getLogger().info(`[Game] EXIT username=${username} game=${gameName} duration=${durationSec}s`);
      try { this.db.recordGameSession(gameName, durationSec); } catch (_) {}

      if (this.sessionId && this.registry) {
        this.registry.setLocation(this.sessionId, 'menu');
      }
    }
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

/** Represents the role-specific menu layer (shown before/after top menu). */
class RoleMenuContext extends MenuContext {
  constructor(def) {
    super(def);
  }
}

/** Represents a game instance on the navigation stack. */
class GameContext {
  constructor(entry) {
    this.entry = entry;
  }
}

module.exports = MenuSession;
module.exports.MenuContext     = MenuContext;
module.exports.RoleMenuContext = RoleMenuContext;
module.exports.GameContext     = GameContext;
