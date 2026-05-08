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
 *   ClientUser : Username (validated as alphanumeric 1..13 chars, then trusted)
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
 *
 * ─── Handshake hardening ──────────────────────────────────────────────────
 * RFC 1282 prescribes four NUL-delimited fields and nothing more. A peer
 * that connects and never sends NULs would, with an unbounded reader, grow
 * the receive buffer to memory exhaustion. readRloginHandshake() caps the
 * accumulated buffer at HANDSHAKE_MAX bytes and rejects the connection if
 * exceeded. The 5-second timeout remains as the second line of defence.
 */

const netModule    = require('net');
const pathModule   = require('path');
const { Terminal } = require(pathModule.join(__dirname, '..', '..', '..', 'engine', 'src', 'index.js'));
const {
  runSilentBBSLogin,
  runInteractiveLogin,
} = require('../auth-flow');
const { getLogger } = require('../logger');
const { isSysopAllowed, isValidNaiveUsername, NAIVE_MAX_USERNAME_LEN } = require('../reserved');

const { RECOVERY_CODE_RE } = require(pathModule.join(__dirname, '..', '..', '..', 'synth-auth', 'index.js'));

// Handshake buffer cap. The four fields together fit comfortably below 1 KiB
// in any legitimate rlogin handshake; 4 KiB gives room for unusual termtypes
// and stays well below any session memory budget.
const HANDSHAKE_MAX = 4 * 1024;

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
    // Default to 'guest' for empty clientUser, matching the previous behaviour.
    const candidate = (clientUser || 'guest').trim() || 'guest';

    // Structural validation. Unlike telnet's interactive prompt, rlogin's
    // handshake is single-shot — there is no retry. Reject and disconnect.
    if (!isValidNaiveUsername(candidate)) {
      getLogger().warn(`[rlogin/naive] Rejected invalid username "${candidate}" from ${ipAddress || 'unknown'} (must be 1-${NAIVE_MAX_USERNAME_LEN} alphanumerics)`);
      socket.destroy();
      return;
    }

    const username = candidate;

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
//
// Reads bytes from `socket` until four NULs have been seen, then parses the
// three intervening fields (clientUser, serverUser, termType). Resolves to
// null on:
//   • 5-second timeout without all four NULs
//   • accumulated buffer exceeding HANDSHAKE_MAX bytes (peer abuse)
//   • the socket emitting an error or closing early
//
// The 'data' handler is removed in every termination path so the listener
// is never left dangling on the socket.
function readRloginHandshake(socket) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      socket.removeListener('data',  handler);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      getLogger().info(`[rlogin] handshake timeout from ${socket.remoteAddress || 'unknown'}`);
      finish(null);
    }, 5000);

    const onError = (err) => {
      getLogger().info(`[rlogin] handshake socket error from ${socket.remoteAddress || 'unknown'}: ${err.message}`);
      finish(null);
    };

    const onClose = () => {
      finish(null);
    };

    const handler = (chunk) => {
      // Bound the receive buffer. RFC 1282 handshakes are tiny — 4 KiB is
      // far more than any legitimate client sends.
      if (total + chunk.length > HANDSHAKE_MAX) {
        getLogger().warn(`[rlogin] handshake oversize from ${socket.remoteAddress || 'unknown'} (>${HANDSHAKE_MAX} bytes) — closing`);
        finish(null);
        return;
      }
      chunks.push(chunk);
      total += chunk.length;

      // Search across the concatenated bytes for four NULs. We do the search
      // on the latest snapshot rather than per-chunk so a NUL split across
      // two chunks is found correctly. The cost is O(total) per chunk, which
      // is fine for a 4 KiB cap.
      const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);

      const nulls = [];
      for (let i = 0; i < buf.length && nulls.length < 4; i++) {
        if (buf[i] === 0) nulls.push(i);
      }

      if (nulls.length >= 4) {
        const clientUser = buf.slice(nulls[0] + 1, nulls[1]).toString('ascii');
        const serverUser = buf.slice(nulls[1] + 1, nulls[2]).toString('ascii');
        const termType   = buf.slice(nulls[2] + 1, nulls[3]).toString('ascii');
        finish({ clientUser, serverUser, termType });
      }
    };

    socket.on('data',  handler);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

module.exports = RloginTransport;
