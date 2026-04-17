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

/**
 * Run the auth/session setup for a connected terminal, then route to a game.
 *
 * @param {object} opts
 * @param {import('../../engine/src/terminal')} opts.terminal
 *   Terminal instance wrapping the connection. username will be set here.
 * @param {object}      opts.output
 *   Raw writable used for the naive-mode username echo prompt.
 *   (For telnet: the net.Socket. For WebSocket: the WsWritable adapter.)
 * @param {Transform}   opts.filtered
 *   TelnetFilterStream providing clean input bytes.
 * @param {string}      opts.authMode   'naive' | 'authenticated'
 * @param {string}      opts.transport  'telnet' | 'web'
 * @param {string|null} opts.ipAddress  Remote IP for auth logging/rate-limiting.
 * @param {GameRouter}  opts.router
 * @returns {Promise<void>}  Resolves when the session ends (game exited / disconnected).
 */
async function runSession({ terminal, output, filtered, authMode, transport, ipAddress, router }) {
  let username;

  if (authMode === 'authenticated') {
    // ── Authenticated mode: full SynthAuth entry flow ─────────────────────
    // terminal.username is set to PublicID on success.
    let result;
    try {
      result = await runEntryFlow(terminal, ipAddress);
    } catch (err) {
      // Auth flow threw (disconnected mid-flow, crypto error, etc.)
      throw err;
    }

    if (!result || !result.success) {
      // Flow completed but auth failed (too many attempts, user quit, etc.)
      // Return normally — caller will destroy the connection.
      return;
    }

    username = result.username; // PublicID
    terminal.username = username;

  } else {
    // ── Naive mode: server-echoed username prompt, trust whatever is typed ─
    // Inline require to avoid a circular dependency if auth-flow ever imports
    // session in the future; also keeps the naive path self-contained here.
    const { readLineEchoed } = require('./transports/telnet-filter');

    output.write('\r\nSynthDoor BBS\r\nUsername: ');
    username = await readLineEchoed(filtered, output);
    username = username.trim() || 'guest';
    output.write('\r\n');

    terminal.username = username;
  }

  // ── Hand off to the game router ──────────────────────────────────────────
  await router.route(terminal, null, transport);
}

module.exports = { runSession };
