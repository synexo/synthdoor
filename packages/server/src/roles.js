'use strict';

/**
 * roles.js
 * Role abstraction for SynthDoor.
 *
 * Works identically in both naive and authenticated modes so the rest of the
 * server never needs to branch on auth mode to answer "what role is this user?"
 *
 * Naive mode:
 *   - Checks the sysop_users config list (default: 'sysop').
 *   - If the username is on the list → 'sysop', otherwise → 'user'.
 *   - DB is not consulted in naive mode (no persistent identity).
 *
 * Authenticated mode:
 *   - Reads the `role` column from the players table in the main DB.
 *   - Falls back to 'user' if the row doesn't exist yet.
 *
 * Usage:
 *   const { getRole } = require('./roles');
 *   const role = getRole(username, config, db, authMode);
 *   if (role === 'sysop') { ... }
 *
 * Defined roles (to date):
 *   'user'   — standard player, default for all accounts
 *   'sysop'  — system operator, has access to the sysop panel and role menu
 */

const { getSysopUsers } = require('./reserved');

/**
 * Return the role for a given username.
 *
 * @param {string}  username
 * @param {Config}  config    Server Config instance
 * @param {DB}      db        Main game DB instance
 * @param {string}  authMode  'naive' | 'authenticated'
 * @returns {'user'|'sysop'}
 */
function getRole(username, config, db, authMode) {
  if (!username) return 'user';

  if (authMode === 'authenticated') {
    return db ? db.getRole(username) : 'user';
  }

  // Naive mode: role derived purely from config list
  const sysopUsers = getSysopUsers(config);
  return sysopUsers.includes(username.trim().toLowerCase()) ? 'sysop' : 'user';
}

/**
 * Convenience: returns true if the user is a sysop.
 *
 * @param {string}  username
 * @param {Config}  config
 * @param {DB}      db
 * @param {string}  authMode
 * @returns {boolean}
 */
function isSysop(username, config, db, authMode) {
  return getRole(username, config, db, authMode) === 'sysop';
}

/**
 * Return the menu file basename for a given role, or null if none defined.
 * The menu file is expected at config/menus/<role>-menu.yaml.
 *
 * @param {string} role
 * @returns {string|null}  e.g. 'sysop-menu', or null for 'user'
 */
function getRoleMenuName(role) {
  if (role === 'user') return null;
  return `${role}-menu`;
}

module.exports = { getRole, isSysop, getRoleMenuName };
