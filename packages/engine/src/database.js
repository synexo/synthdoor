/**
 * database.js
 * SQLite database layer for SynthDoor games.
 * Handles player persistence, game-specific data, high scores,
 * leaderboards, async messaging, and multiplayer state.
 *
 * Uses better-sqlite3 (synchronous API, safe for game loop use).
 *
 * Each game gets its own table namespace (prefixed by gameName).
 * Shared tables (players, messages, chat) are shared across all games.
 *
 * Usage:
 *   const db = new DB('./data/synthdoor.db');
 *   db.init();
 *   db.saveScore('tetris', 'Alice', 10000);
 *   const scores = db.getLeaderboard('tetris', 10);
 */

'use strict';

const path = require('path');
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  // Graceful degradation if better-sqlite3 not installed yet
  console.warn('[DB] better-sqlite3 not installed. Using in-memory mock.');
  Database = null;
}

// In-memory fallback for environments without better-sqlite3
class MockDB {
  _store = {};
  prepare() { return { run: () => {}, get: () => null, all: () => [] }; }
  exec() {}
  transaction(fn) { return fn; }
}

class DB {
  /**
   * @param {string} dbPath - path to .db file (e.g. './data/synthdoor.db')
   */
  constructor(dbPath = './data/synthdoor.db') {
    this.dbPath = dbPath;
    this._db    = null;
  }

  // ─── Initialization ─────────────────────────────────────────────────────
  init() {
    if (Database) {
      const fs = require('fs');
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this._db = new Database(this.dbPath);
    } else {
      this._db = new MockDB();
    }

    this._db.exec(`
      -- Global player registry
      CREATE TABLE IF NOT EXISTS players (
        username     TEXT PRIMARY KEY,
        first_seen   INTEGER DEFAULT (strftime('%s','now')),
        last_seen    INTEGER DEFAULT (strftime('%s','now')),
        total_plays  INTEGER DEFAULT 0,
        login_count  INTEGER DEFAULT 0,
        role         TEXT    DEFAULT 'user'
      );

      -- Migrate: add columns to existing players tables that predate this schema
      -- (SQLite ignores these if columns already exist via the error-suppression pattern)
    `);

    // ── Schema migrations (safe to run on every startup) ──────────────────
    // Each ALTER TABLE is wrapped individually — SQLite will throw if the
    // column already exists, so we catch and ignore those errors silently.
    const migrations = [
      `ALTER TABLE players ADD COLUMN login_count INTEGER DEFAULT 0`,
      `ALTER TABLE players ADD COLUMN role        TEXT    DEFAULT 'user'`,
    ];
    for (const sql of migrations) {
      try { this._db.exec(sql); } catch (_) { /* column already exists */ }
    }

    this._db.exec(`

      -- Per-game high score table
      CREATE TABLE IF NOT EXISTS scores (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        game       TEXT NOT NULL,
        username   TEXT NOT NULL,
        score      INTEGER NOT NULL,
        data       TEXT,              -- optional JSON payload
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_scores_game_score ON scores(game, score DESC);

      -- Async messaging between players
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user  TEXT NOT NULL,
        to_user    TEXT NOT NULL,    -- NULL = broadcast
        subject    TEXT,
        body       TEXT NOT NULL,
        read       INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );

      -- Global chat log (last N entries kept)
      CREATE TABLE IF NOT EXISTS chat (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT NOT NULL,
        message    TEXT NOT NULL,
        game       TEXT,             -- NULL = lobby
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );

      -- Generic per-game per-player key-value store
      CREATE TABLE IF NOT EXISTS player_data (
        game       TEXT NOT NULL,
        username   TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT,
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY (game, username, key)
      );

      -- Active player sessions (for multiplayer awareness)
      CREATE TABLE IF NOT EXISTS sessions (
        username   TEXT NOT NULL,
        game       TEXT NOT NULL,
        node       TEXT NOT NULL,    -- unique instance ID
        started_at INTEGER DEFAULT (strftime('%s','now')),
        last_ping  INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY (username, game)
      );

      -- Generic game-state store (for async multiplayer like Solar Realms)
      CREATE TABLE IF NOT EXISTS game_state (
        game       TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT,
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY (game, key)
      );

      -- Per-game aggregate statistics (play counts + rolling avg session duration)
      CREATE TABLE IF NOT EXISTS game_stats (
        game             TEXT PRIMARY KEY,
        play_count       INTEGER DEFAULT 0,
        session_count    INTEGER DEFAULT 0,
        avg_duration_sec REAL    DEFAULT 0
      );
    `);

    return this;
  }

