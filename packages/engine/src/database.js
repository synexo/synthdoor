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
        total_plays  INTEGER DEFAULT 0
      );

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
