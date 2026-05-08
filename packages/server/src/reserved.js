'use strict';

/**
 * reserved.js
 * Username reservation and validation policy for SynthDoor.
 *
 * Rules:
 *
 *   Naive mode:
 *     - Only usernames explicitly listed in `sysop_users` config are allowed
 *       to connect using a sysop* name. Anyone else attempting a sysop* name
 *       is refused — they cannot connect under that name at all.
 *     - Config key: sysop_users (comma-separated, default: 'sysop')
 *     - Matching is case-insensitive.
 *     - Additionally, naive-mode usernames must be syntactically valid:
 *       alphanumeric only, 1..NAIVE_MAX_USERNAME_LEN characters, no path
 *       separators or whitespace. See isValidNaiveUsername().
 *
 *   Authenticated mode:
 *     - Any username matching the sysop* prefix (case-insensitive) is blocked
 *       at registration. The account can never be created via the normal flow.
 *     - Sysop accounts can only be created via --make-sysop CLI or the panel.
 *     - SynthAuth's normalizeUsername() enforces the alphanumeric rule on
 *       this path, so isValidNaiveUsername() is not called there.
 *
 * Usage:
 *   const { isReservedUsername, isSysopAllowed, isValidNaiveUsername }
 *     = require('./reserved');
 *
 *   // Naive mode — full username acceptance check (use this in transports):
 *   if (!isValidNaiveUsername(username)) { refuse(); }
 *   if (!isSysopAllowed(username, config)) { refuse(); }
 *
 *   // Authenticated mode — block registration of reserved names:
 *   if (isReservedUsername(rawUsername)) { refuse(); }
 */

// ─── Naive-mode username syntax ──────────────────────────────────────────
//
// The rule is intentionally narrow: alphanumeric ASCII only, no separators,
// no whitespace, no control characters. This mirrors the BASE62 alphabet
// SynthAuth's crypto layer enforces on its side, and forecloses several
// attack surfaces at once:
//
//   • Path traversal — no '.', '/', or '\' so usernames cannot escape any
//     directory built with path.join(BASE_DIR, this.username, ...).
//   • Log/terminal injection — no control bytes that could re-position the
//     terminal or smuggle ANSI escapes when usernames are echoed in logs
//     or status bars.
//   • Visual ambiguity — no whitespace-only or zero-width usernames.
//
// 13 characters matches synth-auth's normalizeUsername() length cap so the
// two modes stay consistent: a username valid in naive mode is also valid
// as the username portion of an authenticated PublicID.
const NAIVE_USERNAME_RE     = /^[0-9A-Za-z]+$/;
const NAIVE_MAX_USERNAME_LEN = 13;

/**
 * Returns true if `username` is structurally acceptable as a naive-mode
 * username. Empty, oversized, and non-alphanumeric inputs are rejected.
 *
 * @param {unknown} username
 * @returns {boolean}
 */
function isValidNaiveUsername(username) {
  if (typeof username !== 'string') return false;
  if (username.length === 0 || username.length > NAIVE_MAX_USERNAME_LEN) return false;
  return NAIVE_USERNAME_RE.test(username);
}

/**
 * Returns true if the username matches the sysop* reserved prefix.
 * Case-insensitive. Used in authenticated mode to block registration.
 *
 * @param {string} username
 * @returns {boolean}
 */
function isReservedUsername(username) {
  if (!username || typeof username !== 'string') return false;
  return username.trim().toLowerCase().startsWith('sysop');
}

/**
 * Naive-mode gate: returns true if this username is permitted to connect.
 *
 * - Non-sysop* names: always allowed (returns true).
 * - sysop* names: only allowed if the exact username (case-insensitive) is
 *   listed in the `sysop_users` config value.
 *
 * NOTE: This is a separate concern from isValidNaiveUsername() — both must
 * pass for a naive-mode username to be accepted.
 *
 * @param {string} username
 * @param {Config} config   Server Config instance
 * @returns {boolean}
 */
function isSysopAllowed(username, config) {
  if (!isReservedUsername(username)) return true;   // not a sysop* name — always ok

  const raw      = config ? config.get('sysop_users', 'sysop') : 'sysop';
  const allowed  = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(username.trim().toLowerCase());
}

/**
 * Parse the sysop_users list from config.
 * Returns an array of lowercase usernames.
 *
 * @param {Config} config
 * @returns {string[]}
 */
function getSysopUsers(config) {
  const raw = config ? config.get('sysop_users', 'sysop') : 'sysop';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

module.exports = {
  isReservedUsername,
  isSysopAllowed,
  isValidNaiveUsername,
  getSysopUsers,
  NAIVE_MAX_USERNAME_LEN,
};
