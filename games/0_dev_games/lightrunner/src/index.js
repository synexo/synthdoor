'use strict';
const path = require('path');

const { GameBase, Screen, Draw, Color, Attr, CP437 } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

// ═════════════════════════════════════════════════════════════════════════════
// LIGHTRUNNER — Relativistic Isotope Courier
// A SynthDoor arcade game demonstrating special relativity:
//   - Time dilation (twin paradox via dual clocks)
//   - Length contraction (asteroid sprites squash along velocity axis)
//   - Relativistic Doppler (starfield color & magnitude shift)
//   - Aberration / headlight effect (stars cluster toward bow at high γ)
//   - Velocity composition (interceptor closing speeds)
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// TIMING & PERFORMANCE
// ─────────────────────────────────────────────────────────────────────────────
const FPS              = 20;
const PHYSICS_REF_MS   = 50;     // 20 Hz physics tick
const FRAME_MS         = 1000 / FPS;

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT  (80×24 with status row 25)
// ─────────────────────────────────────────────────────────────────────────────
// Flight viewport: rows 1..19, cols 1..79 (col 80 is forbidden in row 24)
const VIEW_TOP    = 1;
const VIEW_BOT    = 19;
const VIEW_LEFT   = 1;
const VIEW_RIGHT  = 79;
const VIEW_W      = VIEW_RIGHT - VIEW_LEFT + 1;     // 79
const VIEW_H      = VIEW_BOT - VIEW_TOP + 1;        // 19
const VIEW_CX     = VIEW_LEFT + Math.floor(VIEW_W / 2);
const VIEW_CY     = VIEW_TOP + Math.floor(VIEW_H / 2);

// HUD region: rows 20..23 (row 24 is control hint, row 25 is status bar)
const HUD_TOP     = 20;
const HINT_ROW    = 24;

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICS — RELATIVITY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BETA_MAX           = 0.995;          // hard cap (γ ≈ 10)
const BETA_MIN           = 0.0;
const THRUST_PER_TICK    = 0.045;          // β increment per thrust tick
const DECEL_PER_TICK     = 0.045;          // symmetric — must spend fuel both ways
const TURN_PER_TICK      = 0.12;           // bow rotation per steer tick (radians)
const FUEL_BASE_COST     = 0.13;           // fuel per thrust tick at γ=1
const FUEL_MAX           = 100.0;
const HULL_MAX           = 3;

// World-space velocity scaling: β=1 corresponds to this many world-units / sec
// of player motion in the player's frame. Tune so cruise feels brisk but not
// instantaneous. With WORLD_SPEED=10, β=0.9 covers ~9 units/sec.
const WORLD_SPEED        = 10.0;

