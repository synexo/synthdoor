'use strict';

/**
 * game-router.js
 * Discovers available games and routes connections.
 *
 * ── Routing priority ───────────────────────────────────────────────────────
 *
 *  1. requestedGame non-null (rlogin ServerUser game, or any direct-launch)
 *     → Launch that game directly, exit/disconnect when done.
 *       No menu loop.  Preserves existing direct-launch behaviour exactly.
 *
 *  2. default_game set in synthdoor.conf
 *     → Launch that game directly, exit/disconnect when done.
 *       No menu loop.
 *
 *  3. Neither of the above
 *     → Start a MenuSession.  The session renders the menu, runs games, and
 *       returns to the menu after each game exits.  Only disconnects after
 *       the user explicitly chooses Goodbye/Exit, or the connection drops.
 *
 * ── Menu system ────────────────────────────────────────────────────────────
 *   Menu definitions live in config/menus/ as YAML files.  See docs/MENU.md.
 *   MenuLoader auto-generates config/menus/top.yaml from discovered games on
 *   first run if the file does not exist.
 *
 * ── Game discovery ─────────────────────────────────────────────────────────
 *   Scans the games/ directory for subdirectories containing src/index.js.
 *   Each game must export a class extending GameBase with a static GAME_NAME.
 */

const fs   = require('fs');
const path = require('path');

const { Terminal, Screen, Draw, Color } = require(
  path.join(__dirname, '..', '..', 'engine', 'src', 'index.js')
);
const MenuLoader  = require('./menu-loader');
const MenuSession = require('./menu-session');
const { getLogger } = require('./logger');

class GameRouter {
  constructor(config, db, gamesDir, menusDir, logger, authMode, registry) {
    this.config   = config;
    this.db       = db;
    this.gamesDir = gamesDir;
    this.authMode = authMode || 'naive';
    this.registry = registry || null;
    this._log     = logger || { info: console.log, warn: console.warn, error: console.error };

    this.menusDir = menusDir
      || config.get('menus_dir', null)
      || path.resolve(gamesDir, '..', 'config', 'menus');

    this._games     = new Map();
    this._loader    = new MenuLoader(this.menusDir);
    this._gameRoles = this._parseGameRoles();
  }

  /**
   * Parse game_roles config into a Map of gameName → requiredRole.
   * Format: "sysop-panel:sysop, other-game:sysop"
   */
  _parseGameRoles() {
    const raw = this.config.get('game_roles', '');
    const map = new Map();
    if (!raw.trim()) return map;
    for (const entry of raw.split(',')) {
      const [game, role] = entry.trim().split(':').map(s => s.trim());
      if (game && role) map.set(game, role);
    }
    return map;
  }

  /**
   * Return the required role for a game, or null if unrestricted.
   * @param {string} gameName
   * @returns {string|null}
   */
  getRequiredRole(gameName) {
    return this._gameRoles.get(gameName) || null;
  }

  /**
   * Return only the games that should appear in menus (no role restriction).
   * Used by the menu loader for auto-generation and top-menu filtering.
   */
  listPublicGames() {
    return this.listGames().filter(g => !this._gameRoles.has(g.name));
  }

  // ─── Game discovery ────────────────────────────────────────────────────────

  discover() {
    if (!fs.existsSync(this.gamesDir)) {
      this._log.warn(`[Router] Games directory not found: ${this.gamesDir}`);
      return;
    }

    const dirs = fs.readdirSync(this.gamesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      const entryPath = path.join(this.gamesDir, dir, 'src', 'index.js');
      if (!fs.existsSync(entryPath)) continue;

      try {
        const GameClass = require(entryPath);
        const name      = GameClass.GAME_NAME  || dir;
        const title     = GameClass.GAME_TITLE || name;

        this._games.set(name, { name, title, GameClass, dir, entryPath });
        this._log.info(`[Router] Registered game: ${name} (${title})`);
      } catch (err) {
        this._log.warn(`[Router] Failed to load game ${dir}: ${err.message}`);
      }
    }
  }

  /**
   * Reload a single game by name: purge its cache, re-require, re-register.
   * Returns true on success, false if the game directory or entry is not found.
   */
  reloadGame(name) {
    const entry = this._games.get(name);
    const dir   = entry ? entry.dir : name;
    const entryPath = path.join(this.gamesDir, dir, 'src', 'index.js');

    if (!fs.existsSync(entryPath)) {
      this._log.warn(`[Router] reloadGame: entry not found for "${name}" at ${entryPath}`);
      return false;
    }

    // Purge this game's module cache
    this._purgeCache(entryPath);
    this._games.delete(name);
    this._loader.clearCache();

    // Re-require and re-register
    try {
      const GameClass = require(entryPath);
      const newName   = GameClass.GAME_NAME  || dir;
      const title     = GameClass.GAME_TITLE || newName;
      this._games.set(newName, { name: newName, title, GameClass, dir, entryPath });
      this._log.info(`[Router] Reloaded game: ${newName} (${title})`);
      return true;
    } catch (err) {
      this._log.warn(`[Router] Failed to reload game "${name}": ${err.message}`);
      return false;
    }
  }