  // ─── Player management ──────────────────────────────────────────────────
  touchPlayer(username) {
    this._db.prepare(`
      INSERT INTO players (username) VALUES (?)
      ON CONFLICT(username) DO UPDATE SET
        last_seen   = strftime('%s','now'),
        total_plays = total_plays + 1
    `).run(username);
  }

  getPlayer(username) {
    return this._db.prepare('SELECT * FROM players WHERE username = ?').get(username);
  }

  /** Increment the login counter for a player (upserts the row if needed). */
  incrementLoginCount(username) {
    this._db.prepare(`
      INSERT INTO players (username, login_count) VALUES (?, 1)
      ON CONFLICT(username) DO UPDATE SET
        last_seen   = strftime('%s','now'),
        login_count = login_count + 1
    `).run(username);
  }

  // ─── Role management ────────────────────────────────────────────────────

  /**
   * Get the stored role for a player ('user' | 'sysop').
   * Returns 'user' if the player record doesn't exist.
   */
  getRole(username) {
    const row = this._db.prepare(
      `SELECT role FROM players WHERE username = ?`
    ).get(username);
    return row ? (row.role || 'user') : 'user';
  }

  /**
   * Set the role for a player. Upserts the player record if needed.
   * @param {string} username
   * @param {string} role  'user' | 'sysop'
   */
  setRole(username, role) {
    this._db.prepare(`
      INSERT INTO players (username, role) VALUES (?, ?)
      ON CONFLICT(username) DO UPDATE SET role = excluded.role
    `).run(username, role);
  }

  /** Return all players with a given role. */
  getPlayersByRole(role) {
    return this._db.prepare(
      `SELECT username, first_seen, last_seen, login_count FROM players WHERE role = ? ORDER BY username`
    ).all(role);
  }

  // ─── Game statistics ────────────────────────────────────────────────────

  /**
   * Increment play count for a game.
   * Called when a player enters a game.
   */
  incrementGamePlayCount(game) {
    this._db.prepare(`
      INSERT INTO game_stats (game, play_count) VALUES (?, 1)
      ON CONFLICT(game) DO UPDATE SET play_count = play_count + 1
    `).run(game);
  }

  /**
   * Record a completed game session, updating the rolling average duration.
   * Called when a player exits a game.
   * @param {string} game
   * @param {number} durationSec  Session duration in seconds
   */
  recordGameSession(game, durationSec) {
    const row = this._db.prepare(
      `SELECT session_count, avg_duration_sec FROM game_stats WHERE game = ?`
    ).get(game);

    if (!row) {
      this._db.prepare(`
        INSERT INTO game_stats (game, play_count, session_count, avg_duration_sec)
        VALUES (?, 1, 1, ?)
      `).run(game, durationSec);
    } else {
      const newCount = row.session_count + 1;
      const newAvg   = (row.avg_duration_sec * row.session_count + durationSec) / newCount;
      this._db.prepare(`
        UPDATE game_stats SET session_count = ?, avg_duration_sec = ? WHERE game = ?
      `).run(newCount, newAvg, game);
    }
  }

  /** Get stats for all games, ordered by play count descending. */
  getGameStats() {
    return this._db.prepare(`
      SELECT game, play_count, session_count, avg_duration_sec
      FROM game_stats ORDER BY play_count DESC
    `).all();
  }

  /** Get top N users by login count. */
  getTopUsers(limit = 20) {
    return this._db.prepare(`
      SELECT username, login_count, last_seen
      FROM players ORDER BY login_count DESC LIMIT ?
    `).all(limit);
  }

  // ─── Scores & Leaderboards ──────────────────────────────────────────────
  saveScore(game, username, score, data = null) {
    this._db.prepare(
      'INSERT INTO scores (game, username, score, data) VALUES (?, ?, ?, ?)'
    ).run(game, username, score, data ? JSON.stringify(data) : null);
  }

  getLeaderboard(game, limit = 10) {
    return this._db.prepare(`
      SELECT username, score, data, created_at
      FROM   scores
      WHERE  game = ?
      ORDER  BY score DESC
      LIMIT  ?
    `).all(game, limit);
  }

  getPlayerBestScore(game, username) {
    return this._db.prepare(`
      SELECT MAX(score) as best FROM scores WHERE game = ? AND username = ?
    `).get(game, username);
  }

