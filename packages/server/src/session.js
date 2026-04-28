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
 */

const path = require('path');
const { runEntryFlow } = require('./auth-flow');
const { isSysopAllowed } = require('./reserved');
const { getLogger } = require('./logger');

async function runSession({ terminal, output, filtered, authMode, transport, ipAddress, router, config, registry, disconnect }) {
  let username;

  if (authMode === 'authenticated') {
    let result;
    try {
      result = await runEntryFlow(terminal, ipAddress);
    } catch (err) {
      throw err;
    }

    if (!result || !result.success) {
      return;
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

  // ── Register with session registry ───────────────────────────────────────
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

  try {
    await router.route(terminal, null, transport, sessionId);
  } finally {
    getLogger().info(`[Session] LOGOFF username=${username} transport=${transport}`);
    if (registry && sessionId) {
      registry.remove(sessionId);
    }
  }
}

module.exports = { runSession };
