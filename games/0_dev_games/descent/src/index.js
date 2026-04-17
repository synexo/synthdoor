'use strict';

/**
 * descent/src/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * DESCENT INTO THE VOID — vertical SHMUP for SynthDoor
 *
 * GAME SIMULATION MODEL
 * ══════════════════════
 * The game runs a pure physics simulation. It is unaware of:
 *   - Terminal rows or columns
 *   - Whether a scroll happened
 *   - Ghost tracking or erasure
 *   - Render timing
 *   - How objects appear on screen
 *
 * The game only knows:
 *   - Player is at viewport col/row (1-based terminal coordinates for overlay)
 *   - Scroll objects are at simCol/simRow (simulation space)
 *   - Collision: engine.getCollisionAt(simCol, simRow) for terrain
 *   - Collision: engine.getCollisionAtViewport(col, row) for overlay vs terrain
 *   - engine.getBottomSimRow() returns where to spawn new objects
 *
 * SIMULATION TICK RATE
 * ═════════════════════
 * One simulation tick = one step of all physics.
 * The loop runs at SIM_FPS. Each sim tick:
 *   1. Game updates all physics (player, bullets, enemies)
 *   2. Game calls engine.tick() — engine handles scroll and render internally
 *
 * Bullet speed = 1 sim cell per sim tick. At SIM_FPS=20, bullets travel at
 * 20 cells/second. No "skip 2 rows" — every position is visited every tick.
 *
 * Player uses fractional accumulator: velocity decays via drag, accumulator
 * advances each tick, cell movement fires when accumulator crosses ±1.0.
 *
 * ENGINE DIVISORS (all in sim ticks between updates):
 *   SCROLL_DIVISOR — sim ticks per scroll tick (1=scroll every sim tick)
 *   RENDER_DIVISOR — sim ticks per render frame
 *   HUD_DIVISOR    — sim ticks per HUD content rebuild
 *
 * COORDINATE SYSTEMS
 * ═══════════════════
 * Overlay objects (player, bullets, risers, enemy bullets):
 *   .col/.row — 1-based terminal column/row. Never scroll-shifted.
 *   Collision: engine.getCollisionAtViewport(col, row)
 *
 * Scroll objects (drifters):
 *   .simCol/.simRow — simulation coordinates. simRow is an absolute world row.
 *   Spawn at engine.getBottomSimRow(). Visual position computed by engine.
 *   Collision: engine.getCollisionAt(simCol, simRow)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path = require('path');

const { GameBase } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

const ScrollEngine  = require(path.join(__dirname, 'scroll-engine.js'));
const { LAYER, ENTITY_STATE } = ScrollEngine;

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURABLES
// ═══════════════════════════════════════════════════════════════════════════

const CFG = {

  // ── Display ───────────────────────────────────────────────────────────────

  ROWS:        24,
  TOTAL_WIDTH: 79,
  BORDER_COLS: true,
  BORDER_CHAR: '\u2551',

  // ── Simulation and engine rates ───────────────────────────────────────────
  //
  // All divisors: sim ticks between updates. Higher = less frequent.
  //
  // SIM_FPS: how fast the simulation runs. This controls game speed.
  //   At 20fps, bullets travel 1 cell/tick = 20 cells/sec.
  //
  // SCROLL_DIVISOR: 1 = scroll every sim tick. 4 = every 4th tick.
  //   Lower = faster scroll (world moves faster past player).
  //
  // RENDER_DIVISOR: 1 = render every sim tick. 2 = every 2nd tick.
  //   Lower = smoother animation. Higher = lower bandwidth.
  //
  // HUD_DIVISOR: HUD content (score/lives text) rebuilt this often.

  SIM_FPS:        100,
  SCROLL_DIVISOR: 1,    // ~5 scrolls/sec at 20fps — comfortable for testing
  RENDER_DIVISOR: 1,    // render every sim tick (sim is already 20fps)
  HUD_DIVISOR:    10,   // HUD content rebuilt 2x/sec

  // ── Player ────────────────────────────────────────────────────────────────

  PLAYER_CHAR:          'V',
  PLAYER_START_COL:     40,   // viewport col (1-based)
  PLAYER_START_ROW:     5,    // viewport row (1-based)
  PLAYER_COL_MIN:       2,    // leftmost column (inside border)
  PLAYER_COL_MAX:       78,   // rightmost column (inside border)
  PLAYER_ROW_MIN:       2,    // topmost row (below HUD)
  PLAYER_ROW_MAX:       14,   // bottommost row
  PLAYER_LIVES:         333,
  PLAYER_INVULN_TICKS:  40,   // sim ticks of invulnerability after hit (2 sec at 20fps)

  // Fractional movement: velocity impulse per keypress, drag per tick
  PLAYER_ACCEL:     0.8,   // velocity added per keypress
  PLAYER_MAX_SPEED: 3.0,   // max velocity magnitude per axis
  PLAYER_DRAG:      0.8,  // velocity multiplied by this each tick
  PLAYER_MIN_SPEED: 0.05,  // snap to zero below this

  // ── Player bullets ────────────────────────────────────────────────────────

  BULLET_CHAR:         '|',
  BULLET_SPEED:        1,   // cells per sim tick (1 = visits every row)
  FIRE_COOLDOWN_TICKS: 4,   // sim ticks between shots
  MAX_PLAYER_BULLETS:  4,

  // ── Drifter (SCROLL_OBJECT) ───────────────────────────────────────────────

  DRIFTER_CHAR:         'O',
  DRIFTER_SCORE:        100,
  DRIFTER_SPAWN_CHANCE: 0.05,
  DRIFTER_WALL_MARGIN:  3,

  // ── Riser (promoted drifter — OVERLAY_OBJECT) ─────────────────────────────

  RISER_INTERVAL_TICKS: 60,   // sim ticks between promotions (~3 sec at 20fps)
  RISER_MOVE_EVERY:     4,    // sim ticks between upward steps
  RISER_FIRE_EVERY:     15,   // sim ticks between shots
  RISER_SCORE:          300,
  RISER_CHAR:           'O',

  // ── Enemy bullets ─────────────────────────────────────────────────────────

  ENEMY_BULLET_CHAR:  '*',
  ENEMY_BULLET_SPEED: 0.6,   // accumulator advance per sim tick per active axis
  MAX_ENEMY_BULLETS:  8,

  // ── Tunnel walls ─────────────────────────────────────────────────────────

  WALL_CHAR:       '\u2593',
  WALL_MIN:        4,
  WALL_MAX:        16,
  WALL_DRIFT_RATE: 1,
  WALL_WAVE_FREQ:  0.10,
  WALL_WAVE_AMP:   6,

  // ── Stars ─────────────────────────────────────────────────────────────────

  STAR_CHANCE: 0.04,
  STAR_CHARS:  ['.', '\'', '*'],

  // ── Scoring ───────────────────────────────────────────────────────────────

  SCORE_PER_SCROLL: 1,

  // ── Debug colors ──────────────────────────────────────────────────────────

  COLOR: {
    RESET:       '\x1b[0m',
    SCROLL_BG:   '\x1b[0;34m',   // blue          — SCROLL_BACKGROUND
    SCROLL_ENV:  '\x1b[1;34m',   // bright blue   — SCROLL_ENVIRONMENT
    SCROLL_OBJ:  '\x1b[0;31m',   // red           — SCROLL_OBJECT (drifters)
    OVERLAY_HUD: '\x1b[1;37m',   // white         — OVERLAY_HUD
    OVERLAY_OBJ: '\x1b[1;31m',   // bright red    — OVERLAY_OBJECT
    PLAYER:      '\x1b[1;32m',   // bright green  — player
    PLAYER_HIT:  '\x1b[1;37m',   // bright white  — invuln flash
    BORDER:      '\x1b[1;34m',   // bright blue   — borders
  },
};

// ── Derived ────────────────────────────────────────────────────────────────
const INNER_WIDTH = CFG.BORDER_COLS ? CFG.TOTAL_WIDTH - 2 : CFG.TOTAL_WIDTH;
const SIM_MS      = Math.floor(1000 / CFG.SIM_FPS);

// ═══════════════════════════════════════════════════════════════════════════
// SPRITE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildSprite(lines, colorCode) {
  const cells = [];
  for (let dy = 0; dy < lines.length; dy++) {
    for (let dx = 0; dx < lines[dy].length; dx++) {
      const ch = lines[dy][dx];
      if (ch !== ' ') cells.push({ dx, dy, ch, colorCode });
    }
  }
  return cells;
}

const SPRITE_PLAYER     = buildSprite([CFG.PLAYER_CHAR], CFG.COLOR.PLAYER);
const SPRITE_PLAYER_HIT = buildSprite([CFG.PLAYER_CHAR], CFG.COLOR.PLAYER_HIT);
const SPRITE_DRIFTER    = buildSprite([CFG.DRIFTER_CHAR], CFG.COLOR.SCROLL_OBJ);
const SPRITE_RISER      = buildSprite([CFG.RISER_CHAR],   CFG.COLOR.OVERLAY_OBJ);

// ═══════════════════════════════════════════════════════════════════════════
// GAME CLASS
// ═══════════════════════════════════════════════════════════════════════════

class Descent extends GameBase {
  static get GAME_NAME()  { return 'descent'; }
  static get GAME_TITLE() { return 'Descent Into the Void'; }

  async run() {
    this._running  = true;
    this._score    = 0;
    this._wave     = 1;
    this._simTick  = 0;

    // World state for row generator
    this._wallLeft  = CFG.WALL_MIN + 3;
    this._wallRight = CFG.WALL_MIN + 3;

    this._riserCooldown = CFG.RISER_INTERVAL_TICKS;

    // ── ScrollEngine ───────────────────────────────────────────────────────
    this._eng = new ScrollEngine(this.terminal, {
      rows:          CFG.ROWS,
      totalWidth:    CFG.TOTAL_WIDTH,
      borderCols:    CFG.BORDER_COLS,
      borderChar:    CFG.BORDER_CHAR,
      borderColor:   CFG.COLOR.BORDER,
      scrollDivisor: CFG.SCROLL_DIVISOR,
      renderDivisor: CFG.RENDER_DIVISOR,
      hudDivisor:    CFG.HUD_DIVISOR,
      rowGenerator:  (w, tick) => this._generateRow(w, tick),
      defaultBg:     CFG.COLOR.RESET,
    });

    // ── Player (OVERLAY_OBJECT — viewport coordinates) ─────────────────────
    this._player = {
      col:     CFG.PLAYER_START_COL,   // 1-based terminal column
      row:     CFG.PLAYER_START_ROW,   // 1-based terminal row
      velCol:  0, velRow:  0,
      accCol:  0, accRow:  0,
      lives:   CFG.PLAYER_LIVES,
      invuln:  0,
      cooldown: 0,
      sprite:  SPRITE_PLAYER,
      hitbox:  [{ dx: 0, dy: 0 }],
    };
    this._eng.addOverlayObject(this._player);

    // Bullet pools — overlay objects with viewport coordinates
    this._playerBullets = [];
    this._enemyBullets  = [];

    // Input
    this._keyLeft  = false;
    this._keyRight = false;
    this._keyUp    = false;
    this._keyDown  = false;
    this._wantFire = false;

    // ── Init ───────────────────────────────────────────────────────────────
    this._eng.init(true);
    this._setupInput();
    this._updateHUDContent();

    this.screen.statusBar('  ARROWS=Move  SPACE/ENTER=Fire  Q=Quit', 0, 6);
    this.screen.flush();

    // ── Simulation loop ────────────────────────────────────────────────────
    //
    // One tick = one simulation step.
    // Physics advance exactly 1 step per tick.
    // Engine handles scroll + render timing internally via divisors.
    //
    while (this._running && this._player.lives > 0) {
      const t0 = Date.now();
      this._simTick++;

      // 1. Update all game physics
      this._updateSim();

      // 2. Engine tick: advances scroll, renders if due, draws HUD if due
      const { scrolled } = this._eng.tick();
      if (scrolled) this._score += CFG.SCORE_PER_SCROLL;

      await this._sleep(Math.max(0, SIM_MS - (Date.now() - t0)));
    }

    await this._showGameOver();
  }

  async onDisconnect() {
    this._running = false;
    this._eng?.destroy();
    this.input.removeAllListeners('action');
    this.terminal.removeAllListeners('key');
    this.input.stop();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INPUT
  // ─────────────────────────────────────────────────────────────────────────

  _setupInput() {
    this.input.start();
    this.input.on('action', (action) => {
      if (!this._running) return;
      switch (action) {
        case 'LEFT':    this._keyLeft  = true; break;
        case 'RIGHT':   this._keyRight = true; break;
        case 'UP':      this._keyUp    = true; break;
        case 'DOWN':    this._keyDown  = true; break;
        case 'CONFIRM': this._wantFire = true; break;
        case 'QUIT':    this._running  = false; break;
      }
    });
    this.terminal.on('key', (key) => {
      if (key === ' ') this._wantFire = true;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HUD — game builds the string, engine renders it
  // ─────────────────────────────────────────────────────────────────────────

  _updateHUDContent() {
    const score  = `SCORE:${String(this._score).padStart(7, '0')}`;
    const lives  = `LIVES:${this._player.lives}`;
    const wave   = `WAVE:${this._wave}`;
    const inner  = ` ${score}   ${wave}   ${lives} `;
    const padded = inner.padEnd(INNER_WIDTH).substring(0, INNER_WIDTH);
    const full   = CFG.BORDER_COLS
      ? CFG.BORDER_CHAR + padded + CFG.BORDER_CHAR
      : padded;
    this._eng.setHUDLine(1, full, CFG.COLOR.OVERLAY_HUD);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ROW GENERATOR
  // ─────────────────────────────────────────────────────────────────────────

  _generateRow(innerWidth, tick) {
    const W = innerWidth;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const targL = clamp(
      CFG.WALL_MIN + Math.round(CFG.WALL_WAVE_AMP *
        (0.5 + 0.5 * Math.sin(tick * CFG.WALL_WAVE_FREQ))),
      CFG.WALL_MIN, CFG.WALL_MAX
    );
    const targR = clamp(
      CFG.WALL_MIN + Math.round(CFG.WALL_WAVE_AMP *
        (0.5 + 0.5 * Math.sin(tick * CFG.WALL_WAVE_FREQ + 1.8))),
      CFG.WALL_MIN, CFG.WALL_MAX
    );

    if (this._wallLeft  < targL) this._wallLeft  = Math.min(this._wallLeft  + CFG.WALL_DRIFT_RATE, targL);
    if (this._wallLeft  > targL) this._wallLeft  = Math.max(this._wallLeft  - CFG.WALL_DRIFT_RATE, targL);
    if (this._wallRight < targR) this._wallRight = Math.min(this._wallRight + CFG.WALL_DRIFT_RATE, targR);
    if (this._wallRight > targR) this._wallRight = Math.max(this._wallRight - CFG.WALL_DRIFT_RATE, targR);

    const wallL = this._wallLeft;
    const wallR = this._wallRight;

    const chars       = new Array(W).fill(' ');
    const environment = new Array(W).fill(LAYER.EMPTY);

    for (let x = 0; x < wallL && x < W; x++) {
      chars[x] = CFG.WALL_CHAR;
      environment[x] = LAYER.SCROLL_ENVIRONMENT;
    }
    for (let x = Math.max(0, W - wallR); x < W; x++) {
      chars[x] = CFG.WALL_CHAR;
      environment[x] = LAYER.SCROLL_ENVIRONMENT;
    }
    for (let x = wallL; x < W - wallR; x++) {
      if (Utils.chance(CFG.STAR_CHANCE)) {
        chars[x] = Utils.pick(CFG.STAR_CHARS);
        environment[x] = LAYER.SCROLL_BACKGROUND;
      }
    }

    // Spawn drifter at bottom of viewport (sim row = engine.getBottomSimRow())
    const corridor = W - wallR - wallL;
    if (corridor > CFG.DRIFTER_WALL_MARGIN * 2 &&
        Utils.chance(CFG.DRIFTER_SPAWN_CHANCE)) {
      const simCol = Utils.randInt(
        wallL + CFG.DRIFTER_WALL_MARGIN,
        W - wallR - CFG.DRIFTER_WALL_MARGIN - 1
      );
      this._eng.addScrollObject({
        simCol,
        simRow:  this._eng.getBottomSimRow(),
        sprite:  SPRITE_DRIFTER,
        hitbox:  [{ dx: 0, dy: 0 }],
        isRiser: false,
      });
    }

    const palette = [
      CFG.COLOR.SCROLL_BG,
      CFG.COLOR.SCROLL_BG,
      CFG.COLOR.SCROLL_ENV,
      CFG.COLOR.SCROLL_BG,
    ];
    return {
      chars,
      colorCode:   palette[Math.floor(tick / 4) % palette.length],
      environment,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SIMULATION UPDATE — one step per sim tick
  // No terminal coordinates, no render concerns, pure physics.
  // ─────────────────────────────────────────────────────────────────────────

  _updateSim() {
    this._updatePlayer();
    this._updatePlayerBullets();
    this._updateEnemyBullets();
    this._updateRisers();
    this._updateRiserSpawning();
    if (this._simTick % CFG.HUD_DIVISOR === 0) this._updateHUDContent();
    this._eng.removeDeadEntities();
    this._playerBullets = this._playerBullets.filter(b => b.state !== ENTITY_STATE.DEAD);
    this._enemyBullets  = this._enemyBullets.filter(b => b.state !== ENTITY_STATE.DEAD);
  }

  // ── Player ────────────────────────────────────────────────────────────────
  //
  // Player uses viewport coordinates (col/row = terminal 1-based).
  // Collision checked with engine.getCollisionAtViewport(col, row).
  // This is correct because: the viewport maps directly to the collision map
  // (viewport row R → collision map index R-1, offset by scrollOffset).
  //
  // Per-step wall check: move one cell at a time, stop at wall.
  // Bounce: reverse velocity, zero accumulator.

  _updatePlayer() {
    const p = this._player;
    if (p.cooldown > 0) p.cooldown--;
    if (p.invuln   > 0) p.invuln--;

    // Key impulses
    if (this._keyLeft)  p.velCol -= CFG.PLAYER_ACCEL;
    if (this._keyRight) p.velCol += CFG.PLAYER_ACCEL;
    if (this._keyUp)    p.velRow -= CFG.PLAYER_ACCEL;
    if (this._keyDown)  p.velRow += CFG.PLAYER_ACCEL;
    this._keyLeft = this._keyRight = this._keyUp = this._keyDown = false;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    p.velCol = clamp(p.velCol, -CFG.PLAYER_MAX_SPEED, CFG.PLAYER_MAX_SPEED);
    p.velRow = clamp(p.velRow, -CFG.PLAYER_MAX_SPEED, CFG.PLAYER_MAX_SPEED);
    p.velCol *= CFG.PLAYER_DRAG;
    p.velRow *= CFG.PLAYER_DRAG;
    if (Math.abs(p.velCol) < CFG.PLAYER_MIN_SPEED) p.velCol = 0;
    if (Math.abs(p.velRow) < CFG.PLAYER_MIN_SPEED) p.velRow = 0;

    // Fractional accumulator
    p.accCol += p.velCol;
    p.accRow += p.velRow;
    const stepCol = Math.trunc(p.accCol);
    const stepRow = Math.trunc(p.accRow);
    p.accCol -= stepCol;
    p.accRow -= stepRow;

    // Move column, one cell at a time, check wall each step
    if (stepCol !== 0) {
      const dir = Math.sign(stepCol);
      for (let i = 0; i < Math.abs(stepCol); i++) {
        const nc = clamp(p.col + dir, CFG.PLAYER_COL_MIN, CFG.PLAYER_COL_MAX);
        if (this._eng.getCollisionAtViewport(nc, p.row) === LAYER.SCROLL_ENVIRONMENT) {
          p.velCol = -p.velCol * 0.4;
          p.accCol = 0;
          break;
        }
        p.col = nc;
      }
    }

    // Move row, one cell at a time
    if (stepRow !== 0) {
      const dir = Math.sign(stepRow);
      for (let i = 0; i < Math.abs(stepRow); i++) {
        const nr = clamp(p.row + dir, CFG.PLAYER_ROW_MIN, CFG.PLAYER_ROW_MAX);
        if (this._eng.getCollisionAtViewport(p.col, nr) === LAYER.SCROLL_ENVIRONMENT) {
          p.velRow = -p.velRow * 0.4;
          p.accRow = 0;
          break;
        }
        p.row = nr;
      }
    }

    // Damage check at current position
    if (p.invuln === 0) {
      const hit = this._eng.getCollisionAtViewport(p.col, p.row);
      if (hit === LAYER.SCROLL_ENVIRONMENT || hit === LAYER.SCROLL_OBJECT) {
        this._hitPlayer();
      }
    }

    // Blink sprite during invuln
    p.sprite = (p.invuln > 0 && p.invuln % 2 === 0) ? SPRITE_PLAYER_HIT : SPRITE_PLAYER;

    // Fire
    if (this._wantFire && p.cooldown === 0 &&
        this._playerBullets.length < CFG.MAX_PLAYER_BULLETS) {
      const b = this._eng.addOverlayObject({
        col:    p.col,
        row:    p.row + 1,
        sprite: buildSprite([CFG.BULLET_CHAR], CFG.COLOR.OVERLAY_OBJ),
        hitbox: [{ dx: 0, dy: 0 }],
      });
      this._playerBullets.push(b);
      p.cooldown = CFG.FIRE_COOLDOWN_TICKS;
    }
    this._wantFire = false;
  }

  _hitPlayer() {
    this._player.lives--;
    this._player.invuln = CFG.PLAYER_INVULN_TICKS;
    this._player.velCol = -this._player.velCol * 0.5;
    this._player.velRow = -this._player.velRow * 0.5;
    this._player.accCol = 0;
    this._player.accRow = 0;
    if (this._player.lives <= 0) this._running = false;
  }

  // ── Player bullets ────────────────────────────────────────────────────────
  //
  // Bullets are overlay objects with viewport coordinates.
  // Speed = 1 cell/sim-tick downward. Every row is visited — no skip.
  // Hit detection against terrain (getCollisionAtViewport) and
  // scroll objects (entityAtViewport).

  _updatePlayerBullets() {
    for (const b of this._playerBullets) {
      if (b.state === ENTITY_STATE.DEAD) continue;

      // Move one cell downward per sim tick
      b.row += CFG.BULLET_SPEED;

      if (b.row > CFG.ROWS) {
        b.state = ENTITY_STATE.DEAD;
        continue;
      }

      const hit = this._eng.getCollisionAtViewport(b.col, b.row);

      if (hit === LAYER.SCROLL_ENVIRONMENT) {
        b.state = ENTITY_STATE.DEAD;

      } else if (hit === LAYER.SCROLL_OBJECT) {
        // Find and kill the drifter at this viewport position
        const entity = this._eng.entityAtViewport(b.col, b.row);
        if (entity) {
          this._eng.killScrollObject(entity);
          this._score += CFG.DRIFTER_SCORE;
        }
        b.state = ENTITY_STATE.DEAD;

      } else {
        // Check risers with proximity (±1 cell, since riser moves too)
        for (const obj of this._eng.overlayObjects) {
          if (!obj.isRiser || obj.state === ENTITY_STATE.DEAD) continue;
          if (Math.abs(obj.col - b.col) <= 1 && Math.abs(obj.row - b.row) <= 1) {
            obj.state = ENTITY_STATE.DEAD;
            b.state   = ENTITY_STATE.DEAD;
            this._score += CFG.RISER_SCORE;
            break;
          }
        }
      }
    }
  }

  // ── Enemy bullets ─────────────────────────────────────────────────────────
  //
  // Fractional accumulator per axis.
  // velCol/velRow: ±1 or 0 (direction toward player at fire time)
  // Each tick: accCol += velCol * SPEED, accRow += velRow * SPEED
  // When |acc| >= 1.0: step one cell, acc -= 1.0 * sign

  _updateEnemyBullets() {
    for (const b of this._enemyBullets) {
      if (b.state === ENTITY_STATE.DEAD) continue;

      b.accCol += b.velCol * CFG.ENEMY_BULLET_SPEED;
      b.accRow += b.velRow * CFG.ENEMY_BULLET_SPEED;

      const sc = Math.trunc(b.accCol);
      const sr = Math.trunc(b.accRow);
      b.accCol -= sc;
      b.accRow -= sr;
      b.col += sc;
      b.row += sr;

      if (b.row < 1 || b.row > CFG.ROWS || b.col < 1 || b.col > CFG.TOTAL_WIDTH) {
        b.state = ENTITY_STATE.DEAD;
        continue;
      }

      const p = this._player;
      if (p.invuln === 0 &&
          Math.abs(b.col - p.col) <= 1 && Math.abs(b.row - p.row) <= 1) {
        b.state = ENTITY_STATE.DEAD;
        this._hitPlayer();
      }
    }
  }

  // ── Risers ────────────────────────────────────────────────────────────────

  _updateRisers() {
    for (const obj of this._eng.overlayObjects) {
      if (!obj.isRiser || obj.state === ENTITY_STATE.DEAD) continue;

      obj.riserTick = (obj.riserTick || 0) + 1;

      if (obj.riserTick % CFG.RISER_MOVE_EVERY === 0) {
        obj.row--;
        if (obj.row < 1) { obj.state = ENTITY_STATE.DEAD; continue; }
      }

      if (obj.riserTick % CFG.RISER_FIRE_EVERY === 0 &&
          this._enemyBullets.length < CFG.MAX_ENEMY_BULLETS) {
        // Triangulate toward player
        const dx = this._player.col - obj.col;
        const dy = this._player.row - obj.row;
        const velCol = dx === 0 ? 0 : Math.sign(dx);
        const velRow = dy === 0 ? 0 : Math.sign(dy);

        const eb = this._eng.addOverlayObject({
          col:    obj.col,
          row:    obj.row,
          sprite: buildSprite([CFG.ENEMY_BULLET_CHAR], CFG.COLOR.OVERLAY_OBJ),
          hitbox: [{ dx: 0, dy: 0 }],
          velCol, velRow,
          accCol: 0, accRow: 0,
        });
        this._enemyBullets.push(eb);
      }
    }
  }

  // ── Riser spawning ────────────────────────────────────────────────────────

  _updateRiserSpawning() {
    this._riserCooldown--;
    if (this._riserCooldown > 0) return;
    this._riserCooldown = CFG.RISER_INTERVAL_TICKS;

    // Find drifters in the lower half of the viewport
    const minViewRow = Math.floor(this._eng.rows / 2);
    const candidates = this._eng.scrollObjects.filter(obj => {
      if (obj.state !== ENTITY_STATE.SCROLL || obj.isRiser) return false;
      const viewRow = this._eng.getViewportRow(obj.simRow);
      return viewRow >= minViewRow && viewRow <= this._eng.rows;
    });

    if (candidates.length === 0) return;

    const drifter = Utils.pick(candidates);
    this._eng.promoteToOverlay(drifter);
    drifter.isRiser   = true;
    drifter.riserTick = 0;
    drifter.sprite    = SPRITE_RISER;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GAME OVER
  // ─────────────────────────────────────────────────────────────────────────

  async _showGameOver() {
    this._eng.destroy();
    this.input.removeAllListeners('action');
    this.terminal.removeAllListeners('key');
    this.input.stop();

    this.terminal.clearScreen();
    this.terminal.writeRaw('\x1b[0m');

    const c = 28;
    this.terminal.writeRaw(`\x1b[10;${c}H\x1b[1;31m`); this.terminal.write('*** GAME OVER ***');
    this.terminal.writeRaw(`\x1b[12;${c}H\x1b[1;37m`); this.terminal.write(`FINAL SCORE: ${this._score}`);
    this.terminal.writeRaw(`\x1b[14;${c}H\x1b[1;33m`); this.terminal.write(`WAVE REACHED: ${this._wave}`);

    if (this.db) this.db.saveScore(Descent.GAME_NAME, this.username, this._score);

    this.screen.statusBar(' Press any key to continue...', 0, 6);
    this.screen.flush();

    this.input.start();
    await this.input.waitFor('CONFIRM', 'QUIT', 'UP', 'DOWN', 'LEFT', 'RIGHT');
    this.input.stop();

    await this.showLeaderboard(Descent.GAME_NAME, 'DESCENT - HIGH SCORES');
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = Descent;