// Arrival criteria: must be within this radius of destination AND moving
// slowly enough to dock. Encourages real deceleration planning.
const ARRIVAL_RADIUS     = 4.0;
const ARRIVAL_BETA_MAX   = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// ISOTOPE MANIFEST (real-world half-lives)
//
// Game-time model: 1 game-second of ship_time = 1 simulation-second.
// Half-lives are tuned per-isotope so each contract is interesting at its tier:
//   - Long-half isotopes use a generous game-life so decay is gentle.
//   - Short-half isotopes use a tight game-life so β-pressure dominates.
//
// `half_real_s` is preserved for the mission-brief flavor text (real-world fact).
// `half_game_s` is the gameplay constant.
//
// Sanity (ship_time = 60 game-sec):
//   - I-131  (T½=720s game): cargo = 2^(-60/720)  = 94.4%  → trivial
//   - Tc-99m (T½=300s game): cargo = 2^(-60/300)  = 87.1%  → easy
//   - At-211 (T½=180s game): cargo = 2^(-60/180)  = 79.4%  → moderate
//   - F-18   (T½=120s game): cargo = 2^(-60/120)  = 70.7%  → moderate
//   - Bi-213 (T½= 80s game): cargo = 2^(-60/80)   = 59.5%  → tight
//   - Rb-82  (T½= 30s game): cargo = 2^(-60/30)   = 25.0%  → extreme
// At γ=2 (β=0.866), ship_time of 30s = station_time of 60s, so cargo math
// uses ship_time (30s) and Rb-82 = 50% — twin-paradox-as-currency.
// ─────────────────────────────────────────────────────────────────────────────
const ISOTOPES = [
  { code:'I-131',   name:'Iodine-131',     half_real_s: 8.02 * 86400,  half_game_s: 720,
    desc:'Thyroid radiotherapy. Long half-life - decay loss negligible.',
    tier:'TUTORIAL', payPerKg: 500 },
  { code:'Tc-99m',  name:'Technetium-99m', half_real_s: 6.0066 * 3600, half_game_s: 300,
    desc:'Most common medical radioisotope. SPECT imaging worldwide.',
    tier:'EASY',     payPerKg: 2000 },
  { code:'At-211',  name:'Astatine-211',   half_real_s: 7.2 * 3600,    half_game_s: 180,
    desc:'Targeted alpha therapy. Halogen, hard to bond.',
    tier:'MEDIUM',   payPerKg: 5000 },
  { code:'F-18',    name:'Fluorine-18',    half_real_s: 109.7 * 60,    half_game_s: 120,
    desc:'PET tracer (FDG). Real-world flight times: 1-3 hours.',
    tier:'MEDIUM',   payPerKg: 8000 },
  { code:'Bi-213',  name:'Bismuth-213',    half_real_s: 45.6 * 60,     half_game_s: 80,
    desc:'Alpha-emitter. Therapy isotope, on-site generation only.',
    tier:'HARD',     payPerKg: 15000 },
  { code:'Rb-82',   name:'Rubidium-82',    half_real_s: 75,            half_game_s: 30,
    desc:'Cardiac PET tracer. Decays to stable krypton in seconds.',
    tier:'EXTREME',  payPerKg: 40000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TEMPLATES — distance and threat per isotope
// distance: world-units between start (0,0) and destination. Tuned so a typical
// run with proper accel/cruise/decel lasts 25-50 sec.
// ─────────────────────────────────────────────────────────────────────────────
const CONTRACT_TEMPLATES = [
  { idx:0, iso:'I-131',  dest:'Luna Med Center',   distance: 100, threat: 0, cargoKg:100 },
  { idx:1, iso:'Tc-99m', dest:'Mars Imaging Co',   distance: 180, threat: 1, cargoKg:100 },
  { idx:2, iso:'At-211', dest:'Ceres Oncology',    distance: 220, threat: 1, cargoKg: 50 },
  { idx:3, iso:'F-18',   dest:'Europa Station',    distance: 160, threat: 2, cargoKg: 50 },
  { idx:4, iso:'Bi-213', dest:'Titan Hospital',    distance: 140, threat: 2, cargoKg: 25 },
  { idx:5, iso:'Rb-82',  dest:'Pluto Outpost',     distance: 250, threat: 3, cargoKg: 25 },
];

// ─────────────────────────────────────────────────────────────────────────────
// STAR & WORLD GENERATION
// ─────────────────────────────────────────────────────────────────────────────
const NUM_STARS = 70;
// Glyph tiers ordered dim → bright. Index used by beaming math.
const GLYPH_TIERS = ['\u00B7', '.', '+', '*', 'o', 'O'];   // ·  .  +  *  o  O
const TIER_DIM    = 0;
const TIER_NORM   = 1;
const TIER_PLUS   = 2;
const TIER_STAR   = 3;
const TIER_O      = 4;
const TIER_BIG    = 5;

// Doppler color ladder ordered red → rest → blue.
// Used by quantizeDoppler() to map factor D to color.
const DOPPLER_LADDER = [
  Color.DARK_GRAY,        // 0  D < 0.25 — into IR, near invisible
  Color.RED,              // 1  0.25–0.45 — strong redshift
  Color.BRIGHT_RED,       // 2  0.45–0.65
  Color.YELLOW,           // 3  0.65–0.85
  null,                   // 4  0.85–1.15 — REST color (use star's intrinsic)
  Color.BRIGHT_BLUE,      // 5  1.15–1.5
  Color.CYAN,             // 6  1.5–2.0
  Color.BRIGHT_CYAN,      // 7  2.0–3.0
  Color.BRIGHT_WHITE,     // 8  D ≥ 3.0 — extreme blueshift
];
// Threshold for cull (don't draw)
const DOPPLER_CULL_BELOW = 0.10;

// Star intrinsic (rest) color palette — what a star looks like at β=0
const STAR_REST_COLORS = [
  Color.DARK_GRAY, Color.DARK_GRAY, Color.DARK_GRAY,    // most stars are dim
  Color.WHITE, Color.WHITE,
  Color.YELLOW, Color.BRIGHT_WHITE,
  Color.BRIGHT_YELLOW, Color.CYAN,
];

// ─────────────────────────────────────────────────────────────────────────────
// ASTEROID SPRITES (length-contractable along x axis)
// ─────────────────────────────────────────────────────────────────────────────
const ASTEROID_SPRITES = {
  large:  [' \u2592\u2593\u2592 ',
           '\u2592\u2593\u2588\u2593\u2592',
           ' \u2592\u2593\u2592 '],
  medium: ['\u2592\u2593\u2592',
           '\u2593\u2588\u2593'],
  small:  ['\u2593\u2592'],
};

// Interceptor sprite (3-wide, 1 row) — drawn with FG color tied to closing β
const INTERCEPTOR_GLYPHS = ['<\u2550\u25C4', '\u25BA\u2550>'];   // facing left/right

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY MATH (the actual relativistic equations)
// ─────────────────────────────────────────────────────────────────────────────
function gammaOf(beta) {
  const b2 = beta * beta;
  if (b2 >= 1.0) return 1e6;  // pathological guard
  return 1.0 / Math.sqrt(1.0 - b2);
}

// Relativistic Doppler factor for source at angle theta from velocity vector.
// theta = 0 means dead ahead (full blueshift), theta = pi means behind (full redshift).
function dopplerFactor(beta, cosTheta) {
  const num = 1.0 + beta * cosTheta;
  const den = 1.0 - beta * cosTheta;
  if (den <= 0) return 1e6;
  return Math.sqrt(num / den);
}

// Aberrated apparent angle: cos θ' = (cos θ + β) / (1 + β cos θ)
function aberratedCos(beta, cosTheta) {
  return (cosTheta + beta) / (1.0 + beta * cosTheta);
}

// Quantize Doppler factor to a palette slot. Returns {color, isRest}.
// Caller substitutes star's intrinsic color when isRest=true.
function quantizeDoppler(D) {
  if (D < 0.25)  return { color: DOPPLER_LADDER[0], isRest: false };
  if (D < 0.45)  return { color: DOPPLER_LADDER[1], isRest: false };
  if (D < 0.65)  return { color: DOPPLER_LADDER[2], isRest: false };
  if (D < 0.85)  return { color: DOPPLER_LADDER[3], isRest: false };
  if (D < 1.15)  return { color: null,              isRest: true  };
  if (D < 1.5)   return { color: DOPPLER_LADDER[5], isRest: false };
  if (D < 2.0)   return { color: DOPPLER_LADDER[6], isRest: false };
  if (D < 3.0)   return { color: DOPPLER_LADDER[7], isRest: false };
  return            { color: DOPPLER_LADDER[8], isRest: false };
}

// Beaming: glyph tier offset based on Doppler factor.
function beamingTierOffset(D) {
  if (D >= 2.0)  return +2;
  if (D >= 1.4)  return +1;
  if (D >= 0.7)  return  0;
  if (D >= 0.4)  return -1;
  return -2;
}

// Velocity composition (1D head-on). Returns relative β between two observers.
function relativisticAdd(beta1, beta2) {
  return (beta1 + beta2) / (1.0 + beta1 * beta2);
}

// Cargo decay: m(t) = m0 * 2^(-Δτ / T_half)  where Δτ is *proper* time.
function cargoRemaining(initialKg, halfLifeGameS, shipTimeS) {
  return initialKg * Math.pow(2.0, -shipTimeS / halfLifeGameS);
}

// Career-time scaling: in-fiction, each second of flight represents ~6 minutes
// of a working courier's career (transit + ops + refuel + downtime between runs).
// Tuned so a session of ~6 minutes of flight time corresponds to ~36 hours of career.
// This is a pure cosmetic scale on career stats; it does NOT affect cargo decay,
// twin-paradox math, or any other gameplay number.
const CAREER_HOURS_PER_GAMESEC = 0.1;

// Format career game-seconds as "#y ##d" / "##d ##h" / "##h ##m" / "##m".
function fmtCareerTime(gameSec) {
  const totalHours   = gameSec * CAREER_HOURS_PER_GAMESEC;
  const totalMinutes = totalHours * 60;
  const totalDays    = totalHours / 24;
  const totalYears   = totalDays / 365.25;
  if (totalYears >= 1) {
    const y = Math.floor(totalYears);
    const remDays = Math.floor(totalDays - y * 365.25);
    return `${y}y ${remDays}d`;
  }
  if (totalDays >= 1) {
    const d = Math.floor(totalDays);
    const remHours = Math.floor(totalHours - d * 24);
    return `${d}d ${String(remHours).padStart(2, '0')}h`;
  }
  if (totalHours >= 1) {
    const h = Math.floor(totalHours);
    const remMin = Math.floor(totalMinutes - h * 60);
    return `${h}h ${String(remMin).padStart(2, '0')}m`;
  }
  return `${Math.floor(totalMinutes)}m`;
}

function fmtRunTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2,'0')}:${s.toFixed(2).padStart(5,'0')}`;
}

function fmtMoney(n) {
  return '\u00A2' + Utils.commaNum(Math.floor(n));   // ¢ glyph + comma-formatted
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }

// ═════════════════════════════════════════════════════════════════════════════
// MAIN GAME CLASS
// ═════════════════════════════════════════════════════════════════════════════
class Lightrunner extends GameBase {
  static get GAME_NAME()  { return 'lightrunner'; }
  static get GAME_TITLE() { return 'Lightrunner'; }

  // ───────────────────────────────────────────────────────────────────────────
  async run() {
    this._isMono = false;
    this._loadCareer();

    this.screen.setMode(Screen.FIXED);

    let action = 'attract';
    while (this._running) {
      action = await this._titleScreen();
      if (action === 'quit') break;

      // Session begins
      this._sessionInit();

      let sessionAlive = true;
      while (sessionAlive && this._running) {
        const contractIdx = await this._contractBoard();
        if (contractIdx === null) {
          // user quit board — end session
          break;
        }

        const result = await this._runFlight(this._availableContracts[contractIdx]);

        if (result.aborted) {
          // user pressed Q during flight
          break;
        }

        await this._arrivalScreen(result);

        if (this._fuel < FUEL_BASE_COST * 5 || this._hull <= 0) {
          // session-ending condition
          break;
        }
      }

      await this._sessionSummary();
      this._saveCareer();
    }

    this.input.stop();
    this.screen.setMode(Screen.SCROLL);
    this.terminal.resetAttrs();
    this.terminal.clearScreen();
    this.terminal.println('Safe travels, courier.');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CAREER PERSISTENCE
  // ═════════════════════════════════════════════════════════════════════════
  _loadCareer() {
    const gn = Lightrunner.GAME_NAME;
    this._careerPilotTime   = this.db.getPlayerData(gn, this.username, 'pilot_t', 0) || 0;
    this._careerStationTime = this.db.getPlayerData(gn, this.username, 'station_t', 0) || 0;
    this._hiScore           = this.db.getPlayerBestScore(gn, this.username) || 0;
  }

  _saveCareer() {
    const gn = Lightrunner.GAME_NAME;
    this.db.setPlayerData(gn, this.username, 'pilot_t',   this._careerPilotTime);
    this.db.setPlayerData(gn, this.username, 'station_t', this._careerStationTime);
    if (this._sessionPayout > this._hiScore) {
      this._hiScore = this._sessionPayout;
      this.db.saveScore(gn, this.username, Math.floor(this._sessionPayout));
    }
  }

  _sessionInit() {
    this._sessionPayout       = 0;
    this._sessionContracts    = 0;
    this._sessionPilotTime    = 0;
    this._sessionStationTime  = 0;
    this._sessionCargoDelivered = 0;
    this._fuel                = FUEL_MAX;
    this._hull                = HULL_MAX;
    this._availableContracts  = CONTRACT_TEMPLATES.map((c, i) => ({ ...c, idx:i, completed:false }));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TITLE SCREEN
  // ═════════════════════════════════════════════════════════════════════════
  async _titleScreen() {
    let done = false;
    let result = 'attract';
    let dirty = true;
    let blinkPhase = false;
    let lastBlink = 0;
    let idleMs = 0;

    // Generate a small idle starfield for the title
    this._titleStars = [];
    for (let i = 0; i < 35; i++) {
      this._titleStars.push({
        x: Utils.randInt(VIEW_LEFT, VIEW_RIGHT),
        y: Utils.randInt(VIEW_TOP, VIEW_BOT),
        ch: Math.random() < 0.15 ? '+' : (Math.random() < 0.6 ? '.' : '\u00B7'),
        fg: Utils.pick([Color.DARK_GRAY, Color.DARK_GRAY, Color.WHITE, Color.BRIGHT_BLACK]),
      });
    }

    const onKey = (k) => {
      const kl = (k || '').toLowerCase();
      if (kl === 'c') { this._isMono = !this._isMono; dirty = true; idleMs = 0; }
      else if (kl === 'q') { result = 'quit'; done = true; }
      else if (k && k.length > 0) { result = 'play'; done = true; }
    };
    this.input.on('key', onKey);

    while (!done && this._running) {
      const now = Date.now();
      if (now - lastBlink >= 500) {
        blinkPhase = !blinkPhase;
        lastBlink = now;
        dirty = true;
      }
      if (dirty) {
        this._renderTitle(blinkPhase);
        this.screen.flush();
        dirty = false;
      }
      await sleep(FRAME_MS);
      idleMs += FRAME_MS;
      if (idleMs >= 15000) { result = 'attract'; done = true; }
    }
    this.input.removeListener('key', onKey);
    // For first beta: any non-quit result starts a session
    return result === 'quit' ? 'quit' : 'play';
  }

  _renderTitle(blink) {
    this.screen.clear(Color.BLACK, Color.BLACK);

    // Star background
    for (const s of this._titleStars) {
      const fg = this._isMono ? Color.BRIGHT_GREEN : s.fg;
      this.screen.putChar(s.x, s.y, s.ch, fg, Color.BLACK);
    }

    // Title — block-letter "LIGHTRUNNER" using meteoroid-style 3x5
    // We render with a built-in approach: use Draw.blockBanner if it has L,I,G,H,T,R,U,N,E
    // Otherwise use a hand-rolled banner.
    Draw.blockBanner(this.screen, 5, 'LIGHTRUNNER',
      this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN,
      Color.BLACK);

    const subtitle = 'R E L A T I V I S T I C   I S O T O P E   C O U R I E R';
    const subCol = Math.floor((80 - subtitle.length) / 2) + 1;
    this.screen.putString(subCol, 12, subtitle,
      this._isMono ? Color.GREEN : Color.BRIGHT_BLUE, Color.BLACK);

    // Hi-score and age gap
    const hiText = `HI: ${fmtMoney(this._hiScore)}`;
    const ageGap = this._careerStationTime - this._careerPilotTime;
    const gapText = ageGap > 0 ? `AGE GAP: ${fmtCareerTime(ageGap)}` : '';
    const stat = (gapText ? `${hiText}    ${gapText}` : hiText);
    const statCol = Math.floor((80 - stat.length) / 2) + 1;
    this.screen.putString(statCol, 14, stat,
      this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_YELLOW, Color.BLACK);

    if (blink) {
      const prompt = '>>> PRESS ANY KEY TO START <<<';
      const pc = Math.floor((80 - prompt.length) / 2) + 1;
      this.screen.putString(pc, 16, prompt,
        this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_WHITE, Color.BLACK);
    }

    // Controls panel
    const controls = [
      '\u2500\u2500 CONTROLS \u2500\u2500',
      'LEFT/RIGHT or 4/6 - YAW (turn)',
      'UP/DOWN    or 8/2 - PITCH (climb/dive)',
      'R - THRUST     F - DECELERATE',
      'SPACE or 5 - FIRE LASER',
      'C - MONO COLOR    Q - QUIT',
    ];
    for (let i = 0; i < controls.length; i++) {
      const line = controls[i];
      const col = Math.floor((80 - line.length) / 2) + 1;
      this.screen.putString(col, 18 + i, line,
        i === 0 ? Color.DARK_GRAY : (this._isMono ? Color.GREEN : Color.WHITE),
        Color.BLACK);
    }

    // Status bar
    const sbg = this._isMono ? Color.BLACK : Color.BLUE;
    const sfg = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_WHITE;
    this.screen.statusBar(' LIGHTRUNNER  |  SynthDoor  |  Q to quit', sfg, sbg);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CONTRACT BOARD
  // ═════════════════════════════════════════════════════════════════════════
  async _contractBoard() {
    let selected = 0;
    let done = false;
    let dirty = true;
    let result = null;

    const onKey = (k) => {
      const kl = (k || '').toLowerCase();
      if (kl === 'q') { result = null; done = true; }
      else if (k === '\r' || k === '\n' || kl === ' ' || kl === '5') {
        const c = this._availableContracts[selected];
        if (c && !c.completed) { result = selected; done = true; }
      }
    };
    const onAction = (a) => {
      if (a === 'UP')   { selected = (selected - 1 + CONTRACT_TEMPLATES.length) % CONTRACT_TEMPLATES.length; dirty = true; }
      if (a === 'DOWN') { selected = (selected + 1) % CONTRACT_TEMPLATES.length; dirty = true; }
      if (a === 'CONFIRM') {
        const c = this._availableContracts[selected];
        if (c && !c.completed) { result = selected; done = true; }
      }
      if (a === 'QUIT' || a === 'CANCEL') { result = null; done = true; }
    };
    this.input.on('key', onKey);
    this.input.on('action', onAction);

    while (!done && this._running) {
      if (dirty) {
        this._renderBoard(selected);
        this.screen.flush();
        dirty = false;
      }
      await sleep(FRAME_MS);
    }
    this.input.removeListener('key', onKey);
    this.input.removeListener('action', onAction);
    return result;
  }

  _renderBoard(selected) {
    this.screen.clear(Color.BLACK, Color.BLACK);
    const fgT = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN;
    const fgN = this._isMono ? Color.GREEN : Color.WHITE;
    const fgD = this._isMono ? Color.GREEN : Color.DARK_GRAY;

    // Top header
    const ageGap = this._careerStationTime - this._careerPilotTime;
    const hdrL = '\u2500 CONTRACT BOARD ';
    const hdrR = ` PILOT ${fmtCareerTime(this._careerPilotTime)} / STN ${fmtCareerTime(this._careerStationTime)} \u2500`;
    const headFill = '\u2500'.repeat(Math.max(0, 79 - hdrL.length - hdrR.length));
    this.screen.putString(1, 1, hdrL + headFill + hdrR, fgT, Color.BLACK);

    // Contract table
    Draw.box(this.screen, 4, 3, 72, 10, Draw.BOX_DOUBLE, fgN, Color.BLACK);
    this.screen.putString(6, 4, '#  ISOTOPE   T(1/2)      DESTINATION      BOUNTY    THREAT  STATUS', fgD, Color.BLACK);
    this.screen.putString(5, 5, '\u2500'.repeat(70), fgD, Color.BLACK);

    for (let i = 0; i < this._availableContracts.length; i++) {
      const c = this._availableContracts[i];
      const iso = ISOTOPES.find(z => z.code === c.iso);
      const isSel = i === selected;
      const isDone = c.completed;
      const fg = isDone ? Color.DARK_GRAY :
                 isSel ? (this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_YELLOW) : fgN;

      const marker = isSel ? '\u00BB' : ' ';
      const num    = String(i + 1);
      const code   = (c.iso + '        ').slice(0, 9);
      const half   = (this._fmtRealHalf(iso.half_real_s) + '           ').slice(0, 11);
      const dest   = (c.dest + '                ').slice(0, 16);
      const bounty = (`${fmtMoney(iso.payPerKg)}/kg`).padStart(11, ' ');
      const threat = '\u2593'.repeat(c.threat) + '\u2591'.repeat(4 - c.threat);
      const tail   = isDone ? '[DLVRD]' : ' '.repeat(7);

      const line = `${marker} ${num} ${code} ${half} ${dest} ${bounty}  ${threat}  ${tail}`;
      this.screen.putString(6, 6 + i, line, fg, Color.BLACK);
    }

    // Mission brief panel
    const c = this._availableContracts[selected];
    const iso = ISOTOPES.find(z => z.code === c.iso);
    Draw.titledBox(this.screen, 4, 14, 72, 8, 'MISSION BRIEF',
      Draw.BOX_SINGLE, fgN, Color.BLACK, fgT, Color.BLACK);

    this.screen.putString(6, 15, `${c.iso} (${iso.name})`, fgT, Color.BLACK);
    this.screen.putString(6, 16, iso.desc.substring(0, 65), fgN, Color.BLACK);
    const halfStr = this._fmtRealHalf(iso.half_real_s);
    this.screen.putString(6, 17, `Real-world half-life: ${halfStr}.   Cargo: ${c.cargoKg.toFixed(1)} kg`, fgN, Color.BLACK);

    let threatTxt;
    if (c.threat === 0) threatTxt = 'Threat: SAFE - no patrol activity reported.';
    else if (c.threat === 1) threatTxt = 'Threat: LIGHT - 1 patrol expected en route.';
    else if (c.threat === 2) threatTxt = 'Threat: MODERATE - 2 patrols active.';
    else threatTxt = 'Threat: HEAVY - 3 patrols, prepare for combat.';
    const tFg = c.threat === 0 ? Color.GREEN :
                c.threat <= 1 ? Color.BRIGHT_YELLOW : Color.BRIGHT_RED;
    this.screen.putString(6, 18, threatTxt, this._isMono ? Color.GREEN : tFg, Color.BLACK);

    const tier = (iso.tier + '          ').slice(0, 10);
    this.screen.putString(6, 19, `Tier: ${tier}   Distance: ${c.distance} units`, fgD, Color.BLACK);
    this.screen.putString(6, 20, `Bounty: ${fmtMoney(iso.payPerKg * c.cargoKg)} max  (${fmtMoney(iso.payPerKg)} per kg delivered)`, fgT, Color.BLACK);

    // Hint row
    this.screen.putString(20, 23, '[ \u2191\u2193 select   ENTER accept   Q quit ]', fgD, Color.BLACK);

    // Status bar — fuel, hull, age gap
    const sb = ` FUEL ${this._fuelBar(this._fuel)} | HULL ${this._hullDisplay()} | AGE GAP ${fmtCareerTime(ageGap)}`;
    const sbg = this._isMono ? Color.BLACK : Color.CYAN;
    const sfg = this._isMono ? Color.BRIGHT_GREEN : Color.BLACK;
    this.screen.statusBar(sb, sfg, sbg);
  }

  _fmtRealHalf(seconds) {
    if (seconds < 60)     return `${seconds.toFixed(0)} sec`;
    if (seconds < 7200)   return `${(seconds/60).toFixed(1)} min`;   // up to 2 hr stays in minutes
    if (seconds < 86400)  return `${(seconds/3600).toFixed(1)} hr`;
    return `${(seconds/86400).toFixed(2)} d`;
  }

  _fuelBar(fuel) {
    const pct = fuel / FUEL_MAX;
    const filled = Math.round(pct * 10);
    return '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
  }

  _hullDisplay() {
    const hearts = '\u2666'.repeat(this._hull) + '\u00B7'.repeat(HULL_MAX - this._hull);
    return hearts;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // FLIGHT LOOP — the main game
  // ═════════════════════════════════════════════════════════════════════════
  async _runFlight(contract) {
    const iso = ISOTOPES.find(z => z.code === contract.iso);
    this._initFlight(contract, iso);

    let aborted = false;

    const onKey = (k) => {
      const kl = (k || '').toLowerCase();
      if (kl === 'q') { aborted = true; this._flightRunning = false; return; }
      if (kl === ' ' || kl === '5') { this._tryFire(); return; }
      if (kl === 'c') { this._isMono = !this._isMono; return; }
      if (kl === 'r') { this._thrust(true);  return; }    // thrust
      if (kl === 'f') { this._thrust(false); return; }    // decel
      // Numeric pad fallbacks for clients without arrows
      if (kl === '8') { this._pitch(-1); return; }
      if (kl === '2') { this._pitch(+1); return; }
      if (kl === '4') { this._yaw(-1);   return; }
      if (kl === '6') { this._yaw(+1);   return; }
    };
    const onAction = (a) => {
      if (a === 'QUIT')  { aborted = true; this._flightRunning = false; return; }
      if (a === 'LEFT')  { this._yaw(-1);    return; }
      if (a === 'RIGHT') { this._yaw(+1);    return; }
      // Arrow UP/DOWN are now PITCH, not thrust. Thrust is on R/F.
      // Convention: UP arrow = pitch up = nose climbs = +pitch.
      if (a === 'UP')    { this._pitch(+1); return; }
      if (a === 'DOWN')  { this._pitch(-1); return; }
      if (a === 'FIRE')  { this._tryFire(); return; }
    };
    this.input.on('key', onKey);
    this.input.on('action', onAction);

    let lastTime = Date.now();
    this._flightRunning = true;
    let arrived = false;

    while (this._flightRunning && this._running) {
      const now = Date.now();
      const elapsed = Math.max(1, now - lastTime);
      lastTime = now;
      const dt = Math.min(elapsed / 1000, 0.2); // seconds, clamped

      this._updateFlight(dt);
      this._drawFlight();
      this.screen.flush();

      // Arrival: inside the docking sphere AND moving slowly enough to dock.
      // Just being close isn't enough; you have to actually decelerate.
      const distToDest = this._distTo(this._destX, this._destY);
      if (distToDest < ARRIVAL_RADIUS && this._beta < ARRIVAL_BETA_MAX) {
        arrived = true;
        this._flightRunning = false;
      }
      if (this._hull <= 0) {
        // Hull breach — cargo lost
        aborted = true;
        this._flightRunning = false;
      }
      // Stranded check: out of fuel AND barely moving AND nowhere near dest
      if (this._fuel < 0.01 && this._beta < 0.05 && distToDest > ARRIVAL_RADIUS * 2) {
        aborted = true;
        this._flightRunning = false;
        this._radioMsg = 'Stranded — adrift with no fuel.';
      }

      await sleep(FRAME_MS);
    }
    this.input.removeListener('key', onKey);
    this.input.removeListener('action', onAction);

    if (!arrived) {
      return { aborted: true, contract, iso, shipTime: this._shipTime, stationTime: this._stationTime,
               cargoStart: contract.cargoKg, cargoEnd: 0, payout: 0 };
    }

    const cargoEnd = cargoRemaining(contract.cargoKg, iso.half_game_s, this._shipTime);
    const payout = cargoEnd * iso.payPerKg;

    // Update session totals
    this._sessionPayout += payout;
    this._sessionContracts++;
    this._sessionPilotTime += this._shipTime;
    this._sessionStationTime += this._stationTime;
    this._sessionCargoDelivered += cargoEnd;

    // Update career totals
    this._careerPilotTime   += this._shipTime;
    this._careerStationTime += this._stationTime;

    // Mark this contract done
    contract.completed = true;

    return { aborted: false, contract, iso, shipTime: this._shipTime, stationTime: this._stationTime,
             cargoStart: contract.cargoKg, cargoEnd, payout, avgGamma: this._gammaSum / Math.max(1, this._gammaCount) };
  }

  _initFlight(contract, iso) {
    this._contract     = contract;
    this._iso          = iso;
    this._shipTime     = 0;
    this._stationTime  = 0;
    this._beta         = 0;
    this._gamma        = 1;

    // World coordinates (3D). Player starts at origin, level, facing +x.
    // The destination sits straight ahead at (D, 0, 0). Yaw rotates around
    // the vertical (z) axis; pitch tilts the bow up/down.
    this._px           = 0;
    this._py           = 0;
    this._pz           = 0;
    this._yawAngle     = 0;        // 0 = facing +x; +π/2 = facing +y (left)
    this._pitchAngle   = 0;        // 0 = level; +π/2 = nose up; -π/2 = nose down
    this._destX        = contract.distance;
    this._destY        = 0;
    this._destZ        = 0;

    this._gammaSum     = 0;
    this._gammaCount   = 0;
    this._fireCD       = 0;
    this._lastThrustDir = 0;
    this._thrustHeldFrames = 0;
    this._fuelOutWarned = false;

    // World objects (each has world (x,y,z), not bow-relative coords)
    this._stars = this._buildStarSphere(NUM_STARS);
    this._asteroids = [];
    this._interceptors = [];
    this._bullets = [];
    this._particles = [];
    this._asteroidTimer = 0;
    this._interceptorTimer = this._contract.threat > 0 ? this._frames(8) : 1e9;
    this._interceptorsSpawned = 0;
    this._invincibleFrames = 0;

    // Gravity wells: stationary points in 3D world space along the route.
    this._gravWells = this._buildGravWells(contract);

    // Radio chatter
    this._radioMsg = `Cleared for departure. ${contract.dest} expects you.`;
    this._radioTimer = 0;
    this._broadcastTimer = 0;
  }

  // Build gravity wells for this contract. Higher-tier contracts get more wells.
  _buildGravWells(contract) {
    const wells = [];
    let n = 0;
    if (contract.iso === 'Tc-99m')      n = 1;
    else if (contract.iso === 'At-211') n = 1;
    else if (contract.iso === 'F-18')   n = 2;
    else if (contract.iso === 'Bi-213') n = 2;
    else if (contract.iso === 'Rb-82')  n = 3;
    for (let i = 0; i < n; i++) {
      // Place along the great-circle route, with 3D scatter
      const t = (i + 1) / (n + 1);
      const x = t * contract.distance + (Math.random() - 0.5) * 8;
      const y = (Math.random() - 0.5) * 16;
      const z = (Math.random() - 0.5) * 10;
      wells.push({
        x, y, z,
        radius:  3.0,
        phase:   Math.random() * Math.PI * 2,
        warned:  false,
        passed:  false,
      });
    }
    return wells;
  }

  _frames(seconds) { return Math.floor(seconds * FPS); }

  // Bow direction unit vector in world frame, given current yaw + pitch.
  _bowDir() {
    const cy = Math.cos(this._yawAngle);
    const sy = Math.sin(this._yawAngle);
    const cp = Math.cos(this._pitchAngle);
    const sp = Math.sin(this._pitchAngle);
    return { x: cy * cp, y: sy * cp, z: sp };
  }

  // Project a world-space (x, y, z) into bow-relative (range, lateral, vertical).
  //   range    > 0  → in front of the player (along bow axis)
  //   lateral  > 0  → STARBOARD (right of bow); maps to screenX > center
  //   vertical > 0  → ABOVE bow plane;          maps to screenY < center
  // (Cockpit-view convention: a starboard object draws on the right of the
  //  screen, an object above draws toward the top.)
  _toBowRel(wx, wy, wz) {
    const dx = wx - this._px;
    const dy = wy - this._py;
    const dz = (wz === undefined ? 0 : wz) - this._pz;
    const cy = Math.cos(this._yawAngle), sy = Math.sin(this._yawAngle);
    // Inverse-yaw
    const xp =  cy * dx + sy * dy;
    const yp = -sy * dx + cy * dy;
    // Inverse-pitch around the y' (lateral) axis
    const cp = Math.cos(this._pitchAngle), sp = Math.sin(this._pitchAngle);
    const range    =  cp * xp + sp * dz;
    const vertical = -sp * xp + cp * dz;
    // World +y is "left" (port) when yaw=0; flip to match starboard convention
    const lateral = -yp;
    return { range, lateral, vertical };
  }

  // World-space 3D distance from player to a point.
  _distTo(wx, wy, wz) {
    const dx = wx - this._px;
    const dy = wy - this._py;
    const dz = (wz === undefined ? 0 : wz) - this._pz;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }


  // Build a sphere of stars in world directions. Each star is a unit vector
  // (dx, dy, dz) representing the direction from the player to that star.
  // To project we rotate by inverse of the camera (yaw + pitch).
  _buildStarSphere(n) {
    const stars = [];
    for (let i = 0; i < n; i++) {
      // Uniform random direction on the sphere via spherical coords.
      // We bias the distribution slightly toward the equator (cos of polar
      // angle uniform in [-1,1] gives uniform area distribution).
      const u = Math.random() * 2 - 1;          // cos(polar) uniform
      const phi = Math.random() * Math.PI * 2;  // azimuth
      const sinP = Math.sqrt(1 - u * u);
      const dx = sinP * Math.cos(phi);
      const dy = sinP * Math.sin(phi);
      const dz = u;
      const tier = Math.random() < 0.55 ? TIER_DIM
                  : Math.random() < 0.85 ? TIER_NORM
                  : Math.random() < 0.97 ? TIER_PLUS
                  : TIER_STAR;
      stars.push({
        dx, dy, dz,                       // unit-vector direction in world frame
        tier,
        restColor: Utils.pick(STAR_REST_COLORS),
      });
    }
    return stars;
  }

  // ─── INPUT HANDLERS ─────────────────────────────────────────────────────
  // Yaw: LEFT/RIGHT keys rotate the bow around the vertical axis.
  _yaw(dir) {
    this._yawAngle += dir * TURN_PER_TICK;
  }

  // Pitch: UP/DOWN keys tilt the nose. We clamp pitch to ±~85° so the player
  // can't invert and the world geometry stays sensible.
  _pitch(dir) {
    const PITCH_LIMIT = Math.PI * 0.47;   // ~85°
    this._pitchAngle = clamp(this._pitchAngle + dir * TURN_PER_TICK,
                             -PITCH_LIMIT, PITCH_LIMIT);
  }

  // Backwards-compat: keep _steer for any caller that still uses it as yaw.
  _steer(dir) { this._yaw(dir); }

  _thrust(forward) {
    if (this._fuel <= 0) return;
    const cost = FUEL_BASE_COST * Math.pow(this._gamma, 1.5);
    if (this._fuel < cost) return;
    this._fuel -= cost;

    if (forward) {
      // Apply thrust to increase β.
      // Use a relativistic-friendly increment: β += dβ * (1 - β) so we never reach 1.
      const db = THRUST_PER_TICK * (1 - this._beta);
      this._beta = clamp(this._beta + db, BETA_MIN, BETA_MAX);
      this._lastThrustDir = 1;
    } else {
      const db = DECEL_PER_TICK * this._beta;  // proportional decel
      this._beta = clamp(this._beta - db, BETA_MIN, BETA_MAX);
      this._lastThrustDir = -1;
    }
    this._gamma = gammaOf(this._beta);
    this._thrustHeldFrames = 6;  // brief engine flame
  }

  _tryFire() {
    if (this._fireCD > 0) return;
    if (this._bullets.length >= 4) return;
    this._fireCD = 5;
    const bSpeed = 28;     // world-units / sec
    const bow = this._bowDir();
    this._bullets.push({
      x: this._px + bow.x * 0.5,
      y: this._py + bow.y * 0.5,
      z: this._pz + bow.z * 0.5,
      vx: bow.x * bSpeed,
      vy: bow.y * bSpeed,
      vz: bow.z * bSpeed,
      life: this._frames(1.2),
      bornAt: this._shipTime,
    });
  }

  // ─── PHYSICS UPDATE ─────────────────────────────────────────────────────
  _updateFlight(dt) {
    // ── Time accumulation (twin-paradox math) ────────────────────────────
    this._shipTime    += dt;
    this._stationTime += dt * this._gamma;
    this._gammaSum    += this._gamma * dt;
    this._gammaCount  += dt;

    // ── Integrate position from velocity ─────────────────────────────────
    // Player moves at β·WORLD_SPEED in the bow direction. Bow direction is
    // a 3D unit vector built from yaw + pitch. The velocity vector is
    // rigidly coupled to the bow ("vector thrust" model).
    const speed = this._beta * WORLD_SPEED;
    const bow = this._bowDir();
    this._px += bow.x * speed * dt;
    this._py += bow.y * speed * dt;
    this._pz += bow.z * speed * dt;

    // ── Counters ─────────────────────────────────────────────────────────
    if (this._fireCD > 0) this._fireCD--;
    if (this._invincibleFrames > 0) this._invincibleFrames--;
    if (this._thrustHeldFrames > 0) this._thrustHeldFrames--;
    else this._lastThrustDir = 0;
    if (this._broadcastTimer > 0) this._broadcastTimer -= dt;

    // ── Periodic destination beacon broadcast ────────────────────────────
    // The destination's radio is a directional cue: the apparent angle of the
    // beacon relative to the bow tells the player which way to point.
    if (this._broadcastTimer <= 0 && this._radioTimer <= 0) {
      this._broadcastTimer = 4 + Math.random() * 3;   // ~every 4-7 sec
      this._sendBeacon();
    }

    // ── Spawning ─────────────────────────────────────────────────────────
    this._asteroidTimer -= dt;
    if (this._asteroidTimer <= 0 && this._asteroids.length < 6 && this._beta > 0.05) {
      this._spawnAsteroid();
      this._asteroidTimer = 0.6 + Math.random() * 1.2;
    }
    if (this._interceptorsSpawned < this._contract.threat) {
      this._interceptorTimer -= dt;
      if (this._interceptorTimer <= 0) {
        this._spawnInterceptor();
        this._interceptorsSpawned++;
        this._interceptorTimer = 5 + Math.random() * 4;
      }
    }

    // ── Asteroid drift (3D random walk in world space) ───────────────────
    for (const a of this._asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.z = (a.z || 0) + (a.vz || 0) * dt;
    }

    // ── Asteroid hull-impact (real 3D world-space distance) ──────────────
    for (const a of this._asteroids) {
      if (a.dead) continue;
      const d = this._distTo(a.x, a.y, a.z || 0);
      if (d < 1.0 && this._invincibleFrames <= 0) {
        this._hull -= 1;
        this._invincibleFrames = this._frames(2.0);
        this._spawnExplosion(VIEW_CX, VIEW_CY, 'medium');
        this._radioMsg = '!!! HULL IMPACT — ASTEROID !!!';
        this._radioTimer = this._frames(2);
        a.dead = true;
      }
    }

    // ── Gravity wells (3D) ───────────────────────────────────────────────
    for (const w of this._gravWells) {
      w.phase += dt * 4;
      const d = this._distTo(w.x, w.y, w.z || 0);
      if (!w.warned) {
        const rel = this._toBowRel(w.x, w.y, w.z || 0);
        if (rel.range > 0 && rel.range < 30 && d < 35) {
          w.warned = true;
          // Lateral > 0 = port (left); lateral < 0 = starboard.
          // Vertical > 0 = above bow plane.
          let bearing;
          if (Math.abs(rel.vertical) > Math.abs(rel.lateral)) {
            bearing = rel.vertical > 0 ? 'high' : 'low';
          } else {
            bearing = rel.lateral > 0 ? 'port' : 'starboard';
          }
          this._radioMsg = `WARNING: gravity well off ${bearing} bow.`;
          this._radioTimer = this._frames(2.5);
        }
      }
      if (!w.passed && d < w.radius * 2.5) {
        if (d < w.radius) {
          if (this._invincibleFrames <= 0) {
            this._hull -= 1;
            this._invincibleFrames = this._frames(2.0);
            this._spawnExplosion(VIEW_CX, VIEW_CY, 'large');
            this._radioMsg = '!!! GRAVITY WELL BREACH - HULL STRAIN !!!';
            this._radioTimer = this._frames(3);
          }
          w.passed = true;
        } else {
          this._fuel = Math.max(0, this._fuel - 8);
          this._radioMsg = 'Tidal forces drain fuel.';
          this._radioTimer = this._frames(1.5);
          w.passed = true;
        }
      }
    }

    // ── Interceptors: chase the player in 3D at their own β ──────────────
    for (const ip of this._interceptors) {
      if (ip.dead) continue;
      const dx = this._px - ip.x;
      const dy = this._py - ip.y;
      const dz = this._pz - (ip.z || 0);
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist > 0.01) {
        ip.x += (dx / dist) * ip.beta * WORLD_SPEED * dt;
        ip.y += (dy / dist) * ip.beta * WORLD_SPEED * dt;
        ip.z = (ip.z || 0) + (dz / dist) * ip.beta * WORLD_SPEED * dt;
      }
      ip.fireCD -= dt;
      ip.closingBeta = relativisticAdd(this._beta, ip.beta);
      const rel = this._toBowRel(ip.x, ip.y, ip.z || 0);
      if (rel.range > 1 && dist < 25 && ip.fireCD <= 0) {
        ip.fireCD = 1.4;
        this._spawnLaser(ip);
      }
      if (dist < 1.5 && this._invincibleFrames <= 0) {
        this._hull -= 1;
        this._invincibleFrames = this._frames(2.0);
        this._spawnExplosion(VIEW_CX, VIEW_CY, 'large');
        this._radioMsg = '!!! INTERCEPTOR RAMS !!!';
        this._radioTimer = this._frames(2);
        ip.dead = true;
      }
    }

    // ── Bullets: travel in 3D world space along their fire direction ─────
    for (const b of this._bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += (b.vz || 0) * dt;
      b.life--;
    }
    // Bullet vs interceptor (3D world-space distance)
    for (const b of this._bullets) {
      if (b.life <= 0) continue;
      for (const ip of this._interceptors) {
        if (ip.dead) continue;
        const dx = b.x - ip.x;
        const dy = b.y - ip.y;
        const dz = b.z - (ip.z || 0);
        if (dx*dx + dy*dy + dz*dz < 2.25) {     // 1.5-unit hit radius
          ip.dead = true;
          b.life = 0;
          this._spawnExplosion(VIEW_CX, VIEW_CY, 'medium');
          this._sessionPayout += 500;
          this._radioMsg = 'Hostile destroyed.';
          this._radioTimer = this._frames(1.5);
          break;
        }
      }
    }
    // Bullet vs asteroid (3D)
    for (const b of this._bullets) {
      if (b.life <= 0) continue;
      for (const a of this._asteroids) {
        if (a.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - (a.z || 0);
        const r = a.size === 'large' ? 1.6 : a.size === 'medium' ? 1.2 : 0.8;
        if (dx*dx + dy*dy + dz*dz < r*r) {
          a.dead = true;
          b.life = 0;
          this._spawnExplosion(VIEW_CX, VIEW_CY, 'small');
          this._sessionPayout += 50;
          break;
        }
      }
    }

    // ── Particles (purely cosmetic, screen-space) ────────────────────────
    for (const p of this._particles) {
      p.x += p.vx * dt * 10;
      p.y += p.vy * dt * 10;
      p.life--;
    }

    // ── Cull ─────────────────────────────────────────────────────────────
    this._asteroids    = this._asteroids.filter(a => {
      if (a.dead) return false;
      const rel = this._toBowRel(a.x, a.y, a.z || 0);
      return rel.range > -8;
    });
    this._interceptors = this._interceptors.filter(ip => {
      if (ip.dead) return false;
      const dx = ip.x - this._px, dy = ip.y - this._py, dz = (ip.z || 0) - this._pz;
      return dx*dx + dy*dy + dz*dz < 80*80;
    });
    this._bullets   = this._bullets.filter(b => b.life > 0);
    this._particles = this._particles.filter(p => p.life > 0);

    // ── Radio Doppler clarity (rear-direction) ───────────────────────────
    const rearD = dopplerFactor(this._beta, -1);
    this._radioClarity = clamp(rearD * 1.2, 0, 1);
    if (this._radioTimer > 0) this._radioTimer--;

    // ── Fuel-out warning (fires once) ────────────────────────────────────
    if (!this._fuelOutWarned && this._fuel < 1.0) {
      this._fuelOutWarned = true;
      this._radioMsg = 'FUEL EXHAUSTED. Coasting only — drift to dock.';
      this._radioTimer = this._frames(3);
    }
  }

  // Send a destination-beacon radio message that hints at the dest's direction.
  // The hint is degraded by Doppler (you're flying away from station, but the
  // *dest* is what's broadcasting toward you — so actually the dest's apparent
  // Doppler depends on whether you're approaching it or not).
  _sendBeacon() {
    const rel = this._toBowRel(this._destX, this._destY, this._destZ);
    const dist = this._distTo(this._destX, this._destY, this._destZ);
    if (dist < ARRIVAL_RADIUS * 2) return;
    let dirHint;
    const ahead = rel.range > 0;
    const sideOffset = Math.abs(rel.lateral);
    const vertOffset = Math.abs(rel.vertical);
    const offCenter = Math.max(sideOffset, vertOffset);
    if (offCenter < 4 && ahead) {
      dirHint = 'dead ahead';
    } else if (ahead) {
      // Pick the dominant offset direction
      if (vertOffset > sideOffset) {
        dirHint = rel.vertical > 0 ? 'high on the bow' : 'low on the bow';
      } else {
        dirHint = rel.lateral > 0 ? 'on port bow' : 'on starboard bow';
      }
    } else {
      // Behind us
      if (vertOffset > sideOffset) {
        dirHint = rel.vertical > 0 ? 'astern high' : 'astern low';
      } else {
        dirHint = rel.lateral > 0 ? 'astern port' : 'astern starboard';
      }
    }
    this._radioMsg = `${this._contract.dest}: beacon ${dirHint}, ${Math.round(dist)} units.`;
    this._radioTimer = this._frames(2.2);
  }

  // Build a world-space (x,y,z) from a bow-relative (range, lateral, vertical).
  // Inverse of _toBowRel. Used to spawn objects at offsets from the player's
  // current bow direction.
  _bowRelToWorld(range, lateral, vertical) {
    // Step 1: undo the lateral sign flip (lateral>0 = starboard)
    const yp = -lateral;
    // Step 2: undo inverse-pitch (forward rotation around lateral axis)
    const cp = Math.cos(this._pitchAngle), sp = Math.sin(this._pitchAngle);
    const xp = cp * range - sp * vertical;
    const dz = sp * range + cp * vertical;
    // Step 3: undo inverse-yaw (forward rotation around vertical axis)
    const cy = Math.cos(this._yawAngle), sy = Math.sin(this._yawAngle);
    const dx = cy * xp - sy * yp;
    const dy = sy * xp + cy * yp;
    return {
      x: this._px + dx,
      y: this._py + dy,
      z: this._pz + dz,
    };
  }

  // ─── SPAWNERS (world-coordinate, 3D) ─────────────────────────────────────
  _spawnAsteroid() {
    const sizes = ['small', 'small', 'medium', 'medium', 'large'];
    const size = Utils.pick(sizes);
    const aheadDist = 30 + Math.random() * 12;
    // 3D scatter: lateral ±11, vertical ±6 (asteroids feel more horizontal)
    const lat  = (Math.random() - 0.5) * 22;
    const vert = (Math.random() - 0.5) * 12;
    const w = this._bowRelToWorld(aheadDist, lat, vert);
    this._asteroids.push({
      x: w.x, y: w.y, z: w.z,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.4,
      size,
      dead: false,
    });
  }

  _spawnInterceptor() {
    const aheadDist = 30 + Math.random() * 15;
    const lat  = (Math.random() - 0.5) * 30;
    const vert = (Math.random() - 0.5) * 16;
    const w = this._bowRelToWorld(aheadDist, lat, vert);
    const beta = 0.4 + Math.random() * 0.35;
    this._interceptors.push({
      x: w.x, y: w.y, z: w.z,
      beta,
      fireCD: 2 + Math.random() * 2,
      dead: false,
    });
  }

  _spawnLaser(ip) {
    const rel = this._toBowRel(ip.x, ip.y, ip.z || 0);
    const sx = this._projectScreenX(rel);
    const sy = this._projectScreenY(rel);
    this._particles.push({
      x: sx, y: sy,
      vx: (VIEW_CX - sx) * 0.05,
      vy: (VIEW_CY - sy) * 0.05,
      life: this._frames(0.5),
      ch: '\u2500',
      fg: Color.BRIGHT_RED,
    });
  }

  _spawnExplosion(x, y, size) {
    const n = size === 'large' ? 8 : size === 'medium' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.3 + Math.random() * 0.7;
      this._particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5,
        life: Utils.randInt(4, 10),
        ch: Utils.pick(['*', '+', '.']),
        fg: Utils.pick([Color.BRIGHT_YELLOW, Color.BRIGHT_RED, Color.YELLOW, Color.BRIGHT_WHITE]),
      });
    }
  }

  // Project a {range, lateral} bow-relative pair to screen X/Y.
  // Objects far away cluster near the reticle (small angular size); close
  // objects spread to the edges (high angular size).
  _projectScreenX(rel) {
    const r = Math.max(1, rel.range);
    return clamp(VIEW_CX + Math.round((rel.lateral / r) * VIEW_W * 0.35),
                 VIEW_LEFT + 1, VIEW_RIGHT - 1);
  }
  _projectScreenY(rel) {
    // No vertical world axis — keep at center with a small range-based jitter
    return VIEW_CY;
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────
  _drawFlight() {
    this.screen.clear(Color.BLACK, Color.BLACK);
    this._drawStars();
    this._drawGravWells();
    this._drawAsteroids();
    this._drawDestination();
    this._drawInterceptors();
    this._drawBullets();
    this._drawParticles();
    this._drawReticle();
    this._drawDirectionIndicator();
    this._drawHUD();
    this._drawHint();
    this._drawStatusLine();
  }

  // The destination station rendered in-world. As you approach it, the sprite
  // grows from a single bright dot to a multi-cell silhouette. When close
  // enough, show docking guidance.
  _drawDestination() {
    const rel = this._toBowRel(this._destX, this._destY, this._destZ);
    if (rel.range < -3) return;
    if (rel.range > 200) return;
    if (rel.range < 0.5) return;          // off-screen arrow handles this case

    const r = Math.max(1, rel.range);
    const screenX = clamp(VIEW_CX + Math.round((rel.lateral / r) * VIEW_W * 0.4),
                          VIEW_LEFT + 1, VIEW_RIGHT - 5);
    const screenY = clamp(VIEW_CY - Math.round((rel.vertical / r) * VIEW_H * 0.6),
                          VIEW_TOP + 1, VIEW_BOT - 1);
    const dist = this._distTo(this._destX, this._destY, this._destZ);
    const fg  = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN;
    const fg2 = this._isMono ? Color.GREEN : Color.CYAN;

    if (dist > 60) {
      this.screen.putChar(screenX, screenY, '+', fg2, Color.BLACK);
    } else if (dist > 25) {
      this.screen.putChar(screenX, screenY, '*', fg, Color.BLACK);
    } else if (dist > 12) {
      this.screen.putChar(screenX - 1, screenY, '\u2500', fg2, Color.BLACK);
      this.screen.putChar(screenX,     screenY, '\u00A4', fg, Color.BLACK);
      this.screen.putChar(screenX + 1, screenY, '\u2500', fg2, Color.BLACK);
    } else {
      const fgB = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_WHITE;
      if (screenY - 1 >= VIEW_TOP) this.screen.putString(screenX - 1, screenY - 1, '\u2554\u2550\u2557', fg, Color.BLACK);
      this.screen.putString(screenX - 1, screenY, '\u2563\u00A4\u2560', fgB, Color.BLACK);
      if (screenY + 1 <= VIEW_BOT) this.screen.putString(screenX - 1, screenY + 1, '\u255A\u2550\u255D', fg, Color.BLACK);

      if (dist < ARRIVAL_RADIUS * 2) {
        const guidanceY = Math.max(VIEW_TOP + 1, screenY - 3);
        if (this._beta < ARRIVAL_BETA_MAX) {
          const fgOK = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_GREEN;
          const blink = (Math.floor(this._shipTime * 4) % 2) === 0;
          if (blink) {
            this.screen.putString(VIEW_CX - 7, guidanceY, '>>> DOCKING <<<', fgOK, Color.BLACK);
          }
        } else {
          const fgWarn = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_RED;
          this.screen.putString(VIEW_CX - 9, guidanceY,
            `DECELERATE!  \u03B2=${this._beta.toFixed(2)}`, fgWarn, Color.BLACK);
        }
      }
    }
  }

  // When the destination is off-screen, show a steering arrow at the screen
  // edge pointing the way. With pitch, "off-screen" can mean port/starboard
  // (yaw axis), high/low (pitch axis), or astern.
  _drawDirectionIndicator() {
    const rel = this._toBowRel(this._destX, this._destY, this._destZ);
    const r = Math.max(1, rel.range);
    const screenX = VIEW_CX + Math.round((rel.lateral / r) * VIEW_W * 0.4);
    const screenY = VIEW_CY - Math.round((rel.vertical / r) * VIEW_H * 0.6);
    const onScreen = rel.range > 0 &&
                     screenX >= VIEW_LEFT + 2 && screenX <= VIEW_RIGHT - 2 &&
                     screenY >= VIEW_TOP + 1 && screenY <= VIEW_BOT - 1;
    if (onScreen) return;

    const fg = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN;
    const fgD = this._isMono ? Color.GREEN : Color.CYAN;
    let glyph, label, sx, sy;

    if (rel.range < 0) {
      // Behind us — corner indicator
      if (rel.lateral > 0) { glyph = '\u2198'; label = 'ASTERN'; sx = VIEW_RIGHT - 8; sy = VIEW_BOT; }
      else                 { glyph = '\u2199'; label = 'ASTERN'; sx = VIEW_LEFT + 2;  sy = VIEW_BOT; }
    } else {
      // In front; pick the dominant off-axis direction
      const aLat = Math.abs(rel.lateral);
      const aVert = Math.abs(rel.vertical);
      if (aVert > aLat) {
        if (rel.vertical > 0) { glyph = '\u2191'; label = 'HIGH'; sx = VIEW_CX - 4; sy = VIEW_TOP + 1; }
        else                  { glyph = '\u2193'; label = 'LOW';  sx = VIEW_CX - 4; sy = VIEW_BOT - 1; }
      } else {
        if (rel.lateral > 0)  { glyph = '\u2192'; label = 'STARBOARD'; sx = VIEW_RIGHT - 11; sy = VIEW_CY; }
        else                  { glyph = '\u2190'; label = 'PORT';      sx = VIEW_LEFT + 2;   sy = VIEW_CY; }
      }
    }
    this.screen.putString(sx, sy, `${glyph} ${label}`, fg, Color.BLACK);
    const d = Math.round(this._distTo(this._destX, this._destY, this._destZ));
    const distRow = (sy === VIEW_TOP + 1) ? sy + 1
                  : (sy === VIEW_BOT - 1 || sy === VIEW_BOT) ? sy - 1
                  : sy + 1;
    this.screen.putString(sx, distRow, `  ${d}u`, fgD, Color.BLACK);
  }


  _drawGravWells() {
    for (const w of this._gravWells) {
      const rel = this._toBowRel(w.x, w.y, w.z || 0);
      const r = rel.range;
      if (r > 35 || r < -3) continue;
      const screenX = clamp(VIEW_CX + Math.round((rel.lateral / Math.max(1, r)) * VIEW_W * 0.4),
                            VIEW_LEFT + 2, VIEW_RIGHT - 2);
      const screenY = clamp(VIEW_CY - Math.round((rel.vertical / Math.max(1, r)) * VIEW_H * 0.6),
                            VIEW_TOP + 1, VIEW_BOT - 1);
      const ph = Math.floor(w.phase) % 4;
      const fg = this._isMono ? Color.BRIGHT_GREEN :
                 r < 6  ? Color.BRIGHT_MAGENTA :
                 r < 16 ? Color.MAGENTA : Color.DARK_GRAY;
      let pattern;
      if (r < 8) {
        pattern = ph % 2 === 0
          ? [' \u2592 ', '\u2592\u2588\u2592', ' \u2592 ']
          : ['\u00B7\u2591\u00B7', '\u2591\u2588\u2591', '\u00B7\u2591\u00B7'];
      } else if (r < 18) {
        pattern = [' \u2591 ', '\u2591\u2592\u2591', ' \u2591 '];
      } else {
        pattern = [' \u00B7 ', '\u00B7\u00B7\u00B7', ' \u00B7 '];
      }
      for (let dy = 0; dy < pattern.length; dy++) {
        const line = pattern[dy];
        for (let dx = 0; dx < line.length; dx++) {
          const ch = line[dx];
          if (ch === ' ') continue;
          const sx = screenX + dx - 1;
          const sy = screenY + dy - 1;
          if (sx >= VIEW_LEFT && sx <= VIEW_RIGHT && sy >= VIEW_TOP && sy <= VIEW_BOT) {
            this.screen.putChar(sx, sy, ch, fg, Color.BLACK);
          }
        }
      }
    }
  }

  _drawStars() {
    const beta = this._beta;
    const cy = Math.cos(this._yawAngle), sy = Math.sin(this._yawAngle);
    const cp = Math.cos(this._pitchAngle), sp = Math.sin(this._pitchAngle);

    for (const s of this._stars) {
      // Rotate the star's world-frame direction unit vector by the inverse
      // of the camera (yaw, then pitch). Stars are at infinity so we don't
      // translate, only rotate.
      const dx = s.dx, dy = s.dy, dz = s.dz;
      // Inverse-yaw around z-axis
      const xp =  cy * dx + sy * dy;
      const yp = -sy * dx + cy * dy;
      // Inverse-pitch around y'-axis
      const forward  =  cp * xp + sp * dz;
      const vertical = -sp * xp + cp * dz;
      const lateral  = -yp;     // sign flip: lateral>0 = starboard

      // forward = cos of angle from bow direction. Same scalar used by
      // Doppler & aberration.
      const cosT = forward;

      // Cull: stars too far behind the bow get culled by Doppler test below
      // anyway, but skip the projection math for them outright.
      if (forward < -0.999) continue;

      // Aberration: shift the cos along the velocity (= bow) axis.
      // Apparent angle θ' satisfies cos θ' = (cos θ + β)/(1 + β cos θ).
      // The perpendicular components (lateral, vertical) preserve their
      // direction in the perpendicular plane; we just rescale them so the
      // resulting vector remains a unit vector.
      const cosT_app = clamp(aberratedCos(beta, cosT), -1, 1);
      const sinT     = Math.sqrt(Math.max(0, 1 - cosT * cosT));
      const sinT_app = Math.sqrt(Math.max(0, 1 - cosT_app * cosT_app));
      // Perpendicular unit components in the (lateral, vertical) plane
      let pLat, pVert;
      if (sinT > 1e-6) {
        pLat  = lateral  / sinT;
        pVert = vertical / sinT;
      } else {
        pLat = 0; pVert = 0;
      }
      const lateral_app  = pLat  * sinT_app;
      const vertical_app = pVert * sinT_app;

      // Project apparent direction to screen via small-angle approximation:
      // screenX from atan2(lateral_app, cosT_app) but for cosT_app > ~0 we
      // can use a simple lateral/forward ratio. For wide angles (cosT_app
      // close to 0 or negative) we use the full atan2 to wrap correctly.
      // Map forward-cone angle to (-1, 1) via atan2 ratio of perp / forward.
      // Stars behind us (cosT_app < 0) are "off the front of the screen" and
      // are projected toward the edges of the view; we just cull them.
      if (cosT_app < 0.05) continue;

      // Pin-hole-style projection: x' = lateral_app / cosT_app, y' = vertical_app / cosT_app.
      // Multiply by a scale factor that makes the field of view roughly ±60°.
      const FOV_SCALE_X = VIEW_W * 0.42;
      const FOV_SCALE_Y = VIEW_H * 0.55;
      const screenX = Math.round(VIEW_CX + (lateral_app  / cosT_app) * FOV_SCALE_X);
      const screenY = Math.round(VIEW_CY - (vertical_app / cosT_app) * FOV_SCALE_Y);

      if (screenX < VIEW_LEFT || screenX > VIEW_RIGHT) continue;
      if (screenY < VIEW_TOP  || screenY > VIEW_BOT)   continue;

      const D = dopplerFactor(beta, cosT);
      if (D < DOPPLER_CULL_BELOW) continue;

      const tier = clamp(s.tier + beamingTierOffset(D), 0, 5);
      const ch = GLYPH_TIERS[tier];

      let fg;
      if (this._isMono) {
        fg = Color.BRIGHT_GREEN;
      } else {
        const q = quantizeDoppler(D);
        fg = q.isRest ? s.restColor : q.color;
      }
      this.screen.putChar(screenX, screenY, ch, fg, Color.BLACK);
    }
  }

  _drawAsteroids() {
    for (const a of this._asteroids) {
      if (a.dead) continue;
      const rel = this._toBowRel(a.x, a.y, a.z || 0);
      if (rel.range < 0.3) continue;
      const sprite = ASTEROID_SPRITES[a.size];
      const r = Math.max(1, rel.range);
      const screenX = clamp(VIEW_CX + Math.round((rel.lateral / r) * VIEW_W * 0.4),
                            VIEW_LEFT + 2, VIEW_RIGHT - 6);
      const screenY = clamp(VIEW_CY - 1 - Math.round((rel.vertical / r) * VIEW_H * 0.6),
                            VIEW_TOP, VIEW_BOT - sprite.length);

      const squash = this._gamma > 1.5 ? Math.max(1, Math.round(this._gamma)) : 1;

      for (let row = 0; row < sprite.length; row++) {
        const line = sprite[row];
        let col = 0;
        for (let i = 0; i < line.length; i++) {
          if (squash > 1 && (i % squash !== 0)) continue;
          const ch = line[i];
          if (ch !== ' ') {
            const sx = screenX + col;
            const sy = screenY + row;
            if (sx >= VIEW_LEFT && sx <= VIEW_RIGHT && sy >= VIEW_TOP && sy <= VIEW_BOT) {
              const fg = this._isMono ? Color.BRIGHT_GREEN :
                         rel.range < 5  ? Color.BRIGHT_RED :
                         rel.range < 15 ? Color.YELLOW :
                                          Color.WHITE;
              this.screen.putChar(sx, sy, ch, fg, Color.BLACK);
            }
          }
          col++;
        }
      }
    }
  }

  _drawInterceptors() {
    for (const ip of this._interceptors) {
      if (ip.dead) continue;
      const rel = this._toBowRel(ip.x, ip.y, ip.z || 0);
      if (rel.range < 0.5) continue;
      const r = Math.max(1, rel.range);
      const sx = clamp(VIEW_CX + Math.round((rel.lateral / r) * VIEW_W * 0.4),
                       VIEW_LEFT + 1, VIEW_RIGHT - 1);
      const sy = clamp(VIEW_CY - Math.round((rel.vertical / r) * VIEW_H * 0.6),
                       VIEW_TOP + 1, VIEW_BOT - 1);
      // Color via Doppler — head-on interceptor blueshifts
      const cosT = rel.range / Math.max(0.01, Math.sqrt(rel.range*rel.range + rel.lateral*rel.lateral + rel.vertical*rel.vertical));
      const D = dopplerFactor(this._beta, cosT);
      let fg;
      if (this._isMono) {
        fg = Color.BRIGHT_GREEN;
      } else {
        const q = quantizeDoppler(D);
        fg = q.isRest ? Color.BRIGHT_RED : q.color;
      }
      if (rel.range < 8) {
        if (sx - 1 >= VIEW_LEFT) this.screen.putChar(sx - 1, sy, '\u003C', fg, Color.BLACK);
        this.screen.putChar(sx, sy, 'X', fg, Color.BLACK);
        if (sx + 1 <= VIEW_RIGHT) this.screen.putChar(sx + 1, sy, '\u003E', fg, Color.BLACK);
      } else if (rel.range < 18) {
        this.screen.putChar(sx, sy, 'X', fg, Color.BLACK);
      } else {
        this.screen.putChar(sx, sy, '+', fg, Color.BLACK);
      }
    }
  }

  _drawBullets() {
    for (const b of this._bullets) {
      if (b.life <= 0) continue;
      const rel = this._toBowRel(b.x, b.y, b.z || 0);
      if (rel.range < 0.3) continue;
      const r = Math.max(1, rel.range);
      const sx = clamp(VIEW_CX + Math.round((rel.lateral / r) * VIEW_W * 0.4),
                       VIEW_LEFT, VIEW_RIGHT);
      const sy = clamp(VIEW_CY - Math.round((rel.vertical / r) * VIEW_H * 0.6),
                       VIEW_TOP + 1, VIEW_BOT - 1);
      const age = (this._shipTime - (b.bornAt || 0));
      const gl = age < 0.2 ? '*' : age < 0.5 ? '+' : '.';
      this.screen.putChar(sx, sy, gl,
        this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_YELLOW, Color.BLACK);
    }
  }

  _drawParticles() {
    for (const p of this._particles) {
      const sx = Math.round(p.x);
      const sy = Math.round(p.y);
      if (sx >= VIEW_LEFT && sx <= VIEW_RIGHT && sy >= VIEW_TOP && sy <= VIEW_BOT) {
        const fg = this._isMono ? Color.BRIGHT_GREEN : p.fg;
        this.screen.putChar(sx, sy, p.ch, fg, Color.BLACK);
      }
    }
  }

  _drawReticle() {
    // Center reticle indicating bow direction
    const fg = this._isMono ? Color.BRIGHT_GREEN : Color.DARK_GRAY;
    if (this._invincibleFrames > 0 && (this._invincibleFrames % 4) < 2) return;
    this.screen.putChar(VIEW_CX - 1, VIEW_CY, '\u2576', fg, Color.BLACK);  // ╶
    this.screen.putChar(VIEW_CX,     VIEW_CY, '\u253C', fg, Color.BLACK);  // ┼
    this.screen.putChar(VIEW_CX + 1, VIEW_CY, '\u2574', fg, Color.BLACK);  // ╴
  }

  _drawHUD() {
    const fgL = this._isMono ? Color.BRIGHT_GREEN : Color.WHITE;
    const fgD = this._isMono ? Color.GREEN : Color.DARK_GRAY;
    const fgY = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_YELLOW;
    const fgC = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN;

    // Row 20: clocks + β + γ + fuel + cargo
    const shipT = fmtRunTime(this._shipTime);
    const stnT  = fmtRunTime(this._stationTime);
    const cargo = cargoRemaining(this._contract.cargoKg, this._iso.half_game_s, this._shipTime);
    const cargoPct = cargo / this._contract.cargoKg;
    const cargoBar = '\u2593'.repeat(Math.round(cargoPct * 10)) + '\u2591'.repeat(10 - Math.round(cargoPct * 10));

    // HUD line 1: SHIP | STATION | β | γ
    let row = 20;
    this.screen.putString(1, row,  'SHIP ', fgD, Color.BLACK);
    this.screen.putString(6, row,  shipT, fgC, Color.BLACK);
    this.screen.putString(13, row, '   STN ', fgD, Color.BLACK);
    this.screen.putString(20, row, stnT, fgY, Color.BLACK);
    this.screen.putString(27, row, `   \u03B2=${this._beta.toFixed(3)}  \u03B3=${this._gamma.toFixed(2)}`, fgL, Color.BLACK);
    const fuelStr = `FUEL ${this._fuelBar(this._fuel)} ${this._fuel.toFixed(0)}%`;
    this.screen.putString(53, row, fuelStr, fgL, Color.BLACK);

    // HUD line 2: distance + cargo + isotope
    row = 21;
    const totalDist = this._contract.distance;
    const remaining = this._distTo(this._destX, this._destY);
    const closed = clamp(1 - remaining / totalDist, 0, 1);
    const distBar = '\u2588'.repeat(Math.round(closed * 14)) + '\u2591'.repeat(14 - Math.round(closed * 14));
    this.screen.putString(1, row, `DIST ${distBar} ${remaining.toFixed(0)}u`, fgL, Color.BLACK);
    this.screen.putString(28, row, `${this._contract.dest.padEnd(18, ' ')}`, fgC, Color.BLACK);
    this.screen.putString(48, row, `CARGO ${cargoBar} ${cargo.toFixed(1)}kg`, fgL, Color.BLACK);

    // HUD line 3: radio + threat
    row = 22;
    let radio;
    if (this._radioTimer > 0) {
      // Important message — show clearly
      radio = `RADIO  ${this._radioMsg}`;
    } else {
      radio = `RADIO  ${this._garbleRadio('Maintain course. ' + this._iso.code + ' loaded. ETA pending.')}`;
    }
    this.screen.putString(1, row, radio.substring(0, 50), fgD, Color.BLACK);
    const threat = this._interceptors.length > 0
      ? `THREAT \u25B2 patrols=${this._interceptors.length}`
      : 'THREAT clear';
    this.screen.putString(53, row, threat,
      this._interceptors.length > 0 ? Color.BRIGHT_RED : fgD, Color.BLACK);

    // HUD line 4: hull + isotope label
    row = 23;
    this.screen.putString(1, row, `HULL ${this._hullDisplay()}    ISOTOPE ${this._iso.code} (T\u00BD ${this._fmtRealHalf(this._iso.half_real_s)})`, fgL, Color.BLACK);
  }

  _garbleRadio(msg) {
    if (this._radioClarity >= 0.9) return msg;
    const out = [];
    for (let i = 0; i < msg.length; i++) {
      if (Math.random() < this._radioClarity) {
        out.push(msg[i]);
      } else {
        out.push(Utils.pick(['\u2592', '\u2591', '.', '\u2593']));
      }
    }
    return out.join('');
  }

  _drawHint() {
    const hint = '[ \u2190\u2192 YAW  \u2191\u2193 PITCH  R/F THRUST  SPC FIRE  Q QUIT ]';
    const col = Math.floor((80 - hint.length) / 2) + 1;
    const fg = this._isMono ? Color.GREEN : Color.DARK_GRAY;
    this.screen.putString(col, HINT_ROW, hint, fg, Color.BLACK);
  }

  _drawStatusLine() {
    const ageGap = this._careerStationTime - this._careerPilotTime + (this._stationTime - this._shipTime);
    const sb = ` HI: ${fmtMoney(this._hiScore)} | PILOT ${fmtCareerTime(this._careerPilotTime + this._shipTime)} / STN ${fmtCareerTime(this._careerStationTime + this._stationTime)} | LIGHTRUNNER`;
    const sbg = this._isMono ? Color.BLACK : Color.BLUE;
    const sfg = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_WHITE;
    this.screen.statusBar(sb.substring(0, 79), sfg, sbg);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // ARRIVAL CUTSCENE — twin paradox reveal
  // ═════════════════════════════════════════════════════════════════════════
  async _arrivalScreen(result) {
    if (result.aborted) return;

    this.screen.clear(Color.BLACK, Color.BLACK);
    const fgT = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN;
    const fgL = this._isMono ? Color.GREEN : Color.WHITE;
    const fgY = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_YELLOW;
    const fgD = this._isMono ? Color.GREEN : Color.DARK_GRAY;
    const fgG = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_GREEN;

    // Title
    const title = `*** ARRIVAL: ${result.contract.dest} ***`;
    const tCol = Math.floor((80 - title.length) / 2) + 1;
    this.screen.putString(tCol, 2, title, fgT, Color.BLACK);

    // Two clock boxes side by side
    Draw.titledBox(this.screen, 10, 4, 26, 5, 'SHIP CLOCK',
      Draw.BOX_DOUBLE, fgL, Color.BLACK, fgT, Color.BLACK);
    Draw.titledBox(this.screen, 44, 4, 26, 5, 'STATION CLOCK',
      Draw.BOX_DOUBLE, fgL, Color.BLACK, fgY, Color.BLACK);

    // Animate ship clock → station clock with progressive reveal
    this.screen.flush();
    await sleep(400);

    // Ship clock fills first
    const shipText = fmtRunTime(result.shipTime);
    const stnText  = fmtRunTime(result.stationTime);
    this.screen.putString(10 + Math.floor((26 - shipText.length) / 2), 6, shipText, fgT, Color.BLACK);
    this.screen.putString(10 + Math.floor((26 - 14) / 2), 7, '(your time)', fgD, Color.BLACK);
    this.screen.flush();
    await sleep(700);

    // Station clock catches up — animate the digits ratcheting from ship to station
    const startMs = Date.now();
    const animMs = 1500;
    while (Date.now() - startMs < animMs && this._running) {
      const t = (Date.now() - startMs) / animMs;
      const shown = result.shipTime + (result.stationTime - result.shipTime) * t;
      const txt = fmtRunTime(shown);
      this.screen.putString(44, 6, ' '.repeat(26), fgY, Color.BLACK);
      this.screen.putString(44 + Math.floor((26 - txt.length) / 2), 6, txt, fgY, Color.BLACK);
      this.screen.putString(44 + Math.floor((26 - 17) / 2), 7, '(universe time)', fgD, Color.BLACK);
      this.screen.flush();
      await sleep(50);
    }
    this.screen.putString(44, 6, ' '.repeat(26), fgY, Color.BLACK);
    this.screen.putString(44 + Math.floor((26 - stnText.length) / 2), 6, stnText, fgY, Color.BLACK);
    this.screen.flush();
    await sleep(400);

    // Time saved & avg γ
    const dilation = result.stationTime - result.shipTime;
    const dilStr = `Time saved by relativity:  +${dilation.toFixed(2)} sec`;
    const gStr = `Average gamma during transit:   ${(result.avgGamma || 1).toFixed(2)}`;
    this.screen.putString(Math.floor((80 - dilStr.length) / 2) + 1, 10, dilStr, fgG, Color.BLACK);
    this.screen.putString(Math.floor((80 - gStr.length) / 2) + 1, 11, gStr, fgL, Color.BLACK);
    this.screen.flush();
    await sleep(700);

    // Cargo manifest
    Draw.titledBox(this.screen, 10, 13, 60, 8, 'CARGO MANIFEST',
      Draw.BOX_DOUBLE, fgL, Color.BLACK, fgT, Color.BLACK);
    const decayed = result.cargoStart - result.cargoEnd;
    const pct = result.cargoEnd / result.cargoStart;
    const bar = '\u2593'.repeat(Math.round(pct * 20)) + '\u2591'.repeat(20 - Math.round(pct * 20));
    this.screen.putString(12, 14, `${result.iso.code}  loaded:    ${result.cargoStart.toFixed(2)} kg`, fgL, Color.BLACK);
    this.screen.putString(12, 15, `        delivered: ${result.cargoEnd.toFixed(2).padStart(7)} kg   ${bar}`, fgG, Color.BLACK);
    this.screen.putString(12, 16, `        decayed:   ${decayed.toFixed(2).padStart(7)} kg   (proper time: ${result.shipTime.toFixed(2)}s)`, fgD, Color.BLACK);
    this.screen.putString(12, 18, `PAYOUT:  ${result.cargoEnd.toFixed(2)} kg \u00D7 ${fmtMoney(result.iso.payPerKg)}/kg = ${fmtMoney(result.payout)}`, fgY, Color.BLACK);
    this.screen.flush();

    await sleep(1200);

    const press = '[ Press any key to continue \u2192 ]';
    this.screen.putString(Math.floor((80 - press.length) / 2) + 1, 23, press, fgD, Color.BLACK);
    this.screen.flush();

    await this._waitAnyKey();
  }

  async _waitAnyKey() {
    return new Promise(resolve => {
      const onKey = () => { cleanup(); resolve(); };
      const onAct = () => { cleanup(); resolve(); };
      const cleanup = () => {
        this.input.removeListener('key', onKey);
        this.input.removeListener('action', onAct);
      };
      this.input.on('key', onKey);
      this.input.on('action', onAct);
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SESSION SUMMARY (after session ends — ran out of fuel/hull or quit)
  // ═════════════════════════════════════════════════════════════════════════
  async _sessionSummary() {
    this.screen.clear(Color.BLACK, Color.BLACK);
    const fgT = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_CYAN;
    const fgL = this._isMono ? Color.GREEN : Color.WHITE;
    const fgY = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_YELLOW;
    const fgD = this._isMono ? Color.GREEN : Color.DARK_GRAY;

    const title = '*** RUN COMPLETE ***';
    this.screen.putString(Math.floor((80 - title.length) / 2) + 1, 1, title, fgT, Color.BLACK);

    Draw.titledBox(this.screen, 8, 3, 64, 9, 'SESSION TOTALS',
      Draw.BOX_DOUBLE, fgL, Color.BLACK, fgT, Color.BLACK);
    const lines = [
      `Contracts completed:     ${this._sessionContracts}`,
      `Total payout:            ${fmtMoney(this._sessionPayout)}`,
      `Cargo delivered:         ${this._sessionCargoDelivered.toFixed(1)} kg`,
      `Pilot time elapsed:      ${fmtRunTime(this._sessionPilotTime)}`,
      `Station time elapsed:    ${fmtRunTime(this._sessionStationTime)}`,
      `Time dilation gained:    +${(this._sessionStationTime - this._sessionPilotTime).toFixed(2)} sec`,
    ];
    for (let i = 0; i < lines.length; i++) {
      this.screen.putString(11, 5 + i, lines[i], fgL, Color.BLACK);
    }

    Draw.titledBox(this.screen, 8, 13, 64, 6, 'CAREER TOTALS',
      Draw.BOX_DOUBLE, fgL, Color.BLACK, fgT, Color.BLACK);
    const ageGap = this._careerStationTime - this._careerPilotTime;
    const careerLines = [
      `Pilot age:               ${fmtCareerTime(this._careerPilotTime)}`,
      `Station age:             ${fmtCareerTime(this._careerStationTime)}`,
      `Age gap (twin paradox):  ${fmtCareerTime(ageGap)}`,
    ];
    for (let i = 0; i < careerLines.length; i++) {
      this.screen.putString(11, 14 + i, careerLines[i], fgY, Color.BLACK);
    }

    if (this._sessionPayout >= this._hiScore && this._sessionPayout > 0) {
      const hi = `NEW HIGH SCORE: ${fmtMoney(this._sessionPayout)}`;
      this.screen.putString(Math.floor((80 - hi.length) / 2) + 1, 20, hi, fgY, Color.BLACK);
    }

    this.screen.putString(Math.floor((80 - 32) / 2) + 1, 22,
      '[ Press any key to return \u2192 ]', fgD, Color.BLACK);
    const sbg = this._isMono ? Color.BLACK : Color.BLUE;
    const sfg = this._isMono ? Color.BRIGHT_GREEN : Color.BRIGHT_WHITE;
    this.screen.statusBar(' LIGHTRUNNER  |  Thanks for flying  |  ', sfg, sbg);
    this.screen.flush();

    await this._waitAnyKey();
  }
}

module.exports = Lightrunner;
