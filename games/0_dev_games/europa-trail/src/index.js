'use strict';
const path = require('path');

const { GameBase, Screen, Draw, Color, Attr, CP437 } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

const C = Color;

// ═══════════════════════════════════════════════════════════════════════════
// GAME CONFIGURATION (BALANCING CONSTANTS)
// ═══════════════════════════════════════════════════════════════════════════

const CFG = {
  VICTORY_DIST: 600, // Distance to reach Europa (Mkm)

  // -- Setup & Economy --
  START_CREDITS_BANKER: 8000,
  START_CREDITS_OTHER:  4000,
  PRICE_BASE_FUEL:      10,
  PRICE_BASE_RATIONS:   5,
  PRICE_BASE_PARTS:     150,
  PRICE_BASE_DOC:       200,
  SELL_RATE_PCT:        0.50,              // Sell items for 50% of the station's buy price

  // -- Movement & Consumption --
  PACE_FUEL_BURN:       [0, 8, 20, 45],    // Paces: 0=None, 1=Cruise, 2=Accel, 3=Max
  PACE_DIST_BASE:       [0, 15, 35, 60],
  DIST_VARIANCE:        3,                 // +/- randomness to movement
  RATION_BURN_PER_CREW: [0, 1, 3, 5],      // Rations: 0=None, 1=Min, 2=Std, 3=Gen
  
  // -- Class Perks --
  PILOT_FUEL_MULT:      0.8,               // 10% discount on fuel burn
  ENG_REPAIR_PCT:       20,                // % repaired per part (Engineer)
  BASE_REPAIR_PCT:      10,                // % repaired per part (Others)

  // -- Passive System Degradation (Ranges) --
  WEAR_REACTOR_MAX:     [4, 9],            // Extra reactor wear at Max Pace
  WEAR_HULL_MAX:        [1, 6],            // Extra hull wear at Max Pace
  WEAR_REACTOR_STD:     [1, 4],            // Normal reactor wear per week
  WEAR_LIFE_SUPP:       [1, 4],            // Normal Life Support wear per week
  LS_CRIT_THRESHOLD:    10,                // Life Support level where crew suffocates

  // -- Mining / Combat Minigame --
  MINING_FUEL_COST:     2,
  TIME_PERFECT:         3.0,               // Seconds to achieve max yield
  TIME_MODERATE:        5.0,               // Seconds to achieve moderate yield
  
  YIELD_PERF_RATIONS:   [15, 30],
  YIELD_PERF_FUEL:      [8, 15],
  YIELD_PERF_PARTS:     [1, 3],
  
  YIELD_MOD_RATIONS:    [10, 20],
  YIELD_MOD_FUEL:       [3, 8],
  YIELD_MOD_PARTS:      [0, 1],
  
  YIELD_SLOW_RATIONS:   [0, 5],
  YIELD_SLOW_FUEL:      [0, 3],
  
  DMG_MINING_FAIL:      [10, 20],          // Hull dmg on wrong code input
  DMG_MINING_DEBRIS:    [1, 4],            // Guaranteed debris hull dmg on success
  DMG_COMBAT_MOD:       [4, 8],            // Enemy return fire if you are slow
  DMG_COMBAT_SLOW:      [8, 15],           // Heavy enemy return fire if very slow

  // -- Random Events --
  EVENT_CHANCE:         0.30,              // 30% chance for an event each turn
  EVT_METEOR_HULL:      [5, 15],           // Meteoroid hull damage
  EVT_FLARE_REACTOR:    [5, 15],           // Solar flare reactor damage
  EVT_FLARE_CREW_DMG:   2,                 // Solar flare crew health damage
  EVT_LEAK_RATIONS:     [10, 30],          // Stolen/leaked rations
  EVT_MADNESS_CREW_DMG: 1,                 // Space madness crew health damage
  EVT_SALVAGE_CHANCE:   0.70,              // 70% chance derelict is safe
  EVT_SALVAGE_FUEL:     [10, 30],
  EVT_SALVAGE_PARTS:    [1, 3],
  EVT_TRAP_HULL:        [10, 25],          // 30% derelict trap hull damage
  EVT_FLEE_CHANCE:      0.50,              // 50% chance to run from pirates
  EVT_FLEE_FUEL:        [10, 30],          // Fuel burned successfully fleeing
  EVT_PIRATE_HULL:      [15, 30],          // Hull dmg taken if fleeing fails
  EVT_PIRATE_RATIONS:   [10, 40],          // Loot lost if fleeing fails

  // -- Scoring --
  SCORE_PER_SURVIVOR:   1000,
  SCORE_PER_HULL_PCT:   10
};

// ═══════════════════════════════════════════════════════════════════════════
// ANSI GRAPHICS & ENUMS
// ═══════════════════════════════════════════════════════════════════════════

const ART_TITLE = [
  " ▀▀█▀▀ █  █ █▀▀   █▀▀ █  █ █▀▀█ █▀▀█ █▀▀█ █▀▀█   ▀▀█▀▀ █▀▀█ █▀▀█ ▀█▀ █   ",
  "   █   █▀▀█ █▀▀   █▀▀ █  █ █▄▄▀ █  █ █▄▄█ █▄▄█     █   █▄▄▀ █▄▄█  █  █   ",
  "   ▀   ▀  ▀ ▀▀▀   ▀▀▀ ▀▀▀▀ ▀ ▀▀ ▀▀▀▀ ▀    ▀  ▀     ▀   ▀ ▀▀ ▀  ▀ ▀▀▀ ▀▀▀ "
];

const ART_SHIP = [
  "                                       /\\",
  "                                      /  \\",
  "                                     /____\\",
  "                                    |  ██  |",
  "                                    |  ██  |",
  "                                   /|  ██  |\\",
  "                                  / |  ██  | \\",
  "                                 /  |  ██  |  \\",
  "                                |  /|__██__|\\  |",
  "                                | / /      \\ \\ |",
  "                                |/ /_█_██_█_\\ \\|",
  "                                ▀  |█|    |█|  ▀",
  "                                    ▀      ▀"
];

