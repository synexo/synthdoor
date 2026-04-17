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

class GameRouter {
  /**
   * @param {Config} config
   * @param {DB}     db
   * @param {string} gamesDir   Absolute path to the games/ directory.
   * @param {string} [menusDir] Absolute path to config/menus/.
   *                            Defaults to <project-root>/config/menus.
   */
  constructor(config, db, gamesDir, menusDir) {
    this.config   = config;
    this.db       = db;
    this.gamesDir = gamesDir;

    // Menus directory: allow override via config or constructor arg
    this.menusDir = menusDir
      || config.get('menus_dir', null)
      || path.resolve(gamesDir, '..', 'config', 'menus');

    this._games  = new Map(); // name → { name, title, GameClass, dir }
    this._loader = new MenuLoader(this.menusDir);
  }

  // ─── Game discovery ────────────────────────────────────────────────────────

  /** Scan games/ directory and register all valid games. */
  discover() {
    if (!fs.existsSync(this.gamesDir)) {
      console.warn(`[Router] Games directory not found: ${this.gamesDir}`);
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

        this._games.set(name, { name, title, GameClass, dir });
        console.log(`[Router] Registered game: ${name} (${title})`);
      } catch (err) {
        console.warn(`[Router] Failed to load game ${dir}: ${err.message}`);
      }
    }
  }

  /** Get a registered game by name. */
  getGame(name) {
    return this._games.get(name) || null;
  }

  /** Return all registered games as an array. */
  listGames() {
    return Array.from(this._games.values());
  }

  // ─── Main routing entry point ──────────────────────────────────────────────

  /**
   * Route a connection to the appropriate destination.
   *
   * @param {Terminal} terminal
   * @param {string|null} requestedGame  Game name, or null for menu/default.
   * @param {string}      transport      'telnet'|'rlogin'|'web'
   */
  async route(terminal, requestedGame, transport) {

    // ── Direct launch: explicit game requested (e.g. rlogin ServerUser) ──
    if (requestedGame) {
      const entry = this.getGame(requestedGame);
      if (!entry) {
        terminal.println(`\r\nUnknown game: ${requestedGame}`);
        terminal.println('Available: ' + this.listGames().map(g => g.name).join(', '));
        terminal.println('Disconnecting.');
        return;
      }
      await this._launchGame(terminal, entry, transport);
      return; // transport destroys socket
    }

    // ── Direct launch: default_game in config ─────────────────────────────
    const defaultGame = this.config.get('default_game', '').trim();
    if (defaultGame) {
      const entry = this.getGame(defaultGame);
      if (entry) {
        await this._launchGame(terminal, entry, transport);
        return; // transport destroys socket
      }
      console.warn(`[Router] default_game "${defaultGame}" not found — falling through to menu`);
    }

    // ── No games at all ───────────────────────────────────────────────────
    if (this._games.size === 0) {
      terminal.println('\r\nNo games are installed.  Goodbye!');
      return;
    }

    // ── Menu session ──────────────────────────────────────────────────────
    const session = new MenuSession(this, this.config, this.db, this._loader);
    await session.run(terminal, transport);
    // session.run() resolves when the user exits; transport destroys socket
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Instantiate and start a single game, then return.
   * Used for direct-launch paths where there is no menu loop.
   */
  async _launchGame(terminal, entry, transport) {
    const gameConfig = this.config.getGameConfig(entry.name);
    const game = new entry.GameClass({
      terminal,
      db:        this.db,
      config:    gameConfig,
      username:  terminal.username,
      transport,
    });
    await game.start();
  }
}

module.exports = GameRouter;