  getUserRank(game, username) {
    const row = this._db.prepare(`
      SELECT COUNT(*) + 1 as rank
      FROM (SELECT username, MAX(score) as best FROM scores WHERE game=? GROUP BY username)
      WHERE best > (SELECT COALESCE(MAX(score),0) FROM scores WHERE game=? AND username=?)
    `).get(game, game, username);
    return row ? row.rank : null;
  }

  // ─── Per-game per-player key-value store ────────────────────────────────
  setPlayerData(game, username, key, value) {
    this._db.prepare(`
      INSERT INTO player_data (game, username, key, value, updated_at)
      VALUES (?, ?, ?, ?, strftime('%s','now'))
      ON CONFLICT(game, username, key) DO UPDATE SET
        value = excluded.value, updated_at = excluded.updated_at
    `).run(game, username, key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  getPlayerData(game, username, key, defaultValue = null) {
    const row = this._db.prepare(
      'SELECT value FROM player_data WHERE game=? AND username=? AND key=?'
    ).get(game, username, key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  getAllPlayerData(game, username) {
    const rows = this._db.prepare(
      'SELECT key, value FROM player_data WHERE game=? AND username=?'
    ).all(game, username);
    const result = {};
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
    }
    return result;
  }

  // ─── Async Messaging ────────────────────────────────────────────────────
  sendMessage(from, to, subject, body) {
    this._db.prepare(
      'INSERT INTO messages (from_user, to_user, subject, body) VALUES (?, ?, ?, ?)'
    ).run(from, to || null, subject, body);
  }

  getMessages(username, unreadOnly = false) {
    const q = unreadOnly
      ? 'SELECT * FROM messages WHERE (to_user=? OR to_user IS NULL) AND read=0 ORDER BY created_at DESC'
      : 'SELECT * FROM messages WHERE (to_user=? OR to_user IS NULL) ORDER BY created_at DESC LIMIT 50';
    return this._db.prepare(q).all(username);
  }

  markMessageRead(id) {
    this._db.prepare('UPDATE messages SET read=1 WHERE id=?').run(id);
  }

  getUnreadCount(username) {
    const row = this._db.prepare(
      'SELECT COUNT(*) as n FROM messages WHERE (to_user=? OR to_user IS NULL) AND read=0'
    ).get(username);
    return row ? row.n : 0;
  }

  // ─── Global Chat ────────────────────────────────────────────────────────
  addChat(username, message, game = null) {
    this._db.prepare(
      'INSERT INTO chat (username, message, game) VALUES (?, ?, ?)'
    ).run(username, message, game);
    // Keep only last 500 lines
    this._db.prepare(
      'DELETE FROM chat WHERE id NOT IN (SELECT id FROM chat ORDER BY id DESC LIMIT 500)'
    ).run();
  }

  getRecentChat(game = null, limit = 20) {
    if (game) {
      return this._db.prepare(
        'SELECT * FROM chat WHERE game=? ORDER BY id DESC LIMIT ?'
      ).all(game, limit).reverse();
    }
    return this._db.prepare(
      'SELECT * FROM chat ORDER BY id DESC LIMIT ?'
    ).all(limit).reverse();
  }

  // ─── Session tracking ───────────────────────────────────────────────────
  registerSession(username, game, nodeId) {
    this._db.prepare(`
      INSERT INTO sessions (username, game, node) VALUES (?, ?, ?)
      ON CONFLICT(username, game) DO UPDATE SET node=excluded.node, last_ping=strftime('%s','now')
    `).run(username, game, nodeId);
  }

  pingSession(username, game) {
    this._db.prepare(
      "UPDATE sessions SET last_ping=strftime('%s','now') WHERE username=? AND game=?"
    ).run(username, game);
  }

  removeSession(username, game) {
    this._db.prepare('DELETE FROM sessions WHERE username=? AND game=?').run(username, game);
  }

  /** Get all active players in a game (pinged within last 5 minutes) */
  getActivePlayers(game) {
    return this._db.prepare(`
      SELECT username, node, last_ping FROM sessions
      WHERE game=? AND last_ping > strftime('%s','now') - 300
    `).all(game);
  }

  // ─── Generic game state (async multiplayer) ──────────────────────────────
  setGameState(game, key, value) {
    this._db.prepare(`
      INSERT INTO game_state (game, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(game, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(game, key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  getGameState(game, key, defaultValue = null) {
    const row = this._db.prepare('SELECT value FROM game_state WHERE game=? AND key=?').get(game, key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  // ─── Transactions ────────────────────────────────────────────────────────
  transaction(fn) {
    return this._db.transaction(fn);
  }

  close() {
    if (this._db && typeof this._db.close === 'function') {
      this._db.close();
    }
  }
}

module.exports = DB;
