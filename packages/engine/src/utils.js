/**
 * utils.js
 * Shared utility helpers for SynthDoor games.
 * Import what you need: const { roll, chance, wordWrap, ... } = require('@synthdoor/engine').Utils;
 */

'use strict';

const Utils = {

  // ─── Random & probability ──────────────────────────────────────────────

  /** Roll a d-sided die, return 1..d */
  roll(d) { return Math.floor(Math.random() * d) + 1; },

  /** Roll ndice d-sided dice, return sum */
  rollNd(n, d) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Utils.roll(d);
    return sum;
  },

  /** Return true with probability p (0.0–1.0) */
  chance(p) { return Math.random() < p; },

  /** Pick a random element from an array */
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  /** Pick n unique random elements from an array */
  pickN(arr, n) {
    const copy = [...arr];
    const result = [];
    for (let i = 0; i < Math.min(n, copy.length); i++) {
      const idx = Math.floor(Math.random() * copy.length);
      result.push(copy.splice(idx, 1)[0]);
    }
    return result;
  },

  /** Shuffle array in place (Fisher-Yates) */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  /** Random integer in [min, max] inclusive */
  randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },

  // ─── Text formatting ───────────────────────────────────────────────────

  /** Word-wrap text to a given width, return array of lines */
  wordWrap(text, width = 74) {
    if (!text) return [''];
    const words   = text.split(/\s+/);
    const lines   = [];
    let   current = '';
    for (const word of words) {
      if (current.length + (current ? 1 : 0) + word.length > width) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
    return lines;
  },

  /** Center a string within a field of given width using pad character */
  center(str, width, padChar = ' ') {
    if (str.length >= width) return str.substring(0, width);
    const left  = Math.floor((width - str.length) / 2);
    const right = width - str.length - left;
    return padChar.repeat(left) + str + padChar.repeat(right);
  },

  /** Right-align a string within a field */
  rpad(str, width, padChar = ' ') {
    return String(str).padStart(width, padChar);
  },

  /** Format a number with comma separators: 1234567 → "1,234,567" */
  commaNum(n) {
    return Number(n).toLocaleString('en-US');
  },

  /** Format a duration in seconds as "2h 14m 33s" */
  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  },

  /** Truncate a string with ellipsis if over maxLen */
  truncate(str, maxLen, ellipsis = '…') {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - ellipsis.length) + ellipsis;
  },

  // ─── Date / time helpers ──────────────────────────────────────────────

  /** Return today's date as "YYYY-MM-DD" string (for daily reset checks) */
  todayStr() {
    return new Date().toISOString().slice(0, 10);
  },

  /** Return current Unix timestamp (seconds) */
  now() {
    return Math.floor(Date.now() / 1000);
  },

  /** Has the date changed since lastDateStr? */
  isNewDay(lastDateStr) {
    return Utils.todayStr() !== lastDateStr;
  },

  // ─── 2D map / grid utilities ───────────────────────────────────────────

  /**
   * Create a 2D grid (array of arrays) filled with a default value.
   * Access as grid[row][col].
   */
  makeGrid(rows, cols, fill = 0) {
    return Array.from({ length: rows }, () => new Array(cols).fill(fill));
  },

  /**
   * Simple random dungeon floor generator using cellular automata.
   * Returns a 2D grid where 0=wall, 1=floor.
   * @param {number} rows
   * @param {number} cols
   * @param {number} fillProb - initial wall probability (0.0–1.0), default 0.45
   * @param {number} iterations - smoothing passes, default 5
   */
  generateDungeon(rows, cols, fillProb = 0.45, iterations = 5) {
    // Initial random fill
    let grid = Utils.makeGrid(rows, cols, 0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Always wall the border
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
          grid[r][c] = 0;
        } else {
          grid[r][c] = Math.random() > fillProb ? 1 : 0;
        }
      }
    }

    // Cellular automata smoothing
    for (let i = 0; i < iterations; i++) {
      const next = Utils.makeGrid(rows, cols, 0);
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
          let walls = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (grid[r + dr][c + dc] === 0) walls++;
            }
          }
          next[r][c] = walls <= 4 ? 1 : 0;
        }
      }
      grid = next;
    }

    return grid;
  },

  /**
   * Flood-fill connectivity check — returns true if (r1,c1) can reach (r2,c2)
   * on a grid where passable cells have value 1.
   */
  isConnected(grid, r1, c1, r2, c2) {
    const rows    = grid.length;
    const cols    = grid[0].length;
    const visited = Utils.makeGrid(rows, cols, false);
    const queue   = [[r1, c1]];
    visited[r1][c1] = true;

    while (queue.length > 0) {
      const [r, c] = queue.shift();
      if (r === r2 && c === c2) return true;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
            !visited[nr][nc] && grid[nr][nc] === 1) {
          visited[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
    }
    return false;
  },

  /**
   * Find an open (floor=1) cell in a dungeon grid, randomly.
   * Returns [row, col] or null.
   */
  findOpenCell(grid) {
    const candidates = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === 1) candidates.push([r, c]);
      }
    }
    return candidates.length ? Utils.pick(candidates) : null;
  },

  // ─── Color cycling helper ─────────────────────────────────────────────

  /**
   * Returns a cycling array index — useful for animated color effects.
   * Usage: const fg = RAINBOW[Utils.cycle(frame, RAINBOW.length)];
   */
  cycle(tick, len) {
    return Math.floor(Math.abs(tick)) % len;
  },

  /**
   * Standard rainbow color cycle array (ANSI colors).
   */
  RAINBOW: [
    9,  // bright red
    11, // bright yellow
    10, // bright green
    14, // bright cyan
    12, // bright blue
    13, // bright magenta
  ],

  // ─── Procedural name generator ─────────────────────────────────────────

  /**
   * Generate a random fantasy-sounding name.
   * Useful for NPC names, monster names, planet names, etc.
   */
  randomName() {
    const starts = ['Gar','Bel','Kor','Thal','Zor','Myr','Vel','Drak','Ash','Fen','Var','Eld'];
    const mids   = ['an','ar','el','or','en','in','ath','esh','ul','om','ir','ax'];
    const ends   = ['os','is','us','ak','on','eth','ath','ul','orn','ix','ax','ex'];
    return Utils.pick(starts) + Utils.pick(mids) + Utils.pick(ends);
  },

  /** Generate a random star system name */
  randomStarName() {
    const greek  = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta'];
    const latin  = ['Majoris','Minoris','Centauri','Cygni','Draconis','Orionis','Lyrae'];
    return `${Utils.pick(greek)} ${Utils.pick(latin)}`;
  },

  // ─── HTTP fetch with timeout ──────────────────────────────────────────

  /**
   * Fetch JSON from a URL with a timeout. Returns null on failure.
   * @param {string} url
   * @param {number} timeoutMs
   */
  async fetchJSON(url, timeoutMs = 8000) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return null;
    }
  },

  /**
   * Fetch plain text from a URL with a timeout. Returns null on failure.
   */
  async fetchText(url, timeoutMs = 8000) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch {
      return null;
    }
  },
};

module.exports = Utils;
