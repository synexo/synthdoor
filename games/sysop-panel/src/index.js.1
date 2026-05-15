'use strict';

/**
 * games/sysop-panel/src/index.js
 * SynthDoor Sysop Administration Panel
 *
 * Six screens, navigated by function keys or number keys:
 *   1  Dashboard     — uptime, active connections, quick counts
 *   2  Who's Online  — live session table with kick
 *   3  Game Manager  — registered games, R to refresh/hot-reload
 *   4  Statistics    — top games by plays, top users by logins, averages
 *   5  Log Viewer    — tail of current log file, follow mode, search
 *   6  Role Manager  — list users, promote/demote
 *
 * Access is gated: any non-sysop user who somehow reaches this game
 * sees a refusal and exits immediately.
 */

const path = require('path');
const fs   = require('fs');

const { GameBase, Screen, Draw, Color, CP437 } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const { isSysop } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'roles.js')
);
const { getLogger } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'logger.js')
);

// ─── Layout constants ─────────────────────────────────────────────────────────
const W        = 80;
const H        = 25;
const CONTENT_TOP    = 3;   // first content row (below title + tab bar)
const CONTENT_BOTTOM = 23;  // last content row (above status bar)
const CONTENT_H      = CONTENT_BOTTOM - CONTENT_TOP + 1;  // 21 rows

const SCREENS = ['Dashboard', "Who's Online", 'Game Manager', 'Statistics', 'Log Viewer', 'Role Manager'];

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  TITLE_FG:    Color.BRIGHT_WHITE,
  TITLE_BG:    Color.BLUE,
  TAB_FG:      Color.BLACK,
  TAB_BG:      Color.CYAN,
  TAB_ACT_FG:  Color.BRIGHT_WHITE,
  TAB_ACT_BG:  Color.BLUE,
  HEAD_FG:     Color.BRIGHT_CYAN,
  HEAD_BG:     Color.BLACK,
  BODY_FG:     Color.WHITE,
  BODY_BG:     Color.BLACK,
  DIM_FG:      Color.DARK_GRAY,
  DIM_BG:      Color.BLACK,
  HILITE_FG:   Color.BRIGHT_YELLOW,
  HILITE_BG:   Color.BLACK,
  GOOD_FG:     Color.BRIGHT_GREEN,
  WARN_FG:     Color.BRIGHT_YELLOW,
  ERR_FG:      Color.BRIGHT_RED,
  STATUS_FG:   Color.BLACK,
  STATUS_BG:   Color.CYAN,
  SEL_FG:      Color.BLACK,
  SEL_BG:      Color.CYAN,
  BORDER_FG:   Color.CYAN,
  BORDER_BG:   Color.BLACK,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(s, n)  { return String(s).padEnd(n).slice(0, n); }
function lpad(s, n) { return String(s).padStart(n).slice(-n); }

