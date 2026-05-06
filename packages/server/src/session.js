'use strict';

/**
 * packages/server/src/session.js
 *
 * Transport-agnostic session setup.
 *
 * Handles everything that happens after a raw connection is established
 * and a Terminal exists, but before the game router takes over:
 *
 *   - naive mode:        prompt for username, trust the answer
 *   - authenticated mode: run the full SynthAuth entry flow
 *
 * Both TelnetTransport and WebSocketTransport call runSession() identically.
 * Neither transport needs to know anything about auth modes.
 *
 * rlogin has its own more complex auth routing (silent BBS login, recovery
 * codes, ServerUser game routing) and does not use this module.
 *
 * Re-login loop
 * ─────────────
 * When the user hits N on the goodbye "Disconnect? [Y/N]" prompt, the menu
 * session returns { action: 'relogin' }.  session.js catches this and loops
 * back to the top — redisplaying the login art and re-running auth — without
 * dropping the connection.  A 'disconnect' result (or any direct-game launch
 * that returns nothing) falls through to logoff as normal.
 */

const path = require('path');
const { runEntryFlow, displayLoginArt } = require('./auth-flow');
const { isSysopAllowed } = require('./reserved');
const { getLogger } = require('./logger');

async function runSession({ terminal, output, filtered, authMode, transport, ipAddress, router, config, registry, disconnect }) {

  const projectRoot = path.resolve(__dirname, '..', '..', '..');

  // ── Re-login loop ─────────────────────────────────────────────────────────
  // Iterates when the user chooses N on the goodbye disconnect prompt.
  // Always executes at least once.
  let relogin = true;

  while (relogin) {
    relogin = false; // reset; set to true again only on explicit relogin signal

    // Display optional pre-login art (no-op if login_art_file not set or missing)
    await displayLoginArt(terminal, config, projectRoot);

    let username;

    if (authMode === 'authenticated') {
      let result;
      try {
        result = await runEntryFlow(terminal, ipAddress);
      } catch (err) {
        throw err;
      }

      if (!result || !result.success) {
        return; // auth failed — disconnect
      }

      username = result.username;
      terminal.username = username;

    } else {
      const { readLineEchoed } = require('./transports/telnet-filter');

      output.write('\r\nSynthDoor BBS\r\nUsername: ');
      const raw = await readLineEchoed(filtered, output);
      username  = raw.trim() || 'guest';
      output.write('\r\n');

      if (!isSysopAllowed(username, config)) {
        getLogger().warn(`[Session] Blocked reserved username attempt: "${username}" from ${ipAddress || 'unknown'}`);
        output.write('\r\nThat username is not available.\r\n\r\n');
        return;
      }

      terminal.username = username;
    }

    // ── Register with session registry ──────────────────────────────────────
    let sessionId = null;
    if (registry) {
      sessionId = registry.add({
        username,
        transport,
        ipAddress,
        disconnect: disconnect || (() => {}),
      });
    }

    getLogger().info(`[Session] LOGIN username=${username} transport=${transport} ip=${ipAddress || 'unknown'}`);
    try { router.db.incrementLoginCount(username); } catch (_) {}

    let routeResult;
    try {
      routeResult = await router.route(terminal, null, transport, sessionId);
    } finally {
      getLogger().info(`[Session] LOGOFF username=${username} transport=${transport}`);
      if (registry && sessionId) {
        registry.remove(sessionId);
      }
    }

    // Check whether the goodbye prompt asked to restart the login flow
    if (routeResult && routeResult.action === 'relogin') {
      // Clear the goodbye screen (title bar, art, status bar) completely
      // before re-entering the login flow so the user sees a clean slate.
      terminal.reset();
      relogin = true;
    }
  }
}

module.exports = { runSession };