const ART_STATION = [
  "                           \\          _|_           /",
  "                            \\  ______|   |______   /",
  "                             \\|  (O)       (O)  | /",
  "                               ||_  _  _ _  _  _||",
  "                             / |  (O)       (O)  | \\",
  "                            /  |______|___|______|  \\",
  "                           /           | |           \\"
];

const ART_VICTORY = [
  "                                     .-----.       ",
  "                                 _.-'       '-._   ",
  "                               .'               '. ",
  "                              /                  \\",
  "                        _..._|                   |_..._",
  "                      .'     |                   |     '.",
  "                     /_______|___________________|_______\\"
];

const ART_SKULL = [
  "                                 ░░░░░░░░░░░",
  "                               ░░  ▒▒   ▒▒  ░░",
  "                              ░░  ▒▒▒   ▒▒▒  ░░",
  "                              ░░   ░░   ░░   ░░",
  "                               ░░    ▒▒▒    ░░",
  "                                 ░░░ ▒▒▒ ░░░",
  "                                  ░ █████ ░"
];

const TARGET_WORDS = ['ALPHA', 'BRAVO', 'DELTA', 'ECHO', 'NOVA', 'ORION', 'PULSAR', 'QUASAR', 'VOID'];
const CREW_HEALTH = ['DEAD', 'CRITICAL', 'POOR', 'FAIR', 'OPTIMAL'];

const STATIONS = [
  { dist: 0,   name: 'Lunar Gateway',       mult: 1.0 },
  { dist: 150, name: 'Mars Space Elevator', mult: 1.5 },
  { dist: 350, name: 'Ceres Mining Hub',    mult: 2.0 },
  { dist: 500, name: 'Callisto Relay',      mult: 2.5 },
  { dist: CFG.VICTORY_DIST, name: 'Europa Colony', mult: 0 } // Destination
];

class EuropaTrail extends GameBase {
  static get GAME_NAME()  { return 'europa-trail'; }
  static get GAME_TITLE() { return 'The Europa Trail'; }

  async run() {
    this.screen.setMode(Screen.SCROLL);
    this.terminal.hideCursor();

    while (true) {
      await this._showSplash();
      const wantInstr = await this._askYN('DO YOU NEED A MISSION BRIEFING?', true);
      if (wantInstr) await this._showInstructions();

      await this._playGame();
      
      this.terminal.println();
      const again = await this._askYN('  Sign up for another voyage?', false);
      if (!again) break;
    }

    this.terminal.showCursor();
    this.terminal.resetAttrs();
    this.terminal.clearScreen();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPLASH & INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async _showSplash() {
    const t = this.terminal;
    t.resetAttrs(); t.clearScreen(); t.moveTo(1,1);

    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println(CP437.BOX2_TL + CP437.BOX2_H.repeat(78) + CP437.BOX2_TR);

    t.setColor(C.BRIGHT_CYAN, C.BLACK);
    for (const line of ART_TITLE) {
      this._centerText(line, C.BRIGHT_CYAN);
    }
    t.println();
    for (const line of ART_SHIP) {
      t.println(line);
    }
    t.println();

    this._centerText('Earth to Europa  --  Year 2147', C.BRIGHT_YELLOW);
    this._centerText('A Deep Space Survival Simulation', C.DARK_GRAY);
    t.println();

    const msg = 'Press any key to initiate launch sequence...';
    t.setColor(C.BRIGHT_CYAN, C.BLACK, Attr.BLINK);
    this._centerText(msg, null, true);
    
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.resetAttrs();
    t.println(CP437.BOX2_BL + CP437.BOX2_H.repeat(78) + CP437.BOX2_BR);
    t.resetAttrs();

    await t.waitKey();
    t.clearScreen(); t.moveTo(1,1);
  }

  async _showInstructions() {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);

    this._sectionHeader('MISSION BRIEFING', C.BRIGHT_CYAN);
    t.println();

    const sections = [
      { hdr: 'THE VOYAGE & EVENTS', col: C.BRIGHT_YELLOW, text: [
        `You are commanding a colony ship bound for Europa (${CFG.VICTORY_DIST} Mkm).`,
        'Traveling and Mining both take time (weeks) and expose you to',
        'random deep space events like solar flares, meteoroids, and pirates.'
      ]},
      { hdr: 'RESOURCE MANAGEMENT', col: C.BRIGHT_CYAN, text: [
        'CREDITS : The currency of the solar system.',
        'FUEL    : He-3 Isotopes. Used to fly the ship and maneuver during mining.',
        'RATIONS : Consumed every week. Prevents crew starvation and disease.',
        'PARTS   : Crucial for repairing Hull, Reactor, and Life Support.'
      ]},
      { hdr: 'SHIP SYSTEMS', col: C.BRIGHT_GREEN, text: [
        'HULL         : Protects you from the void. If it hits 0, you die.',
        'REACTOR      : Powers the ship. If it fails, you are stranded.',
        'LIFE SUPPORT : Provides oxygen. If it fails, the crew suffocates rapidly.'
      ]},
      { hdr: 'ACTIONS & RISKS', col: C.BRIGHT_YELLOW, text: [
        'FLYING : Faster speeds burn more fuel and damage the reactor over time.',
        'MINING : Yields resources but takes time and exposes the hull to damage.',
      ]}
    ];

    const lines = [];
    for (const s of sections) {
      lines.push({ text: '  ' + CP437.ARROW_DBL_RIGHT + ' ' + s.hdr, color: s.col });
      for (const l of s.text) lines.push({ text: '      ' + l, color: C.WHITE });
      lines.push(null);
    }
    lines.push({ text: '  GOOD LUCK, COMMANDER.', color: C.BRIGHT_CYAN });
    lines.push(null);

    await this.terminal.pager(lines, { pageHeight: 20 });
    t.resetAttrs();
    t.print('  Press any key to continue...');
    await t.waitKey();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN GAME LOOP & STATE
  // ═══════════════════════════════════════════════════════════════════════════

  async _playGame() {
    this.s = {
      crew: [],
      prof: 0,
      profName: '',
      credits: 0,
      fuel: 0,
      rations: 0,
      parts: 0,
      hull: 100,
      reactor: 100,
      lifeSupport: 100,
      distance: 0,
      week: 1,
      pace: 1,      // 1: Cruising, 2: Accelerated, 3: Maximum Burn
      rationLv: 2,  // 1: Bare Minimum, 2: Standard, 3: Generous
      nextStationIdx: 1,
      dead: false,
      deathCause: ''
    };

    await this._setupPhase();
    if (this.s.dead) return;

    // Main loop
    while (this.s.distance < CFG.VICTORY_DIST && !this.s.dead) {
      await this._processTurn();
      if (this.s.dead) break;

      // Check arrival
      if (this.s.distance >= CFG.VICTORY_DIST) {
        await this._doVictory();
        const score = this.s.credits + (this._countAlive() * CFG.SCORE_PER_SURVIVOR) + this.s.hull * CFG.SCORE_PER_HULL_PCT;
        this.db?.saveScore(EuropaTrail.GAME_NAME, this.username, Math.floor(score));
        return;
      }

      // Check if at station
      const nextSt = STATIONS[this.s.nextStationIdx];
      if (nextSt && this.s.distance >= nextSt.dist) {
        this.s.distance = nextSt.dist; // Snap to station
        await this._doStation(nextSt);
        this.s.nextStationIdx++;
      }
    }

    if (this.s.dead) {
      await this._doFuneral(this.s.deathCause);
    }
  }

  async _setupPhase() {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);

    this._sectionHeader('COMMANDER PROFILE', C.BRIGHT_CYAN);
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('  What is your background?');
    t.println();
    
    const profs = [
      { id: 1, name: 'Corporate Banker',  desc: `Starts with ${CFG.START_CREDITS_BANKER} Credits.` },
      { id: 2, name: 'Chief Engineer',    desc: `Starts with ${CFG.START_CREDITS_OTHER} Credits, bonus repair skills.` },
      { id: 3, name: 'Veteran Pilot',     desc: `Starts with ${CFG.START_CREDITS_OTHER} Credits, uses less fuel.` }
    ];

    for (const p of profs) {
      t.setColor(C.BRIGHT_WHITE, C.BLACK); t.write(`   [${p.id}] `);
      t.setColor(C.BRIGHT_CYAN, C.BLACK);  t.write(p.name.padEnd(20));
      t.setColor(C.DARK_GRAY, C.BLACK);    t.println(p.desc);
    }
    t.println();

    let choice = 0;
    while (choice < 1 || choice > 3) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Select background (1-3): '); t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      choice = parseInt(line.trim());
      if (isNaN(choice)) choice = 0;
    }

