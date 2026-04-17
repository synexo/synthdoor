'use strict';

const crypto = require('crypto');

/**
 * SessionStore — lightweight in-memory session store.
 * Token format: base64url(random 32 bytes) — no embedded claims.
 */
class SessionStore {
  constructor(opts = {}) {
    this.ttlSeconds = opts.ttlSeconds || 3600;
    /** @type {Map<string, { data: object, expiresAt: number }>} */
    this._store = new Map();

    this._pruneInterval = setInterval(() => this._prune(), 5 * 60 * 1000);
    this._pruneInterval.unref();
  }

  create(data) {
    const token     = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    this._store.set(token, { data: { ...data }, expiresAt });
    return token;
  }

  get(token) {
    const entry = this._store.get(token);
    if (!entry) return null;
    if (Math.floor(Date.now() / 1000) > entry.expiresAt) {
      this._store.delete(token);
      return null;
    }
    return entry.data;
  }

  touch(token) {
    const entry = this._store.get(token);
    if (!entry) return false;
    entry.expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    return true;
  }

  destroy(token) {
    this._store.delete(token);
  }

  attachToConnection(connectionKey, data) {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    this._store.set(`conn:${connectionKey}`, { data: { ...data }, expiresAt });
  }

  getByConnection(connectionKey) {
    return this.get(`conn:${connectionKey}`);
  }

  detachConnection(connectionKey) {
    this._store.delete(`conn:${connectionKey}`);
  }

  _prune() {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }

  destroyAll() {
    clearInterval(this._pruneInterval);
    this._store.clear();
  }
}

module.exports = SessionStore;
