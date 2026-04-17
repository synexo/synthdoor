'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

/**
 * AuthDB — thin SQLite wrapper for the SynthAuth identity registry.
 * Shares the same better-sqlite3 dependency as synthdoor's main DB.
 */
class AuthDB {
  /**
   * @param {string} [dbPath]  Path to SQLite file.
   */
  constructor(dbPath) {
    const resolved = dbPath || path.join(__dirname, '..', '..', '..', 'data', 'synth-auth.db');
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolved);
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identities (
        internal_id TEXT PRIMARY KEY,
        created_at  INTEGER NOT NULL,
        ip_address  TEXT
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        key          TEXT PRIMARY KEY,
        count        INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL
      );
    `);
  }

  // ---------------------------------------------------------------------------
  // Identity registry
  // ---------------------------------------------------------------------------

  exists(internalId) {
    const row = this.db
      .prepare('SELECT 1 FROM identities WHERE internal_id = ?')
      .get(internalId);
    return !!row;
  }

  register(internalId, ipAddress = null) {
    try {
      this.db
        .prepare('INSERT INTO identities (internal_id, created_at, ip_address) VALUES (?, ?, ?)')
        .run(internalId, Math.floor(Date.now() / 1000), ipAddress || null);
      return true;
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
      throw e;
    }
  }

  find(internalId) {
    return this.db
      .prepare('SELECT * FROM identities WHERE internal_id = ?')
      .get(internalId) || null;
  }

  /**
   * Canonical collision guard. Checks the 20-char PublicID prefix
   * (13 username chars + '-' + 6 suffix chars).
   */
  publicIdExists(internalId) {
    const prefix = internalId.slice(0, 20);
    const row = this.db
      .prepare("SELECT 1 FROM identities WHERE substr(internal_id, 1, 20) = ?")
      .get(prefix);
    return !!row;
  }

  usernameExists(normalizedUsername) {
    const prefix = normalizedUsername + '-';
    const row = this.db
      .prepare("SELECT 1 FROM identities WHERE substr(internal_id, 1, ?) = ?")
      .get(prefix.length, prefix);
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Rate limiting  (sliding window, in-DB counter)
  // ---------------------------------------------------------------------------

  rateLimit(key, maxCount, windowSecs) {
    const now = Math.floor(Date.now() / 1000);

    const row = this.db
      .prepare('SELECT * FROM rate_limits WHERE key = ?')
      .get(key);

    if (!row || (now - row.window_start) >= windowSecs) {
      this.db
        .prepare(`
          INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start
        `)
        .run(key, now);
      return { allowed: true, remaining: maxCount - 1 };
    }

    if (row.count >= maxCount) {
      return { allowed: false, remaining: 0 };
    }

    this.db
      .prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?')
      .run(key);

    return { allowed: true, remaining: maxCount - row.count - 1 };
  }

  close() {
    this.db.close();
  }
}

module.exports = AuthDB;
