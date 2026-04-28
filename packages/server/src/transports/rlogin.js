'use strict';

/**
 * transports/rlogin.js
 * rlogin transport (RFC 1282) — overhauled for SynthAuth integration.
 *
 * Connection handshake (per RFC):
 *   Client sends: \0 <ClientUser> \0 <ServerUser> \0 <TermType/Speed> \0
 *   Server sends: \0  (acknowledgment)
 *
 * ─── Naive mode ───────────────────────────────────────────────────────────
 *   ClientUser : Username (trusted as-is)
 *   ServerUser : If a valid game name → launch that game; else → game selection
 *   TermType   : Ignored
 *
 *   Examples:
 *     "Alice" "Alice"     "ANSI" → game selection for user Alice
 *     "Alice" "meteoroid" "ANSI" → launch meteoroid for user Alice
 *
 * ─── Authenticated mode ───────────────────────────────────────────────────
 *   ClientUser : Username (used for auth derivation)
 *   ServerUser : • Valid recovery code (XXXX-XXXX format) → silent BBS auto-login/register,
 *                  then launch game from TermType (if valid), else game selection
 *                • Valid game name → interactive auth, then launch that game
 *                • Anything else  → interactive auth, then game from TermType or selection
 *   TermType   : If a valid game name → game to launch (overridden by ServerUser game)
 *
 *   NOTE: If both ServerUser and TermType contain valid game names,
 *         ServerUser takes precedence.
 *
 *   Examples:
 *     "Alice" "Alice"     "ANSI"     → auth flow, then game selection
 *     "Alice" "meteoroid" "ANSI"     → auth flow, then launch meteoroid
 *     "Alice" "Y2Z1-X53H" "ANSI"    → silent login, then game selection
 *     "Alice" "Y2Z1-X53H" "meteoroid" → silent login, then launch meteoroid
 */

const netModule    = require('net');
const pathModule   = require('path');
const { Terminal } = require(pathModule.join(__dirname, '..', '..', '..', 'engine', 'src', 'index.js'));
const {
  runSilentBBSLogin,
  runInteractiveLogin,
} = require('../auth-flow');
const { getLogger } = require('../logger');
const { isSysopAllowed } = require('../reserved');

const { RECOVERY_CODE_RE } = require(pathModule.join(__dirname, '..', '..', '..', 'synth-auth', 'index.js'));

class RloginTransport {
  /**
   * @param {Config}     config
   * @param {DB}         db
   * @param {GameRouter} router
   * @param {string}     authMode  'naive' | 'authenticated'
   */
  constructor(config, db, router, authMode, registry) {
    this.config   = config;
    this.db       = db;
    this.router   = router;
    this.authMode = authMode || 'naive';
    this.registry = registry || null;
    this._server  = null;
  }

  listen(port) {
    this._server = netModule.createServer((socket) => {
      this._handleConnection(socket).catch(err => {
        getLogger().error('[rlogin] Unhandled error:', err.message);
        socket.destroy();
      });
    });
    this._server.listen(port);
    return this;
  }

  close() {
    this._server?.close();
  }

  async _handleConnection(socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);

    const handshake = await readRloginHandshake(socket);
    if (!handshake) {
      socket.destroy();
      return;
    }

    // Acknowledge
    socket.write(Buffer.from([0]));

    const { clientUser, serverUser, termType } = handshake;
    const ipAddress = socket.remoteAddress || null;

    const terminal = new Terminal({
      output:    socket,
      input:     socket,
      username:  'unknown',
      transport: 'rlogin',
    });

