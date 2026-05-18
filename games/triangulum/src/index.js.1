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
const PHYSICS_REF_MS = 50;   // 20 FPS physics baseline

const MSG_PERSIST_MS = 2000; // Configurable duration for stage messages
const MSG_PERSIST_F  = MSG_PERSIST_MS / PHYSICS_REF_MS;

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
const PLAY_COLS  = 42;
const PLAY_ROWS  = 22;
const FIELD_LEFT = 19;
const FIELD_TOP  =  2;
const BORDER_L   = 18;
const BORDER_R   = 61;
const BORDER_T   =  1;
const BORDER_B   = 24;

function sc(x) { return Math.round(x) + FIELD_LEFT; }
function sr(y) { return Math.round(y) + FIELD_TOP;  }

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER CONTROLS & PHYSICS (Meteoroid Pattern)
// ─────────────────────────────────────────────────────────────────────────────
const PLAYER_ROW          = PLAY_ROWS - 1;
const PLAYER_START_X      = PLAY_COLS / 2;
const PLAYER_ACCEL        = 0.75;            // Impulse added per keypress
const PLAYER_DRAG         = 0.80;            // Friction multiplier per tick
const PLAYER_MAX_SPEED    = 2.50;            // Max columns per tick
const BULLET_SPEED        = 1.0;             // rows per tick
const MAX_PLAYER_BULLETS  = 2;               // per fighter (4 total in dual)
const PLAYER_FIRE_CD      = 1;               // ticks between shots
const PLAYER_INVINCIBLE_F = 40;              // ticks
const RESPAWN_F           = 30;              // ticks
const DUAL_OFFSET         = 3;               // x-distance between dual fighters

const EXTRA_LIFE_SCORES   = [20000, 70000, 140000, 210000, 280000];

// ─────────────────────────────────────────────────────────────────────────────
// FORMATION
// ─────────────────────────────────────────────────────────────────────────────
const T_BEE       = 'bee';
const T_BUTTERFLY = 'butterfly';
const T_BOSS      = 'boss';
const T_MORPH     = 'morph';

const FORM_TOP_Y = 2;

// Base column offsets relative to center (0).
const FORM_DEF = [
  { type: T_BOSS,      rowIdx: 0, cols: [-1.5, -0.5, 0.5, 1.5] },
  { type: T_BUTTERFLY, rowIdx: 1, cols: [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5] },
  { type: T_BUTTERFLY, rowIdx: 2, cols: [-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5] },
  { type: T_BEE,       rowIdx: 3, cols: [-4.5, -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5, 4.5] },
  { type: T_BEE,       rowIdx: 4, cols: [-4.5, -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5, 4.5] },
];

const SCORE = {
  bee_form:          50,
  bee_dive:          100,
  butterfly_form:    80,
  butterfly_dive:    160,
  boss_form:         150,
  boss_dive_solo:    400,
  boss_dive_esc1:    800,
  boss_dive_esc2:    1600,
  morph_dive:        160,
  morph_bonus:       1000,
  captured_ship:     1000,
  rescue_fighter:    1000,
  challenge_each:    100,
  challenge_perfect: 10000,
};

// ─────────────────────────────────────────────────────────────────────────────
// ENEMY SPRITES
// ─────────────────────────────────────────────────────────────────────────────
const SPR = {
  bee:        [ ['>','*','<'], ['>','+','<'] ],
  butterfly:  [ ['(','v',')'], ['(','V',')'] ],
  boss:       [ ['/','Θ','\\'], ['\\','Θ','/'] ],
  boss_hit:   [ ['/','0','\\'], ['\\','0','/'] ],
  morph:      [ ['/','\\'], ['\\','/'] ], 
};

const SPR_COLORS = {
  bee:        [ Color.BRIGHT_BLUE,    Color.BRIGHT_YELLOW, Color.BRIGHT_BLUE    ],
  butterfly:  [ Color.BRIGHT_RED,     Color.BRIGHT_WHITE,  Color.BRIGHT_RED     ],
  boss:       [ Color.BLUE,   Color.BRIGHT_YELLOW, Color.BLUE   ],
  boss_hit:   [ Color.BLUE, Color.BRIGHT_BLUE,  Color.BLUE ],
  morph:      [ Color.BRIGHT_YELLOW, Color.BRIGHT_YELLOW ],
};

// ─────────────────────────────────────────────────────────────────────────────
// VFX
// ─────────────────────────────────────────────────────────────────────────────
const EXPL_FRAMES    = ['*+*', '+#+', '+.+'];
const EXPL_COLORS    = [Color.BRIGHT_YELLOW, Color.BRIGHT_RED, Color.YELLOW];
const EXPL_DURATION  = 6;  // ticks
const MAX_PARTICLES  = 25;
const MAX_EXPLOSIONS = 8;

// ─────────────────────────────────────────────────────────────────────────────
// DIVE MECHANICS
// ─────────────────────────────────────────────────────────────────────────────
const DIVE_SPEED_BASE  = 0.60;    // path-steps/tick
const DIVE_SPEED_SCALE = 0.04;
const DIVE_SPEED_MAX   = 1.25;
const DIVE_PROB_BASE   = 0.006;   // per tick

const BOSS_TRACTOR_CHANCE = 0.55;
const TRACTOR_WIDTH       = 2.5;
const TRACTOR_DURATION    = 50;   // ticks
const TRACTOR_STOP_Y      = 13;
const TRACTOR_RISE_SPEED  = 0.15; // rows/tick

const ENEMY_BULLET_SPEED = 0.60;
const MAX_ENEMY_BULLETS  = 8;
const ENEMY_FIRE_PROB    = 0.015; // per diving enemy per tick

const ENTRY_SPEED        = 0.80;
const ENTRY_BATCH_DELAY  = 6;     // ticks between pair launches
const WAVE_DELAY         = 80;    // ticks between waves

const CHALLENGE_TOTAL    = 40;
const CHALLENGE_SPEED    = 0.70;

const NUM_STARS = 30;

