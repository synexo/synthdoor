'use strict';

/**
 * logger.js
 * Structured file + stdout logger for SynthDoor.
 *
 * - Writes to stdout (as before) AND to a daily rotating log file.
 * - Log files are named: synthdoor-YYYY-MM-DD.log
 * - A Scheduler task prunes files older than `keepDays` each day at 02:00.
 * - All original console.log / console.warn / console.error calls in the
 *   server should be replaced with logger.info / logger.warn / logger.error.
 *
 * Usage:
 *   const { createLogger } = require('./logger');
 *   const logger = createLogger({ logsDir: './logs', keepDays: 7, scheduler });
 *
 *   logger.info('[Router] Game registered: tetris');
 *   logger.warn('[Auth] Unknown user attempted sysop login');
 *   logger.error('[DB] Connection failed', err);
 *
 * Log line format (file):
 *   2025-04-26T02:00:00.000Z [INFO]  [Router] Game registered: tetris
 *   2025-04-26T02:00:01.000Z [WARN]  [Auth] Unknown user attempted sysop login
 *   2025-04-26T02:00:02.000Z [ERROR] [DB] Connection failed: <message>
 */

const fs   = require('fs');
const path = require('path');

class Logger {
  /**
   * @param {object}    opts
   * @param {string}    opts.logsDir    Directory to write log files into
   * @param {number}    opts.keepDays   How many days of log files to retain
   * @param {Scheduler} opts.scheduler  Scheduler instance (registers prune job)
   */
  constructor(opts = {}) {
    this.logsDir   = opts.logsDir   || './logs';
    this.keepDays  = opts.keepDays  || 7;
    this.pruneTime = opts.pruneTime || '02:00';

    this._currentDate   = null;  // 'YYYY-MM-DD' of the open file
    this._stream        = null;  // current write stream

    // Ensure log directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    // Open today's log file immediately
    this._rotate();

    // Register daily prune job if a scheduler was provided
    if (opts.scheduler) {
      opts.scheduler.register({
        name:       'log-pruner',
        interval:   '24h',
        time:       this.pruneTime,
        runOnStart: true,
        fn:         () => this._prune(),
      });
    }
  }

  // ─── Public logging methods ────────────────────────────────────────────────

  info(...args)  { this._write('INFO ', ...args); }
  warn(...args)  { this._write('WARN ', ...args); }
  error(...args) { this._write('ERROR', ...args); }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Format and write a log line to both stdout and the current file.
   * Automatically rotates the file if the date has changed.
   */
  _write(level, ...args) {
    // Rotate if the calendar day has changed since we last wrote
    const today = dateStamp(new Date());
    if (today !== this._currentDate) {
      this._rotate();
    }

    // Build the message string — handle Error objects and multiple args
    const message = args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack}`;
      if (typeof a === 'object' && a !== null) return JSON.stringify(a);
      return String(a);
    }).join(' ');

    const ts   = new Date().toISOString();
    const line = `${ts} [${level}] ${message}`;

    // stdout (preserve original behaviour)
    if (level === 'ERROR') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }

    // file
    if (this._stream) {
      this._stream.write(line + '\n');
    }
  }

  /**
   * Open (or re-open) the log file for today's date.
   * Called on construction and whenever the date rolls over.
   */
  _rotate() {
    // Close existing stream if open
    if (this._stream) {
      try { this._stream.end(); } catch (_) {}
      this._stream = null;
    }

    this._currentDate = dateStamp(new Date());
    const filePath    = path.join(this.logsDir, `synthdoor-${this._currentDate}.log`);

    try {
      this._stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
      this._stream.on('error', (err) => {
        process.stderr.write(`[Logger] Write stream error: ${err.message}\n`);
        this._stream = null;
      });
    } catch (err) {
      process.stderr.write(`[Logger] Failed to open log file ${filePath}: ${err.message}\n`);
    }
  }

  /**
   * Delete log files older than keepDays.
   * Called by the scheduler at 02:00 daily and once on startup.
   */
  _prune() {
    const cutoff = Date.now() - (this.keepDays * 24 * 60 * 60 * 1000);
    let pruned = 0;

    let entries;
    try {
      entries = fs.readdirSync(this.logsDir);
    } catch (err) {
      this._write('WARN ', `[Logger] Could not read logs dir for pruning: ${err.message}`);
      return;
    }

    for (const name of entries) {
      // Only touch files matching our naming pattern
      const match = name.match(/^synthdoor-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!match) continue;

      const fileDate = new Date(match[1]).getTime();
      if (isNaN(fileDate)) continue;

      // Don't delete today's file regardless of keepDays setting
      if (match[1] === this._currentDate) continue;

      if (fileDate < cutoff) {
        try {
          fs.unlinkSync(path.join(this.logsDir, name));
          pruned++;
        } catch (err) {
          this._write('WARN ', `[Logger] Could not delete old log ${name}: ${err.message}`);
        }
      }
    }

    if (pruned > 0) {
      this._write('INFO ', `[Logger] Pruned ${pruned} log file(s) older than ${this.keepDays} days`);
    }
  }

  /** Close the write stream cleanly on server shutdown. */
  close() {
    if (this._stream) {
      try { this._stream.end(); } catch (_) {}
      this._stream = null;
    }
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns 'YYYY-MM-DD' for a given Date in local time. */
function dateStamp(date) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Return the shared logger instance.
 * Throws if createLogger() has not been called yet.
 */
function getLogger() {
  if (!_instance) throw new Error('[Logger] Logger not initialised. Call createLogger() first.');
  return _instance;
}

/**
 * Create and return a Logger instance. Also sets the module singleton.
 * @param {object} opts  See Logger constructor.
 */
function createLogger(opts) {
  _instance = new Logger(opts);
  return _instance;
}

module.exports = { createLogger, getLogger, Logger };
