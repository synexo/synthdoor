'use strict';

/**
 * scheduler.js
 * Lightweight task scheduler for SynthDoor server maintenance jobs.
 *
 * Supports daily tasks anchored to a wall-clock time, plus arbitrary
 * interval tasks. Tasks can optionally fire once immediately on startup.
 *
 * Usage:
 *   const scheduler = new Scheduler();
 *
 *   scheduler.register({
 *     name:       'log-pruner',
 *     interval:   '24h',
 *     time:       '02:00',   // fire at this time of day (server local time)
 *     runOnStart: true,      // also fire once immediately at startup
 *     fn:         async () => { ... }
 *   });
 *
 *   scheduler.start();
 *   // later...
 *   scheduler.stop();
 *
 * interval formats: '24h', '1h', '30m', '60s', or a plain number (ms).
 * time format: 'HH:MM' (24-hour, server local time). Optional.
 *   - If time is set, the task fires at that time each day regardless of
 *     when the server started. interval is used only to determine the period
 *     (typically '24h' when time is set).
 *   - If time is omitted, the task fires every `interval` ms from startup.
 */

class Scheduler {
  constructor() {
    this._tasks   = [];   // registered task descriptors
    this._timers  = [];   // active setTimeout / setInterval handles
    this._running = false;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a task. Can be called before or after start().
   *
   * @param {object}   opts
   * @param {string}   opts.name        Human-readable task name (for logging)
   * @param {string|number} opts.interval  Period: '24h','1h','30m','60s', or ms
   * @param {string}   [opts.time]      'HH:MM' wall-clock anchor (local time)
   * @param {boolean}  [opts.runOnStart] Fire immediately on start() (default false)
   * @param {Function} opts.fn          Async (or sync) task function
   */
  register(opts) {
    if (!opts.name)     throw new Error('[Scheduler] Task must have a name');
    if (!opts.interval) throw new Error('[Scheduler] Task must have an interval');
    if (!opts.fn)       throw new Error('[Scheduler] Task must have a fn');

    const task = {
      name:       opts.name,
      intervalMs: parseInterval(opts.interval),
      time:       opts.time || null,
      runOnStart: opts.runOnStart === true,
      fn:         opts.fn,
    };

    this._tasks.push(task);

    // If already running, schedule this task immediately
    if (this._running) {
      this._scheduleTask(task);
    }
  }

  /** Start the scheduler. Safe to call multiple times (no-op if already running). */
  start() {
    if (this._running) return;
    this._running = true;
    for (const task of this._tasks) {
      this._scheduleTask(task);
    }
  }

  /** Stop all scheduled tasks cleanly. */
  stop() {
    this._running = false;
    for (const handle of this._timers) {
      clearTimeout(handle);
      clearInterval(handle);
    }
    this._timers = [];
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _scheduleTask(task) {
    // Fire immediately if requested
    if (task.runOnStart) {
      this._run(task);
    }

    if (task.time) {
      // Wall-clock anchored: fire at HH:MM each day
      const msUntilFirst = msUntilNextTime(task.time);
      const handle = setTimeout(() => {
        this._run(task);
        // After first fire, repeat every intervalMs
        const repeating = setInterval(() => this._run(task), task.intervalMs);
        this._timers.push(repeating);
      }, msUntilFirst);
      this._timers.push(handle);
    } else {
      // Simple interval from now
      const handle = setInterval(() => this._run(task), task.intervalMs);
      this._timers.push(handle);
    }
  }

  async _run(task) {
    try {
      await task.fn();
    } catch (err) {
      // Use console.error here — logger itself uses scheduler, avoid circular dep
      console.error(`[Scheduler] Task "${task.name}" failed: ${err.message}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse an interval string into milliseconds.
 * Accepts: '24h', '1h', '30m', '60s', or a plain number (already ms).
 */
function parseInterval(value) {
  if (typeof value === 'number') return value;
  const str = String(value).trim().toLowerCase();
  const match = str.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)?$/);
  if (!match) throw new Error(`[Scheduler] Invalid interval: "${value}"`);
  const n = parseFloat(match[1]);
  switch (match[2]) {
    case 'h':  return Math.round(n * 3600 * 1000);
    case 'm':  return Math.round(n * 60 * 1000);
    case 's':  return Math.round(n * 1000);
    case 'ms': return Math.round(n);
    default:   return Math.round(n); // bare number = ms
  }
}

/**
 * Calculate milliseconds until the next occurrence of HH:MM (local time).
 * Always returns a value in (0, 86400000].
 */
function msUntilNextTime(timeStr) {
  const [hh, mm] = timeStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) throw new Error(`[Scheduler] Invalid time: "${timeStr}"`);

  const now    = new Date();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);

  let diff = target - now;
  if (diff <= 0) {
    // Already passed today — schedule for tomorrow
    diff += 24 * 60 * 60 * 1000;
  }
  return diff;
}

module.exports = Scheduler;