  /**
   * Hot-reload: purge require cache for all game modules, clear the map,
   * and re-discover. Handles add, modify, and delete uniformly.
   * Any player currently in a game will be mid-session on the old code —
   * this is intentional and accepted as the "blunt tool" policy.
   */
  rediscover() {
    this._log.info('[Router] Rediscovering games...');

    // Purge require cache for all known game entry paths and their local deps
    for (const entry of this._games.values()) {
      this._purgeCache(entry.entryPath);
    }

    // Also scan the games directory for any stale cache entries from
    // games that may have been added/removed since last discover
    if (fs.existsSync(this.gamesDir)) {
      const dirs = fs.readdirSync(this.gamesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      for (const dir of dirs) {
        const entryPath = path.join(this.gamesDir, dir, 'src', 'index.js');
        this._purgeCache(entryPath);
      }
    }

    this._games.clear();
    this._loader.clearCache();
    this.discover();
    this._gameRoles = this._parseGameRoles();
    this._log.info(`[Router] Rediscovery complete. ${this._games.size} game(s) registered.`);
  }

  /**
   * Recursively purge a module and all its local (non-node_modules) children
   * from the require cache.
   */
  _purgeCache(entryPath) {
    const resolved = this._safeResolve(entryPath);
    if (!resolved) return;
    this._purgeModule(resolved, new Set());
  }

  _purgeModule(filePath, visited) {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const mod = require.cache[filePath];
    if (!mod) return;

    // Recurse into local children only (skip node_modules)
    for (const child of mod.children || []) {
      if (!child.filename.includes('node_modules')) {
        this._purgeModule(child.filename, visited);
      }
    }

    delete require.cache[filePath];
  }

  _safeResolve(p) {
    try { return require.resolve(p); } catch (_) { return null; }
  }

  getGame(name) {
    return this._games.get(name) || null;
  }

  listGames() {
    return Array.from(this._games.values());
  }

  // ─── Main routing entry point ──────────────────────────────────────────────

  async route(terminal, requestedGame, transport, sessionId) {
    // Direct launch: explicit game requested
    if (requestedGame) {
      const entry = this.getGame(requestedGame);
      if (!entry) {
        terminal.println(`\r\nUnknown game: ${requestedGame}`);
        terminal.println('Available: ' + this.listGames().map(g => g.name).join(', '));
        terminal.println('Disconnecting.');
        return;
      }
      await this._launchGame(terminal, entry, transport, sessionId);
      return;
    }

    // Direct launch: default_game in config
    const defaultGame = this.config.get('default_game', '').trim();
    if (defaultGame) {
      const entry = this.getGame(defaultGame);
      if (entry) {
        await this._launchGame(terminal, entry, transport, sessionId);
        return;
      }
      this._log.warn(`[Router] default_game "${defaultGame}" not found — falling through to menu`);
    }

    if (this._games.size === 0) {
      terminal.println('\r\nNo games are installed.  Goodbye!');
      return;
    }

    // Menu session
    const session = new MenuSession(this, this.config, this.db, this._loader, this.authMode, this.registry, sessionId);
    await session.run(terminal, transport);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  async _launchGame(terminal, entry, transport, sessionId) {
    const username = terminal.username;
    const gameName = entry.name;
    const startedAt = Date.now();

    // Update registry location
    if (sessionId && this.registry) {
      this.registry.setLocation(sessionId, gameName);
    }

    // Structured log + DB play count
    getLogger().info(`[Game] ENTER username=${username} game=${gameName} transport=${transport}`);
    try { this.db.incrementGamePlayCount(gameName); } catch (_) {}

    const gameConfig = this.config.getGameConfig(gameName);
    const enrichedConfig = Object.assign({}, gameConfig, {
      authMode:    this.authMode,
      sysop_users: this.config.get('sysop_users', 'sysop'),
      _router:     this,
      _registry:   this.registry,
    });

    const game = new entry.GameClass({
      terminal,
      db:        this.db,
      config:    enrichedConfig,
      username,
      transport,
    });

    try {
      await game.start();
    } finally {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);

      // Structured log + DB session average
      getLogger().info(`[Game] EXIT username=${username} game=${gameName} duration=${durationSec}s`);
      try { this.db.recordGameSession(gameName, durationSec); } catch (_) {}

      // Restore registry location to menu
      if (sessionId && this.registry) {
        this.registry.setLocation(sessionId, 'menu');
      }
    }
  }
}

module.exports = GameRouter;
