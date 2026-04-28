'use strict';

/**
 * reserved.js
 * Username reservation policy for SynthDoor.
 *
 * Rules:
 *
 *   Naive mode:
 *     - Only usernames explicitly listed in `sysop_users` config are allowed
 *       to connect using a sysop* name. Anyone else attempting a sysop* name
 *       is refused — they cannot connect under that name at all.
 *     - Config key: sysop_users (comma-separated, default: 'sysop')
 *     - Matching is case-insensitive.
 *
 *   Authenticated mode:
 *     - Any username matching the sysop* prefix (case-insensitive) is blocked
 *       at registration. The account can never be created via the normal flow.
 *     - Sysop accounts can only be created via --make-sysop CLI or the panel.
 *
 * Usage:
 *   const { isReservedUsername, isSysopAllowed } = require('./reserved');
 *
 *   // Authenticated mode — block registration:
 *   if (isReservedUsername(rawUsername)) { refuse(); }
 *
 *   // Naive mode — allow only if explicitly listed:
 *   if (!isSysopAllowed(username, config)) { refuse(); }
 */

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

module.exports = { isReservedUsername, isSysopAllowed, getSysopUsers };
