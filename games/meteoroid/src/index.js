'use strict';
const path = require('path');

const { GameBase, Screen, Draw, Color, Attr } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

// ─────────────────────────────────────────────────────────────────────────────
// TIMING & PERFORMANCE
// ─────────────────────────────────────────────────────────────────────────────
const FPS_FAST       = 20;
const FPS_SLOW       = 10;
const PHYSICS_REF_MS = 50; // 20 FPS

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATE SYSTEM & GAME CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const PLAY_COLS = 60;
const PLAY_ROWS = 20;

const SHIP_ROT_SPEED = Math.PI / 4; 
const SHIP_THRUST    = 0.09; 
const SHIP_DRAG      = 0.975; 
const SHIP_MAX_SPEED = 1.0; 
const SHIP_RADIUS    = 0.6;

// IDLE ENGINE CONFIGURATION
const IDLE_ENGINE_CHARS = {
  '-':  ['∙', 'o'],
  '|':  ['°', '∙', 'o'],
  '\\': ['°', '∙', 'o'],
  '/':  ['°', '∙', 'o']
};
const IDLE_ENGINE_COLOR = Color.DARK_GRAY;
const IDLE_ENGINE_MS    = 250;

const BULLET_SPEED   = 1.5; 
const BULLET_LIFE    = 20;
const FIRE_COOLDOWN  = 10;
const MAX_BULLETS    = 2;
const INVINCIBLE_F   = 120;
const HYPER_CD       = 80;
const SHIELD_MAX     = 100;
const SHIELD_DRAIN   = 2.0;
const SHIELD_REGEN   = 0.1; 
const RESPAWN_F      = 40;

const MAX_ROCKS   = 15;
const ROCK_SPEED = { large: 0.09, medium: 0.25, small: 0.55 }; 
const ROCK_RADII = { large: 3.5, medium: 2.5, small: 1.5 };
const WAVE_BASE_ROCKS = 2;
const WAVE_MAX_ROCKS = 8;
const MAX_MOVE_ROCKS = 4;
const ROCK_VX_BIAS = 1.4;
const ROCK_VY_BIAS = .2;
const ROCK_BIAS_PCT = 0.8;
const ROCK_Y_SPAWN_JITTER = 4;
const ROCK_JITTER_SAFE_DIST = 10.0;
const ROCK_SHIP_HIT_TIME_MAX = 200; //ms
const SCORE_TABLE = { large: 20, medium: 50, small: 100 };

// UFO CONFIGURATION
const UFO_CHAR          = '∞';
const UFO_RADIUS        = 1.5;
const UFO_COLOR         = Color.BRIGHT_BLUE;
const UFO_SPEED         = 0.25;
const UFO_DIR_CHANGE_F  = 40;
const UFO_BULLET_SPEED  = 0.8;
const UFO_BULLET_LIFE   = 40;
const UFO_FIRE_CD       = 20;
const UFO_SPAWN_MIN     = 250;
const UFO_SPAWN_MAX     = 600;
const UFO_WAVE_SCALER   = 0.9; // Each wave, max is 90% of the previous
const UFO_ACCURACY_RATE = 10; // Level at which UFO achieves max accuracy

// ─────────────────────────────────────────────────────────────────────────────
// COLOR CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const MONO_COLORS = [
  Color.BRIGHT_GREEN, Color.BRIGHT_YELLOW, Color.BRIGHT_CYAN,
  Color.BRIGHT_WHITE, Color.BRIGHT_RED, Color.BRIGHT_BLUE,
  Color.BRIGHT_MAGENTA, Color.GREEN, Color.YELLOW, Color.CYAN,
  Color.WHITE, Color.RED, Color.BLUE, Color.MAGENTA, Color.DARK_GRAY
];

const W  = Color.BRIGHT_WHITE;
const BG = Color.BRIGHT_GREEN;
const BY = Color.BRIGHT_YELLOW;
const BC = Color.BRIGHT_CYAN;

const SHIP_DIR_CHARS = ['^', '\u2510', '>', '\u2518', 'v', '\u2514', '<', '\u250c'];

function angleToOctant(angle) {
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const shifted = (a + Math.PI / 2) % (Math.PI * 2);
  return Math.round(shifted / (Math.PI / 4)) % 8;
}

const ASTEROID_SPRITES = {
  large: [
    [' ░▓▒░ ', '░▓██▓░', '▒▓███▒'],
    ['░▓███▒', '▒▓███░', ' ░▒▒░ '],
    ['░░▓▒░ ', ' ▓███░', '░▓███▒'],
    [' ▓███▒', '░▓███░', ' ░▓▒▒░'],
    ['░▓███▒', ' ▓███░', ' ░▓▒▒░'],
    ['░░▓▒░ ', '░▓███░', '▒▓███▒'],
    [' ▓███▒', '░▓██▓░', ' ░▒▒░ '],
    [' ░▓▒░ ', '▒▓███░', '░▓███▒'],
  ],
  medium: [
    ['▒▓▒', '▒▓ '],
    ['░▓▒', ' ▓▒'],
    ['▓▓ ', '▓▒▓'],
    [' ▒▒', '▓▓▓'],
    ['░▓▒', '▓▒▓'],
    ['▓▓ ', '▓▓▓'],
    [' ▒▒', '▒▓ '],
    ['▒▓▒', ' ▓▒'],
  ],
  small: [
    ['▄▓'],
    ['▓▄'],
    ['▀▓'],
    ['▓▀'],
    ['░░'],
    ['▒▒'],
    ['▓░'],
    ['░▓'],
  ],
};


const ROCK_PALETTES = {
  large:  [Color.DARK_GRAY, Color.WHITE, Color.CYAN, Color.GREEN, Color.RED, Color.YELLOW],
  medium: [Color.WHITE, Color.BRIGHT_CYAN, Color.BRIGHT_GREEN, Color.BRIGHT_RED, Color.YELLOW, Color.BLUE],
  small:  [Color.BRIGHT_WHITE, Color.BRIGHT_CYAN, Color.BRIGHT_GREEN, Color.BRIGHT_RED, Color.BRIGHT_YELLOW, Color.YELLOW],
};

const EXPLOSION_FRAMES = [
  [' * ', '***', ' * '],
  ['*░*', '░█░', '*░*'],
  ['░ ░', ' ░ ', '░ ░'],
];
const EXPLOSION_FG = [Color.BRIGHT_YELLOW, Color.BRIGHT_RED, Color.YELLOW, Color.WHITE];

function bulletChar(vx, vy) {
  if (Math.abs(vx) > Math.abs(vy) * 2) return '-';
  if (Math.abs(vy) > Math.abs(vx) * 2) return '|';
  return vx * vy > 0 ? '\\' : '/';
}

