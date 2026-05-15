'use strict';

/**
 * packages/server/src/session.js
 *
 * Transport-agnostic session setup.
 *
 * Handles everything that happens after a raw connection is established
 * and a Terminal exists, but before the game router takes over:
 *
 *   - naive mode:        prompt for username, validate it, trust the answer
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
 *
 * Naive-mode validation
 * ─────────────────────
 * Naive mode trusts the username the client supplies, but only after a
 * structural check (isValidNaiveUsername): alphanumeric ASCII, length 1..13,
 * no path separators / whitespace / control bytes. This keeps usernames safe
 * to use as path components (e.g. img2ansi's BASE_OUTPUT_DIR/<username>/...)
 * and to echo in logs and status bars without escape-code smuggling.
 * Authenticated mode bypasses this check — SynthAuth's normalizeUsername()
 * enforces the same alphabet on its own.
 */

const path = require('path');
const { runEntryFlow, displayLoginArt } = require('./auth-flow');
const { isSysopAllowed, isValidNaiveUsername, NAIVE_MAX_USERNAME_LEN } = require('./reserved');
const { getLogger } = require('./logger');

async function runSession({ terminal, output, filtered, authMode, transport, ipAddress, router, config, registry, disconnect, isLive, bindSession }) {

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

      // ── Naive-mode username prompt with structural validation ───────────
      //
      // We give the user up to 3 tries to type a syntactically valid
      // username. Each prompt has the readLineEchoed maxLen capped at
      // NAIVE_MAX_USERNAME_LEN so the wire-level length is bounded too —
      // the regex check is defence in depth on top of that.
      //
      // Empty input falls back to 'guest' on the first prompt only, matching
      // the previous behaviour. After a rejected entry, an explicit name
      // must be typed; a second blank press disconnects rather than silently
      // logging in as guest.
      const MAX_USERNAME_ATTEMPTS = 3;
      let accepted = false;

      for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
        if (attempt === 0) {
          output.write('\r\nSynthDoor BBS\r\nUsername: ');
        } else {
          output.write('Username: ');
        }

        const raw = await readLineEchoed(filtered, output, NAIVE_MAX_USERNAME_LEN);
        output.write('\r\n');

        const candidate = raw.trim();

        // First prompt only: empty → 'guest' (preserves previous behaviour).
        // Subsequent prompts treat empty as a rejection so we don't loop on
        // a stuck client.
        if (candidate === '' && attempt === 0) {
          username = 'guest';
        } else if (candidate === '') {
          // Second/third blank press — bail out rather than fall back.
          getLogger().info(`[Session] Empty username from ${ipAddress || 'unknown'} after ${attempt} retries — disconnecting`);
          return;
        } else {
          username = candidate;
        }

        if (!isValidNaiveUsername(username)) {
          getLogger().warn(`[Session] Rejected naive username "${username}" from ${ipAddress || 'unknown'} (invalid syntax)`);
          output.write('\r\nUsername must be 1-' + NAIVE_MAX_USERNAME_LEN + ' letters or digits (A-Z, a-z, 0-9). No spaces, dots, or slashes.\r\n\r\n');
          continue;
        }

        if (!isSysopAllowed(username, config)) {
          getLogger().warn(`[Session] Blocked reserved username attempt: "${username}" from ${ipAddress || 'unknown'}`);
          output.write('\r\nThat username is not available.\r\n\r\n');
          // Reserved-name attempts close the connection on the first hit
          // rather than letting the attacker probe for the sysop list.
          return;
        }

        accepted = true;
        break;
      }

      if (!accepted) {
        getLogger().warn(`[Session] Naive username validation exhausted for ${ipAddress || 'unknown'} — disconnecting`);
        output.write('\r\nToo many invalid attempts.\r\n\r\n');
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
        isLive,
      });
    }

    // Hand the id back to the transport so it can drive registry.ping()
    // from its own activity hooks. Optional — transports that don't
    // implement liveness reporting just skip it.
    if (sessionId && typeof bindSession === 'function') {
      try { bindSession(sessionId); } catch (_) {}
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