    if (this.authMode === 'naive') {
      await this._handleNaive(terminal, socket, clientUser, serverUser, ipAddress);
    } else {
      await this._handleAuthenticated(terminal, socket, clientUser, serverUser, termType, ipAddress);
    }
  }

  // ─── Naive mode ──────────────────────────────────────────────────────────

  async _handleNaive(terminal, socket, clientUser, serverUser, ipAddress) {
    const username = (clientUser || 'guest').trim() || 'guest';

    if (!isSysopAllowed(username, this.config)) {
      getLogger().warn(`[rlogin/naive] Blocked reserved username attempt: "${username}" from ${ipAddress || 'unknown'}`);
      socket.destroy();
      return;
    }

    terminal.username = username;
    const gameName = this._resolveGame(serverUser);

    const sessionId = this.registry ? this.registry.add({
      username,
      transport:  'rlogin',
      ipAddress,
      disconnect: () => socket.destroy(),
    }) : null;

    getLogger().info(`[Session] LOGIN username=${username} transport=rlogin ip=${ipAddress || 'unknown'}`);
    try { this.router.db.incrementLoginCount(username); } catch (_) {}

    try {
      await this.router.route(terminal, gameName, 'rlogin', sessionId);
    } catch (err) {
      getLogger().error(`[rlogin/naive] Error for ${username}:`, err.message);
    } finally {
      getLogger().info(`[Session] LOGOFF username=${username} transport=rlogin`);
      if (this.registry && sessionId) this.registry.remove(sessionId);
      socket.destroy();
    }
  }

  // ─── Authenticated mode ───────────────────────────────────────────────────

  async _handleAuthenticated(terminal, socket, clientUser, serverUser, termType, ipAddress) {
    const rawUsername = (clientUser || '').trim();

    // Determine whether ServerUser is a recovery code, a game name, or neither
    const serverUserIsRecoveryCode = RECOVERY_CODE_RE.test((serverUser || '').trim());
    const serverUserGame           = !serverUserIsRecoveryCode
      ? this._resolveGame(serverUser)
      : null;
    const termTypeGame             = this._resolveGame(termType);

    // Game precedence: ServerUser game > TermType game
    let gameName = serverUserGame || termTypeGame || null;

    let authResult;

    if (serverUserIsRecoveryCode) {
      // ── Silent BBS path: auto-register/login, no prompts ─────────────────
      getLogger().info(`[rlogin/auth] BBS recovery code from ${ipAddress} for user "${rawUsername}"`);

      authResult = await runSilentBBSLogin(
        rawUsername,
        serverUser.trim(),
        ipAddress
      );

      if (!authResult || !authResult.success) {
        getLogger().info(`[rlogin/auth] Silent BBS login failed for "${rawUsername}" from ${ipAddress}`);
        socket.destroy();
        return;
      }

      // For BBS silent path, show minimal info per spec:
      //   "Your identity has been created. Others will see you as: Alice-r7Kx2M"
      //   "Welcome, Alice-r7Kx2M!"
      // Only on first registration (action === 'register')
      if (authResult.action === 'register') {
        terminal.println('');
        terminal.println(`Your identity has been created. Others will see you as: ${authResult.publicId}`);
        terminal.println('');
        terminal.println(`Welcome, ${authResult.publicId}!`);
        terminal.println('');
        terminal.println('Hit any key to continue.');
        await terminal.waitKey();
      }

    } else {
      // ── Interactive auth ──────────────────────────────────────────────────
      // If ServerUser is a known game, the user still needs to auth before playing.
      getLogger().info(`[rlogin/auth] Interactive auth from ${ipAddress} for user "${rawUsername}"`);

      authResult = await runInteractiveLogin(terminal, rawUsername, ipAddress);

      if (!authResult || !authResult.success) {
        getLogger().info(`[rlogin/auth] Interactive login failed for "${rawUsername}" from ${ipAddress}`);
        socket.destroy();
        return;
      }
    }

    const username = authResult.username;  // PublicID
    terminal.username = username;

    const sessionId = this.registry ? this.registry.add({
      username,
      transport:  'rlogin',
      ipAddress,
      disconnect: () => socket.destroy(),
    }) : null;

    getLogger().info(`[Session] LOGIN username=${username} transport=rlogin ip=${ipAddress || 'unknown'}`);
    try { this.router.db.incrementLoginCount(username); } catch (_) {}

    try {
      await this.router.route(terminal, gameName, 'rlogin', sessionId);
    } catch (err) {
      getLogger().error(`[rlogin/auth] Error for ${username}:`, err.message);
    } finally {
      getLogger().info(`[Session] LOGOFF username=${username} transport=rlogin`);
      if (this.registry && sessionId) this.registry.remove(sessionId);
      socket.destroy();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Resolve a string to a game name if it matches a registered game.
   * Strips any trailing "/speed" component (e.g. "meteoroid/9600" → "meteoroid").
   * Returns the game name (string) if valid, or null.
   *
   * @param {string|undefined} candidate
   * @returns {string|null}
   */
  _resolveGame(candidate) {
    if (!candidate || !candidate.trim()) return null;
    // Strip optional speed suffix: "meteoroid/9600" → "meteoroid"
    const name  = candidate.trim().toLowerCase().split('/')[0].trim();
    if (!name) return null;
    const entry = this.router.getGame(name);
    return entry ? entry.name : null;
  }
}

// ─── rlogin handshake reader ──────────────────────────────────────────────
function readRloginHandshake(socket) {
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0);

    const timeout = setTimeout(() => {
      socket.removeListener('data', handler);
      resolve(null);
    }, 5000);

    const handler = (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      // Find four null terminators
      const nulls = [];
      for (let i = 0; i < buf.length && nulls.length < 4; i++) {
        if (buf[i] === 0) nulls.push(i);
      }

      if (nulls.length >= 4) {
        clearTimeout(timeout);
        socket.removeListener('data', handler);

        const clientUser = buf.slice(nulls[0] + 1, nulls[1]).toString('ascii');
        const serverUser = buf.slice(nulls[1] + 1, nulls[2]).toString('ascii');
        const termType   = buf.slice(nulls[2] + 1, nulls[3]).toString('ascii');
        resolve({ clientUser, serverUser, termType });
      }
    };

    socket.on('data', handler);
  });
}

module.exports = RloginTransport;
