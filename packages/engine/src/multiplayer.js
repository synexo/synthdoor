/**
 * multiplayer.js
 * Inter-player communication and multiplayer coordination layer.
 *
 * Architecture overview:
 *  - A central EventBus (process-level EventEmitter) routes messages between
 *    concurrent game sessions running in the same Node.js process.
 *  - For multi-process or multi-server deployments, the EventBus can be
 *    backed by a SQLite polling loop (async-safe) or replaced with a
 *    Redis pub/sub adapter (stub provided).
 *
 * What this provides:
 *  1. Broadcast chat to all players in a game room
 *  2. Direct messages (player-to-player)
 *  3. Shared game state events (player joined/left, turn changed, etc.)
 *  4. Cooperative game action routing (e.g. MUD room events, trade wars)
 *  5. Player list and presence awareness
 *
 * Usage in a game:
 *   const mp = new Multiplayer(db, username, 'solar_realms');
 *   mp.on('chat',   (msg) => renderChatLine(msg));
 *   mp.on('event',  (evt) => handleGameEvent(evt));
 *   mp.say('Hello, world!');
 *   mp.broadcast({ type: 'attacked', by: username, target: 'EnemyBase' });
 *   mp.close();
 */

'use strict';

const { EventEmitter } = require('events');

// ─── Global in-process event bus ─────────────────────────────────────────
// All Multiplayer instances in the same process share this bus.
const _bus = new EventEmitter();
_bus.setMaxListeners(200);

// ─── Adapters ─────────────────────────────────────────────────────────────
/**
 * SQLiteAdapter: polls the DB chat and game_state tables for new events.
 * Suitable for multi-process (e.g. multiple telnet connections in separate
 * child processes) on a single machine.
 */
class SQLiteAdapter {
  constructor(db, game, pollIntervalMs = 1000) {
    this.db       = db;
    this.game     = game;
    this.interval = pollIntervalMs;
    this._lastId  = 0;
    this._timer   = null;
  }

  start() {
    // Find highest existing chat ID so we don't replay history
    const rows = this.db.getRecentChat(this.game, 1);
    if (rows.length) this._lastId = rows[rows.length - 1].id;

    this._timer = setInterval(() => {
      const rows = this.db._db?.prepare(
        'SELECT * FROM chat WHERE game=? AND id > ? ORDER BY id ASC'
      ).all(this.game, this._lastId) || [];

      for (const row of rows) {
        this._lastId = row.id;
        _bus.emit(`chat:${this.game}`, { username: row.username, message: row.message, id: row.id });
      }
    }, this.interval);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }
}

/**
 * RedisAdapter stub — replace SQLiteAdapter with this for clustered deployments.
 * Requires `ioredis` package.
 */
class RedisAdapter {
  constructor(redisUrl, game) {
    this.url  = redisUrl;
    this.game = game;
    // TODO: implement Redis pub/sub
    // const Redis = require('ioredis');
    // this.pub = new Redis(redisUrl);
    // this.sub = new Redis(redisUrl);
  }
  start() { console.warn('[MP] RedisAdapter: not yet implemented'); }
  stop()  {}
}

// ─── Main Multiplayer class ───────────────────────────────────────────────
class Multiplayer extends EventEmitter {
  /**
   * @param {DB}     db       - DB instance
   * @param {string} username - current player's username
   * @param {string} game     - game name/room (e.g. 'trade_wars', 'mud_zone1')
   * @param {string} [nodeId] - unique instance ID (defaults to random)
   */
  constructor(db, username, game, nodeId = null) {
    super();
    this.db       = db;
    this.username = username;
    this.game     = game;
    this.nodeId   = nodeId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this._chatHandler  = null;
    this._eventHandler = null;
    this._adapter      = null;

    this._attach();
  }

  _attach() {
    // Register presence
    this.db.registerSession(this.username, this.game, this.nodeId);

    // Ping session every 60 seconds
    this._pingInterval = setInterval(() => {
      this.db.pingSession(this.username, this.game);
    }, 60000);

    // Listen for chat from the in-process bus
    this._chatHandler = (msg) => {
      if (msg.username !== this.username) {
        this.emit('chat', msg);
      }
    };
    _bus.on(`chat:${this.game}`, this._chatHandler);

    // Listen for game events
    this._eventHandler = (evt) => {
      if (evt._from !== this.nodeId) {
        this.emit('event', evt);
      }
    };
    _bus.on(`event:${this.game}`, this._eventHandler);
  }

  // ─── Chat ───────────────────────────────────────────────────────────────
  /** Send a chat message to all players in this game */
  say(message) {
    const msg = { username: this.username, message, id: Date.now() };
    this.db.addChat(this.username, message, this.game);
    _bus.emit(`chat:${this.game}`, msg);
    return this;
  }

  /** Send a direct message to a specific player */
  whisper(toUser, message) {
    this.db.sendMessage(this.username, toUser, 'DM', message);
    _bus.emit(`dm:${toUser}`, { from: this.username, message });
    return this;
  }

  /** Listen for direct messages to this player */
  onDM(handler) {
    _bus.on(`dm:${this.username}`, handler);
    return this;
  }

  // ─── Game events ─────────────────────────────────────────────────────────
  /**
   * Broadcast a structured game event to all players in the room.
   * @param {object} event - any JSON-serializable object
   */
  broadcast(event) {
    const evt = Object.assign({}, event, { _from: this.nodeId, _ts: Date.now() });
    _bus.emit(`event:${this.game}`, evt);
    // Also persist for cross-process delivery via adapter
    this.db.setGameState(this.game, `evt_${evt._ts}`, evt);
    return this;
  }

  // ─── Presence ─────────────────────────────────────────────────────────
  /** Returns array of {username, node, last_ping} for active players */
  getActivePlayers() {
    return this.db.getActivePlayers(this.game);
  }

  isPlayerOnline(username) {
    const players = this.getActivePlayers();
    return players.some(p => p.username === username);
  }

  // ─── Shared state (async-safe via DB) ────────────────────────────────
  setState(key, value) {
    this.db.setGameState(this.game, key, value);
    return this;
  }

  getState(key, defaultValue = null) {
    return this.db.getGameState(this.game, key, defaultValue);
  }

  // ─── Cross-process adapter ────────────────────────────────────────────
  /**
   * Enable SQLite polling for cross-process multiplayer.
   * Call this once per game instance on startup.
   */
  useSQLiteAdapter(pollMs = 1000) {
    this._adapter = new SQLiteAdapter(this.db, this.game, pollMs);
    this._adapter.start();
    return this;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────
  close() {
    clearInterval(this._pingInterval);
    this.db.removeSession(this.username, this.game);
    if (this._chatHandler)  _bus.removeListener(`chat:${this.game}`,  this._chatHandler);
    if (this._eventHandler) _bus.removeListener(`event:${this.game}`, this._eventHandler);
    if (this._adapter)      this._adapter.stop();
    this.removeAllListeners();
  }
}

module.exports = Multiplayer;
module.exports.SQLiteAdapter = SQLiteAdapter;
module.exports.RedisAdapter  = RedisAdapter;