    this.s.prof = choice;
    this.s.profName = profs[choice-1].name;
    this.s.credits = choice === 1 ? CFG.START_CREDITS_BANKER : CFG.START_CREDITS_OTHER;

    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('  Enter the names of your 5 crew members (including yourself).');
    for (let i = 0; i < 5; i++) {
      let name = '';
      while (!name) {
        t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(`  Crew ${i+1}: `); t.resetAttrs();
        name = (await t.readLine({maxLen:15})).trim();
      }
      this.s.crew.push({ name: name, health: 4, alive: true }); // 4 = Optimal
    }

    // Initial purchases
    await this._doStation(STATIONS[0], true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TURN LOGIC
  // ═══════════════════════════════════════════════════════════════════════════

  async _processTurn() {
    const t = this.terminal;
    
    // Status Screen
    t.clearScreen(); t.moveTo(1,1);
    this._dateDistanceHeader();
    this._showShipStatus();
    this._showCrewStatus();
    
    // Action Menu
    let action = 0;
    while (true) {
      t.println();
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.println('  COMMAND DIRECTIVE:');
      t.setColor(C.WHITE, C.BLACK);
      t.println('   [1] Engage Thrusters (Continue)');
      t.println('   [2] Adjust Flight Pace');
      t.println('   [3] Adjust Ration Output');
      t.println('   [4] Perform Ship Repairs');
      t.println('   [5] Tactical Asteroid Mining');
      t.println();
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Action: '); t.resetAttrs();
      
      const line = await t.readLine({maxLen:1});
      action = parseInt(line.trim());
      if (action >= 1 && action <= 5) break;
    }

    if (action === 1) {
      await this._advanceTime();
    } else if (action === 2) {
      await this._changePace();
    } else if (action === 3) {
      await this._changeRations();
    } else if (action === 4) {
      await this._repairShip();
    } else if (action === 5) {
      await this._miningMinigame();
    }
  }

  async _advanceTime() {
    const t = this.terminal;
    t.println();
    
    // Calculate costs
    let fuelBurn = CFG.PACE_FUEL_BURN[this.s.pace];
    if (this.s.prof === 3) fuelBurn = Math.floor(fuelBurn * CFG.PILOT_FUEL_MULT); 

    let distGain = CFG.PACE_DIST_BASE[this.s.pace];
    const variance = CFG.DIST_VARIANCE;
    distGain += Math.floor(Math.random() * (variance * 2 + 1)) - variance;
    
    const aliveCount = this._countAlive();
    let rationBurn = CFG.RATION_BURN_PER_CREW[this.s.rationLv] * aliveCount;

    // Check pre-requisites
    if (this.s.fuel < fuelBurn) {
      this._notice('INSUFFICIENT FUEL FOR THIS PACE. WE ARE DRIFTING.', C.BRIGHT_RED);
      distGain = 2; // Drift slightly
      fuelBurn = this.s.fuel; // Burn remaining
    }

    this.s.fuel -= fuelBurn;
    if (this.s.fuel < 0) this.s.fuel = 0;

    if (this.s.rations < rationBurn) {
      this._notice('INSUFFICIENT RATIONS. CREW IS STARVING.', C.BRIGHT_RED);
      rationBurn = this.s.rations;
      // Degrade health
      this.s.crew.forEach(c => { if (c.alive && Utils.chance(0.8)) c.health--; });
    } else {
      // Heal if rations high
      if (this.s.rationLv === 3) {
        this.s.crew.forEach(c => { if (c.alive && c.health < 4 && Utils.chance(0.4)) c.health++; });
      }
    }
    this.s.rations -= rationBurn;
    if (this.s.rations < 0) this.s.rations = 0;

    // Environmental degradation
    const R = (arr) => Utils.randInt(arr[0], arr[1]);

    if (this.s.pace === 3) {
      this.s.reactor -= R(CFG.WEAR_REACTOR_MAX);
      this.s.hull -= R(CFG.WEAR_HULL_MAX);
    } else {
      this.s.reactor -= R(CFG.WEAR_REACTOR_STD);
    }
    this.s.lifeSupport -= R(CFG.WEAR_LIFE_SUPP);

    // Life support check
    if (this.s.lifeSupport <= CFG.LS_CRIT_THRESHOLD) {
      this._notice('LIFE SUPPORT CRITICAL. OXYGEN LEVELS DROPPING.', C.BRIGHT_RED);
      this.s.crew.forEach(c => { if (c.alive && Utils.chance(0.5)) c.health--; });
    }

    // Apply distance & time
    this.s.distance += distGain;
    this.s.week++;

    // Random Event
    if (distGain > 2) {
      await this._randomEvent();
    }

    // Check Deaths
    this._checkCrewDeaths();
    this._checkShipFailure();

    if (!this.s.dead) {
      t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
      await t.waitKey();
    }
    t.println();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MENUS & ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async _changePace() {
    const t = this.terminal;
    t.println();
    this._sectionHeader('FLIGHT PACE', C.BRIGHT_CYAN);
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('   [1] Cruising       (Slow, uses very little fuel)');
    t.println('   [2] Accelerated    (Standard, moderate fuel use)');
    t.println('   [3] Maximum Burn   (Fast, burns massive fuel, reactor strain)');
    t.println();
    let p = 0;
    while(p < 1 || p > 3) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Select Pace (1-3): '); t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      p = parseInt(line.trim());
      if (isNaN(p)) p = 0;
    }
    this.s.pace = p;
    this._notice('Flight pace locked in.', C.BRIGHT_GREEN);
    await t.waitKey();
  }

  async _changeRations() {
    const t = this.terminal;
    t.println();
    this._sectionHeader('RATION OUTPUT', C.BRIGHT_CYAN);
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('   [1] Bare Minimum   (Saves rations, crew gets weaker)');
    t.println('   [2] Standard       (Normal consumption, maintains health)');
    t.println('   [3] Generous       (High consumption, helps crew recover)');
    t.println();
    let p = 0;
    while(p < 1 || p > 3) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Select Rations (1-3): '); t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      p = parseInt(line.trim());
      if (isNaN(p)) p = 0;
    }
    this.s.rationLv = p;
    this._notice('Ration output updated.', C.BRIGHT_GREEN);
    await t.waitKey();
  }