function wrapX(x) { return ((x % PLAY_COLS) + PLAY_COLS) % PLAY_COLS; }
function wrapY(y) { return ((y % PLAY_ROWS) + PLAY_ROWS) % PLAY_ROWS; } 
function rnd(a, b) { return a + Math.random() * (b - a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
class Meteoroid extends GameBase {
  static get GAME_NAME()  { return 'meteoroid'; }
  static get GAME_TITLE() { return 'METEOROID'; }

  async run() {
    this.screen.setMode(Screen.FIXED);
    this.input.start();

    this._monoColorIndex = 0; // Default Bright Green
    this._baseFps = FPS_FAST;
    this._isMono = false;

    await this._connectionScreen();

    let appRunning = true;
    while (appRunning) {
      let mode = await this._titleScreen();
      if (mode === 'quit') {
        appRunning = false;
        break;
      }

      if (mode === 'attract') {
        await this._playGame(true); // AI plays
        await Promise.race([
          this.showLeaderboard(Meteoroid.GAME_NAME, 'METEOROID - HIGH SCORES'),
          sleep(5000)
      ]);

      } else {
        // Normal player
        let playAgain = true;
        while (playAgain) {
          await this._playGame(false);
          this.db.saveScore(Meteoroid.GAME_NAME, this.username, this._score);
          this._saveHi(this._hiScore);
          await Promise.race([
            this.showLeaderboard(Meteoroid.GAME_NAME, 'METEOROID - HIGH SCORES'),
            sleep(5000)
          ]);
          playAgain = await Promise.race([
            this._playAgainPrompt(),
            new Promise(resolve => setTimeout(() => resolve(false), 5000))
          ]);
        }
      }
    }

    this.input.stop();
    this.screen.setMode(Screen.SCROLL);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION SPEED MENU
  // ═══════════════════════════════════════════════════════════════════════════
  async _connectionScreen() {
    let selected = 0;
    let done = false;
    let dirty = true;
    const options = [
      { label: 'FAST', fps: FPS_FAST, mono: false },
      { label: 'SLOW', fps: FPS_SLOW, mono: true }
    ];

    const onAction = a => {
      if (a === 'UP')   { selected = (selected - 1 + options.length) % options.length; dirty = true; }
      if (a === 'DOWN') { selected = (selected + 1) % options.length; dirty = true; }
      if (a === 'FIRE') done = true;
    };
    
    const onKey = k => {
      const kl = k.toLowerCase();
      if (kl === ' ' || kl === '5' || k === '\r' || k === '\n') done = true;
      if (kl === 'c') { this._toggleColor(); dirty = true; }
    };

    this.input.on('action', onAction);
    this.input.on('key', onKey);

    while (!done) {
      if (dirty) {
        this._isMono = options[selected].mono;
        this.screen.clear(this._fg(Color.BLACK), this._bg(Color.BLACK));

        this._printCenteredScreen(2, '*** CONNECTION SPEED ***', Color.BRIGHT_CYAN);
        this._printCenteredScreen(4, 'Select your network speed:', Color.DARK_GRAY);

        for (let i = 0; i < options.length; i++) {
          const isSel = i === selected;
          const fg = isSel ? Color.BRIGHT_YELLOW : Color.WHITE;
          const text = (isSel ? '> ' : '  ') + options[i].label + (isSel ? ' <' : '  ');
          this._printCenteredScreen(7 + i * 2, text, fg);
        }

        if (this._isMono) {
          this._printCenteredScreen(12, 'C - TOGGLE MONO COLOR', Color.BRIGHT_GREEN);
        }

        this._printCenteredScreen(15, 'UP/DOWN to select, SPACE/5 to confirm', Color.DARK_GRAY);

        this.screen.flush();
        dirty = false;
      }
      await sleep(50);
    }

    this.input.removeListener('action', onAction);
    this.input.removeListener('key', onKey);

    this._baseFps = options[selected].fps;
    this._isMono  = options[selected].mono;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TITLE SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  async _titleScreen() {
    this._buildStars();
    let done  = false;
    let dirty = true;
    let lastBlink = false;
    let result = 'attract';
    let idleTime = 0;
    
    const onKey = (k) => {
      const kl = k.toLowerCase();
      if (kl === 'c') { this._toggleColor(); dirty = true; idleTime = 0; }
      else if (kl === 'q') { result = 'quit'; done = true; }
      else { result = 'play'; done = true; }
    };
    this.input.on('key', onKey);

    while (!done) {
      let blink = Math.floor(Date.now() / 500) % 2 === 0;
      if (blink !== lastBlink) {
        dirty = true;
        lastBlink = blink;
      }

      if (dirty) {
        this._renderTitle(blink);
        this.screen.flush();
        dirty = false;
      }
      await sleep(50);
      idleTime += 50;

      // 10 second idle = trigger Attract Mode
      if (idleTime >= 10000) {
        done = true;
      }
    }
    this.input.removeListener('key', onKey);
    return result;
  }

  _renderTitle(blink) {
    this.screen.clear(this._fg(Color.BLACK), this._bg(Color.BLACK));
    this._drawStars();

    const LOGO = [
      '             █   █ █████ █████ █████  ███  ████   ███  ███ ████ ',
      '             ██ ██ █       █   █     █   █ █   █ █   █  █  █   █',
      '             █ █ █ ███     █   ███   █   █ ████  █   █  █  █   █',
      '             █   █ █       █   █     █   █ █ █   █   █  █  █   █',
      '             █   █ █████   █   █████  ███  █  ██  ███  ███ ████ ',
    ];

    const dh = '\u2550', dv = '\u2551', dtl = '\u2554', dtr = '\u2557', dbl = '\u255a', dbr = '\u255d';
    this.screen.putString(1, 2, dtl + dh.repeat(78) + dtr, this._fg(Color.GREEN), this._bg(Color.BLACK));
    this.screen.putString(1, 9, dbl + dh.repeat(78) + dbr, this._fg(Color.GREEN), this._bg(Color.BLACK));
    for (let r = 3; r <= 8; r++) {
      this.screen.putChar(1,  r, dv, this._fg(Color.GREEN), this._bg(Color.BLACK));
      this.screen.putChar(80, r, dv, this._fg(Color.GREEN), this._bg(Color.BLACK));
    }

    for (let r = 0; r < LOGO.length; r++) {
      const line = LOGO[r];
      for (let c = 0; c < line.length && c + 2 <= 79; c++) {
        if (line[c] !== ' ') {
          this.screen.putChar(c + 2, r + 3, line[c], this._fg(Color.BRIGHT_CYAN), this._bg(Color.BLACK));
        }
      }
    }

    this._printCenteredScreen(8, '***  SYNTHDOOR EDITION  *  SYNTHDOOR EDITION  ***', Color.GREEN, Color.BLACK);

    const hi = this._loadHi();
    this._printCenteredScreen(11, 'HI-SCORE: ' + String(hi).padStart(7, '0'), Color.BRIGHT_YELLOW, Color.BLACK);

    if (blink) {
      this._printCenteredScreen(12, '>>>  PRESS ANY KEY TO START  <<<', Color.BRIGHT_WHITE, Color.BLACK);
    }

    this._printCenteredScreen(14, '- CONTROLS -', Color.DARK_GRAY, Color.BLACK);
    this._printAt(15, 22, 'LEFT/RIGHT/4/6 - ROTATE SHIP', Color.WHITE);
    this._printAt(16, 22, 'UP/8           - THRUST',      Color.WHITE);
    this._printAt(17, 22, 'SPACE/5        - FIRE',        Color.WHITE);
    this._printAt(18, 22, 'S / 7          - SHIELD TOGGLE', Color.BRIGHT_YELLOW);
    this._printAt(19, 22, 'F / 9          - HYPERSPACE',  Color.BRIGHT_CYAN);

    if (this._isMono) {
    this._printAt(20, 22, 'C              - TOGGLE MONO COLOR', Color.BRIGHT_GREEN);
    }
    const sbFg = this._isMono ? MONO_COLORS[this._monoColorIndex] : Color.BLACK;
    const sbBg = this._isMono ? Color.BLACK : Color.CYAN;
    this.screen.statusBar(' METEOROID  |  SynthDoor  |  Q to quit', sbFg, sbBg);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAY AGAIN PROMPT
  // ═══════════════════════════════════════════════════════════════════════════
  async _playAgainPrompt() {
    this.screen.clear(this._fg(Color.BLACK), this._bg(Color.BLACK));
    this._printCenteredScreen(11, '  PLAY AGAIN? (Y/N)  ', Color.BRIGHT_YELLOW, Color.BLACK, true);
    this.screen.flush();

    return new Promise(resolve => {
      const onKey = k => {
        const kl = k.toLowerCase();
        if (kl === 'y') { cleanUp(); resolve(true); }
        if (kl === 'n' || kl === 'q') { cleanUp(); resolve(false); }
      };
      const onAction = a => {
        if (a === 'QUIT') { cleanUp(); resolve(false); }
      };
      const cleanUp = () => {
        this.input.removeListener('key', onKey);
        this.input.removeListener('action', onAction);
      };
      this.input.on('key', onKey);
      this.input.on('action', onAction);
    });
  }

  _initGame() {
    this._score         = 0;
    this._hiScore       = this._loadHi();
    this._lives         = this._isAttractMode ? 0 : 3;
    this._wave          = 1;
    this._frame         = 0;
    this._running       = true;
    this._gameOver      = false;
    this._gameOverTimer = 0;
    this._levelFlash    = 0;
    this._respawnTimer  = 0;
    this._fireCD        = 0;
    this._hyperCD       = 0;
    this._shieldEnergy  = SHIELD_MAX;
    this._shieldActive  = false;
    this._keys          = {};

    this._bullets       = [];
    this._ufoBullets    = [];
    this._rocks         = [];
    this._explosions    = [];
    this._particles     = [];

    this._ufo           = null;
    this._ufoTimer      = rnd(UFO_SPAWN_MIN, UFO_SPAWN_MAX);

    this._ship = this._makeShip();
    this._spawnWave();
  }

  _makeShip() {
    return {
      x: PLAY_COLS / 2,
      y: PLAY_ROWS / 2,
      vx: 0, vy: 0,
      angle: -Math.PI / 2, 
      invincible: INVINCIBLE_F,
      dead: false,
    };
  }

  _spawnWave() {
    const n = Math.min(WAVE_MAX_ROCKS, WAVE_BASE_ROCKS + Math.floor((this._wave - 1) / 2));
    this._rocks   = [];
    this._bullets = [];
    this._ufoBullets = [];
    for (let i = 0; i < n; i++) this._spawnRock('large', null, null, null, null);
  }

  _spawnRock(size, x, y, vx, vy) {
    const rockCount = this._rocks.length;
    const isSplit = y !== undefined;

    if (rockCount > MAX_ROCKS) return;

    const spd   = ROCK_SPEED[size];
    const angle = Math.random() * Math.PI * 2;

    const rx = x ?? (Math.random() < 0.5 ? rnd(0, 6) : rnd(PLAY_COLS - 6, PLAY_COLS));
    const ry = y ?? (Math.random() < 0.5 ? rnd(0, 4) : rnd(PLAY_ROWS - 4, PLAY_ROWS));

    const maxSpd = ROCK_SPEED[size] * 1.3;
    const rvx = vx ?? (Math.cos(angle) * (spd + rnd(0, spd * 0.3)));
    const rvy = vy ?? (Math.sin(angle) * (spd + rnd(0, spd * 0.3)) * 0.75);

    const rmag = Math.hypot(rvx, rvy);
    const rscale = rmag > maxSpd ? maxSpd / rmag : 1;

    // Calculate distance to ship
    let distToShip = Infinity;
    if (this._ship && !this._ship.dead) {
        distToShip = Math.hypot(rx - this._ship.x, ry - this._ship.y);
    }

    const jitter = (distToShip > ROCK_JITTER_SAFE_DIST) ? rnd(-ROCK_Y_SPAWN_JITTER, ROCK_Y_SPAWN_JITTER) : 0;

    let vx_bias = ROCK_VX_BIAS;
    let vy_bias = ROCK_VY_BIAS;
    if (Math.random() > ROCK_BIAS_PCT) {
       vx_bias = 1;
       vy_bias = 1;
    } 

    let do_highlight = true;
    if (Math.random() < 0.5) do_highlight = false; 

    this._rocks.push({
      x: rx,
      y: Math.max(0.5, Math.min(PLAY_ROWS - 0.5, ry + jitter)),
      vx: (rvx * rscale) * vx_bias,
      vy: (rvy * rscale) * vy_bias,
      size,
      variant: Utils.randInt(0, 7),
      color: ROCK_PALETTES[size][Utils.randInt(0, ROCK_PALETTES[size].length - 1)],
      highlight: do_highlight,
      ship_hit_time: 0
    });
  }

  _spawnUfo() {
    const isLeft = Math.random() < 0.5;
    const startX = isLeft ? 0 : PLAY_COLS - 1;
    const startY = rnd(2, PLAY_ROWS - 2);
    
    const accuracyFactor = Math.min(1.0, (this._wave - 1) / UFO_ACCURACY_RATE);
    const points = 200 + Math.floor(accuracyFactor * 800);

    this._ufo = {
      x: startX,
      y: startY,
      vx: isLeft ? UFO_SPEED : -UFO_SPEED,
      vy: 0,
      distTraveled: 0,
      dirTimer: UFO_DIR_CHANGE_F,
      fireCD: UFO_FIRE_CD,
      points: points,
      accuracy: accuracyFactor
    };
  }

  _explodeRock(r) {
    this._addExplosion(r.x, r.y, r.size);
    const rockCount = this._rocks.length;
    let spawn_count = 2;
    if (rockCount >= MAX_ROCKS) {
      spawn_count = 1;
    }
    if (r.size === 'large') {
      for (let k = 0; k < spawn_count; k++) {
        const a  = r.vx ? Math.atan2(r.vy, r.vx) : Math.random() * Math.PI * 2;
        const na = a + Math.PI / 2 + k * Math.PI + rnd(-0.5, 0.5);
        this._spawnRock('medium', r.x + rnd(-1,1), r.y + rnd(-0.5,0.5),
          r.vx + Math.cos(na) * 0.5, r.vy + Math.sin(na) * 0.3);
      }
    } else if (r.size === 'medium') {
      for (let k = 0; k < spawn_count; k++) {
        const a  = Math.atan2(r.vy, r.vx);
        const na = a + Math.PI / 2 + k * Math.PI + rnd(-0.5, 0.5);
        this._spawnRock('small', r.x + rnd(-1,1), r.y + rnd(-0.3,0.3),
          r.vx + Math.cos(na) * 0.7, r.vy + Math.sin(na) * 0.4);
      }
    }
  }

  _addExplosion(x, y, size) {
    const maxFrame = size === 'large' ? 7 : size === 'medium' ? 5 : 3;
    this._explosions.push({ x, y, frame: 0, maxFrame, size });
    const n = size === 'large' ? 6 : size === 'medium' ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const a   = Math.random() * Math.PI * 2;
      const spd = rnd(0.2, size === 'large' ? 1.0 : 0.6);
      this._particles.push({
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd * 0.55,
        life: Math.floor(rnd(4, 14)),
        ch: Utils.pick(['*', '+', '.', '*', '.']),
        fg: Utils.pick([Color.BRIGHT_YELLOW, Color.BRIGHT_RED,
                        Color.BRIGHT_WHITE, Color.YELLOW, Color.BRIGHT_GREEN]),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAY LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  async _playGame(isAttractMode = false) {
    this._isAttractMode = isAttractMode;
    this._initGame();

    this._burstsThisFrame = 0;
    this._lastActionTime = 0;

    const onKey = k => {
      if (this._isAttractMode) {
        this._running = false; 
        return;
      }
      const kl = k.toLowerCase();
      if (kl === 'q') { this._running = false; return; }
      if (kl === ' ' || kl === '5') { this._tryFire(); return; }
      if (kl === 'f' || kl === '9') { this._hyperspace(); return; }
      if (kl === 's' || kl === '7') {
        if (this._shieldEnergy > 0) this._shieldActive = !this._shieldActive;
        return;
      }
      if (kl === 'c') { this._toggleColor(); return; }
    };

    const onAction = a => {
      if (this._isAttractMode) {
        this._running = false; 
        return;
      }
      const now = Date.now();
      if (this._lastActionTime && (now - this._lastActionTime) < 15) {
        this._burstsThisFrame++;
      }
      this._lastActionTime = now;

      if (a === 'QUIT')  { this._running = false; return; }
      if (a === 'LEFT')  { this._applyRotate(-1); return; }
      if (a === 'RIGHT') { this._applyRotate( 1); return; }
      if (a === 'UP')    { this._applyThrust();   return; }
      if (a === 'FIRE')  { this._tryFire();       return; }
    };

    this.input.on('key', onKey);
    this.input.on('action', onAction);

    let currentFps = this._baseFps;
    let targetFrameMs = 1000 / currentFps;
    let lastTime = Date.now();

    while (this._running) {
      const now = Date.now();
      const elapsed = Math.max(1, now - lastTime);
      lastTime = now;
      
      let timeToSimulate = Math.min(elapsed / PHYSICS_REF_MS, 20.0);
      const MAX_STEP = 1.0;
      
      while (timeToSimulate > 0) {
        const stepDt = Math.min(timeToSimulate, MAX_STEP);
        if (this._isAttractMode) this._aiUpdate();
        this._update(stepDt);
        timeToSimulate -= stepDt;
      }

      this._draw();
      this.screen.flush();

      this._thrusting = false;

      const processTime = Date.now() - now;
      const sleepTime = Math.max(5, targetFrameMs - processTime);
      await sleep(sleepTime);

      this._frame += elapsed / PHYSICS_REF_MS;
    }

    this.input.removeListener('key', onKey);
    this.input.removeListener('action', onAction);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AI LOGIC
  // ═══════════════════════════════════════════════════════════════════════════
  _aiUpdate() {
    if (!this._ship || this._ship.dead || this._gameOver) return;

    if (Math.random() < 0.5) return;

    let closestTarget = null;
    let minTargetDist = Infinity;
    
    let closestHazard = null;
    let minHazardDist = Infinity;

    const targets = [...this._rocks];
    if (this._ufo) targets.push(this._ufo);

    for (const t of targets) {
      let dx = Math.abs(this._ship.x - t.x);
      let dy = Math.abs(this._ship.y - t.y);
      if (dx > PLAY_COLS / 2) dx = PLAY_COLS - dx;
      if (dy > PLAY_ROWS / 2) dy = PLAY_ROWS - dy;
      let dist = dx * dx + dy * dy;
      if (dist < minTargetDist) { 
        minTargetDist = dist; 
        closestTarget = t; 
      }
    }

    const hazards = [...targets, ...this._ufoBullets];
    for (const h of hazards) {
      let dx = Math.abs(this._ship.x - h.x);
      let dy = Math.abs(this._ship.y - h.y);
      if (dx > PLAY_COLS / 2) dx = PLAY_COLS - dx;
      if (dy > PLAY_ROWS / 2) dy = PLAY_ROWS - dy;
      let dist = dx * dx + dy * dy;
      if (dist < minHazardDist) { 
        minHazardDist = dist; 
        closestHazard = h; 
      }
    }

    if (closestTarget) {
      let dx = closestTarget.x - this._ship.x;
      let dy = closestTarget.y - this._ship.y;
      
      if (Math.abs(dx) > PLAY_COLS/2) dx = -Math.sign(dx) * (PLAY_COLS - Math.abs(dx));
      if (Math.abs(dy) > PLAY_ROWS/2) dy = -Math.sign(dy) * (PLAY_ROWS - Math.abs(dy));

      let targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - this._ship.angle;
      
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));

      if (diff > 0.39) this._applyRotate(1);
      else if (diff < -0.39) this._applyRotate(-1);

      if (Math.abs(diff) <= 0.4) {
        this._tryFire();
        if (minTargetDist > 400) this._applyThrust(); 
      }

      if (minHazardDist < 50) {
        if (minHazardDist < 20) {
            if (Math.random() < 0.05) this._hyperspace();
            else if (this._shieldEnergy > 20) this._shieldActive = true;
        }
        if (Math.abs(diff) > 1.5) this._applyThrust(); 
      } else {
        this._shieldActive = false; 
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUT ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  _toggleColor() {
    this._monoColorIndex = (this._monoColorIndex + 1) % MONO_COLORS.length;
  }

  _applyRotate(dir) {
    if (!this._ship || this._ship.dead || this._gameOver) return;
    this._ship.angle += dir * SHIP_ROT_SPEED;
  }

  _applyThrust() {
    if (!this._ship || this._ship.dead || this._gameOver) return;
    if (!this._particles) return;
    const ship = this._ship;
    ship.vx += Math.cos(ship.angle) * SHIP_THRUST;
    ship.vy += Math.sin(ship.angle) * SHIP_THRUST;
    const spd = Math.hypot(ship.vx, ship.vy);
    if (spd > SHIP_MAX_SPEED) { ship.vx = ship.vx/spd*SHIP_MAX_SPEED; ship.vy = ship.vy/spd*SHIP_MAX_SPEED; }
    this._thrusting = true;
    const ba = ship.angle + Math.PI + rnd(-0.4, 0.4);
    this._particles.push({
      x: ship.x, y: ship.y,
      vx: Math.cos(ba) * rnd(0.15, 0.45),
      vy: Math.sin(ba) * rnd(0.08, 0.2),
      life: Utils.randInt(2, 5),
      ch: Utils.pick(['.', '*']),
      fg: Utils.pick([Color.BRIGHT_YELLOW, Color.YELLOW, Color.RED]),
    });
  }

  _tryFire() {
    if (!this._ship || this._ship.dead || this._gameOver) return;
    if (this._fireCD > 0) return;
    if (this._bullets.length >= MAX_BULLETS) return;
    this._fireCD = FIRE_COOLDOWN;
    const ship  = this._ship;
    const angle = ship.angle;
    this._bullets.push({
      x:    ship.x + Math.cos(angle) * 1.2,
      y:    ship.y + Math.sin(angle) * 0.8,
      vx:   ship.vx + Math.cos(angle) * BULLET_SPEED,
      vy:   ship.vy + Math.sin(angle) * BULLET_SPEED * 0.55,
      life: BULLET_LIFE,
    });
  }

  _hyperspace() {
    if (!this._ship || this._ship.dead || this._gameOver) return;
    if (this._hyperCD > 0) return;
    let nx, ny, tries = 0;
    do {
      nx = rnd(5, PLAY_COLS - 5);
      ny = rnd(2, PLAY_ROWS - 2);
      tries++;
    } while (tries < 20 && this._rocks.some(r => Math.abs(r.x - nx) < 6 && Math.abs(r.y - ny) < 4));
    this._addExplosion(this._ship.x, this._ship.y, 'medium');
    this._ship.x = nx;
    this._ship.y = ny;
    this._ship.vx = 0;
    this._ship.vy = 0;
    this._ship.invincible = INVINCIBLE_F; 
    this._hyperCD = HYPER_CD;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════════════════
  _update(dt) {
    if (this._gameOver) {
      this._gameOverTimer += dt;
      if (this._isAttractMode && this._gameOverTimer > 30) this._running = false;
      else if (this._gameOverTimer > 200) this._running = false;
      
      this._updateParticles(dt);
      this._updateExplosions(dt);
      return;
    }

    if (this._respawnTimer > 0) {
      this._respawnTimer -= dt;
      this._updateParticles(dt);
      this._updateExplosions(dt);
      return;
    }

    if (!this._ship || this._ship.dead) {
      this._lives--;
      if (this._lives < 0) {
        this._gameOver = true;
        this._gameOverTimer = 0;
        if (this._score > this._hiScore) this._hiScore = this._score;
        return;
      }
      this._ship = this._makeShip();
      this._keys = {};  
    }

    const ship = this._ship;

    if (this._shieldActive) {
      this._shieldEnergy = Math.max(0, this._shieldEnergy - SHIELD_DRAIN * dt);
      if (this._shieldEnergy === 0) this._shieldActive = false; 
    } else {
      this._shieldEnergy = Math.min(SHIELD_MAX, this._shieldEnergy + SHIELD_REGEN * dt);
    }

    if (this._hyperCD > 0) this._hyperCD -= dt;

    const spd = Math.hypot(ship.vx, ship.vy);
    if (spd > SHIP_MAX_SPEED) {
      ship.vx = ship.vx / spd * SHIP_MAX_SPEED;
      ship.vy = ship.vy / spd * SHIP_MAX_SPEED;
    }
    ship.vx *= Math.pow(SHIP_DRAG, dt);
    ship.vy *= Math.pow(SHIP_DRAG, dt);
    
    ship.x = wrapX(ship.x + ship.vx * dt);
    ship.y = wrapY(ship.y + ship.vy * dt);
    if (ship.invincible > 0) ship.invincible -= dt;

    if (this._fireCD > 0) this._fireCD -= dt;

    // UFO Spawning
    if (!this._ufo && this._ufoTimer > 0) {
      this._ufoTimer -= dt;
      if (this._ufoTimer <= 0) this._spawnUfo();
    }

    // Update UFO
    if (this._ufo) this._updateUfo(dt);

    for (const b of this._bullets) {
      b.x = wrapX(b.x + b.vx * dt);
      b.y = wrapY(b.y + b.vy * dt);
      b.life -= dt;
    }
    this._bullets = this._bullets.filter(b => b.life > 0);

    for (const b of this._ufoBullets) {
      b.x = wrapX(b.x + b.vx * dt);
      b.y = wrapY(b.y + b.vy * dt);
      b.life -= dt;
    }
    this._ufoBullets = this._ufoBullets.filter(b => b.life > 0);

    const shuffled = [...this._rocks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Only move the first MAX_MOVE_ROCKS from that shuffled list
    const toMove = shuffled.slice(0, MAX_MOVE_ROCKS);
    for (const r of toMove) {
      r.x = wrapX(r.x + r.vx * dt);
      r.y = wrapY(r.y + r.vy * dt);
    }

    const deadBullets = new Set();
    const deadRocks   = new Set();

    // 1. Player Bullets vs Rocks
    for (let bi = 0; bi < this._bullets.length; bi++) {
      const b = this._bullets[bi];
      for (let ri = 0; ri < this._rocks.length; ri++) {
        if (deadRocks.has(ri)) continue;
        const r  = this._rocks[ri];
        const hr = ROCK_RADII[r.size];
        const dx = Math.abs(b.x - r.x);
        const dy = Math.abs(b.y - r.y) * 1.8;
        if (dx < hr && dy < hr) {
          deadBullets.add(bi);
          deadRocks.add(ri);
          this._score += SCORE_TABLE[r.size];
          if (this._score > this._hiScore) this._hiScore = this._score;
          this._explodeRock(r);
          break; // move to next bullet
        }
      }
    }

    // 2. Player Bullets vs UFO
    if (this._ufo) {
      let ufoHit = false;
      for (let bi = 0; bi < this._bullets.length; bi++) {
        if (deadBullets.has(bi)) continue;
        const b = this._bullets[bi];
        const dx = Math.abs(b.x - this._ufo.x);
        const dy = Math.abs(b.y - this._ufo.y) * 1.8;
        if (dx < UFO_RADIUS && dy < UFO_RADIUS) {
          deadBullets.add(bi);
          ufoHit = true;
          break;
        }
      }
      if (ufoHit) {
        this._score += this._ufo.points;
        if (this._score > this._hiScore) this._hiScore = this._score;
        this._addExplosion(this._ufo.x, this._ufo.y, 'medium');
        this._ufo = null;
        let currentMax = Math.max(UFO_SPAWN_MIN, UFO_SPAWN_MAX * Math.pow(UFO_WAVE_SCALER, this._wave - 1));
        this._ufoTimer = rnd(UFO_SPAWN_MIN, currentMax);
      }
    }

    // 3. UFO vs Rocks
    if (this._ufo) {
      let ufoHit = false;
      for (let ri = 0; ri < this._rocks.length; ri++) {
        if (deadRocks.has(ri)) continue;
        const r = this._rocks[ri];
        const hr = ROCK_RADII[r.size] + 1.2;
        const dx = Math.abs(this._ufo.x - r.x);
        const dy = Math.abs(this._ufo.y - r.y) * 1.8;
        if (dx < hr && dy < hr) {
          ufoHit = true;
          deadRocks.add(ri);
          this._explodeRock(r);
          break;
        }
      }
      if (ufoHit) {
         this._addExplosion(this._ufo.x, this._ufo.y, 'medium');
         this._ufo = null;
         this._ufoTimer = rnd(UFO_SPAWN_MIN, UFO_SPAWN_MAX);
      }
    }

    this._bullets = this._bullets.filter((_, i) => !deadBullets.has(i));
    this._rocks   = this._rocks.filter((_, i)   => !deadRocks.has(i));

    // 4. Hazards vs Ship
    if (ship.invincible <= 0 && !ship.dead) {
      // Rocks
      for (const r of this._rocks) {
        const hr = ROCK_RADII[r.size] + (this._shieldActive ? 1.5 : SHIP_RADIUS);
        const dx = Math.abs(ship.x - r.x);
        const dy = Math.abs(ship.y - r.y) * 1.8;
        if (dx < hr && dy < hr) {
          if (r.ship_hit_time === 0) {
            r.ship_hit_time = Date.now();
          }

          const sht_elapsed = Date.now() - r.ship_hit_time;          

          if (sht_elapsed >= ROCK_SHIP_HIT_TIME_MAX) {
            r.ship_hit_time = 0;
            if (this._hitShip(r.x, r.y)) {
              const ang = Math.atan2(r.y - ship.y, r.x - ship.x);
              r.vx = Math.cos(ang) * 0.6;
              r.vy = Math.sin(ang) * 0.3;
            }
          }

          break;
        }
        else {
          r.ship_hit_time = 0;
        }
      }

      // UFO
      if (this._ufo && !ship.dead) {
        const dx = Math.abs(ship.x - this._ufo.x);
        const dy = Math.abs(ship.y - this._ufo.y) * 1.8;
        if (dx < (SHIP_RADIUS + 1.2) && dy < (SHIP_RADIUS + 1.2)) {
          if (this._hitShip(this._ufo.x, this._ufo.y)) {
             this._ufo.vx *= -1;
             this._ufo.vy *= -1;
          } else {
             this._addExplosion(this._ufo.x, this._ufo.y, 'medium');
             this._ufo = null;
             this._ufoTimer = rnd(UFO_SPAWN_MIN, UFO_SPAWN_MAX);
          }
        }
      }

      // UFO Bullets
      if (!ship.dead) {
        for (let bi = 0; bi < this._ufoBullets.length; bi++) {
          const b = this._ufoBullets[bi];
          const dx = Math.abs(ship.x - b.x);
          const dy = Math.abs(ship.y - b.y) * 1.8;
          if (dx < SHIP_RADIUS && dy < SHIP_RADIUS) {
            this._ufoBullets.splice(bi, 1);
            this._hitShip(b.x, b.y);
            break;
          }
        }
      }
    }

    if (this._rocks.length === 0 && !this._wavePending) {
      this._wavePending = true;
      this._wave++;
      this._levelFlash = 30;
      this._shieldEnergy = Math.min(SHIELD_MAX, this._shieldEnergy + 40);
      this._score += this._wave * 500;
      setTimeout(() => { this._spawnWave(); this._wavePending = false; }, 1500);
    }

    if (this._levelFlash > 0) this._levelFlash -= dt;
    this._updateParticles(dt);
    this._updateExplosions(dt);
  }

  _hitShip(hazardX, hazardY) {
    if (this._shieldActive && this._shieldEnergy > 0) {
      this._shieldEnergy = Math.max(0, this._shieldEnergy - 25);
      this._addExplosion((this._ship.x + hazardX) / 2, (this._ship.y + hazardY) / 2, 'small');
      return true; // Shield absorbed it
    } else {
      this._ship.dead = true;
      this._addExplosion(this._ship.x, this._ship.y, 'large');
      this._respawnTimer = RESPAWN_F;
      return false; // Ship died
    }
  }

  _updateUfo(dt) {
    const ufo = this._ufo;
    ufo.x += ufo.vx * dt;
    ufo.y += ufo.vy * dt;
    ufo.distTraveled += Math.abs(ufo.vx * dt);

    if (ufo.distTraveled > PLAY_COLS) {
       this._ufo = null;
       this._ufoTimer = rnd(UFO_SPAWN_MIN, UFO_SPAWN_MAX);
       return;
    }

    ufo.y = wrapY(ufo.y);
    ufo.x = wrapX(ufo.x);

    ufo.dirTimer -= dt;
    if (ufo.dirTimer <= 0) {
      ufo.dirTimer = UFO_DIR_CHANGE_F;
      const r = Math.random();
      if (r < 0.33) ufo.vy = -UFO_SPEED * 0.3;
      else if (r < 0.66) ufo.vy = UFO_SPEED * 0.3;
      else ufo.vy = 0;
    }

    ufo.fireCD -= dt;
    if (ufo.fireCD <= 0 && this._ship && !this._ship.dead && !this._gameOver) {
      ufo.fireCD = UFO_FIRE_CD;
      this._ufoFire();
    }
  }

  _ufoFire() {
    if (!this._ufo || !this._ship) return;
    const ufo = this._ufo;
    let dx = this._ship.x - ufo.x;
    let dy = this._ship.y - ufo.y;

    if (Math.abs(dx) > PLAY_COLS / 2) dx = -Math.sign(dx) * (PLAY_COLS - Math.abs(dx));
    if (Math.abs(dy) > PLAY_ROWS / 2) dy = -Math.sign(dy) * (PLAY_ROWS - Math.abs(dy));

    let angle = Math.atan2(dy, dx * 0.55);

    if (ufo.accuracy < 1.0) {
      const noise = (1.0 - ufo.accuracy) * rnd(-Math.PI, Math.PI);
      angle += noise;
    }

    this._ufoBullets.push({
      x: ufo.x,
      y: ufo.y,
      vx: Math.cos(angle) * UFO_BULLET_SPEED,
      vy: Math.sin(angle) * UFO_BULLET_SPEED * 0.55,
      life: UFO_BULLET_LIFE
    });
  }

  _updateParticles(dt) {
    if (this._baseFps === FPS_SLOW) {
      if (this._particles.length > 0) this._particles = [];
      return;
    }
    for (const p of this._particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    this._particles = this._particles.filter(p =>
      p.life > 0 && p.x >= 0 && p.x < PLAY_COLS && p.y >= 0 && p.y < PLAY_ROWS);
    if (this._particles.length > 50) this._particles.splice(0, this._particles.length - 50);
  }

  _updateExplosions(dt) {
    if (this._baseFps === FPS_SLOW) {
      if (this._explosions.length > 0) this._explosions = [];
      return;
    }
    for (const e of this._explosions) e.frame += dt;
    this._explosions = this._explosions.filter(e => e.frame < e.maxFrame);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAW
  // ═══════════════════════════════════════════════════════════════════════════
  _draw() {
    this.screen.clear(this._fg(Color.BLACK), this._bg(Color.BLACK));
    
    if (this._baseFps !== FPS_SLOW) {
      this._drawStars();
    }
    this._drawBorder();

    for (const r of this._rocks)      this._drawRock(r);
    if (this._ufo)                    this._drawUFO();
    this._drawParticles();
    this._drawExplosions();
    for (const b of this._bullets)    this._drawBullet(b);
    for (const b of this._ufoBullets) this._drawUFOBullet(b);
    if (this._ship && !this._ship.dead) this._drawShip();
    this._drawHUD();

    if (this._levelFlash > 0)        this._drawLevelFlash();
    if (this._gameOver && !this._isAttractMode) this._drawGameOver();
  }

  _drawRock(r) {
    const sprite = ASTEROID_SPRITES[r.size][r.variant];
    const fg     = r.color;
    const hl      = r.highlight;
    const cx     = Math.round(r.x);
    const cy     = Math.round(r.y);
    const h      = sprite.length;
    for (let row = 0; row < h; row++) {
      const line = sprite[row];
      const startX = cx - Math.floor(line.length / 2);
      for (let c = 0; c < line.length; c++) {
        let ch = line[c]; // Changed from const to let
        if (ch !== ' ') {
          let cfg = fg;
          
          if (this._baseFps === FPS_SLOW) {
            // Force uniform character for SLOW mode
            ch = '▓'; 
          } else {
            // Apply original detailed highlights only in FAST mode
            if (hl === true) {
              if (ch === '█') cfg = Color.WHITE;
              else if (ch === '▓') cfg = r.size === 'large' ? Color.DARK_GRAY : Color.WHITE;
            }
          }
          
          this._setCell(startX + c, cy + row - Math.floor(h / 2), ch, cfg);
        }
      }
    }
  }

  _drawUFO() {
    this._setCell(Math.round(this._ufo.x), Math.round(this._ufo.y), UFO_CHAR, UFO_COLOR);
  }

  _drawShip() {
    const ship = this._ship;
    if (ship.invincible > 0 && Math.floor(this._frame / 4) % 2 === 0) return;

    const oct   = angleToOctant(ship.angle);
    const dirCh = SHIP_DIR_CHARS[oct];
    const cx    = Math.round(ship.x);
    const cy    = Math.round(ship.y);

    // Draw Ship
    const shipFg = this._thrusting ? Color.BRIGHT_YELLOW : W;
    this._setCell(cx, cy, dirCh, shipFg);

    // Draw Shield
    if (this._shieldActive && this._shieldEnergy > 0) {
      const pulse = Math.floor(this._frame / 3) % 2;
      const rc    = pulse ? '*' : '+';
      const sfg   = this._shieldEnergy > 50 ? Color.BRIGHT_YELLOW
                  : this._shieldEnergy > 20 ? Color.YELLOW : Color.BRIGHT_RED;
      this._setCell(cx - 1, cy, rc, sfg);
      this._setCell(cx + 1, cy, rc, sfg);
    }

    // Skip idle engine for SLOW
    if (this._baseFps === FPS_SLOW) {
      return;
    }

    // Draw Idle Engine
    const ex = Math.cos(ship.angle);
    const ey = Math.sin(ship.angle);
    let engList;
    if (Math.abs(ex) > Math.abs(ey) * 2) {
      engList = IDLE_ENGINE_CHARS['-'];
    } else if (Math.abs(ey) > Math.abs(ex) * 2) {
      engList = IDLE_ENGINE_CHARS['|'];
    } else {
      engList = ex * ey > 0 ? IDLE_ENGINE_CHARS['\\'] : IDLE_ENGINE_CHARS['/'];
    }

    const engIdx = Math.floor(Date.now() / IDLE_ENGINE_MS) % engList.length;
    const engCh  = engList[engIdx];
    
    // Positioned opposite the firing direction
    const engX = wrapX(ship.x - ex * 1.2);
    const engY = wrapY(ship.y - ey * 0.8);
    const roundEngX = Math.round(engX);
    const roundEngY = Math.round(engY);

    // Only draw the engine if it won't be perfectly masked by the ship's cell
    if (roundEngX !== cx || roundEngY !== cy) {
      // and isn't thrusting and isn't using shield
      if (this._thrusting === false && this._shieldActive === false){
        this._setCell(roundEngX, roundEngY, engCh, IDLE_ENGINE_COLOR);
      }
    }

  }

  _drawBullet(b) {
    const ch = bulletChar(b.vx, b.vy);
    this._setCell(Math.round(b.x), Math.round(b.y), ch, Color.BRIGHT_WHITE);
  }

  _drawUFOBullet(b) {
    let ch = "∙";
    if (this._baseFps === FPS_SLOW) {
      ch = "°";
    }
    this._setCell(Math.round(b.x), Math.round(b.y), ch, Color.BRIGHT_RED);
  }

  _drawExplosions() {
    for (const e of this._explosions) {
      const fi     = Math.floor(e.frame * EXPLOSION_FRAMES.length / e.maxFrame);
      const sprite = EXPLOSION_FRAMES[Math.min(fi, EXPLOSION_FRAMES.length - 1)];
      const fg     = EXPLOSION_FG[Math.min(e.frame, EXPLOSION_FG.length - 1)];
      for (let r = 0; r < sprite.length; r++) {
        for (let c = 0; c < sprite[r].length; c++) {
          const ch = sprite[r][c];
          if (ch !== ' ') {
            this._setCell(Math.round(e.x) + c - 1,
                          Math.round(e.y) + r - 1, ch, fg);
          }
        }
      }
    }
  }

  _drawParticles() {
    for (const p of this._particles) {
      this._setCell(Math.round(p.x), Math.round(p.y), p.ch, p.fg);
    }
  }

  _drawHUD() {
    for (let c = 1; c <= 80; c++)
      this.screen.putChar(c, 1, ' ', this._fg(Color.BLACK), this._bg(Color.BLUE));
      
    this._printAtScreen(1, 1,
      ` SCORE:${String(this._score).padStart(7, '0')} `,
      Color.BRIGHT_WHITE, Color.BLUE, true);
    this._printCenteredScreen(1,
      `HI:${String(this._hiScore).padStart(7, '0')}`,
      Color.BRIGHT_YELLOW, Color.BLUE, true);
      
    const lifeStr = ('^ ').repeat(Math.max(0, this._lives));
    this._printAtScreen(80 - lifeStr.length, 1, lifeStr, Color.BRIGHT_GREEN, Color.BLUE, true);

    for (let c = 1; c <= 80; c++)
      this.screen.putChar(c, 24, ' ', this._fg(Color.BLACK), this._bg(Color.DARK_GRAY));
      
    this._printAtScreen(1, 24,
      ` WV:${String(this._wave).padStart(2, '0')}`,
      Color.BRIGHT_GREEN, Color.DARK_GRAY, true);

    const barLen    = 15;
    const filled    = Math.round(this._shieldEnergy / SHIELD_MAX * barLen);
    const barFg     = this._shieldEnergy > 60 ? Color.BRIGHT_YELLOW
                    : this._shieldEnergy > 25 ? Color.YELLOW
                    : Color.BRIGHT_RED;
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    this._printAtScreen(10, 24, `SH[${bar}]`, barFg, Color.DARK_GRAY, false);

    if (this._isAttractMode) {
      this._printCenteredScreen(24, '*** DEMO MODE - PRESS ANY KEY ***', Color.BRIGHT_YELLOW, Color.DARK_GRAY, true);
    } else {
      this._printAtScreen(32, 24,
        '</> TURN  ^ THRUST  SPC:FIRE  S:SHLD  F:HYPR',
        Color.DARK_GRAY, Color.DARK_GRAY, true);
    }

    const sbFg = this._isMono ? MONO_COLORS[this._monoColorIndex] : Color.BLACK;
    const sbBg = this._isMono ? Color.BLACK : Color.CYAN;
    this.screen.statusBar(' METEOROID  |  SynthDoor  |  Q to quit', sbFg, sbBg);
  }

  _drawLevelFlash() {
    const fg = this._levelFlash > 15 ? Color.BRIGHT_YELLOW : Color.YELLOW;
    const midRow = Math.floor(PLAY_ROWS / 2) + 2; 
    this._printCenteredScreen(midRow,
      `  \u2592\u2592\u2592 WAVE ${this._wave - 1} CLEARED \u2592\u2592\u2592\u2592`, fg, Color.BLACK, true);
    this._printCenteredScreen(midRow + 1,
      `  \u2591 +${(this._wave - 1) * 500} BONUS POINTS \u2591  `,
      Color.BRIGHT_GREEN, Color.BLACK, false);
  }

  _drawGameOver() {
    Draw.box(this.screen, 24, 7, 32, 10, Draw.BOX_DOUBLE,
      this._fg(Color.BRIGHT_RED), this._bg(Color.BLACK), true);
      
    for (let c = 25; c <= 55; c++)
      this.screen.putChar(c, 8, ' ', this._fg(Color.BLACK), this._bg(Color.RED));
      
    this._printAtScreen(25, 8, '  \u2592\u2592\u2592 GAME OVER \u2592\u2592\u2592',
      Color.BRIGHT_WHITE, Color.RED, true);
    this._printAtScreen(27, 10, 'FINAL SCORE:', Color.BRIGHT_YELLOW, Color.BLACK, true);
    this._printAtScreen(27, 11,
      String(this._score).padStart(12, '0'), Color.BRIGHT_WHITE, Color.BLACK, true);
    this._printAtScreen(27, 13, 'HI-SCORE:   ', Color.BRIGHT_YELLOW, Color.BLACK, false);
    this._printAtScreen(27, 14,
      String(this._hiScore).padStart(12, '0'), Color.BRIGHT_GREEN, Color.BLACK, false);
      
    if (this._gameOverTimer > 50 && Math.floor(this._frame / 25) % 2) {
      this._printCenteredScreen(16, '>>> PRESS Q TO EXIT <<<',
        Color.BRIGHT_WHITE, Color.BLACK, true);
    }
  }

  _drawBorder() {
    for (let c = 1; c <= 80; c++) {
      const ch = c === 1 ? '+' : c === 80 ? '+' : '-';
      this.screen.putChar(c, 2, ch, this._fg(Color.DARK_GRAY), this._bg(Color.BLACK));
    }
  }

  _buildStars() {
    this._stars = [];
    for (let i = 0; i < 30; i++) {
      this._stars.push({
        x:  Utils.randInt(-1, PLAY_COLS),
        y:  Utils.randInt(-2, PLAY_ROWS),
        ch: Math.random() < 0.2 ? '+' : '.',
        fg: Utils.pick([Color.DARK_GRAY, Color.DARK_GRAY, Color.DARK_GRAY]),
      });
    }
  }

  _drawStars() {
    for (const s of this._stars) {
      this._setCell(s.x, s.y, s.ch, s.fg);
    }
  }

  // ─── COLOR WRAPPERS ────────────────────────────────────────────────────────
  
  _fg(color) {
    return this._isMono ? MONO_COLORS[this._monoColorIndex] : color;
  }

  _bg(color) {
    return this._isMono ? Color.BLACK : (color || Color.BLACK);
  }

  // ─── LOW-LEVEL CELL WRITES ─────────────────────────────────────────────────
  
_setCell(x, y, ch, fg) {
  const offsetX = Math.floor((80 - PLAY_COLS) / 2); 
  const col = Math.round(x) + 1 + offsetX; 
  const row = Math.round(y) + 3;
  
  // Update the bounds check to allow the new column range
  if (col >= 1 && col <= 80 && row >= 3 && row <= 24)
    this.screen.putChar(col, row, ch, this._fg(fg), this._bg(Color.BLACK));
}

  _printAt(row, col, text, fg) {
    this.screen.putString(col, row, text, this._fg(fg), this._bg(Color.BLACK));
  }

  _printAtScreen(col, row, text, fg, bg) {
    this.screen.putString(col, row, text, this._fg(fg), this._bg(bg || Color.BLACK));
  }

  _printCentered(row, text, fg, bold) {
    const col = Math.max(1, Math.floor((80 - text.length) / 2) + 1);
    this.screen.putString(col, row, text, this._fg(fg), this._bg(Color.BLACK));
  }

  _printCenteredScreen(row, text, fg, bg, bold) {
    const col = Math.max(1, Math.floor((80 - text.length) / 2) + 1);
    this._printAtScreen(col, row, text, fg, bg, bold);
  }

  _loadHi() {
    return this.db.getPlayerData(Meteoroid.GAME_NAME, 'global', 'hiScore', 0);
  }
  
  _saveHi(score) {
    if (score > this._loadHi())
      this.db.setPlayerData(Meteoroid.GAME_NAME, 'global', 'hiScore', score);
  }
}

module.exports = Meteoroid;