function fmtDuration(sec) {
  if (sec == null) return '  --:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtDate(epoch) {
  if (!epoch) return 'never';
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function uptime() {
  const s = Math.floor(process.uptime());
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// ─── Main class ───────────────────────────────────────────────────────────────

class SysopPanel extends GameBase {
  static get GAME_NAME()   { return 'sysop-panel'; }
  static get GAME_TITLE()  { return 'Sysop Panel'; }

  async run() {
    // ── Access gate (defence in depth) ───────────────────────────────────
    // This check is intentionally redundant with the router-level role gate.
    // The panel must always refuse non-sysop access regardless of how it was
    // reached — direct rlogin launch, menu bypass, future transports, etc.
    const authMode = this.config.authMode || 'naive';

    // Build a minimal config-like object that isSysop() can call .get() on.
    // this.config is the enriched game config dict, not the server Config instance,
    // so we wrap it to provide the .get() interface isSysop expects.
    const cfgProxy = {
      get: (key, def = '') => {
        const val = this.config[key];
        return (val !== undefined && val !== null) ? String(val) : def;
      }
    };

    if (!isSysop(this.username, cfgProxy, this.db, authMode)) {
      getLogger().warn(`[SysopPanel] ACCESS DENIED username=${this.username} authMode=${authMode}`);
      this.terminal.println('\r\nAccess denied.\r\n');
      return;
    }

    getLogger().info(`[SysopPanel] ENTER username=${this.username}`);

    this.screen.setMode(Screen.FIXED);
    this.terminal.hideCursor();

    this._screen  = 0;       // active screen index
    this._running = true;

    // Screen-local state
    this._logLines   = [];
    this._logOffset  = 0;
    this._logFollow  = false;
    this._logSearch  = '';
    this._roleOffset = 0;
    this._roleSel    = 0;
    this._whoOffset  = 0;
    this._whoSel     = 0;
    this._statOffset = 0;
    this._gameOffset = 0;
    this._gameSel    = 0;

    await this._loop();
  }

  // ─── Main loop ───────────────────────────────────────────────────────────

  async _loop() {
    this._draw();

    while (this._running) {
      // Use input.waitKey() which returns the raw key, but also check if it
      // maps to a named action via the default bindings. We get the raw key
      // and translate it ourselves using the same approach the engine uses.
      const raw = await this.input.waitKey();
      const key = this._translateKey(raw);
      await this._handleKey(key);
      if (this._running) this._draw();
    }
  }

  // Translate raw terminal key to action name where applicable,
  // matching the default bindings in input.js exactly.
  _translateKey(raw) {
    const MAP = {
      '\x1b[A': 'UP',    '\x1bOA': 'UP',
      '\x1b[B': 'DOWN',  '\x1bOB': 'DOWN',
      '\x1b[5~': 'PAGEUP',
      '\x1b[6~': 'PAGEDOWN',
      '\x1b[H': 'HOME',
      '\x1b[F': 'END',
    };
    return MAP[raw] || raw;
  }

  // ─── Key handling ────────────────────────────────────────────────────────

  async _handleKey(key) {
    const k = key.toLowerCase();

    // Global: number keys switch screens
    if (k >= '1' && k <= '6') {
      this._screen = parseInt(k) - 1;
      this._resetOffsets();
      return;
    }

    // Global: Q / ESC exits
    if (k === 'q' || key === '\x1b') {
      this._running = false;
      return;
    }

    // Screen-specific keys
    switch (this._screen) {
      case 0: await this._keyDashboard(key); break;
      case 1: await this._keyWho(key);       break;
      case 2: await this._keyGames(key);     break;
      case 3: await this._keyStat(key);      break;
      case 4: await this._keyLog(key);       break;
      case 5: await this._keyRoles(key);     break;
    }
  }

  _resetOffsets() {
    this._logOffset  = 0;
    this._roleOffset = 0;
    this._roleSel    = 0;
    this._whoOffset  = 0;
    this._whoSel     = 0;
    this._statOffset = 0;
    this._gameOffset = 0;
    this._gameSel    = 0;
    this._logFollow  = false;
    this._logSearch  = '';
  }

  // ─── Master draw ─────────────────────────────────────────────────────────

  _draw() {
    this.screen.clear(C.BODY_FG, C.BODY_BG);
    this._drawChrome();
    switch (this._screen) {
      case 0: this._drawDashboard(); break;
      case 1: this._drawWho();       break;
      case 2: this._drawGames();     break;
      case 3: this._drawStats();     break;
      case 4: this._drawLog();       break;
      case 5: this._drawRoles();     break;
    }
    this.screen.flush();
  }

  // ─── Chrome (title bar + tab bar) ────────────────────────────────────────

  _drawChrome() {
    const s = this.screen;

    // Row 1: title bar
    s.fill(1, 1, W, 1, ' ', C.TITLE_FG, C.TITLE_BG);
    s.putString(2, 1, `SynthDoor Sysop Panel`, C.TITLE_FG, C.TITLE_BG);
    const uptimeStr = `uptime: ${uptime()}`;
    s.putString(W - uptimeStr.length, 1, uptimeStr, C.TITLE_FG, C.TITLE_BG);

    // Row 2: tab bar
    s.fill(1, 2, W, 1, ' ', C.TAB_FG, C.TAB_BG);
    let col = 1;
    for (let i = 0; i < SCREENS.length; i++) {
      const label = ` ${i + 1}:${SCREENS[i]} `;
      const fg = i === this._screen ? C.TAB_ACT_FG : C.TAB_FG;
      const bg = i === this._screen ? C.TAB_ACT_BG : C.TAB_BG;
      s.putString(col, 2, label, fg, bg);
      col += label.length;
    }
  }

  _status(msg, hint = 'Q=quit') {
    const hintStr = ` ${hint} `;
    const left    = ` ${msg}`;
    this.screen.statusBarLR(left, hintStr, C.STATUS_FG, C.STATUS_BG);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN 1 — DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  _drawDashboard() {
    const s     = this.screen;
    const row   = CONTENT_TOP;
    const reg   = this._registry();

    // Stat cards: 3 across
    const cards = [
      { label: 'Active Connections', value: String(reg ? reg.count() : 0), color: C.GOOD_FG },
      { label: 'Games Registered',   value: String(this._router() ? this._router().listGames().length : 0), color: C.HILITE_FG },
      { label: 'Server Uptime',      value: uptime(), color: C.BODY_FG },
    ];

    const cardW = 24;
    cards.forEach((card, i) => {
      const col = 2 + i * (cardW + 2);
      Draw.titledBox(s, col, row, cardW, 5, card.label,
        Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG, C.HEAD_FG, C.HEAD_BG);
      const vStr = card.value.slice(0, cardW - 4);
      s.putString(col + Math.floor((cardW - vStr.length) / 2), row + 2, vStr, card.color, C.BODY_BG);
    });

    // Active sessions mini-table
    const tRow = row + 7;
    s.putString(2, tRow, 'ACTIVE SESSIONS', C.HEAD_FG, C.HEAD_BG);
    Draw.hLine(s, 2, tRow + 1, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);

    const sessions = reg ? reg.list() : [];
    if (sessions.length === 0) {
      s.putString(4, tRow + 2, 'No active connections.', C.DIM_FG, C.DIM_BG);
    } else {
      // Header
      s.putString(2,  tRow + 2, pad('User', 18),        C.HEAD_FG, C.HEAD_BG);
      s.putString(21, tRow + 2, pad('Transport', 10),   C.HEAD_FG, C.HEAD_BG);
      s.putString(32, tRow + 2, pad('Location', 20),    C.HEAD_FG, C.HEAD_BG);
      s.putString(53, tRow + 2, pad('Duration', 10),    C.HEAD_FG, C.HEAD_BG);

      const maxRows = CONTENT_BOTTOM - (tRow + 3);
      sessions.slice(0, maxRows).forEach((sess, i) => {
        const r = tRow + 3 + i;
        s.putString(2,  r, pad(sess.username,  18), C.BODY_FG,   C.BODY_BG);
        s.putString(21, r, pad(sess.transport, 10), C.DIM_FG,    C.DIM_BG);
        s.putString(32, r, pad(sess.location,  20), C.HILITE_FG, C.BODY_BG);
        s.putString(53, r, fmtDuration(sess.connectedSec), C.BODY_FG, C.BODY_BG);
      });
    }

    this._status('Dashboard', '1-6=screens  Q=quit');
  }

  async _keyDashboard(key) {
    // R to refresh (redraw, picks up new session data)
    // No-op — auto-refresh on any key
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN 2 — WHO'S ONLINE
  // ═══════════════════════════════════════════════════════════════════════════

  _drawWho() {
    const s        = this.screen;
    const reg      = this._registry();
    const sessions = reg ? reg.list() : [];
    const pageSize = CONTENT_H - 4;

    const hRow = CONTENT_TOP;
    s.putString(2,  hRow, pad('User', 20),        C.HEAD_FG, C.HEAD_BG);
    s.putString(23, hRow, pad('Transport', 10),   C.HEAD_FG, C.HEAD_BG);
    s.putString(34, hRow, pad('Location', 22),    C.HEAD_FG, C.HEAD_BG);
    s.putString(57, hRow, pad('IP Address', 16),  C.HEAD_FG, C.HEAD_BG);
    s.putString(74, hRow, 'Dur',                  C.HEAD_FG, C.HEAD_BG);
    Draw.hLine(s, 2, hRow + 1, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);

    const visible = sessions.slice(this._whoOffset, this._whoOffset + pageSize);

    if (visible.length === 0) {
      s.putString(4, CONTENT_TOP + 2, 'No active connections.', C.DIM_FG, C.DIM_BG);
    } else {
      visible.forEach((sess, i) => {
        const r   = CONTENT_TOP + 2 + i;
        const sel = i === this._whoSel;
        const fg  = sel ? C.SEL_FG   : C.BODY_FG;
        const bg  = sel ? C.SEL_BG   : C.BODY_BG;
        const loc = sel ? C.SEL_FG   : C.HILITE_FG;
        const dim = sel ? C.SEL_FG   : C.DIM_FG;
        s.putString(2,  r, pad(sess.username,  20), fg,  bg);
        s.putString(23, r, pad(sess.transport, 10), dim, bg);
        s.putString(34, r, pad(sess.location,  22), loc, bg);
        s.putString(57, r, pad(sess.ipAddress || '', 16), dim, bg);
        s.putString(74, r, fmtDuration(sess.connectedSec), fg, bg);
      });
    }

    const total    = sessions.length;
    const absIdx   = this._whoOffset + this._whoSel;
    const selUser  = sessions[absIdx] ? sessions[absIdx].username : '';
    const scrollHint = total > pageSize ? ` (${absIdx + 1}/${total})` : '';
    this._status(`${total} connection(s)${scrollHint}${selUser ? '  sel:' + selUser : ''}`, '^^/v=scroll  K=kick  Q=quit');
  }

  async _keyWho(key) {
    const reg      = this._registry();
    const sessions = reg ? reg.list() : [];
    const pageSize = CONTENT_H - 4;
    const total    = sessions.length;
    const k        = key.toLowerCase();

    if (key === 'UP') {
      if (this._whoSel > 0) {
        this._whoSel--;
      } else if (this._whoOffset > 0) {
        this._whoOffset--;
      }
    }
    if (key === 'DOWN') {
      const maxSel = Math.min(pageSize - 1, total - this._whoOffset - 1);
      if (this._whoSel < maxSel) {
        this._whoSel++;
      } else if (this._whoOffset + pageSize < total) {
        this._whoOffset++;
      }
    }
    if (key === 'PAGEUP') {
      this._whoOffset = Math.max(0, this._whoOffset - pageSize);
      this._whoSel = 0;
    }
    if (key === 'PAGEDOWN') {
      this._whoOffset = Math.min(Math.max(0, total - pageSize), this._whoOffset + pageSize);
      this._whoSel = 0;
    }

    if (k === 'k' && total > 0 && reg) {
      const absIdx = this._whoOffset + this._whoSel;
      const target = sessions[absIdx];
      if (target && target.username !== this.username) {
        const confirmed = await this._confirm(`Kick ${target.username}?`);
        if (confirmed) {
          reg.kick(target.id);
          getLogger().info(`[SysopPanel] KICK username=${target.username} by sysop=${this.username}`);
          this._whoSel = 0;
        }
      } else if (target && target.username === this.username) {
        await this._alert('Cannot kick yourself.');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN 3 — GAME MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  // Build the display list: virtual "All Games" entry at index 0, then real games
  _gameList(router) {
    const games = router ? router.listGames() : [];
    return [
      { name: null, title: 'Reload ALL games', dir: '— full rediscover —', _all: true },
      ...games,
    ];
  }

  _drawGames() {
    const s        = this.screen;
    const router   = this._router();
    const list     = this._gameList(router);
    const pageSize = CONTENT_H - 4;

    const hRow = CONTENT_TOP;
    s.putString(2,  hRow, pad('Game Name', 22),  C.HEAD_FG, C.HEAD_BG);
    s.putString(25, hRow, pad('Title', 34),       C.HEAD_FG, C.HEAD_BG);
    s.putString(60, hRow, pad('Directory', 18),   C.HEAD_FG, C.HEAD_BG);
    Draw.hLine(s, 2, hRow + 1, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);

    const visible = list.slice(this._gameOffset, this._gameOffset + pageSize);

    if (visible.length === 0) {
      s.putString(4, CONTENT_TOP + 2, 'No games registered.', C.DIM_FG, C.DIM_BG);
    } else {
      visible.forEach((entry, i) => {
        const r   = CONTENT_TOP + 2 + i;
        const sel = i === this._gameSel;
        const bg  = sel ? C.SEL_BG : C.BODY_BG;

        if (entry._all) {
          // "All Games" virtual row — always bright, distinct style
          const fg = sel ? C.SEL_FG : C.BRIGHT_WHITE || Color.BRIGHT_WHITE;
          s.putString(2,  r, pad('[ All Games ]', 22), sel ? C.SEL_FG : C.HILITE_FG, bg);
          s.putString(25, r, pad(entry.title, 34),     sel ? C.SEL_FG : C.BODY_FG,   bg);
          s.putString(60, r, pad(entry.dir,   18),     sel ? C.SEL_FG : C.DIM_FG,    bg);
        } else {
          s.putString(2,  r, pad(entry.name,  22), sel ? C.SEL_FG : C.HILITE_FG, bg);
          s.putString(25, r, pad(entry.title, 34), sel ? C.SEL_FG : C.BODY_FG,   bg);
          s.putString(60, r, pad(entry.dir,   18), sel ? C.SEL_FG : C.DIM_FG,    bg);
        }
      });
    }

    const total   = list.length;
    const absIdx  = this._gameOffset + this._gameSel;
    const sel     = list[absIdx];
    const selLabel = sel ? (sel._all ? 'All Games' : sel.name) : '';
    const scrollHint = total > pageSize ? ` (${absIdx + 1}/${total})` : '';
    this._status(`${total - 1} game(s)${scrollHint}  sel:${selLabel}`, '^^/v=scroll  R=reload selected  Q=quit');
  }

  async _keyGames(key) {
    const router   = this._router();
    const list     = this._gameList(router);
    const pageSize = CONTENT_H - 4;
    const total    = list.length;
    const k        = key.toLowerCase();

    if (key === 'UP') {
      if (this._gameSel > 0) {
        this._gameSel--;
      } else if (this._gameOffset > 0) {
        this._gameOffset--;
      }
    }
    if (key === 'DOWN') {
      const maxSel = Math.min(pageSize - 1, total - this._gameOffset - 1);
      if (this._gameSel < maxSel) {
        this._gameSel++;
      } else if (this._gameOffset + pageSize < total) {
        this._gameOffset++;
      }
    }
    if (key === 'PAGEUP') {
      this._gameOffset = Math.max(0, this._gameOffset - pageSize);
      this._gameSel = 0;
    }
    if (key === 'PAGEDOWN') {
      this._gameOffset = Math.min(Math.max(0, total - pageSize), this._gameOffset + pageSize);
      this._gameSel = 0;
    }

    if (k === 'r' && router) {
      const absIdx  = this._gameOffset + this._gameSel;
      const sel     = list[absIdx];

      if (sel && sel._all) {
        const confirmed = await this._confirm('Reload ALL games? (players in-game finish on old code)');
        if (confirmed) {
          this._drawProgress('Reloading all games...');
          router.rediscover();
          getLogger().info(`[SysopPanel] REDISCOVER by sysop=${this.username}`);
          this._gameOffset = 0;
          this._gameSel    = 0;
        }
      } else if (sel) {
        const confirmed = await this._confirm(`Reload ${sel.name}? (players in-game finish on old code)`);
        if (confirmed) {
          this._drawProgress(`Reloading ${sel.name}...`);
          const ok = router.reloadGame(sel.name);
          if (ok) {
            getLogger().info(`[SysopPanel] RELOAD_GAME game=${sel.name} by sysop=${this.username}`);
          } else {
            await this._alert(`Reload failed for ${sel.name} — check logs.`);
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN 4 — STATISTICS
  // ═══════════════════════════════════════════════════════════════════════════

  _drawStats() {
    const s   = this.screen;
    let row   = CONTENT_TOP;

    // Top games
    s.putString(2, row, 'TOP GAMES BY PLAYS', C.HEAD_FG, C.HEAD_BG);
    row++;
    Draw.hLine(s, 2, row, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);
    row++;

    const gameStats = this.db ? this.db.getGameStats() : [];
    if (gameStats.length === 0) {
      s.putString(4, row, 'No game data yet.', C.DIM_FG, C.DIM_BG);
      row++;
    } else {
      // Column headers
      s.putString(2,  row, pad('Game', 22),      C.DIM_FG, C.DIM_BG);
      s.putString(25, row, lpad('Plays', 7),     C.DIM_FG, C.DIM_BG);
      s.putString(34, row, lpad('Sessions', 10), C.DIM_FG, C.DIM_BG);
      s.putString(46, row, lpad('Avg Dur', 8),   C.DIM_FG, C.DIM_BG);
      row++;

      const maxGameRows = 8;
      gameStats.slice(0, maxGameRows).forEach(g => {
        s.putString(2,  row, pad(g.game, 22),                    C.HILITE_FG, C.BODY_BG);
        s.putString(25, row, lpad(g.play_count, 7),              C.BODY_FG,   C.BODY_BG);
        s.putString(34, row, lpad(g.session_count, 10),          C.BODY_FG,   C.BODY_BG);
        s.putString(46, row, lpad(fmtDuration(Math.round(g.avg_duration_sec)), 8), C.BODY_FG, C.BODY_BG);
        row++;
      });
    }

    row++;

    // Top users by login count
    s.putString(2, row, 'TOP USERS BY LOGINS', C.HEAD_FG, C.HEAD_BG);
    row++;
    Draw.hLine(s, 2, row, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);
    row++;

    const topUsers = this.db ? this.db.getTopUsers(10) : [];
    if (topUsers.length === 0) {
      s.putString(4, row, 'No login data yet.', C.DIM_FG, C.DIM_BG);
    } else {
      s.putString(2,  row, pad('User', 24),          C.DIM_FG, C.DIM_BG);
      s.putString(27, row, lpad('Logins', 8),        C.DIM_FG, C.DIM_BG);
      s.putString(37, row, pad('Last Seen', 12),     C.DIM_FG, C.DIM_BG);
      row++;

      const remaining = CONTENT_BOTTOM - row;
      topUsers.slice(0, remaining).forEach(u => {
        s.putString(2,  row, pad(u.username, 24),           C.BODY_FG,   C.BODY_BG);
        s.putString(27, row, lpad(u.login_count, 8),        C.HILITE_FG, C.BODY_BG);
        s.putString(37, row, pad(fmtDate(u.last_seen), 12), C.DIM_FG,    C.BODY_BG);
        row++;
      });
    }

    this._status('Statistics', '1-6=screens  Q=quit');
  }

  async _keyStat(key) { /* read-only */ }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN 5 — LOG VIEWER
  // ═══════════════════════════════════════════════════════════════════════════

  _loadLogLines() {
    // Resolve logs directory the same way the server does:
    // project root is three levels up from games/sysop-panel/src/
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    const router      = this._router();
    let logsDir;

    if (router && router.config && typeof router.config.get === 'function') {
      logsDir = path.resolve(projectRoot, router.config.get('logs_dir', './logs'));
    } else {
      logsDir = path.resolve(projectRoot, 'logs');
    }

    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const logPath = path.join(logsDir, `synthdoor-${stamp}.log`);

    try {
      const raw   = fs.readFileSync(logPath, 'utf8');
      const lines = raw.split('\n').filter(l => l.trim());
      return lines;
    } catch (_) {
      return [`[Log file not found: ${logPath}]`];
    }
  }

  _drawLog() {
    const s        = this.screen;
    const allLines = this._loadLogLines();

    // Apply search filter
    const lines = this._logSearch
      ? allLines.filter(l => l.toLowerCase().includes(this._logSearch.toLowerCase()))
      : allLines;

    const pageSize = CONTENT_H - 2;

    // In follow mode, pin to the end
    if (this._logFollow) {
      this._logOffset = Math.max(0, lines.length - pageSize);
    }

    // Clamp offset
    this._logOffset = Math.max(0, Math.min(this._logOffset, Math.max(0, lines.length - pageSize)));

    // Header row
    const searchInfo = this._logSearch ? ` [filter: "${this._logSearch}"]` : '';
    const followInfo = this._logFollow ? ' [FOLLOW]' : '';
    s.putString(2, CONTENT_TOP, `Log Viewer${searchInfo}${followInfo}`, C.HEAD_FG, C.HEAD_BG);
    Draw.hLine(s, 2, CONTENT_TOP + 1, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);

    const visible = lines.slice(this._logOffset, this._logOffset + pageSize);

    visible.forEach((line, i) => {
      const r = CONTENT_TOP + 2 + i;

      // Colour by level
      let fg = C.BODY_FG;
      if (line.includes('[ERROR]')) fg = C.ERR_FG;
      else if (line.includes('[WARN ]')) fg = C.WARN_FG;
      else if (line.includes('[Game] ENTER') || line.includes('[Game] EXIT')) fg = C.GOOD_FG;
      else if (line.includes('[Session] LOGIN') || line.includes('[Session] LOGOFF')) fg = C.HILITE_FG;

      // Highlight search term
      const display = line.slice(0, W - 3);
      s.putString(2, r, pad(display, W - 3), fg, C.BODY_BG);
    });

    const total = lines.length;
    const pct   = total > 0 ? Math.round((this._logOffset + pageSize) / total * 100) : 100;
    s.putString(2, CONTENT_BOTTOM, `Line ${this._logOffset + 1}-${Math.min(this._logOffset + pageSize, total)} of ${total} (${pct}%)`, C.DIM_FG, C.DIM_BG);

    this._status(
      this._logFollow ? 'Following log...' : 'Log viewer',
      '^^/v=scroll  F=follow  /=search  Q=quit'
    );
  }

  async _keyLog(key) {
    const allLines = this._loadLogLines();
    const lines    = this._logSearch
      ? allLines.filter(l => l.toLowerCase().includes(this._logSearch.toLowerCase()))
      : allLines;
    const pageSize = CONTENT_H - 2;
    const k        = key.toLowerCase();

    if (key === 'UP'   || key === 'k') { this._logFollow = false; this._logOffset = Math.max(0, this._logOffset - 1); }
    if (key === 'DOWN' || key === 'j') { this._logFollow = false; this._logOffset = Math.min(Math.max(0, lines.length - pageSize), this._logOffset + 1); }
    if (key === 'PAGEUP')   { this._logFollow = false; this._logOffset = Math.max(0, this._logOffset - pageSize); }
    if (key === 'PAGEDOWN') { this._logFollow = false; this._logOffset = Math.min(Math.max(0, lines.length - pageSize), this._logOffset + pageSize); }
    if (key === 'HOME') { this._logFollow = false; this._logOffset = 0; }
    if (key === 'END')  { this._logFollow = false; this._logOffset = Math.max(0, lines.length - pageSize); }
    if (k === 'f')      { this._logFollow = !this._logFollow; }

    if (k === '/') {
      const q = await this._prompt('Search: ');
      this._logSearch = q.trim();
      this._logOffset = 0;
      this._logFollow = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREEN 6 — ROLE MANAGER
  // ═══════════════════════════════════════════════════════════════════════════

  _drawRoles() {
    const s        = this.screen;
    const isNaive  = (this.config.authMode || 'naive') === 'naive';
    const players  = this.db ? this._allPlayersWithRoles() : [];
    const pageSize = CONTENT_H - (isNaive ? 6 : 4);

    let tableTop = CONTENT_TOP;
    if (isNaive) {
      s.putString(2, CONTENT_TOP,     'NOTE: Naive mode active. Role changes are stored in the DB', C.WARN_FG,  C.BODY_BG);
      s.putString(2, CONTENT_TOP + 1, 'but have no effect until auth_mode = authenticated.', C.DIM_FG, C.BODY_BG);
      tableTop = CONTENT_TOP + 2;
    }

    const hRow = tableTop;
    s.putString(2,  hRow, pad('Username', 28),  C.HEAD_FG, C.HEAD_BG);
    s.putString(31, hRow, pad('Role', 12),       C.HEAD_FG, C.HEAD_BG);
    s.putString(44, hRow, pad('Logins', 8),      C.HEAD_FG, C.HEAD_BG);
    s.putString(53, hRow, pad('Last Seen', 12),  C.HEAD_FG, C.HEAD_BG);
    Draw.hLine(s, 2, hRow + 1, W - 3, Draw.BOX_SINGLE, C.BORDER_FG, C.BORDER_BG);

    const visible = players.slice(this._roleOffset, this._roleOffset + pageSize);

    if (visible.length === 0) {
      s.putString(4, tableTop + 2, 'No players found.', C.DIM_FG, C.DIM_BG);
    } else {
      visible.forEach((p, i) => {
        const r      = tableTop + 2 + i;
        const sel    = i === this._roleSel;
        const isSelf = p.username === this.username;
        const bg     = sel ? C.SEL_BG   : C.BODY_BG;
        const nameFg = sel ? C.SEL_FG   : (isSelf ? C.GOOD_FG : C.BODY_FG);
        const roleFg = sel ? C.SEL_FG   : (p.role === 'sysop' ? C.WARN_FG : C.DIM_FG);
        const dimFg  = sel ? C.SEL_FG   : C.DIM_FG;
        s.putString(2,  r, pad(p.username, 28),            nameFg,    bg);
        s.putString(31, r, pad(p.role, 12),                roleFg,    bg);
        s.putString(44, r, lpad(p.login_count || 0, 8),   C.BODY_FG, bg);
        s.putString(53, r, pad(fmtDate(p.last_seen), 12), dimFg,     bg);
      });
    }

    const total   = players.length;
    const absIdx  = this._roleOffset + this._roleSel;
    const selUser = players[absIdx] ? players[absIdx].username : '';
    const scrollHint = total > pageSize ? ` (${absIdx + 1}/${total})` : '';
    this._status(`${total} player(s)${scrollHint}${selUser ? '  sel:' + selUser : ''}`, '^^/v=scroll  P=promote  D=demote  Q=quit');
  }

  async _keyRoles(key) {
    const players  = this.db ? this._allPlayersWithRoles() : [];
    const isNaive  = (this.config.authMode || 'naive') === 'naive';
    const pageSize = CONTENT_H - (isNaive ? 6 : 4);
    const total    = players.length;
    const k        = key.toLowerCase();

    if (key === 'UP') {
      if (this._roleSel > 0) {
        this._roleSel--;
      } else if (this._roleOffset > 0) {
        this._roleOffset--;
      }
    }
    if (key === 'DOWN') {
      const maxSel = Math.min(pageSize - 1, total - this._roleOffset - 1);
      if (this._roleSel < maxSel) {
        this._roleSel++;
      } else if (this._roleOffset + pageSize < total) {
        this._roleOffset++;
      }
    }
    if (key === 'PAGEUP') {
      this._roleOffset = Math.max(0, this._roleOffset - pageSize);
      this._roleSel = 0;
    }
    if (key === 'PAGEDOWN') {
      this._roleOffset = Math.min(Math.max(0, total - pageSize), this._roleOffset + pageSize);
      this._roleSel = 0;
    }

    if ((k === 'p' || k === 'd') && total > 0) {
      const absIdx = this._roleOffset + this._roleSel;
      const target = players[absIdx];
      if (!target) return;

      if (k === 'd' && target.username === this.username) {
        await this._alert('Cannot demote yourself.');
        return;
      }

      const newRole = k === 'p' ? 'sysop' : 'user';
      if (target.role === newRole) {
        await this._alert(`${target.username} already has role: ${newRole}`);
        return;
      }

      const action = k === 'p' ? 'Promote' : 'Demote';
      const confirmed = await this._confirm(`${action} ${target.username} to ${newRole}?`);
      if (confirmed) {
        this.db.setRole(target.username, newRole);
        getLogger().info(`[SysopPanel] ROLE_CHANGE username=${target.username} role=${newRole} by sysop=${this.username}`);
      }
    }
  }

  _allPlayersWithRoles() {
    try {
      return this.db._db.prepare(
        `SELECT username, role, login_count, last_seen
         FROM players ORDER BY role DESC, login_count DESC`
      ).all();
    } catch (_) {
      return [];
    }
  }

  // ─── UI helpers ──────────────────────────────────────────────────────────

  /** Display a confirmation prompt in the status bar. Returns true/false. */
  async _confirm(msg) {
    this.screen.statusBar(` ${msg} [Y/N] `, C.WARN_FG, Color.BLACK);
    this.screen.flush();

    while (true) {
      const k = (await this.input.waitKey()).toLowerCase();
      if (k === 'y') return true;
      if (k === 'n' || k === '\x1b') return false;
    }
  }

  /** Display a brief message and wait for a keypress. */
  async _alert(msg) {
    this.screen.statusBar(` ${msg}  [any key]`, C.ERR_FG, Color.BLACK);
    this.screen.flush();
    await this.input.waitKey();
  }

  /** Inline prompt in the status bar. Returns typed string. */
  async _prompt(label) {
    this.screen.statusBar(` ${label}`, C.STATUS_FG, C.STATUS_BG);
    this.screen.flush();
    this.terminal.showCursor();
    // Move cursor to after the label on row 25
    this.terminal.moveTo(2 + label.length, H);
    const result = await this.terminal.readLine({ maxLen: 40, echo: true });
    this.terminal.hideCursor();
    return result;
  }

  /** Brief progress message while a blocking op runs. */
  _drawProgress(msg) {
    this.screen.statusBar(` ${msg}`, C.GOOD_FG, Color.BLACK);
    this.screen.flush();
  }

  // ─── Server object accessors ─────────────────────────────────────────────
  // The panel receives the router and registry via the config object,
  // which game-router populates before launch.

  _router()   { return this.config._router   || null; }
  _registry() { return this.config._registry || null; }
}

module.exports = SysopPanel;