  async _repairShip() {
    const t = this.terminal;
    t.println();
    this._sectionHeader('SHIP REPAIRS', C.BRIGHT_YELLOW);
    t.println();
    if (this.s.parts <= 0) {
      this._notice('NO SPARE PARTS AVAILABLE.', C.BRIGHT_RED);
      await t.waitKey();
      return;
    }

    t.setColor(C.WHITE, C.BLACK);
    t.println(`  Spare Parts available: ${this.s.parts}`);
    const rBonus = this.s.prof === 2 ? CFG.ENG_REPAIR_PCT : CFG.BASE_REPAIR_PCT;
    t.println(`  Which system to repair? (1 part = +${rBonus}% to system)`);
    t.println();
    t.println(`   [1] Hull         (${this.s.hull}%)`);
    t.println(`   [2] Reactor      (${this.s.reactor}%)`);
    t.println(`   [3] Life Support (${this.s.lifeSupport}%)`);
    t.println('   [4] Cancel');
    t.println();

    let sys = 0;
    while(sys < 1 || sys > 4) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Selection (1-4): '); t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      sys = parseInt(line.trim());
      if (isNaN(sys)) sys = 0;
    }

    if (sys === 4) return;

    let amt = -1;
    while (amt < 0 || amt > this.s.parts) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Parts to use: '); t.resetAttrs();
      const line = await t.readLine({maxLen:3});
      amt = parseInt(line.trim());
      if (isNaN(amt)) amt = -1;
    }

    if (amt === 0) return;

    const boost = amt * rBonus;
    this.s.parts -= amt;
    
    if (sys === 1) this.s.hull = Math.min(100, this.s.hull + boost);
    if (sys === 2) this.s.reactor = Math.min(100, this.s.reactor + boost);
    if (sys === 3) this.s.lifeSupport = Math.min(100, this.s.lifeSupport + boost);

    this._notice(`Repairs complete. Applied +${boost}%.`, C.BRIGHT_GREEN);
    await t.waitKey();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MINIGAME: TACTICAL MINING
  // ═══════════════════════════════════════════════════════════════════════════

  async _miningMinigame(isCombat = false) {
    const t = this.terminal;
    const R = (arr) => Utils.randInt(arr[0], arr[1]);

    t.clearScreen(); t.moveTo(1,1);
    
    if (this.s.fuel < CFG.MINING_FUEL_COST) {
      this._notice('INSUFFICIENT FUEL FOR MANEUVERING.', C.BRIGHT_RED);
      await t.waitKey();
      return;
    }

    this.s.fuel -= CFG.MINING_FUEL_COST;

    // Time passes during this action
    this.s.week++;
    const aliveCount = this._countAlive();
    let rationBurn = CFG.RATION_BURN_PER_CREW[this.s.rationLv] * aliveCount;
    
    if (this.s.rations < rationBurn) {
      this._notice('INSUFFICIENT RATIONS DURING OPERATION. CREW STARVING.', C.BRIGHT_RED);
      rationBurn = this.s.rations;
      this.s.crew.forEach(c => { if (c.alive && Utils.chance(0.8)) c.health--; });
    } else if (this.s.rationLv === 3) {
      this.s.crew.forEach(c => { if (c.alive && c.health < 4 && Utils.chance(0.4)) c.health++; });
    }
    this.s.rations -= rationBurn;
    if (this.s.rations < 0) this.s.rations = 0;

    // Passive system wear while working
    this.s.reactor -= R(CFG.WEAR_REACTOR_STD);
    this.s.lifeSupport -= R(CFG.WEAR_LIFE_SUPP);

    if (this.s.lifeSupport <= CFG.LS_CRIT_THRESHOLD) {
      this._notice('LIFE SUPPORT CRITICAL. OXYGEN LEVELS DROPPING.', C.BRIGHT_RED);
      this.s.crew.forEach(c => { if (c.alive && Utils.chance(0.5)) c.health--; });
    }

    this._sectionHeader(isCombat ? 'TACTICAL COMBAT' : 'TACTICAL ASTEROID MINING', C.BRIGHT_YELLOW);
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println(isCombat ? '  Targeting enemy vessel. Laser banks armed.' : '  Targeting rogue asteroid. Laser banks armed.');
    t.println('  Enter the targeting code sequence as fast as possible!');
    t.println();

    const word = Utils.pick(TARGET_WORDS) + '-' + Utils.randInt(10000,99999);
    
    t.setColor(C.BRIGHT_RED, C.BLACK, Attr.BLINK);
    t.write('  >> TARGET LOCK: ');
    t.setColor(C.BRIGHT_WHITE, C.BLACK, Attr.BLINK); t.write(word);
    t.setColor(C.BRIGHT_RED, C.BLACK, Attr.BLINK); t.write(' <<');
    t.resetAttrs(); t.println('\n');

    t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Input Code: '); t.resetAttrs();

    const start = Date.now();
    const typed = (await t.readLine({maxLen:15})).trim().toUpperCase();
    const elapsed = (Date.now() - start) / 1000;

    t.println();
    if (typed !== word) {
      this._notice(isCombat ? 'TARGETING FAILURE! WEAPONS IMPACT!' : 'TARGETING FAILURE! MASSIVE DEBRIS IMPACT!', C.BRIGHT_RED);
      this.s.hull -= R(CFG.DMG_MINING_FAIL);
    } else {
      if (elapsed <= CFG.TIME_PERFECT) {
        this._notice('PERFECT STRIKE! MAXIMUM YIELD ACQUIRED.', C.BRIGHT_GREEN);
        this.s.rations += R(CFG.YIELD_PERF_RATIONS);
        this.s.fuel += R(CFG.YIELD_PERF_FUEL);
        this.s.parts += R(CFG.YIELD_PERF_PARTS);
      } else if (elapsed <= CFG.TIME_MODERATE) {
        this._notice('TARGET DESTROYED. MODERATE YIELD.', C.GREEN);
        if (isCombat) {
            this._notice('Enemy returned fire before exploding!', C.YELLOW);
            this.s.hull -= R(CFG.DMG_COMBAT_MOD);
        }
        this.s.rations += R(CFG.YIELD_MOD_RATIONS);
        this.s.fuel += R(CFG.YIELD_MOD_FUEL);
        this.s.parts += R(CFG.YIELD_MOD_PARTS);
      } else {
        this._notice('TARGET DESTROYED, BUT TOO SLOW. MINIMAL YIELD.', C.YELLOW);
        if (isCombat) {
            this._notice('Enemy landed heavy blows before exploding!', C.BRIGHT_RED);
            this.s.hull -= R(CFG.DMG_COMBAT_SLOW);
        }
        this.s.rations += R(CFG.YIELD_SLOW_RATIONS);
        this.s.fuel += R(CFG.YIELD_SLOW_FUEL);
      }

      // Inherent debris damage for mining
      if (!isCombat && typed === word) {
        this._notice('Asteroid shrapnel chips away at the hull.', C.DARK_GRAY);
        this.s.hull -= R(CFG.DMG_MINING_DEBRIS);
      }
    }

    if (!isCombat) {
      await this._randomEvent();
    }

    this._checkCrewDeaths();
    this._checkShipFailure();
    
    if (!this.s.dead && !isCombat) {
      t.println();
      t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to return to command...');
      await t.waitKey();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIONS / ECONOMY
  // ═══════════════════════════════════════════════════════════════════════════

  async _doStation(station, isInit = false) {
    const t = this.terminal;
    
    if (!isInit) {
      t.clearScreen(); t.moveTo(1,1);
      t.setColor(C.BRIGHT_CYAN, C.BLACK);
      for (const line of ART_STATION) {
        t.println(line);
      }
      t.println();
      this._centerText(`ARRIVED AT: ${station.name}`, C.BRIGHT_WHITE);
      t.println();
      t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to dock...');
      await t.waitKey();
    }

    const prices = {
      fuel:    Math.floor(CFG.PRICE_BASE_FUEL * station.mult),
      rations: Math.floor(CFG.PRICE_BASE_RATIONS * station.mult),
      parts:   Math.floor(CFG.PRICE_BASE_PARTS * station.mult),
      doc:     Math.floor(CFG.PRICE_BASE_DOC * station.mult)
    };

    const sellPrices = {
      fuel:    Math.max(1, Math.floor(prices.fuel * CFG.SELL_RATE_PCT)),
      rations: Math.max(1, Math.floor(prices.rations * CFG.SELL_RATE_PCT)),
      parts:   Math.max(1, Math.floor(prices.parts * CFG.SELL_RATE_PCT))
    };

    while (true) {
      t.clearScreen(); t.moveTo(1,1);
      this._sectionHeader(`MARKETPLACE: ${station.name}`, C.BRIGHT_YELLOW);
      t.println();
      
      t.setColor(C.WHITE, C.BLACK);
      t.println(`  Credits Available: $${this.s.credits}`);
      t.println();

      // Show current cargo
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.println('  CURRENT INVENTORY:');
      t.setColor(C.WHITE, C.BLACK);
      t.println(`    Fuel:    ${this.s.fuel}`);
      t.println(`    Rations: ${this.s.rations}`);
      t.println(`    Parts:   ${this.s.parts}`);
      t.println();

      t.setColor(C.BRIGHT_YELLOW, C.BLACK); t.println('  ITEMS FOR TRADE:');
      t.setColor(C.WHITE, C.BLACK);
      t.println(`   [1] Buy Fuel      ($${prices.fuel})  |  [4] Sell Fuel      (+$${sellPrices.fuel})`);
      t.println(`   [2] Buy Rations   ($${prices.rations})  |  [5] Sell Rations   (+$${sellPrices.rations})`);
      t.println(`   [3] Buy Parts     ($${prices.parts})  |  [6] Sell Parts     (+$${sellPrices.parts})`);
      t.println(`   [7] Doctor Visit  ($${prices.doc})`);
      t.println(`   [8] Return to Ship`);
      t.println();

      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Choice (1-8): '); t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      const choice = parseInt(line.trim());
      
      if (choice === 8) {
        if (isInit) {
          const ok = await this._askYN('Are you sure you are ready to depart?', true);
          if (ok) break;
        } else {
          break;
        }
      }

      // --- BUYING ---
      if (choice >= 1 && choice <= 3) {
        let item = '', cost = 0;
        if (choice===1) { item = 'Fuel Unit'; cost = prices.fuel; }
        if (choice===2) { item = 'Ration Pack'; cost = prices.rations; }
        if (choice===3) { item = 'Spare Part'; cost = prices.parts; }

        t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(`  How many ${item}s to BUY? `); t.resetAttrs();
        const qty = parseInt((await t.readLine({maxLen:4})).trim());
        if (isNaN(qty) || qty <= 0) continue;

        const total = qty * cost;
        if (total > this.s.credits) {
          this._notice('INSUFFICIENT CREDITS.', C.BRIGHT_RED);
          t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
          await t.waitKey();
        } else {
          this.s.credits -= total;
          if (choice===1) this.s.fuel += qty;
          if (choice===2) this.s.rations += qty;
          if (choice===3) this.s.parts += qty;
          this._notice(`Purchased ${qty} ${item}s for $${total}.`, C.BRIGHT_GREEN);
          t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
          await t.waitKey();
        }
      }

      // --- SELLING ---
      if (choice >= 4 && choice <= 6) {
        let item = '', yieldAmt = 0, currentQty = 0;
        if (choice===4) { item = 'Fuel Unit'; yieldAmt = sellPrices.fuel; currentQty = this.s.fuel; }
        if (choice===5) { item = 'Ration Pack'; yieldAmt = sellPrices.rations; currentQty = this.s.rations; }
        if (choice===6) { item = 'Spare Part'; yieldAmt = sellPrices.parts; currentQty = this.s.parts; }

        t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(`  How many ${item}s to SELL? (Max: ${currentQty}): `); t.resetAttrs();
        const qty = parseInt((await t.readLine({maxLen:4})).trim());
        if (isNaN(qty) || qty <= 0) continue;

        if (qty > currentQty) {
          this._notice('INSUFFICIENT INVENTORY.', C.BRIGHT_RED);
          t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
          await t.waitKey();
        } else {
          const total = qty * yieldAmt;
          this.s.credits += total;
          if (choice===4) this.s.fuel -= qty;
          if (choice===5) this.s.rations -= qty;
          if (choice===6) this.s.parts -= qty;
          this._notice(`Sold ${qty} ${item}s for $${total}.`, C.BRIGHT_GREEN);
          t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
          await t.waitKey();
        }
      }

      // --- DOCTOR ---
      if (choice === 7) {
        if (this.s.credits < prices.doc) {
          this._notice('INSUFFICIENT CREDITS FOR MEDICAL BAY.', C.BRIGHT_RED);
          t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
          await t.waitKey();
        } else {
          this.s.credits -= prices.doc;
          this.s.crew.forEach(c => { if (c.alive) c.health = 4; });
          this._notice('All living crew members treated and restored to Optimal health.', C.BRIGHT_GREEN);
          t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
          await t.waitKey();
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RANDOM EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  async _randomEvent() {
    const t = this.terminal;
    const R = (arr) => Utils.randInt(arr[0], arr[1]);

    if (!Utils.chance(CFG.EVENT_CHANCE)) return;

    t.println();
    this._sectionHeader('PROXIMITY ALERT', C.BRIGHT_YELLOW);
    t.println();

    const roll = Utils.randInt(1, 100);

    if (roll <= 15) {
      this._notice('MICROMETEOROID SHOWER!', C.BRIGHT_RED);
      this._notice('Hull sustained micro-fractures.', C.YELLOW);
      this.s.hull -= R(CFG.EVT_METEOR_HULL);
    } else if (roll <= 30) {
      this._notice('SOLAR FLARE EMISSION.', C.BRIGHT_RED);
      this._notice('Radiation shields overloaded. Reactor damaged, crew exposed.', C.YELLOW);
      this.s.reactor -= R(CFG.EVT_FLARE_REACTOR);
      const victim = Utils.pick(this.s.crew.filter(c => c.alive));
      if (victim) {
        victim.health -= CFG.EVT_FLARE_CREW_DMG;
        this._notice(`${victim.name} is suffering from severe radiation sickness.`, C.BRIGHT_RED);
      }
    } else if (roll <= 45) {
      this._notice('CONTAINMENT LEAK IN RATION STORAGE.', C.YELLOW);
      const loss = R(CFG.EVT_LEAK_RATIONS);
      this.s.rations -= loss;
      if (this.s.rations < 0) this.s.rations = 0;
      this._notice(`Lost ${loss} rations.`, C.YELLOW);
    } else if (roll <= 60) {
      this._notice('SPACE MADNESS.', C.YELLOW);
      const victim = Utils.pick(this.s.crew.filter(c => c.alive));
      if (victim) {
        victim.health -= CFG.EVT_MADNESS_CREW_DMG;
        this._notice(`${victim.name} is exhibiting psychological distress.`, C.YELLOW);
      }
    } else if (roll <= 75) {
      this._notice('NAVIGATION COMPUTER GLITCH.', C.YELLOW);
      this._notice('Lost time recalibrating telemetry vectors.', C.YELLOW);
      this.s.week += 1;
    } else if (roll <= 85) {
      this._notice('DERELICT FREIGHTER DETECTED.', C.BRIGHT_GREEN);
      const ok = await this._askYN('Send an EVA team to salvage?', true);
      if (ok) {
        if (Utils.chance(CFG.EVT_SALVAGE_CHANCE)) {
          const f = R(CFG.EVT_SALVAGE_FUEL);
          const p = R(CFG.EVT_SALVAGE_PARTS);
          this.s.fuel += f;
          this.s.parts += p;
          this._notice(`Salvage successful! Recovered ${f} fuel and ${p} parts.`, C.BRIGHT_GREEN);
        } else {
          this._notice('Booby trap! The derelict exploded!', C.BRIGHT_RED);
          this.s.hull -= R(CFG.EVT_TRAP_HULL);
        }
      }
    } else {
      this._notice('INTERCEPTED BY PIRATE CORSAIR!', C.BRIGHT_RED);
      const ok = await this._askYN('Attempt to flee? (Y) or Fight (N)', true);
      if (ok) {
        if (Utils.chance(CFG.EVT_FLEE_CHANCE)) {
          this._notice('Evasive maneuvers successful. Massive fuel burn.', C.BRIGHT_GREEN);
          this.s.fuel -= R(CFG.EVT_FLEE_FUEL);
          if (this.s.fuel < 0) this.s.fuel = 0;
        } else {
          this._notice('Failed to outrun them! Hull breached by weapons fire!', C.BRIGHT_RED);
          this.s.hull -= R(CFG.EVT_PIRATE_HULL);
          this.s.rations -= R(CFG.EVT_PIRATE_RATIONS);
          if (this.s.rations < 0) this.s.rations = 0;
        }
      } else {
        await this._miningMinigame(true); // Tactical combat
      }
    }
    t.println();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEATH & VICTORY
  // ═══════════════════════════════════════════════════════════════════════════

  _checkCrewDeaths() {
    for (const c of this.s.crew) {
      if (c.alive && c.health <= 0) {
        c.alive = false;
        c.health = 0;
        this._notice(`CREW MEMBER LOST: ${c.name} has died.`, C.BRIGHT_RED);
      }
    }
    // Commander is index 0
    if (!this.s.crew[0].alive) {
      this.s.dead = true;
      this.s.deathCause = 'COMMANDER K.I.A.';
    } else if (this._countAlive() === 0) {
      this.s.dead = true;
      this.s.deathCause = 'ENTIRE CREW DEAD';
    }
  }

  _checkShipFailure() {
    if (this.s.hull <= 0) {
      this.s.dead = true;
      this.s.deathCause = 'CATASTROPHIC HULL BREACH';
    } else if (this.s.reactor <= 0) {
      this.s.dead = true;
      this.s.deathCause = 'REACTOR CORE MELTDOWN';
    }
  }

  _countAlive() {
    return this.s.crew.filter(c => c.alive).length;
  }

  async _doFuneral(cause) {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);
    
    t.setColor(C.BRIGHT_RED, C.BLACK);
    for (const line of ART_SKULL) {
      t.println(line);
    }
    t.println();
    
    this._centerText('M I S S I O N   F A I L U R E', C.BRIGHT_WHITE);
    t.println();
    
    t.setColor(C.BRIGHT_RED, C.BLACK);
    t.println(CP437.BOX2_TL + CP437.BOX2_H.repeat(78) + CP437.BOX2_TR);
    this._centerText(`CAUSE OF DEATH: ${cause}`, C.BRIGHT_WHITE);
    t.setColor(C.BRIGHT_RED, C.BLACK);
    t.println(CP437.BOX2_BL + CP437.BOX2_H.repeat(78) + CP437.BOX2_BR);
    t.println();

    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('  Your ship joins the countless others drifting in the void.');
    t.println('  Earth Command has officially classified you as MIA.');
    t.println();

    t.resetAttrs();
    t.print('  Press any key to end transmission...');
    await t.waitKey();
  }

  async _doVictory() {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);
    
    t.setColor(C.BRIGHT_CYAN, C.BLACK);
    for (const line of ART_VICTORY) {
      this._centerText(line);
    }
    t.println();

    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println(CP437.BOX2_TL + CP437.BOX2_H.repeat(78) + CP437.BOX2_TR);
    this._centerText('W E L C O M E   T O   E U R O P A', C.BRIGHT_WHITE);
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println(CP437.BOX2_BL + CP437.BOX2_H.repeat(78) + CP437.BOX2_BR);
    t.println();

    t.setColor(C.BRIGHT_GREEN, C.BLACK);
    t.println(`  After ${this.s.week} weeks in the black, your ship breaches the ice crust`);
    t.println('  of Europa and docks with the sub-surface ocean colony.');
    t.println();

    const score = this.s.credits + (this._countAlive() * CFG.SCORE_PER_SURVIVOR) + this.s.hull * CFG.SCORE_PER_HULL_PCT;
    
    t.setColor(C.BRIGHT_CYAN, C.BLACK); t.println('  MISSION EVALUATION:');
    t.setColor(C.WHITE, C.BLACK);
    t.println(`    Crew Surviving : ${this._countAlive()}/5`);
    t.println(`    Hull Integrity : ${this.s.hull}%`);
    t.println(`    Credits Retained: $${this.s.credits}`);
    t.println();
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println(`    FINAL SCORE    : ${score}`);
    t.println();
    
    t.resetAttrs();
    t.print('  Press any key to end transmission...');
    await t.waitKey();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  _centerText(text, color, blink = false) {
    const t = this.terminal;
    const pad = Math.max(0, Math.floor((80 - text.length) / 2));
    if (color) t.setColor(color, C.BLACK, blink ? Attr.BLINK : undefined);
    t.println(' '.repeat(pad) + text);
  }

  _sectionHeader(title, color) {
    const t = this.terminal;
    const padLen = Math.max(2, 70 - title.length);
    t.setColor(color, C.BLACK);
    t.write('  ' + CP437.BOX2_TL + CP437.BOX2_H.repeat(2) + ' ');
    t.setColor(C.BRIGHT_WHITE, C.BLACK); t.write(title);
    t.setColor(color, C.BLACK);
    t.println(' ' + CP437.BOX2_H.repeat(padLen) + CP437.BOX2_TR);
    t.resetAttrs();
  }

  _dateDistanceHeader() {
    const t = this.terminal;
    const pct = Math.floor(Math.min(100, (this.s.distance / CFG.VICTORY_DIST) * 100));
    const title = `WEEK ${this.s.week.toString().padStart(2, '0')}  ||  DISTANCE: ${this.s.distance} Mkm (${pct}%)`;
    
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('  ' + CP437.BOX_TL + CP437.BOX_H.repeat(74) + CP437.BOX_TR);
    
    t.write('  ' + CP437.BOX_V);
    const pad = Math.floor((74 - title.length) / 2);
    t.setColor(C.BRIGHT_WHITE, C.BLACK);
    t.write(' '.repeat(pad) + title + ' '.repeat(74 - pad - title.length));
    t.setColor(C.DARK_GRAY, C.BLACK); t.println(CP437.BOX_V);
    
    // Progress Bar (74 wide)
    const filled = Math.floor((pct / 100) * 74);
    t.write('  ' + CP437.BOX_V);
    t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(CP437.FULL_BLOCK.repeat(filled));
    t.setColor(C.BLACK, C.DARK_GRAY);   t.write(' '.repeat(74 - filled));
    t.setColor(C.DARK_GRAY, C.BLACK);   t.println(CP437.BOX_V);

    t.println('  ' + CP437.BOX_BL + CP437.BOX_H.repeat(74) + CP437.BOX_BR);
    t.resetAttrs();
  }

  _showShipStatus() {
    const t = this.terminal;
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('  ' + CP437.BOX_TL + CP437.BOX_H.repeat(74) + CP437.BOX_TR);
    
    const printRow = (label1, val1, col1, label2, val2, col2) => {
      t.setColor(C.DARK_GRAY, C.BLACK); t.write('  ' + CP437.BOX_V + '  ');
      
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(label1.padEnd(14));
      t.setColor(col1, C.BLACK);          t.write(String(val1).padEnd(20));

      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(label2.padEnd(16));
      t.setColor(col2, C.BLACK);          t.write(String(val2).padEnd(22));

      t.setColor(C.DARK_GRAY, C.BLACK); t.println(CP437.BOX_V);
    };

    const hlColor = this.s.hull < 30 ? C.BRIGHT_RED : C.BRIGHT_GREEN;
    const rcColor = this.s.reactor < 30 ? C.BRIGHT_RED : C.BRIGHT_GREEN;
    const lsColor = this.s.lifeSupport < 30 ? C.BRIGHT_RED : C.BRIGHT_GREEN;

    const fuColor = this.s.fuel < 20 ? C.BRIGHT_RED : C.BRIGHT_WHITE;
    const raColor = this.s.rations < 20 ? C.BRIGHT_RED : C.BRIGHT_WHITE;

    printRow('HULL:', `${this.s.hull}%`, hlColor, 'FUEL (He3):', this.s.fuel, fuColor);
    printRow('REACTOR:', `${this.s.reactor}%`, rcColor, 'RATIONS:', this.s.rations, raColor);
    printRow('LIFE SUPP:', `${this.s.lifeSupport}%`, lsColor, 'PARTS:', this.s.parts, C.BRIGHT_WHITE);
    
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('  ' + CP437.BOX_BL + CP437.BOX_H.repeat(74) + CP437.BOX_BR);
    t.resetAttrs();
  }

  _showCrewStatus() {
    const t = this.terminal;
    t.println();
    
    let line = '  ';
    for (let i = 0; i < 5; i++) {
      const c = this.s.crew[i];
      let hStr = CREW_HEALTH[c.health];
      let col = C.BRIGHT_GREEN;
      if (c.health === 3) col = C.GREEN;
      if (c.health === 2) col = C.YELLOW;
      if (c.health === 1) col = C.BRIGHT_RED;
      if (c.health === 0) col = C.DARK_GRAY;

      t.setColor(C.WHITE, C.BLACK); t.write(`  ${c.name}: `);
      t.setColor(col, C.BLACK); t.write(hStr.padEnd(9));
      
      if (i === 2) { t.println(); t.write('  '); }
    }
    t.println();
  }

  _notice(msg, color) {
    const t = this.terminal;
    t.setColor(color || C.WHITE, C.BLACK);
    const safe = msg.length > 73 ? msg.substring(0, 73) : msg;
    t.println('  ' + CP437.ARROW_DBL_RIGHT + ' ' + safe);
    t.resetAttrs();
  }

  async _askYN(question, def) {
    const t = this.terminal;
    t.println();
    t.setColor(C.BRIGHT_CYAN, C.BLACK);
    t.println('  ' + CP437.BOX2_H.repeat(74));
    const pad = Math.floor((74 - question.length) / 2);
    t.setColor(C.BRIGHT_WHITE, C.BLACK);
    t.println('  ' + ' '.repeat(pad) + question);
    t.setColor(C.BRIGHT_CYAN, C.BLACK);
    t.println('  ' + CP437.BOX2_H.repeat(74));
    t.resetAttrs(); t.println();
    return t.askYesNo('  ', def);
  }
}

module.exports = EuropaTrail;