const MONO_COLORS = [
  Color.BRIGHT_GREEN, Color.BRIGHT_YELLOW, Color.BRIGHT_CYAN,
  Color.BRIGHT_WHITE, Color.BRIGHT_RED,    Color.BRIGHT_MAGENTA,
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }
function rnd(a, b)        { return a + Math.random() * (b - a); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function bezier4(p0, p1, p2, p3, steps) {
  const pts = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, mt = 1 - t;
    pts.push({
      x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
      y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
    });
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
class Triangulum extends GameBase {
  static get GAME_NAME()  { return 'triangulum'; }
  static get GAME_TITLE() { return 'TRIANGULUM'; }

  async run() {
    this.screen.setMode(Screen.FIXED);
    this.input.start();

    this._monoColorIndex = 0;
    this._isMono         = false;
    this._baseFps        = FPS_FAST;

    await this._connectionScreen();

    let appRunning = true;
    while (appRunning) {
      const mode = await this._titleScreen();
      if (mode === 'quit') { appRunning = false; break; }

      if (mode === 'attract') {
        await this._playGame(true);
        await Promise.race([
          this.showLeaderboard(Triangulum.GAME_NAME, 'TRIANGULUM - HIGH SCORES'),
          sleep(5000),
        ]);
      } else {
        let again = true;
        while (again) {
          await this._playGame(false);
          this.db.saveScore(Triangulum.GAME_NAME, this.username, this._score);
          this._saveHi(this._hiScore);
          await Promise.race([
            this.showLeaderboard(Triangulum.GAME_NAME, 'TRIANGULUM - HIGH SCORES'),
            sleep(5000),
          ]);
          again = await Promise.race([
            this._playAgainPrompt(),
            new Promise(resolve => setTimeout(() => resolve(false), 8000)),
          ]);
        }
      }
    }
    this.input.stop();
    this.screen.setMode(Screen.SCROLL);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREENS
  // ═══════════════════════════════════════════════════════════════════════════
  async _connectionScreen() {
    let sel = 0, done = false, dirty = true;
    const opts = [
      { label: 'FAST  (local / broadband)', fps: FPS_FAST, mono: false },
      { label: 'SLOW  (9600 bps modem)',    fps: FPS_SLOW, mono: true  },
    ];
    const onAction = a => {
      if (a === 'UP' || a === 'DOWN' || a === 'UP_DOWN' || a === 'DOWN_DOWN') { 
        sel = (sel + 1) % 2; dirty = true; 
      }
    };
    const onKey = k => {
      const kl = k.toLowerCase();
      if (kl === ' ' || k === '\r' || k === '\n') done = true;
      if (kl === 'c') { this._toggleColor(); dirty = true; }
    };
    this.input.on('action', onAction);
    this.input.on('key',    onKey);
    while (!done) {
      if (dirty) {
        this._isMono = opts[sel].mono;
        this.screen.clear(Color.BLACK, Color.BLACK);
        this._cprint(3,  '*** CONNECTION SPEED ***', Color.BRIGHT_CYAN);
        this._cprint(5,  'Select your network speed:', Color.DARK_GRAY);
        for (let i = 0; i < opts.length; i++) {
          const fg  = i === sel ? Color.BRIGHT_YELLOW : Color.WHITE;
          const txt = (i === sel ? '> ' : '  ') + opts[i].label + (i === sel ? ' <' : '');
          this._cprint(8 + i * 2, txt, fg);
        }
        this._cprint(14, 'UP/DOWN   SPACE to confirm', Color.DARK_GRAY);
        if (this._isMono) this._cprint(16, 'C - TOGGLE MONO COLOR', Color.BRIGHT_GREEN);
        this.screen.flush();
        dirty = false;
      }
      await sleep(50);
    }
    this.input.removeListener('action', onAction);
    this.input.removeListener('key',    onKey);
    this._baseFps = opts[sel].fps;
    this._isMono  = opts[sel].mono;
  }

  async _titleScreen() {
    this._buildStars();
    let done = false, dirty = true, lastBlink = false, idleMs = 0, result = 'attract';
    const onKey = k => {
      const kl = k.toLowerCase();
      if (kl === 'q') { result = 'quit'; done = true; }
      else if (kl === 'c') { this._toggleColor(); dirty = true; idleMs = 0; }
      else { result = 'play'; done = true; }
    };
    this.input.on('key', onKey);
    while (!done) {
      const blink = Math.floor(Date.now() / 500) % 2 === 0;
      if (blink !== lastBlink) { dirty = true; lastBlink = blink; }
      if (dirty) { this._renderTitle(blink); this.screen.flush(); dirty = false; }
      await sleep(50);
      idleMs += 50;
      if (idleMs >= 10000) done = true;
    }
    this.input.removeListener('key', onKey);
    return result;
  }

  _renderTitle(blink) {
    this.screen.clear(Color.BLACK, Color.BLACK);
    this._drawStars();

    const TITLE_TEXT   = 'TRIANGULUM';
    const CHAR_W       = 4;
    const BANNER_W     = TITLE_TEXT.length * CHAR_W;
    const BANNER_START = Math.floor((80 - BANNER_W) / 2) + 1;
    const BANNER_ROW   = 3;

    const offset = BANNER_START - 1;
    const proxyScreen = {
      putChar: (col, row, ch, fg, bg, attr) => this.screen.putChar(col + offset, row, ch, fg, bg, attr || 0),
      putString: (col, row, str, fg, bg) => this.screen.putString(col + offset, row, str, fg, bg),
      fill: (col, row, w, h, ch, fg, bg) => this.screen.fill(col + offset, row, w, h, ch, fg, bg),
    };
    Draw.blockBanner(proxyScreen, BANNER_ROW, TITLE_TEXT, this._fg(Color.BRIGHT_CYAN), Color.BLACK);

    this._cprint(10, '* * * SYNTHDOOR EDITION * * *',   this._fg(Color.BRIGHT_GREEN));
    this._cprint(11, String(this._loadHi()).padStart(9,'0') + '  HI-SCORE', this._fg(Color.BRIGHT_YELLOW));

    if (blink) this._cprint(13, '>>  PRESS ANY KEY TO START  <<', this._fg(Color.BRIGHT_WHITE));

    this._cprint(15, '- CONTROLS -', Color.DARK_GRAY);
    this._cprint(16, 'LEFT / RIGHT   Move fighter', Color.WHITE);
    this._cprint(17, 'SPACE          Fire', Color.WHITE);
    this._cprint(18, 'Q              Quit', Color.DARK_GRAY);
    if (this._isMono) this._cprint(19, 'C              Mono color', Color.BRIGHT_GREEN);

    const sbFg = this._isMono ? MONO_COLORS[this._monoColorIndex] : Color.BLACK;
    const sbBg = this._isMono ? Color.BLACK : Color.CYAN;
    this.screen.statusBar(' TRIANGULUM  |  SynthDoor  |  Q to quit', sbFg, sbBg);
  }

  async _playAgainPrompt() {
    this.screen.clear(Color.BLACK, Color.BLACK);
    this._cprint(12, '  PLAY AGAIN? (Y/N)  ', Color.BRIGHT_YELLOW);
    this.screen.flush();
    return new Promise(resolve => {
      const yes     = () => { cleanup(); resolve(true);  };
      const no      = () => { cleanup(); resolve(false); };
      const cleanup = () => { this.input.removeListener('key', onKey); this.input.removeListener('action', onAct); };
      const onKey = k => { const kl=k.toLowerCase(); if(kl==='y') yes(); if(kl==='n'||kl==='q') no(); };
      const onAct = a => { if(a==='QUIT') no(); };
      this.input.on('key', onKey);
      this.input.on('action', onAct);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GAME INIT & STATE
  // ═══════════════════════════════════════════════════════════════════════════
  _initGame() {
    this._score          = 0;
    this._hiScore        = this._loadHi();
    this._lives          = 3;
    this._stage          = 1;
    this._frame          = 0;
    this._running        = true;
    this._gameOver       = false;
    this._gameOverTimer  = 0;
    
    // Sequential Message Queue
    this._msgQueue       = [];

    this._bulletsFired    = 0;
    this._bulletsHit      = 0;
    this._nextExtraLife   = 0;

    this._player = {
      x:           PLAYER_START_X,
      vx:          0,
      dead:        false,
      invincible:  0,
      captured:    false,
      dual:        false,
    };

    this._capturedFighter = null;
    this._captureFlash    = 0;

    this._playerBullets   = [];
    this._enemyBullets    = [];
    this._enemies         = [];
    this._explosions      = [];
    this._particles       = [];
    this._entryQueue      = [];
    this._entryActive     = [];

    this._fireCD          = 0;
    this._respawnTimer    = 0;

    // Grid System
    this._gridOffsetX     = 0;
    this._gridPhase       = 0;
    this._gridBreath      = 1.0;

    this._buildStars();
    this._startStage(1);
  }

  _startStage(n) {
    this._stage           = n;
    this._stagePending    = false; // MUST be false to allow future progression!
    
    this._enemies         = [];
    this._entryQueue      = [];
    this._entryActive     = [];
    this._playerBullets   = [];
    this._enemyBullets    = [];
    this._capturedFighter = null;
    this._captureFlash    = 0;
    
    // Stages 3, 7, 11, 15... are infinite challenge stages
    this._isChallenge     = (n > 2 && n % 4 === 3);
    this._chalTotal       = this._isChallenge ? CHALLENGE_TOTAL : 0;
    this._chalKilled      = 0;
    this._chalPerfect     = true;
    this._chalSpawnIdx    = 0;
    this._chalSpawnTimer  = 0;

    this._explosions      = [];
    this._particles       = [];

    if (!this._isChallenge) {
      this._buildFormation();
      this._queueEntries();
    }
  }

  _buildFormation() {
    for (const rowDef of FORM_DEF) {
      for (const colOffset of rowDef.cols) {
        this._enemies.push(this._makeEnemy(rowDef.type, rowDef.rowIdx, colOffset));
      }
    }
  }

  _makeEnemy(type, rowIdx, baseCol) {
    return {
      type,
      rowIdx,
      baseCol,
      x:             0,
      y:             -10,
      inForm:        false,
      docking:       false,
      returning:     false,
      dead:          false,
      diving:        false,
      divePath:      null,
      diveIdx:       0,
      hitCount:      0,
      hasCaptured:   false,
      tractorRun:    false,
      tractorActive: false,
      tractorTimer:  0,
      tractorFired:  false,
      escorts:       [],
      animFrame:     0,
      animTimer:     0,
      isChallEnemy:  false,
      isMorph:       false,
      morphGroupId:  0,
    };
  }

  _queueEntries() {
    const waves = [[], [], [], [], []];
    let wIdx = 0;
    const sorted = [...this._enemies].sort((a,b) => (a.rowIdx*100 + a.baseCol) - (b.rowIdx*100 + b.baseCol));
    for (const e of sorted) {
      waves[Math.floor(wIdx / 8)].push(e);
      wIdx++;
    }

    let tDelay = 0;
    for (let w = 0; w < 5; w++) {
      const fromLeft = (w % 2 === 0);
      let eDelay = tDelay;
      for (const e of waves[w]) {
        this._entryQueue.push({
          enemy:   e,
          delay:   eDelay,
          path:    this._buildEntryPath(e, fromLeft, w),
          pathIdx: 0,
        });
        eDelay += ENTRY_BATCH_DELAY;
      }
      tDelay += WAVE_DELAY;
    }
  }

  _buildEntryPath(e, fromLeft, waveIdx) {
    const destX = PLAY_COLS / 2 + e.baseCol * 3.0; 
    const destY = FORM_TOP_Y + e.rowIdx * 2;
    
    const style = (this._stage + waveIdx) % 3;
    const lowY = PLAYER_ROW - 1; // Deep swoop target
    
    // Add +4 to the Y control points to physically force the bezier curve 
    // to bottom out near lowY.
    if (style === 0) {
        return bezier4({x: PLAY_COLS/2, y: -2}, 
                       {x: PLAY_COLS/2 + (fromLeft ? -15 : 15), y: lowY + 4}, 
                       {x: destX + (fromLeft ? -5 : 5), y: destY + 5}, 
                       {x: destX, y: destY}, 30);
    } else if (style === 1) {
        const startX = fromLeft ? -4 : PLAY_COLS + 4;
        return bezier4({x: startX, y: 10}, 
                       {x: PLAY_COLS/2, y: lowY + 4}, 
                       {x: destX, y: destY + 8}, 
                       {x: destX, y: destY}, 30);
    } else {
        const startX = fromLeft ? -2 : PLAY_COLS + 2;
        return bezier4({x: startX, y: -2}, 
                       {x: startX + (fromLeft?12:-12), y: lowY + 4}, 
                       {x: destX + (fromLeft?-10:10), y: -5}, 
                       {x: destX, y: destY}, 35);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN LOOP & INPUT (Meteoroid Pattern)
  // ═══════════════════════════════════════════════════════════════════════════
  async _playGame(isAttract = false) {
    this._isAttract = isAttract;
    this._initGame();

    const onAction = a => {
      if (this._isAttract) { this._running = false; return; }
      if (a === 'QUIT')    { this._running = false; return; }
      if (a === 'LEFT')    { this._applyThrust(-1); return; }
      if (a === 'RIGHT')   { this._applyThrust( 1); return; }
      if (a === 'FIRE')    { this._tryFire();       return; }
    };
    const onKey = k => {
      if (this._isAttract) { this._running = false; return; }
      const kl = k.toLowerCase();
      if (kl === 'q')               { this._running = false; return; }
      if (kl === ' ' || kl === '5') { this._tryFire();       return; }
      if (kl === 'c')               { this._toggleColor();   return; }
    };

    this.input.on('action', onAction);
    this.input.on('key',    onKey);

    let lastTime = Date.now();
    const frameMs = 1000 / this._baseFps;

    while (this._running) {
      const now     = Date.now();
      const elapsed = Math.max(1, now - lastTime);
      lastTime = now;

      let toSim = Math.min(elapsed / PHYSICS_REF_MS, 20.0);
      while (toSim > 0) {
        const step = Math.min(toSim, 1.0);
        if (this._isAttract) this._aiUpdate();
        this._update(step);
        toSim -= step;
      }
      
      this._draw();
      this.screen.flush();

      const proc = Date.now() - now;
      await sleep(Math.max(5, frameMs - proc));
    }

    this.input.removeListener('action', onAction);
    this.input.removeListener('key',    onKey);
  }

  _aiUpdate() {
    if (this._gameOver || this._player.dead || this._player.captured) return;
    if (Math.random() < 0.1) return;
    
    let nearX = null, nearDist = Infinity;
    for (const b of this._enemyBullets) {
      const d = Math.abs(b.x - this._player.x) * 0.6 + Math.abs(b.y - PLAYER_ROW) * 0.4;
      if (d < nearDist) { nearDist = d; nearX = b.x; }
    }
    for (const e of this._enemies) {
      if (!e.dead && e.diving && e.y > PLAY_ROWS * 0.5) {
        const d = Math.abs(e.x - this._player.x);
        if (d < nearDist) { nearDist = d; nearX = e.x; }
      }
    }
    
    if (nearX !== null && nearDist < 4) {
      this._applyThrust(nearX > this._player.x ? -1 : 1);
    } else {
      let best = null, bd = Infinity;
      for (const e of this._enemies) {
        if (e.dead) continue;
        const d = Math.abs(e.x - this._player.x) + e.y * 0.2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        if (best.x < this._player.x - 1) this._applyThrust(-1);
        else if (best.x > this._player.x + 1) this._applyThrust(1);
      }
    }
    if (Math.random() < 0.3) this._tryFire();
  }

  _applyThrust(dir) {
    if (this._player.dead || this._player.captured || this._gameOver) return;
    if (this._msgQueue.length > 0) return; // Prevent moving during messages
    const accel = PLAYER_ACCEL * (this._baseFps === FPS_SLOW ? 1.4 : 1.0);
    this._player.vx += dir * accel;
  }

  _tryFire() {
    if (this._player.dead || this._player.captured || this._gameOver) return;
    if (this._msgQueue.length > 0) return; // Prevent firing during messages
    if (this._fireCD > 0) return;
    
    const mainBullets = this._playerBullets.filter(b => !b.isDual).length;
    const dualBullets = this._playerBullets.filter(b =>  b.isDual).length;

    let fired = false;
    if (mainBullets < MAX_PLAYER_BULLETS) {
      this._playerBullets.push({ x: this._player.x, y: PLAYER_ROW - 0.5, isDual: false });
      this._bulletsFired++;
      fired = true;
    }
    if (this._player.dual && dualBullets < MAX_PLAYER_BULLETS) {
      this._playerBullets.push({ x: this._player.x + DUAL_OFFSET, y: PLAYER_ROW - 0.5, isDual: true });
      this._bulletsFired++;
      fired = true;
    }
    if (fired) this._fireCD = PLAYER_FIRE_CD;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE LOGIC (Tick-based)
  // ═══════════════════════════════════════════════════════════════════════════
  _update(dt) {
    this._frame += dt;

    if (this._gameOver) {
      this._gameOverTimer += dt;
      if (this._gameOverTimer > 150 || (this._isAttract && this._gameOverTimer > 40)) this._running = false;
      this._tickParticles(dt);
      this._tickExplosions(dt);
      return;
    }

    // Process Sequential Messages (Pauses Gameplay)
    if (this._msgQueue.length > 0) {
      const currentMsg = this._msgQueue[0];
      if (currentMsg.action) {
         currentMsg.action();
         this._msgQueue.shift();
      } else {
         currentMsg.timer -= dt;
         if (currentMsg.timer <= 0) {
           this._msgQueue.shift();
         }
      }
      this._tickParticles(dt);
      this._tickExplosions(dt);
      
      // Let bullets clear out naturally during messages
      this._tickPlayerBullets(dt);
      this._tickEnemyBullets(dt);
      return;
    }

    if (this._respawnTimer > 0) {
      this._respawnTimer -= dt;
      this._tickGridSystem(dt);
      this._tickEntries(dt);
      this._tickEnemyMotion(dt);
      this._tickEnemyBullets(dt);
      this._tickParticles(dt);
      this._tickExplosions(dt);
      return;
    }

    if (this._player.dead) {
      this._lives--;
      if (this._lives < 0) {
        this._gameOver      = true;
        this._gameOverTimer = 0;
        if (this._score > this._hiScore) this._hiScore = this._score;
        return;
      }
      this._player.x          = PLAYER_START_X;
      this._player.vx         = 0;
      this._player.dead        = false;
      this._player.invincible  = PLAYER_INVINCIBLE_F;
      this._player.captured    = false;
      this._player.dual        = false;
      this._capturedFighter    = null;
      this._playerBullets      = [];
      this._respawnTimer       = RESPAWN_F;
      return;
    }

    if (!this._player.dead && !this._player.captured) {
      this._player.vx *= Math.pow(PLAYER_DRAG, dt);
      this._player.vx = clamp(this._player.vx, -PLAYER_MAX_SPEED, PLAYER_MAX_SPEED);
      this._player.x += this._player.vx * dt;
      this._player.x = clamp(this._player.x, 1, PLAY_COLS - (this._player.dual ? DUAL_OFFSET + 2 : 2));
    }

    if (this._captureFlash > 0)       this._captureFlash -= dt;
    if (this._fireCD > 0)             this._fireCD -= dt;
    if (this._player.invincible > 0)  this._player.invincible -= dt;

    this._tickGridSystem(dt);
    this._tickEntries(dt);

    if (this._isChallenge) {
      this._tickChallenge(dt);
    } else {
      this._tickEnemyMotion(dt);
      this._tickDiveLaunches(dt);
      this._tickEnemyFire(dt);
    }

    this._tickPlayerBullets(dt);
    this._tickEnemyBullets(dt);
    this._tickTractor(dt);
    this._detectCollisions();
    this._checkStageClear();
    this._tickParticles(dt);
    this._tickExplosions(dt);
  }

  // ─── Grid System (Breathing & Swaying) ──────────────────────────────────
  _getGridX(e) { return PLAY_COLS/2 + this._gridOffsetX + e.baseCol * (3.0 * this._gridBreath); }
  _getGridY(e) { return FORM_TOP_Y + e.rowIdx * (2 * this._gridBreath); }

  _tickGridSystem(dt) {
    if (this._isChallenge) return;
    
    // Sway is constant
    this._gridOffsetX = Math.sin(this._frame * 0.04) * 6.0;
    
    // Breathing only starts once all bugs are out of the entry queue/active path
    const allDocked = this._entryQueue.length === 0 && this._entryActive.length === 0;
    if (allDocked) {
        this._gridPhase += dt;
    }
    // High amplitude for visible breathing
    this._gridBreath = 1.0 + Math.sin(this._gridPhase * 0.15) * 0.15; 

    for (const e of this._enemies) {
      if (e.inForm && !e.dead) {
        e.x = this._getGridX(e);
        e.y = this._getGridY(e);
      }
    }
  }

  // ─── Entry Flights ────────────────────────────────────────────────────────
  _tickEntries(dt) {
    for (let i = this._entryQueue.length - 1; i >= 0; i--) {
      const q = this._entryQueue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        q.enemy.x = q.path[0].x;
        q.enemy.y = q.path[0].y;
        this._entryActive.push(q);
        this._entryQueue.splice(i, 1);
      }
    }
    
    for (let i = this._entryActive.length - 1; i >= 0; i--) {
      const q = this._entryActive[i];
      if (q.enemy.dead) { this._entryActive.splice(i, 1); continue; }
      
      q.pathIdx += ENTRY_SPEED * dt;
      const idx  = Math.floor(q.pathIdx);
      
      if (idx >= q.path.length - 1) {
        q.enemy.docking = true;
        this._entryActive.splice(i, 1);
      } else {
        const t  = q.pathIdx - idx;
        const p0 = q.path[idx], p1 = q.path[idx + 1];
        q.enemy.x = p0.x + (p1.x - p0.x) * t;
        q.enemy.y = p0.y + (p1.y - p0.y) * t;
      }
    }
  }

  // ─── Enemy Motion & Dives ─────────────────────────────────────────────────
  _tickEnemyMotion(dt) {
    for (const e of this._enemies) {
      if (e.dead) continue;
      
      e.animTimer += dt;
      const animRate = this._baseFps === FPS_SLOW ? 14 : 9;
      if (e.animTimer >= animRate) { e.animFrame = 1 - e.animFrame; e.animTimer = 0; }
      
      if (e.docking) this._advanceDocking(e, dt);
      else if (e.diving) this._advanceDive(e, dt);
    }
  }

  _advanceDocking(e, dt) {
    const tx = this._getGridX(e);
    const ty = this._getGridY(e);
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy);
    
    if (dist < 0.5) {
      e.x = tx; e.y = ty;
      e.inForm = true;
      e.docking = false;
    } else {
      const spd = Math.min(dist, ENTRY_SPEED * 2.0 * dt); // Snaps nicely
      e.x += (dx / dist) * spd;
      e.y += (dy / dist) * spd;
    }
  }

  _advanceDive(e, dt) {
    if (!e.divePath) return;

    if (e.tractorActive) {
      e.tractorTimer -= dt;
      if (e.tractorTimer <= 0) {
        e.tractorActive = false;
        e.tractorFired  = true;
        
        // Global safety check: if player wasn't captured by us (or anyone), fly away
        const shipAlreadyCaptured = this._player.captured || this._capturedFighter !== null || this._enemies.some(en => en.hasCaptured);
        if (!shipAlreadyCaptured) {
          e.divePath = this._buildDiveSwoop(e.x, e.y, this._player.x, Math.random() < 0.5 ? -1 : 1);
          e.diveIdx  = 0;
        }
      }
      return;
    }

    const spd = Math.min(DIVE_SPEED_MAX, DIVE_SPEED_BASE + DIVE_SPEED_SCALE * (this._stage - 1));
    e.diveIdx += spd * dt;
    const idx  = Math.floor(e.diveIdx);

    if (idx >= e.divePath.length - 1 || e.y >= PLAY_ROWS) {
      if (e.isMorph) {
        // Morphs never dock, they infinitely loop and attack
        e.y = -2;
        e.divePath = this._buildDiveSwoop(e.x, e.y, this._player.x, Math.random() < 0.5 ? -1 : 1);
        e.diveIdx = 0;
      } else if (e.returning) {
        e.diving = false;
        e.returning = false;
        e.docking = true;
      } else {
        // Exited bottom: compute wrap-around return flight to exactly match slot
        e.y = -2;
        e.returning = true;
        const destX = this._getGridX(e);
        const destY = this._getGridY(e);
        e.divePath = bezier4(
          {x: e.x, y: -2}, 
          {x: e.x, y: PLAY_ROWS/2}, 
          {x: destX, y: destY + 5}, 
          {x: destX, y: destY}, 
          30
        );
        e.diveIdx = 0;
        e.tractorFired = false;
        e.tractorRun = false;
        e.escorts = [];
      }
    } else {
      const t  = e.diveIdx - idx;
      const p0 = e.divePath[idx], p1 = e.divePath[idx + 1];
      e.x = clamp(p0.x + (p1.x - p0.x) * t, 0, PLAY_COLS - 1);
      e.y = p0.y + (p1.y - p0.y) * t;

      if (e.type === T_BOSS && e.tractorRun && !e.tractorFired && !e.tractorActive
          && e.y >= TRACTOR_STOP_Y && e.y < TRACTOR_STOP_Y + 1.0) {
        
        const anyOtherTractor = this._enemies.some(o => o !== e && o.tractorActive);
        const shipAlreadyCaptured = this._player.captured || this._capturedFighter !== null || this._enemies.some(en => en.hasCaptured);

        // Strict limit: No other active tractors, ship isn't already captured, boss is undamaged
        if (!shipAlreadyCaptured && !anyOtherTractor && e.hitCount === 0) {
          e.tractorActive = true;
          e.tractorTimer  = TRACTOR_DURATION;
        } else {
          e.tractorRun = false; 
        }
      }
    }
  }

  _buildDiveSwoop(startX, startY, targetX, loopDir) {
    const p0 = { x: startX, y: startY };
    const p1 = { x: clamp(startX + loopDir * 15, -5, PLAY_COLS + 5), y: startY + 8 };
    const p2 = { x: clamp(startX - loopDir * 10, -5, PLAY_COLS + 5), y: startY + 12 };
    const p3 = { x: clamp(targetX, 2, PLAY_COLS - 2), y: PLAYER_ROW - 1 }; // Deep swoop
    return bezier4(p0, p1, p2, p3, 30);
  }

  _tickDiveLaunches(dt) {
    const formed = this._enemies.filter(e => e.inForm && !e.dead && !e.diving);
    const diving = this._enemies.filter(e => e.diving && !e.dead);
    const allIn  = this._entryQueue.length === 0 && this._entryActive.length === 0;
    
    if (!allIn) return;

    // Determine max active divers based on stage
    const maxDivers = Math.min(3 + Math.floor(this._stage / 3), 8);
    if (diving.length >= maxDivers) return;

    const prob = Math.min(DIVE_PROB_BASE + 0.001 * (this._stage - 1), 0.015);
    for (const e of formed) {
      if (diving.length >= maxDivers) break;
      if (Math.random() < prob * dt) {
        
        // Morph Feature: Pulsating Bees transforming into 3 specialized ships
        if (e.type === T_BEE && this._stage >= 3 && Math.random() < 0.05) {
            e.type = T_MORPH;
            e.isMorph = true;
            e.morphGroupId = this._frame;
            e.diving = true; e.inForm = false; e.docking = false; e.returning = false;
            e.divePath = this._buildDiveSwoop(e.x, e.y, this._player.x, e.baseCol < 0 ? -1 : 1);
            e.diveIdx = 0;
            
            for(let i=0; i<2; i++) {
                const esc = this._makeEnemy(T_MORPH, -1, 0);
                esc.x = e.x + (i===0 ? -2 : 2); 
                esc.y = e.y;
                esc.isMorph = true;
                esc.morphGroupId = e.morphGroupId;
                esc.diving = true; esc.inForm = false; esc.docking = false; esc.returning = false;
                esc.divePath = this._buildDiveSwoop(esc.x, esc.y, this._player.x, e.baseCol < 0 ? -1 : 1);
                esc.diveIdx = 0;
                this._enemies.push(esc);
            }
        } else {
            if (e.type === T_BOSS) this._launchBossDive(e);
            else                   this._launchDive(e);
        }
      }
    }
  }

  _launchDive(e) {
    e.diving = true; e.inForm = false; e.docking = false; e.returning = false;
    e.divePath = this._buildDiveSwoop(e.x, e.y, this._player.x, e.baseCol < 0 ? -1 : 1);
    e.diveIdx  = 0;
  }

  _launchBossDive(boss) {
    boss.diving = true; boss.inForm = false; boss.docking = false; boss.returning = false;
    
    // Global check before initiating a tractor dive
    const shipAlreadyCaptured = this._player.captured || this._capturedFighter !== null || this._enemies.some(en => en.hasCaptured);
    const anyTractorActive = this._enemies.some(o => o.tractorRun || o.tractorActive);
    
    boss.tractorRun = !shipAlreadyCaptured && !this._player.dual && boss.hitCount === 0 && !anyTractorActive && Math.random() < BOSS_TRACTOR_CHANCE;
    
    if (!boss.tractorRun) {
      const butterflies = this._enemies.filter(e => e.type === T_BUTTERFLY && e.inForm && !e.dead);
      boss.escorts = butterflies.slice(0, Math.random() < 0.5 ? 2 : 1);
      for (const esc of boss.escorts) {
        esc.diving = true; esc.inForm = false; esc.docking = false; esc.returning = false;
        esc.divePath = this._buildDiveSwoop(esc.x, esc.y, this._player.x, esc.baseCol < 0 ? -1 : 1);
        esc.diveIdx = 0;
      }
    }
    boss.divePath = this._buildDiveSwoop(boss.x, boss.y, this._player.x, boss.baseCol < 0 ? -1 : 1);
    boss.diveIdx = 0;
  }

  // ─── Challenge Stage ──────────────────────────────────────────────────────
  _tickChallenge(dt) {
    for (const e of this._enemies) {
      if (e.dead || !e.divePath) continue;
      e.animTimer += dt;
      if (e.animTimer >= 9) { e.animFrame = 1 - e.animFrame; e.animTimer = 0; }
      
      e.diveIdx += CHALLENGE_SPEED * dt;
      const idx = Math.floor(e.diveIdx);
      if (idx >= e.divePath.length - 1) {
        e.dead = true;
      } else {
        const t = e.diveIdx - idx;
        e.x = e.divePath[idx].x + (e.divePath[idx+1].x - e.divePath[idx].x) * t;
        e.y = Math.min(e.divePath[idx].y + (e.divePath[idx+1].y - e.divePath[idx].y) * t, PLAYER_ROW - 1);
      }
    }

    this._chalSpawnTimer -= dt;
    if (this._chalSpawnTimer <= 0 && this._chalSpawnIdx < this._chalTotal) {
      this._chalSpawnTimer = 10;
      this._spawnChallengeEnemy();
      this._chalSpawnIdx++;
    }
  }

  _spawnChallengeEnemy() {
    const wave = Math.floor(this._chalSpawnIdx / 8);
    const inWave = this._chalSpawnIdx % 8;
    const fromLeft = wave % 2 === 0;
    
    const startX = fromLeft ? -2 : PLAY_COLS + 2;
    const endX   = fromLeft ? PLAY_COLS + 2 : -2;
    
    // Vary the challenge flight paths, sweeping down low
    const pattern = Math.floor(this._stage / 4) % 3;
    const path = [];
    
    if (pattern === 0) {
        const amp = (PLAYER_ROW - 2) / 2;
        const midY = 2 + amp;
        for (let s = 0; s <= 40; s++) {
          const t = s / 40;
          path.push({ x: startX + (endX - startX) * t, y: midY - Math.cos(t * Math.PI * 2) * amp });
        }
    } else if (pattern === 1) {
        const xPos = fromLeft ? 5 + inWave * 2 : PLAY_COLS - 5 - inWave * 2;
        path.push(...bezier4({x: xPos, y: -2}, 
                             {x: xPos, y: PLAYER_ROW + 5}, 
                             {x: xPos + (fromLeft?16:-16), y: PLAYER_ROW + 5}, 
                             {x: xPos + (fromLeft?16:-16), y: -2}, 40));
    } else {
        for (let s = 0; s <= 40; s++) {
          const t = s / 40;
          path.push({ x: startX + (endX - startX) * t, y: -2 + t * (PLAYER_ROW + 2) + Math.sin(t * Math.PI * 6) * 3 });
        }
    }

    const e = this._makeEnemy(Utils.pick([T_BEE, T_BUTTERFLY]), -1, 0);
    e.x = path[0].x; e.y = path[0].y;
    e.divePath = path; e.diveIdx = 0;
    e.diving = true; e.isChallEnemy = true;
    this._enemies.push(e);
  }

  // ─── Bullets & Tractor Beam ───────────────────────────────────────────────
  _tickPlayerBullets(dt) {
    for (const b of this._playerBullets) b.y -= BULLET_SPEED * dt;
    this._playerBullets = this._playerBullets.filter(b => b.y >= 0);
  }

  _tickEnemyBullets(dt) {
    for (const b of this._enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    this._enemyBullets = this._enemyBullets.filter(
      b => b.y < PLAY_ROWS && b.y >= 0 && b.x >= -1 && b.x <= PLAY_COLS + 1
    );
  }

  _tickEnemyFire(dt) {
    if (this._player.dead || this._player.captured) return;
    if (this._enemyBullets.length >= MAX_ENEMY_BULLETS) return;
    
    const prob = Math.min(ENEMY_FIRE_PROB * (1 + (this._stage - 1) * 0.1), 0.1);
    for (const e of this._enemies) {
      // Morphs never shoot
      if (e.dead || !e.diving || e.tractorActive || e.isMorph) continue;
      if (Math.random() < prob * dt) {
        const dx = this._player.x - e.x, dy = PLAYER_ROW - e.y;
        const len = Math.hypot(dx, dy) || 1;
        
        let vy = (dy / len) * ENEMY_BULLET_SPEED;
        if (vy < 0.25) vy = 0.25; 
        
        const vx = clamp((dx / len) * (ENEMY_BULLET_SPEED * 0.4), -0.3, 0.3) + rnd(-0.05, 0.05);

        this._enemyBullets.push({ x: e.x, y: e.y, vx: vx, vy: vy });
        if (this._enemyBullets.length >= MAX_ENEMY_BULLETS) break;
      }
    }
  }

  _tickTractor(dt) {
    for (const e of this._enemies) {
      if (!e.tractorActive || e.dead || e.type !== T_BOSS) continue;
      if (this._player.captured || this._player.dead) continue;
      if (Math.abs(e.x - this._player.x) <= TRACTOR_WIDTH || 
         (this._player.dual && Math.abs(e.x - (this._player.x + DUAL_OFFSET)) <= TRACTOR_WIDTH)) {
        
        this._player.captured  = true;
        this._capturedFighter  = { x: this._player.x, y: PLAYER_ROW, bossRef: e };
        this._captureFlash     = 60; // ticks
        e.tractorActive = false;
        e.tractorFired  = true;
      }
    }

    if (!this._capturedFighter) return;
    const cf = this._capturedFighter;

    if (!cf.bossRef || cf.bossRef.dead) {
      this._capturedFighter = null;
      this._player.captured = false;
      this._player.dead     = false;
      this._addScore(SCORE.rescue_fighter);
      return;
    }

    cf.y -= TRACTOR_RISE_SPEED * dt;
    cf.x += (cf.bossRef.x - cf.x) * 0.1 * dt;

    if (cf.y <= cf.bossRef.y + 1) {
      cf.bossRef.hasCaptured = true;
      this._capturedFighter  = null;
      this._player.dead      = true; 
    }
  }

  // ─── Collisions ───────────────────────────────────────────────────────────
  _detectCollisions() {
    const deadBullets = new Set();
    const HITBOX_X = 1.6;
    const HITBOX_Y = 1.0;

    for (let bi = 0; bi < this._playerBullets.length; bi++) {
      const b = this._playerBullets[bi];
      for (const e of this._enemies) {
        if (e.dead || deadBullets.has(bi)) continue;
        if (Math.abs(b.x - e.x) <= HITBOX_X && Math.abs(b.y - e.y) <= HITBOX_Y) {
          deadBullets.add(bi);
          this._bulletsHit++;
          this._hitEnemy(e);
          break;
        }
      }
    }
    this._playerBullets = this._playerBullets.filter((_, i) => !deadBullets.has(i));

    if (!this._isChallenge && !this._player.dead && !this._player.captured && this._player.invincible <= 0) {
      for (let bi = this._enemyBullets.length - 1; bi >= 0; bi--) {
        const b = this._enemyBullets[bi];
        if (this._checkPlayerHit(b.x, b.y, 1.0, 1.0)) {
          this._enemyBullets.splice(bi, 1);
          break;
        }
      }
      
      for (const e of this._enemies) {
        if (e.dead || Math.abs(e.y - PLAYER_ROW) >= 2.0) continue;
        if (this._checkPlayerHit(e.x, e.y, HITBOX_X, HITBOX_Y)) {
          this._hitEnemy(e);
          break;
        }
      }
    }
  }

  _checkPlayerHit(tx, ty, hx, hy) {
    if (Math.abs(tx - this._player.x) <= hx && Math.abs(ty - PLAYER_ROW) <= hy) {
      this._killPlayer(false); return true;
    }
    if (this._player.dual && Math.abs(tx - (this._player.x + DUAL_OFFSET)) <= hx && Math.abs(ty - PLAYER_ROW) <= hy) {
      this._killPlayer(true); return true;
    }
    return false;
  }

  _hitEnemy(e) {
    if (e.dead) return;
    if (e.type === T_BOSS && e.hitCount === 0) {
      e.hitCount = 1;
      return;
    }

    const wasDiving = e.diving;
    e.dead = true;
    
    if (e.hasCaptured) {
      e.hasCaptured = false;
      this._player.dual = true;
      this._player.captured = false;
      this._addScore(SCORE.rescue_fighter);
    }

    let pts = 0;
    if (e.type === T_BOSS) {
      const aliveEscs = (e.escorts || []).filter(esc => !esc.dead).length;
      if      (aliveEscs >= 2) pts = SCORE.boss_dive_esc2;
      else if (aliveEscs === 1) pts = SCORE.boss_dive_esc1;
      else                      pts = wasDiving ? SCORE.boss_dive_solo : SCORE.boss_form;
    } else if (e.type === T_BUTTERFLY) {
      pts = (wasDiving || e.isChallEnemy) ? SCORE.butterfly_dive : SCORE.butterfly_form;
    } else if (e.type === T_MORPH) {
      pts = SCORE.morph_dive;
      const siblings = this._enemies.filter(o => o.isMorph && o.morphGroupId === e.morphGroupId && !o.dead);
      if (siblings.length === 0) {
        pts += SCORE.morph_bonus;
      }
    } else {
      pts = (wasDiving || e.isChallEnemy) ? SCORE.bee_dive : SCORE.bee_form;
    }

    if (e.isChallEnemy) this._chalKilled++;
    this._addScore(pts);
    this._addExplosion(e.x, e.y, e.type === T_BOSS);
  }

  _killPlayer(hitDualShip) {
    this._chalPerfect = false;
    if (this._player.dual && hitDualShip) {
      this._player.dual = false;
      this._addExplosion(this._player.x + DUAL_OFFSET, PLAYER_ROW, true);
    } else if (this._player.dual && !hitDualShip) {
      this._player.dual = false;
      this._player.x += DUAL_OFFSET; 
      this._addExplosion(this._player.x - DUAL_OFFSET, PLAYER_ROW, true);
    } else {
      this._player.dead = true;
      this._addExplosion(this._player.x, PLAYER_ROW, true);
      this._respawnTimer  = RESPAWN_F;
      this._playerBullets = [];
    }
  }

  _addScore(pts) {
    this._score += pts;
    if (this._score > this._hiScore) this._hiScore = this._score;
    while (this._nextExtraLife < EXTRA_LIFE_SCORES.length &&
           this._score >= EXTRA_LIFE_SCORES[this._nextExtraLife]) {
      this._lives = Math.min(8, this._lives + 1);
      this._nextExtraLife++;
    }
  }

  _checkStageClear() {
    const allDead  = this._enemies.every(e => e.dead);
    const entryDone = this._entryQueue.length === 0 && this._entryActive.length === 0;
    const chalDone  = !this._isChallenge || this._chalSpawnIdx >= this._chalTotal;
    if (!(allDead && entryDone && chalDone)) return;
    
    // We only trigger this once per stage end
    if (this._stagePending) return;
    this._stagePending = true;
    
    const nextStage = this._stage + 1;
    const isNextChallenge = (nextStage > 2 && nextStage % 4 === 3);

    // Queue Stage Ending Stats/Message
    if (this._isChallenge) {
      const perfect = this._chalPerfect && this._chalKilled >= this._chalTotal;
      const bonus   = perfect ? SCORE.challenge_perfect : this._chalKilled * SCORE.challenge_each;
      this._addScore(bonus);
      this._msgQueue.push({
        lines: [
          `NUMBER OF HITS   ${this._chalKilled}`,
          perfect ? 'PERFECT!' : `BONUS   ${bonus}`
        ],
        timer: MSG_PERSIST_F
      });
    } else {
      this._msgQueue.push({
        lines: [`STAGE ${this._stage} CLEAR!`],
        timer: MSG_PERSIST_F
      });
    }

    // Queue Next Stage Intro Message
    if (isNextChallenge) {
      this._msgQueue.push({
        lines: ["CHALLENGING STAGE"],
        timer: MSG_PERSIST_F
      });
    }

    // Queue Action to trigger the actual next stage
    this._msgQueue.push({
      action: () => this._startStage(nextStage)
    });
  }

  // ─── VFX ──────────────────────────────────────────────────────────────────
  _addExplosion(x, y, large = false) {
    if (this._baseFps === FPS_SLOW) return;
    if (this._explosions.length < MAX_EXPLOSIONS) {
      this._explosions.push({ x, y, timer: 0, large });
    }
    if (!large) return;
    for (let i = 0; i < 3 && this._particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2, s = rnd(0.5, 1.2);
      this._particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5,
        life: rnd(4, 10), ch: Utils.pick(['*', '.']), fg: Utils.pick([Color.BRIGHT_YELLOW, Color.WHITE]),
      });
    }
  }

  _tickParticles(dt) {
    for (const p of this._particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this._particles = this._particles.filter(p => p.life > 0 && p.x >= 0 && p.x < PLAY_COLS);
  }

  _tickExplosions(dt) {
    for (const ex of this._explosions) ex.timer += dt;
    this._explosions = this._explosions.filter(ex => ex.timer < EXPL_DURATION);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER (Diffed naturally by the Screen Engine)
  // ═══════════════════════════════════════════════════════════════════════════
  _draw() {
    this.screen.clear(Color.BLACK, Color.BLACK);
    this._drawBorder();
    this._drawPanels();
    this._drawStars();

    this._drawEnemies();
    this._drawTractorBeam();
    this._drawCapturedFighter();

    if (this._baseFps !== FPS_SLOW) {
      this._drawParticles();
      this._drawExplosions();
    }

    this._drawEnemyBullets();
    this._drawPlayerBullets();
    this._drawPlayer();
    
    this._drawMessages();

    if (this._captureFlash > 0)             this._drawCaptureFlash();
    if (this._gameOver && !this._isAttract) this._drawGameOver();
  }

  _drawBorder() {
    const fg = this._fg(Color.DARK_GRAY), bg = Color.BLACK;
    this.screen.putChar(BORDER_L, BORDER_T, '╔', fg, bg);
    this.screen.putChar(BORDER_R, BORDER_T, '╗', fg, bg);
    for (let c = BORDER_L + 1; c < BORDER_R; c++) this.screen.putChar(c, BORDER_T, '═', fg, bg);
    this.screen.putChar(BORDER_L, BORDER_B, '╚', fg, bg);
    this.screen.putChar(BORDER_R, BORDER_B, '╝', fg, bg);
    for (let c = BORDER_L + 1; c < BORDER_R; c++) this.screen.putChar(c, BORDER_B, '═', fg, bg);
    for (let r = BORDER_T + 1; r < BORDER_B; r++) {
      this.screen.putChar(BORDER_L, r, '║', fg, bg);
      this.screen.putChar(BORDER_R, r, '║', fg, bg);
    }
  }

  _drawPanels() {
    const W = Color.BRIGHT_WHITE, G = Color.DARK_GRAY, lc = 1;
    this._pstr(lc,  1, '-- SCORE TABLE --', G);
    this._drawEnemySprite(lc, 3, T_BEE, 0);       this._pstr(lc+4, 3, 'BEE  50  100', W);
    this._drawEnemySprite(lc, 4, T_BUTTERFLY, 0); this._pstr(lc+4, 4, 'BFLY 80  160', W);
    this._drawEnemySprite(lc, 5, T_BOSS, 0);      this._pstr(lc+4, 5, 'BOSS 150 400', W);
    this._drawEnemySprite(lc, 6, T_MORPH, 0);   this._pstr(lc+4, 6, 'MRPH     160', W);
    this._pstr(lc-1,  7, ' All 3 Mrph  1000', Color.BRIGHT_MAGENTA);
    this._pstr(lc-1,  8, ' +2 Escort   1600', W);
    this._pstr(lc-1,  9, ' Rescue      1000', Color.BRIGHT_CYAN);
    
    this._pstr(lc, 12, 'LIVES:', Color.BRIGHT_GREEN);
    for (let i = 0; i < Math.max(0, this._lives); i++) {
      if (lc + i * 4 + 2 <= 17) this._drawEnemySprite(lc + i * 4, 13, 'player', 0);
    }
    if (this._player.dual) this._pstr(lc, 14, '** DUAL MODE **', Color.BRIGHT_YELLOW);
    this._pstr(lc, 17, `STAGE: ${this._stage}`, Color.BRIGHT_CYAN);
    const flags = ('* ').repeat(Math.min(8, this._stage - 1));
    if (flags) this._pstr(lc, 18, flags.substring(0, 17), Color.BRIGHT_CYAN);

    const rCenter = (row, text, fg) => this._pstr(Math.max(62, 62 + Math.floor((19 - text.length)/2)), row, text, fg);
    rCenter( 1, '1-UP SCORE', G); rCenter( 2, String(this._score).padStart(10, '0'), W);
    rCenter( 4, 'HI-SCORE', G);   rCenter( 5, String(this._hiScore).padStart(10, '0'), Color.BRIGHT_YELLOW);
    rCenter( 7, '-- CONTROLS --', G);
    rCenter( 8, '</> MOVE', W); rCenter( 9, 'SPC FIRE', W); rCenter(10, 'Q   QUIT', G);
    if (this._isMono) rCenter(11, 'C   COLOR', Color.BRIGHT_GREEN);

    if (this._bulletsFired > 0) {
      rCenter(17, 'HIT RATIO', G);
      rCenter(18, `${Math.round((this._bulletsHit / this._bulletsFired) * 100)}%`, W);
    }

    rCenter(20, '-- ENEMIES --', G);
    this._drawEnemySprite(64, 21, T_BEE, 0);
    this._drawEnemySprite(68, 21, T_BUTTERFLY, 0);
    this._drawEnemySprite(73, 21, T_BOSS, 0);
    this._drawEnemySprite(77, 21, T_MORPH, 0);

    if (this._isAttract) { rCenter(22, '** DEMO **', Color.BRIGHT_YELLOW); rCenter(23, 'PRESS KEY', G); }
  }

  _drawEnemySprite(col, row, type, frame) {
    if (type === 'player') {
      if (col >= 1 && col+2 <= 79 && row >= 1 && row <= 24)
        this.screen.putString(col, row, '(^)', this._fg(Color.BRIGHT_WHITE), Color.BLACK);
      return;
    }
    const sprSet = SPR[type]; if (!sprSet) return;
    const spr = sprSet[frame % sprSet.length], colors = SPR_COLORS[type] || [Color.WHITE, Color.WHITE, Color.WHITE];
    for (let ci = 0; ci < spr.length; ci++) {
      if (col + ci >= 1 && col + ci <= 79 && row >= 1 && row <= 24)
        this.screen.putChar(col + ci, row, spr[ci], this._isMono ? MONO_COLORS[this._monoColorIndex] : colors[ci], Color.BLACK);
    }
  }

  _buildStars() {
    this._stars = [];
    for (let i = 0; i < NUM_STARS; i++) {
      this._stars.push({
        x:  Utils.randInt(0, PLAY_COLS - 1),
        y:  Utils.randInt(0, PLAY_ROWS - 1),
        ch: Math.random() < 0.25 ? '+' : '.',
        fg: Color.DARK_GRAY,
      });
    }
  }

  _drawStars() {
    if (this._baseFps === FPS_SLOW) return;
    for (const s of this._stars) {
      const c = sc(s.x), r = sr(s.y);
      if (c > BORDER_L && c < BORDER_R && r > BORDER_T && r < BORDER_B)
        this.screen.putChar(c, r, s.ch, s.fg, Color.BLACK);
    }
  }

  _drawEnemies() {
    for (const e of this._enemies) {
      if (e.dead) continue;
      const col = sc(e.x), row = sr(e.y);
      if (row < FIELD_TOP || row >= FIELD_TOP + PLAY_ROWS) continue;

      const sprKey = (e.type === T_BOSS && e.hitCount > 0) ? 'boss_hit' : e.type;
      const sprSet = SPR[sprKey] || SPR[e.type];
      const frame  = this._baseFps === FPS_SLOW ? 0 : e.animFrame;
      const spr    = sprSet[frame];
      const colors = this._isMono ? Array(spr.length).fill(MONO_COLORS[this._monoColorIndex]) : (SPR_COLORS[sprKey] || SPR_COLORS[e.type]);

      for (let ci = 0; ci < spr.length; ci++) {
        const dc = col - 1 + ci;
        if (dc > BORDER_L && dc < BORDER_R) this.screen.putChar(dc, row, spr[ci], colors[ci], Color.BLACK);
      }
      
      // Captured ship rendering above Boss
      if (e.hasCaptured) {
        const capR = sr(e.y - 1.5);
        if (capR > BORDER_T) this.screen.putString(col - 1, capR, '(^)', this._fg(Color.BRIGHT_RED), Color.BLACK);
      }
    }
  }

  _drawTractorBeam() {
    for (const e of this._enemies) {
      if (!e.tractorActive || e.dead || e.type !== T_BOSS) continue;
      const bossCol = sc(e.x), bossRow = sr(e.y);
      const pulse = Math.floor(this._frame / 3) % 2;
      const beamCh = pulse ? '|' : ':', beamFg = this._fg(Color.BRIGHT_BLUE);
      for (let dc = -2; dc <= 2; dc++) {
        const bc = bossCol + dc;
        if (bc <= BORDER_L || bc >= BORDER_R) continue;
        for (let r = bossRow + 1; r < BORDER_B; r++) this.screen.putChar(bc, r, beamCh, beamFg, Color.BLACK);
      }
    }
  }

  _drawCapturedFighter() {
    if (!this._capturedFighter) return;
    const cf = this._capturedFighter, col = sc(cf.x), row = clamp(sr(cf.y), FIELD_TOP, FIELD_TOP + PLAY_ROWS - 1);
    if (col > BORDER_L && col < BORDER_R) {
      const spinCh = Math.floor(this._frame / 2) % 2 === 0 ? '^' : 'v';
      this.screen.putChar(col, row, spinCh, this._fg(Color.BRIGHT_RED), Color.BLACK);
    }
  }

  _drawPlayerBullets() {
    for (const b of this._playerBullets) {
      const col = sc(b.x), row = sr(b.y);
      if (col > BORDER_L && col < BORDER_R && row > BORDER_T && row < BORDER_B)
        this.screen.putChar(col, row, '|', this._fg(Color.BRIGHT_WHITE), Color.BLACK);
    }
  }

  _drawEnemyBullets() {
    for (const b of this._enemyBullets) {
      const col = sc(b.x), row = sr(b.y);
      if (col > BORDER_L && col < BORDER_R && row > BORDER_T && row < BORDER_B)
        this.screen.putChar(col, row, this._baseFps === FPS_SLOW ? '-' : '+', this._fg(Color.BRIGHT_RED), Color.BLACK);
    }
  }

  _drawPlayer() {
    if (this._player.dead || this._player.captured) return;
    if (this._player.invincible > 0 && Math.floor(this._frame / 4) % 2 === 0) return;

    const drawShip = (px, fg) => {
      const col = sc(px), row = sr(PLAYER_ROW);
      if (col - 1 > BORDER_L) this.screen.putChar(col-1, row, '(', this._fg(fg), Color.BLACK);
      if (col > BORDER_L && col < BORDER_R) this.screen.putChar(col, row, '^', Color.BRIGHT_RED, Color.BLACK);
      if (col+1 < BORDER_R) this.screen.putChar(col+1, row, ')', this._fg(fg), Color.BLACK);
    };
    drawShip(this._player.x, Color.BRIGHT_WHITE);
    if (this._player.dual) drawShip(this._player.x + DUAL_OFFSET, Color.BRIGHT_WHITE);
  }

  _drawExplosions() {
    for (const ex of this._explosions) {
      const fi = Math.floor((ex.timer / EXPL_DURATION) * EXPL_FRAMES.length);
      const spr = EXPL_FRAMES[Math.min(fi, EXPL_FRAMES.length - 1)];
      const fg = EXPL_COLORS[Math.min(fi, EXPL_COLORS.length - 1)];
      const col = sc(ex.x), row = sr(ex.y);
      if (row <= BORDER_T || row >= BORDER_B) continue;
      for (let ci = 0; ci < 3; ci++) {
        const dc = col - 1 + ci;
        if (dc > BORDER_L && dc < BORDER_R) this.screen.putChar(dc, row, spr[ci], fg, Color.BLACK);
      }
    }
  }

  _drawParticles() {
    for (const p of this._particles) {
      const c = sc(p.x), r = sr(p.y);
      if (c > BORDER_L && c < BORDER_R && r > BORDER_T && r < BORDER_B) this.screen.putChar(c, r, p.ch, p.fg, Color.BLACK);
    }
  }

  _drawMessages() {
    if (this._msgQueue.length > 0) {
      const msg = this._msgQueue[0];
      if (msg.lines) {
        const mid = FIELD_TOP + Math.floor(PLAY_ROWS / 2) - Math.floor(msg.lines.length / 2);
        msg.lines.forEach((line, idx) => {
          let fg = Color.BRIGHT_CYAN;
          if (line.includes('PERFECT')) fg = Color.BRIGHT_GREEN;
          else if (line.includes('CLEAR')) fg = Color.BRIGHT_YELLOW;
          else if (line.includes('CHALLENGING')) fg = Color.BRIGHT_MAGENTA;
          
          this.screen.putString(FIELD_LEFT + Math.max(0, Math.floor((PLAY_COLS - line.length) / 2)), mid + idx, line, this._fg(fg), Color.BLACK);
        });
      }
    }
  }

  _drawCaptureFlash() {
    const msg = 'FIGHTER CAPTURED';
    const fg = Math.floor(this._frame / 6) % 2 === 0 ? Color.BRIGHT_RED : Color.BRIGHT_WHITE;
    this.screen.putString(FIELD_LEFT + Math.max(0, Math.floor((PLAY_COLS - msg.length) / 2)), FIELD_TOP + Math.floor(PLAY_ROWS / 2) + 2, msg, this._fg(fg), Color.BLACK);
  }

  _drawGameOver() {
    const cx = FIELD_LEFT + Math.floor(PLAY_COLS / 2), mid = FIELD_TOP + Math.floor(PLAY_ROWS / 2) - 4;
    const lines = [
      { t: ' GAME OVER ', fg: Color.BRIGHT_RED }, { t: '', fg: Color.BLACK },
      { t: 'SCORE:', fg: Color.BRIGHT_YELLOW }, { t: String(this._score).padStart(10, '0'), fg: Color.BRIGHT_WHITE },
      { t: 'HI:', fg: Color.BRIGHT_YELLOW }, { t: String(this._hiScore).padStart(10, '0'), fg: Color.BRIGHT_GREEN },
      { t: '', fg: Color.BLACK }, { t: `HIT RATIO: ${this._bulletsFired > 0 ? Math.round(this._bulletsHit / this._bulletsFired * 100) : 0}%`, fg: Color.BRIGHT_CYAN }
    ];
    for (let i = 0; i < lines.length; i++) this.screen.putString(cx - Math.floor(lines[i].t.length / 2), mid + i, lines[i].t, this._fg(lines[i].fg), Color.BLACK);
  }

  _pstr(col, row, text, fg) { this.screen.putString(col, row, text, this._fg(fg), Color.BLACK); }
  _cprint(row, text, fg) { this.screen.putString(Math.max(1, Math.floor((80 - text.length) / 2) + 1), row, text, this._fg(fg), Color.BLACK); }
  _fg(color) { return this._isMono ? MONO_COLORS[this._monoColorIndex] : color; }
  _toggleColor() { this._monoColorIndex = (this._monoColorIndex + 1) % MONO_COLORS.length; }
  _loadHi() { return this.db.getPlayerData(Triangulum.GAME_NAME, 'global', 'hiScore', 0); }
  _saveHi(s) { if (s > this._loadHi()) this.db.setPlayerData(Triangulum.GAME_NAME, 'global', 'hiScore', s); }
}

module.exports = Triangulum;