'use strict';

/**
 * session-registry.js
 * Live session tracking for SynthDoor.
 *
 * Maintains an in-memory map of all currently connected sessions.
 * Each session entry tracks who is connected, on what transport,
 * where they are (menu or a specific game), and when they connected.
 * A disconnect handle is stored for future kick support.
 *
 * The registry is the authoritative source for real-time stats.
 * Historical stats (play counts, login counts, averages) live in the DB.
 *
 * Usage:
 *   const registry = new SessionRegistry();
 *
 *   // On connect:
 *   const id = registry.add({ username, transport, disconnect });
 *
 *   // On game entry:
 *   registry.setLocation(id, 'meteoroid');
 *
 *   // On menu return / game exit:
 *   registry.setLocation(id, 'menu');
 *
 *   // On disconnect:
 *   registry.remove(id);
 *
 *   // For sysop panel / stats:
 *   registry.list()   → array of session snapshots
 *   registry.count()  → number of active sessions
 */

const { randomBytes } = require('crypto');

class SessionRegistry {
  constructor() {
    this._sessions = new Map(); // id → SessionEntry
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a new session. Returns a unique session ID.
   *
   * @param {object}   opts
   * @param {string}   opts.username    Authenticated or naive username
   * @param {string}   opts.transport   'telnet' | 'rlogin' | 'web'
   * @param {string}   opts.ipAddress   Remote IP (may be null)
   * @param {Function} opts.disconnect  Callable that terminates the connection
   * @returns {string}  Session ID
   */
  add({ username, transport, ipAddress, disconnect }) {
    const id = randomBytes(8).toString('hex');
    this._sessions.set(id, {
      id,
      username:    username || 'unknown',
      transport:   transport || 'unknown',
      ipAddress:   ipAddress || null,
      location:    'menu',           // 'menu' or a game name
      connectedAt: Date.now(),
      gameEnteredAt: null,           // timestamp of current game entry
      disconnect:  disconnect || (() => {}),
    });
    return id;
  }

  /**
   * Update the location of a session.
   * Call with a game name when a game starts, 'menu' when returning to menu.
   *
   * @param {string} id
   * @param {string} location  'menu' | game name
   */
  setLocation(id, location) {
    const entry = this._sessions.get(id);
    if (!entry) return;
    entry.location     = location;
    entry.gameEnteredAt = location !== 'menu' ? Date.now() : null;
  }

  /**
   * Remove a session (call on disconnect).
   * @param {string} id
   */
  remove(id) {
    this._sessions.delete(id);
  }

  /**
   * Return a snapshot of all active sessions.
   * Each snapshot is a plain object safe to read without holding a reference
   * to the internal entry (disconnect handle is excluded).
   *
   * @returns {SessionSnapshot[]}
   */
  list() {
    const now = Date.now();
    return Array.from(this._sessions.values()).map(e => ({
      id:           e.id,
      username:     e.username,
      transport:    e.transport,
      ipAddress:    e.ipAddress,
      location:     e.location,
      connectedAt:  e.connectedAt,
      connectedSec: Math.floor((now - e.connectedAt) / 1000),
      gameEnteredAt: e.gameEnteredAt,
      gameSec:      e.gameEnteredAt ? Math.floor((now - e.gameEnteredAt) / 1000) : null,
    }));
  }

  /**
   * Return the number of active sessions.
   * @returns {number}
   */
  count() {
    return this._sessions.size;
  }

  /**
   * Kick a session by ID (forcibly disconnect).
   * @param {string} id
   * @returns {boolean}  true if the session was found and kicked
   */
  kick(id) {
    const entry = this._sessions.get(id);
    if (!entry) return false;
    try { entry.disconnect(); } catch (_) {}
    this._sessions.delete(id);
    return true;
  }

  /**
   * Return a single session snapshot by ID, or null if not found.
   * @param {string} id
   * @returns {SessionSnapshot|null}
   */
  get(id) {
    return this.list().find(s => s.id === id) || null;
  }
}

module.exports = SessionRegistry;
