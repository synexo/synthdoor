/**
 * config.js
 * Plaintext configuration file parser.
 *
 * Format: key = value (one per line)
 * Comments start with #
 * Section headers: [section_name]  (optional, for organization only)
 *
 * Example synthdoor.conf:
 *   # SynthDoor Configuration
 *   telnet_port = 2323
 *   web_port = 8080
 *   db_path = ./data/synthdoor.db
 *   default_game = tetris
 *
 *   [telnet]
 *   dorinfo_path = ./DORINFO1.DEF
 *
 *   [game:tetris]
 *   high_score_limit = 100
 *   speed_multiplier = 1.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');

class Config {
  constructor(filePath) {
    this.filePath = filePath;
    this._data    = {};
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      console.warn(`[Config] File not found: ${this.filePath} — using defaults`);
      return this;
    }

    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
    let section = '';

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      // Section header
      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1).trim();
        continue;
      }

      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const key   = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      const fullKey = section ? `${section}.${key}` : key;
      this._data[fullKey] = value;
      // Also store without section prefix for top-level access
      if (!section) this._data[key] = value;
    }

    return this;
  }

  /** Get a value, with optional default. Checks section-qualified key first. */
  get(key, defaultValue = null) {
    return this._data[key] !== undefined ? this._data[key] : defaultValue;
  }

  getInt(key, defaultValue = 0) {
    const v = this.get(key);
    return v !== null ? parseInt(v) : defaultValue;
  }

  getFloat(key, defaultValue = 0.0) {
    const v = this.get(key);
    return v !== null ? parseFloat(v) : defaultValue;
  }

  getBool(key, defaultValue = false) {
    const v = this.get(key);
    if (v === null) return defaultValue;
    return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
  }

  /** Get all keys under a section prefix */
  getSection(section) {
    const prefix = `${section}.`;
    const result = {};
    for (const [k, v] of Object.entries(this._data)) {
      if (k.startsWith(prefix)) {
        result[k.slice(prefix.length)] = v;
      }
    }
    return result;
  }

  /** Get config for a specific game */
  getGameConfig(gameName) {
    return this.getSection(`game:${gameName}`);
  }

  /** Reload from disk */
  reload() {
    this._data = {};
    return this.load();
  }

  /** Write a value back to memory (not persisted to disk) */
  set(key, value) {
    this._data[key] = String(value);
    return this;
  }
}

module.exports = Config;
