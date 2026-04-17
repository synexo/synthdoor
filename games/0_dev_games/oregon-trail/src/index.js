'use strict';
const path = require('path');

const { GameBase, Screen, Draw, Color, Attr, CP437 } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

// ─── Game dates (faithful to original, 19 biweekly turns) ───────────────────
const DATES = [
  'APRIL 12',     'APRIL 26',     'MAY 10',       'MAY 24',
  'JUNE 7',       'JUNE 21',      'JULY 5',        'JULY 19',
  'AUGUST 2',     'AUGUST 16',    'AUGUST 31',     'SEPTEMBER 13',
  'SEPTEMBER 27', 'OCTOBER 11',   'OCTOBER 25',    'NOVEMBER 8',
  'NOVEMBER 22',  'DECEMBER 6',   'DECEMBER 20',
];

// ─── Event probability thresholds (DATA line 3620 in original BASIC) ────────
const EVENT_THRESHOLDS = [6,11,13,15,17,22,32,35,37,42,44,54,64,69,95];

// ─── Shooting words ──────────────────────────────────────────────────────────
const SHOOT_WORDS = ['BANG', 'BLAM', 'POW', 'WHAM'];

const C = Color;

class OregonTrail extends GameBase {
  static get GAME_NAME()  { return 'oregon-trail'; }
  static get GAME_TITLE() { return 'The Oregon Trail'; }

  async run() {
    this.screen.setMode(Screen.SCROLL);
    this.terminal.hideCursor();

    await this._showSplash();
    const wantInstr = await this._askYN('DO YOU NEED INSTRUCTIONS?', true);
    if (wantInstr) await this._showInstructions();

    while (true) {
      await this._playGame();
      this.terminal.println();
      const again = await this.terminal.askYesNo('  Play again?', false);
      if (!again) break;
    }

    this.terminal.showCursor();
    this.terminal.resetAttrs();
    this.terminal.clearScreen();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPLASH SCREEN  (all content fits in 80 cols)
  // ═══════════════════════════════════════════════════════════════════════════
  async _showSplash() {
    const t = this.terminal;
    t.resetAttrs(); t.clearScreen(); t.moveTo(1,1);

    // W = 78: content between the two border chars (total line = 80)
    const W = 78;
    const dh=CP437.BOX2_H, dv=CP437.BOX2_V;
    const dtl=CP437.BOX2_TL, dtr=CP437.BOX2_TR;
    const dbl=CP437.BOX2_BL, dbr=CP437.BOX2_BR;

    // boxLine: print dv + exactly W chars of content + dv
    // Short content is padded; long content is clipped at W.
    const boxLine = (content, textColor) => {
      t.setColor(C.YELLOW, C.BLACK); t.write(dv);
      if (textColor) t.setColor(textColor, C.BLACK);
      const s = content.length <= W
        ? content + ' '.repeat(W - content.length)
        : content.substring(0, W);
      t.write(s);
      t.setColor(C.YELLOW, C.BLACK); t.println(dv);
    };

    // Outer border
    t.setColor(C.YELLOW, C.BLACK);
    t.println(dtl + dh.repeat(W) + dtr);
    boxLine('');

    // ── Logo: 5-row block font, "THE OREGON TRAIL" ─────────────────────
    // Pre-rendered rows — no per-character setColor calls.
    // Each row is exactly 78 chars (padded), written with a single setColor.
    // FULL_BLOCK (bright) and DARK_SHADE (dim) chars give a 2-tone effect.
    {
      const FB = CP437.FULL_BLOCK;  // █
      const DS = CP437.DARK_SHADE;  // ▓
      const FONT = {
        'T':['%%%','_^_','_^_','_^_','_^_'],
        'H':['%_%','%_%','%%%','%_%','%_%'],
        'E':['%%%','%__','%%_','%__','%%%'],
        ' ':['   ','   ','   ','   ','   '],
        'O':['_%%','%_%','%_%','%_%','_%%'],
        'R':['%%_','%_%','%%_','%^_','%_%'],
        'G':['_%%','%__','%_%','%_%','_%%'],
        'N':['%_%','%%_','%%%','_%%','%_%'],
        'A':['_^_','%_%','%%%','%_%','%_%'],
        'I':['%%%','_^_','_^_','_^_','%%%'],
        'L':['%__','%__','%__','%__','%%%'],
      };
      const TITLE = 'THE OREGON TRAIL';
      const titleW = TITLE.length * 4; // 64
      const padL = Math.floor((W - titleW) / 2);
      for (let row = 0; row < 5; row++) {
        let line = ' '.repeat(padL);
        for (const ch of TITLE) {
          const g = FONT[ch] || FONT[' '];
          const r = g[row];
          for (const px of r) line += px === '%' ? FB : (px === '^' ? DS : ' ');
          line += ' ';
        }
        // Clip/pad to exactly W chars
        if (line.length > W) line = line.substring(0, W);
        else if (line.length < W) line += ' '.repeat(W - line.length);
        // Write as single boxLine — ONE setColor call per row, no inner loops
        t.setColor(C.YELLOW, C.BLACK); t.write(dv);
        t.setColor(C.BRIGHT_YELLOW, C.BLACK);
        t.write(line);
        t.setColor(C.YELLOW, C.BLACK); t.println(dv);
      }
    }

    boxLine('');

    // ── Wagon art (original design, all lines ≤78 chars, padded by boxLine) ──
    const wagon = [
      "  ,-----.       _____                                                   ",
      " /|OREGON|\    /     \    ~~~ ~~~ ~~ ~ ~~~ ~~~ ~ ~ ~~ ~~~ ~~ ~ ~~~ ~~  ",
      "/ | TRAIL | \__/       \                                                ",
      "|_|_______|_/___________\                                                ",
      "      (O) (O) (O)       (O)                                              ",
    ];
    for (const row of wagon) boxLine(row, C.BRIGHT_WHITE);

    boxLine('');

    // Subtitle lines (centered in W chars, padded by boxLine)
    const sub1 = 'Independence, Missouri  to  Oregon City, Oregon  --  1847';
    const p1 = Math.floor((W - sub1.length) / 2);
    boxLine(' '.repeat(p1) + sub1, C.BRIGHT_CYAN);

    const sub2 = 'Original design by Bill Heinemann  *  MECC  *  1971';
    const p2 = Math.floor((W - sub2.length) / 2);
    boxLine(' '.repeat(p2) + sub2, C.DARK_GRAY);

    boxLine('');

    // Press-any-key line: blink via combined SGR (5=blink, 1=bold, 37=white)
    // Must NOT call setColor() after writeRaw blink-on, as setColor() resets attrs.
    const pk = 'Press any key to begin your journey...';
    const ppk = Math.floor((W - pk.length) / 2);
    t.setColor(C.YELLOW, C.BLACK); t.write(dv);
    const pkLine = ' '.repeat(ppk) + pk + ' '.repeat(W - ppk - pk.length);
    t.setColor(C.BRIGHT_WHITE, C.BLACK, Attr.BLINK);
    t.write(pkLine);
    t.resetAttrs();
    t.setColor(C.YELLOW, C.BLACK); t.println(dv);

    t.println(dbl + dh.repeat(W) + dbr);
    t.resetAttrs();

    await t.waitKey();
    t.clearScreen(); t.moveTo(1,1);
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // INSTRUCTIONS  (paged to fit 80x25 terminal)
  // ═══════════════════════════════════════════════════════════════════════════
  async _showInstructions() {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);

    this._sectionHeader('INSTRUCTIONS FOR THE OREGON TRAIL', C.BRIGHT_YELLOW);
    t.println();

    const sections = [
      { hdr:'THE JOURNEY', col:C.BRIGHT_YELLOW, text:[
        'This program simulates a trip over the Oregon Trail from Independence,',
        'Missouri to Oregon City, Oregon in 1847. Your family of five will cover',
        'the 2040 mile Oregon Trail in 5-6 months -- if you make it alive.',
      ]},
      { hdr:'YOUR BUDGET', col:C.BRIGHT_CYAN, text:[
        'You saved $900. After paying $200 for a wagon, you have $700 to spend.',
      ]},
      { hdr:'OXEN  ($200-$300)', col:C.BRIGHT_GREEN, text:[
        'The more you spend, the faster you\'ll travel.',
      ]},
      { hdr:'FOOD', col:C.BRIGHT_GREEN, text:[
        'More food means less chance of sickness.',
      ]},
      { hdr:'AMMUNITION  ($1 = 50 bullets)', col:C.BRIGHT_GREEN, text:[
        'Needed for animal attacks, bandit raids, and hunting.',
      ]},
      { hdr:'CLOTHING', col:C.BRIGHT_GREEN, text:[
        'Critical for cold weather when crossing the mountains.',
      ]},
      { hdr:'MISCELLANEOUS SUPPLIES', col:C.BRIGHT_GREEN, text:[
        'Medicine, repair parts, and emergency items.',
      ]},
      { hdr:'FORTS', col:C.BRIGHT_YELLOW, text:[
        'You can stop at forts to resupply, but prices are higher there.',
        'You get only 2/3 the value per dollar vs. your initial purchase.',
        'Stopping at a fort also costs you 45 miles of travel time.',
      ]},
      { hdr:'SHOOTING', col:C.BRIGHT_RED, text:[
        'When hunting or fighting, you must type a word quickly and hit ENTER.',
        'The faster you type it correctly, the better your result.',
        'Choose your skill level honestly -- higher skill = less time allowed.',
      ]},
    ];

    const instrLines = [];
    for (const s of sections) {
      instrLines.push({ text: '  ' + CP437.ARROW_DBL_RIGHT + ' ' + s.hdr, color: s.col });
      for (const l of s.text) instrLines.push({ text: '      ' + l, color: C.WHITE });
      instrLines.push(null);
    }
    instrLines.push({ text: '  GOOD LUCK!!!', color: C.BRIGHT_YELLOW });
    instrLines.push(null);
    await this.terminal.pager(instrLines, { pageHeight: 20 });

    t.resetAttrs();
    t.print('  Press any key to continue...');
    await t.waitKey();
    t.clearScreen(); t.moveTo(1,1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN GAME LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  async _playGame() {
    const t = this.terminal;

    // ── Shooting skill ────────────────────────────────────────────────────────
    t.clearScreen(); t.moveTo(1,1);
    this._sectionHeader('YOUR SHOOTING SKILL', C.BRIGHT_RED);
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('  How good a shot are you with your rifle?');
    t.println('  The better you claim, the faster you must respond when shooting.');
    t.println();
    // Use only ASCII dashes -- no em-dash, no CP437 issues
    const skillOpts = [
      [C.BRIGHT_GREEN,  '1', 'Ace Marksman      -- lightning fast draw'],
      [C.GREEN,         '2', 'Good Shot         -- quick on the trigger'],
      [C.BRIGHT_YELLOW, '3', "Fair to Middlin'  -- average speed"],
      [C.YELLOW,        '4', 'Need More Practice -- somewhat slow'],
      [C.BRIGHT_RED,    '5', 'Shaky Knees        -- very slow'],
    ];
    for (const [col,n,label] of skillOpts) {
      t.setColor(col, C.BLACK); t.write('     ');
      t.setColor(C.BRIGHT_WHITE, C.BLACK); t.write('['+n+'] ');
      t.setColor(col, C.BLACK); t.println(label);
    }
    t.println();

    let d9 = 0;
    while (d9<1||d9>5) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK);
      t.write('  Enter skill level (1-5): ');
      t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      d9 = parseInt(line.trim());
      if (isNaN(d9)||d9<1||d9>5) { d9=0; this._notice('Please enter 1-5', C.BRIGHT_RED); }
    }

    // ── Initial purchases ─────────────────────────────────────────────────────
    let purchases;
    while (true) {
      purchases = await this._doPurchases();
      if (purchases) break;
    }
    let { A, F, B, Cv, M1, T } = purchases;

    // ── Game state ────────────────────────────────────────────────────────────
    let M  = 0;   // total mileage
    let M2 = 0;   // mileage at turn start (victory calc)
    let D3 = 0;   // turn counter
    let S4 = 0;   // illness flag
    let K8 = 0;   // injury flag
    let M9 = 0;   // south pass display flag
    let F1 = 0;   // cleared south pass flag
    let F2 = 0;   // cleared blue mountains flag
    let X1 = -1;  // fort option alternation flag

    t.clearScreen(); t.moveTo(1,1);
    this._dateHeader('MONDAY  MARCH 29  1847');
    t.println();
    t.setColor(C.BRIGHT_GREEN, C.BLACK);
    t.println('  Your wagon rolls out of Independence, Missouri.');
    t.println('  The Oregon Trail stretches 2040 miles ahead of you...');
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('  After your purchases you have $'+Math.floor(T)+' dollars left.');
    t.println();
    t.print('  Press any key to hit the trail...');
    await t.waitKey();

    // ── Main game loop ─────────────────────────────────────────────────────────
    while (true) {
      if (M >= 2040) {
        await this._doVictory(M, M2, F, B, Cv, M1, T, D3);
        this.db?.saveScore(OregonTrail.GAME_NAME, this.username,
          Math.max(0, Math.floor(T + F + B/50 + Cv + M1)));
        return;
      }

      D3++;
      if (D3 > DATES.length) {
        t.clearScreen(); t.moveTo(1,1); this._deathHeader(); t.println();
        t.setColor(C.BRIGHT_RED, C.BLACK);
        t.println('  YOU HAVE BEEN ON THE TRAIL TOO LONG ------');
        t.println('  YOUR FAMILY DIES IN THE FIRST BLIZZARD OF WINTER');
        await this._doFuneral(t, 'EXPOSURE'); return;
      }

      const dateStr = 'MONDAY  '+DATES[D3-1]+'  1847';

      // Clamp negatives
      if (F<0) F=0; if (B<0) B=0; if (Cv<0) Cv=0; if (M1<0) M1=0;

      // Doctor bill
      t.clearScreen(); t.moveTo(1,1);
      this._dateHeader(dateStr);
      if (S4===1 || K8===1) {
        T -= 20;
        if (T<0) {
          this._showStatus(F,B,Cv,M1,0, M9?950:Math.floor(M));
          this._notice("YOU CAN'T AFFORD A DOCTOR", C.BRIGHT_RED);
          t.setColor(C.BRIGHT_RED, C.BLACK);
          t.println('  YOU DIED OF '+(K8===1?'INJURIES':'PNEUMONIA'));
          await this._doFuneral(t, K8===1?'INJURIES':'PNEUMONIA'); return;
        }
        this._showStatus(F,B,Cv,M1,T, M9?950:Math.floor(M));
        this._notice("DOCTOR'S BILL IS $20", C.BRIGHT_YELLOW);
        S4=0; K8=0;
      } else {
        this._showStatus(F,B,Cv,M1,T, M9?950:Math.floor(M));
      }
      M9=0;

      if (F<13) this._notice("YOU'D BETTER DO SOME HUNTING OR BUY FOOD AND SOON!!!!", C.BRIGHT_RED);

      // ── Turn choice ───────────────────────────────────────────────────────
      const fortAvail = (X1===1);
      let action = 3;
      while (true) {
        t.println();
        t.setColor(C.BRIGHT_CYAN, C.BLACK); t.println('  What do you want to do?');
        t.setColor(C.WHITE, C.BLACK);
        if (fortAvail) {
          t.println('   [1] Stop at the next fort');
          t.setColor(B>39?C.WHITE:C.DARK_GRAY, C.BLACK);
          t.println('   [2] Hunt');
          t.setColor(C.WHITE, C.BLACK);
          t.println('   [3] Continue on the trail');
          t.println();
          t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Choice: '); t.resetAttrs();
          const inp = await t.readLine({maxLen:1});
          const v = parseInt(inp.trim());
          if (v===1) { action=1; break; }
          if (v===2) {
            if (B<=39) { this._notice('TOUGH --- YOU NEED MORE BULLETS TO GO HUNTING', C.BRIGHT_RED); continue; }
            action=2; break;
          }
          if (v===3) { action=3; break; }
        } else {
          t.setColor(B>39?C.WHITE:C.DARK_GRAY, C.BLACK);
          t.println('   [1] Hunt');
          t.setColor(C.WHITE, C.BLACK);
          t.println('   [2] Continue on the trail');
          t.println();
          t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Choice: '); t.resetAttrs();
          const inp = await t.readLine({maxLen:1});
          const v = parseInt(inp.trim());
          if (v===1) {
            if (B<=39) { this._notice('TOUGH --- YOU NEED MORE BULLETS TO GO HUNTING', C.BRIGHT_RED); continue; }
            action=2; break;
          }
          if (v===2) { action=3; break; }
        }
      }

      X1 = X1 * -1;

      // ── Fort ──────────────────────────────────────────────────────────────
      if (action===1) {
        t.println();
        this._sectionHeader('FORT SUPPLY STORE', C.BRIGHT_YELLOW);
        this._notice('Items cost more at the fort (you get 2/3 value per dollar)', C.DARK_GRAY);
        t.println();
        t.setColor(C.WHITE, C.BLACK);
        t.println('  Cash available: $'+Math.floor(T));
        t.println();

        const fortBuy = async (label) => {
          while (true) {
            t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  '+label+': $'); t.resetAttrs();
            const line = await t.readLine({maxLen:5});
            const p = Math.max(0, parseInt(line.trim())||0);
            if (p>T) { this._notice("YOU DON'T HAVE THAT MUCH -- KEEP YOUR SPENDING DOWN", C.BRIGHT_RED); continue; }
            T -= p; return p;
          }
        };
        const pF = await fortBuy('Food');          F  += (2/3)*pF;
        const pB = await fortBuy('Ammunition');    B  += Math.floor((2/3)*pB*50);
        const pC = await fortBuy('Clothing');      Cv += (2/3)*pC;
        const pM = await fortBuy('Misc Supplies'); M1 += (2/3)*pM;
        M -= 45;
        action = 3;
      }

      // ── Hunting ───────────────────────────────────────────────────────────
      if (action===2) {
        M -= 45;
        t.println();
        this._sectionHeader('HUNTING', C.BRIGHT_GREEN);
        t.println();
        const b1 = await this._shootingMinigame(d9);
        if (b1<=1) {
          this._notice('RIGHT BETWEEN THE EYES --- YOU GOT A BIG ONE!!!!', C.BRIGHT_GREEN);
          this._notice('FULL BELLIES TONIGHT!', C.BRIGHT_GREEN);
          F += 52 + Math.random()*6; B -= 10 + Math.random()*4;
        } else if ((100+Math.random()) < 13*b1) {
          this._notice('YOU MISSED --- AND YOUR DINNER GOT AWAY.....', C.YELLOW);
        } else {
          this._notice("NICE SHOT -- RIGHT ON TARGET -- GOOD EATIN' TONIGHT!!", C.GREEN);
          F += 48 - 2*b1; B -= 10 + 3*b1;
        }
      }

      // Starvation check before eating
      if (F<13) {
        t.clearScreen(); t.moveTo(1,1); this._deathHeader(); t.println();
        t.setColor(C.BRIGHT_RED, C.BLACK);
        t.println('  YOU RAN OUT OF FOOD AND STARVED TO DEATH');
        await this._doFuneral(t,'STARVATION'); return;
      }

      // ── Eating ────────────────────────────────────────────────────────────
      let E = 0;
      while (true) {
        t.println();
        this._sectionHeader('MEAL TIME', C.BRIGHT_CYAN);
        t.println();
        t.setColor(C.WHITE, C.BLACK);
        t.println('  Do you want to eat:');
        t.println('   [1] Poorly      (-13 food, saves rations)');
        t.println('   [2] Moderately  (-18 food, normal meal)');
        t.println('   [3] Well        (-23 food, full feast)');
        t.println();
        t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Your choice: '); t.resetAttrs();
        const line = await t.readLine({maxLen:1});
        E = parseInt(line.trim());
        if (isNaN(E)||E<1||E>3) { E=0; continue; }
        const cost = 8+5*E;
        if (F-cost<0) { this._notice("YOU CAN'T EAT THAT WELL", C.BRIGHT_RED); E=0; continue; }
        F -= cost; break;
      }

      // Mileage advance
      M2 = M;
      M += 200 + (A-220)/5 + Math.random()*10;

      // Riders
      const riderThresh = ((M/100-4)**2+72)/((M/100-4)**2+12)-1;
      if (Math.random()*10 <= riderThresh) {
        const rr = await this._doRiders(t, d9, B, T, M, A, M1, K8);
        B=rr.B; T=rr.T; M=rr.M; A=rr.A; M1=rr.M1; K8=rr.K8;
        if (rr.died) { await this._doFuneral(t,'MASSACRE'); return; }
      }

      // Random event
      const er = await this._doEvent(t, d9, E, M, B, F, Cv, M1, T, A, K8, S4);
      B=er.B; F=er.F; Cv=er.Cv; M1=er.M1; T=er.T; A=er.A; K8=er.K8; S4=er.S4; M=er.M;
      if (er.died) { await this._doFuneral(t, er.deathCause||'PNEUMONIA'); return; }

      // Starvation after events
      if (F<0) {
        t.clearScreen(); t.moveTo(1,1); this._deathHeader(); t.println();
        t.setColor(C.BRIGHT_RED, C.BLACK);
        t.println('  YOU RAN OUT OF FOOD AND STARVED TO DEATH');
        await this._doFuneral(t,'STARVATION'); return;
      }

      // Mountain logic
      if (M>950) {
        const mr = await this._doMountains(t, M, F, B, Cv, M1, F1, F2, S4, K8);
        M=mr.M; F=mr.F; B=mr.B; Cv=mr.Cv; M1=mr.M1;
        F1=mr.F1; F2=mr.F2; S4=mr.S4; K8=mr.K8; M9=mr.M9;
        if (mr.died) { await this._doFuneral(t, mr.deathCause||'PNEUMONIA'); return; }
      }

      // Trail progress bar -- kept to max 78 chars
      // Layout: '  TRAIL [' (9) + 40 blocks + '] ' (2) + pct% (up to 4) + '  ' + miles label (up to 18) = max 75
      t.println();
      const safeMiles = Math.max(0, M);
      const pct = Math.min(100, Math.floor((safeMiles/2040)*100));
      const filled = Math.floor(pct/2*0.8); // scale to 40 blocks
      const barWidth = 40;
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  TRAIL [');
      t.setColor(C.BRIGHT_GREEN, C.BLACK); t.write(CP437.FULL_BLOCK.repeat(filled));
      t.setColor(C.DARK_GRAY, C.BLACK);   t.write(CP437.LIGHT_SHADE.repeat(barWidth-filled));
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('] ');
      t.setColor(C.BRIGHT_WHITE, C.BLACK); t.write(String(pct).padStart(3)+'%');
      t.setColor(C.DARK_GRAY, C.BLACK);
      // Miles label: '  (NNNN/2040 mi)' -- max 16 chars
      const miStr = '  ('+Math.floor(safeMiles)+'/2040 mi)';
      t.println(miStr);
      t.println();
      t.setColor(C.DARK_GRAY, C.BLACK); t.print('  Press any key to continue...');
      await t.waitKey();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIAL PURCHASES
  // ═══════════════════════════════════════════════════════════════════════════
  async _doPurchases() {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);

    this._sectionHeader('SUPPLY PURCHASES -- INDEPENDENCE, MO', C.BRIGHT_YELLOW);
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println('  You saved $900. After $200 for a wagon, you have');
    t.setColor(C.BRIGHT_YELLOW, C.BLACK); t.write('  $700 ');
    t.setColor(C.WHITE, C.BLACK); t.println('to spend on supplies:');
    t.println();

    // Info table -- inner content = 66 chars, box = 66+2 borders = 68, plus '  ' = 70 total
    // '  ' + BOX_TL + '-'*66 + BOX_TR = 2+1+66+1 = 70
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('  '+CP437.BOX_TL+CP437.BOX_H.repeat(66)+CP437.BOX_TR);
    const infoRow = (name, hint) => {
      t.setColor(C.DARK_GRAY, C.BLACK); t.write('  '+CP437.BOX_V+' ');
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write(name.padEnd(20));
      t.setColor(C.DARK_GRAY, C.BLACK);
      const h = hint.length > 44 ? hint.substring(0,44) : hint.padEnd(44);
      t.write(h+' ');
      t.println(CP437.BOX_V);
    };
    infoRow('OXEN TEAM',       '$200-$300  More spent = faster travel');
    infoRow('FOOD',            'any amount  More = less risk of illness');
    infoRow('AMMUNITION',      'any amount  $1 = 50 bullets');
    infoRow('CLOTHING',        'any amount  Critical in the mountains');
    infoRow('MISC SUPPLIES',   'any amount  Medicine and repair parts');
    t.println('  '+CP437.BOX_BL+CP437.BOX_H.repeat(66)+CP437.BOX_BR);
    t.println();

    const ask = async (label, min, max) => {
      while (true) {
        t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Spend on '+label+': $'); t.resetAttrs();
        const line = await t.readLine({maxLen:5});
        const v = parseInt(line.trim());
        if (isNaN(v)||v<0)    { this._notice('IMPOSSIBLE', C.BRIGHT_RED); continue; }
        if (min!=null&&v<min) { this._notice('NOT ENOUGH (minimum $'+min+')', C.BRIGHT_RED); continue; }
        if (max!=null&&v>max) { this._notice('TOO MUCH (maximum $'+max+')', C.BRIGHT_RED); continue; }
        return v;
      }
    };

    while (true) {
      const oxen  = await ask('Oxen team',    200, 300);
      const food  = await ask('Food',         0);
      const ammo  = await ask('Ammunition',   0);
      const cloth = await ask('Clothing',     0);
      const misc  = await ask('Misc supplies',0);

      const spent = oxen+food+ammo+cloth+misc;
      const rem   = 700-spent;

      if (rem<0) {
        t.println();
        t.setColor(C.BRIGHT_RED, C.BLACK);
        t.println('  YOU OVERSPENT -- YOU ONLY HAD $700 TO SPEND.  BUY AGAIN.');
        t.println(); continue;
      }

      // Summary box
      // Box is exactly 46 wide: '  ' + BOX_TL + '-'*42 + BOX_TR = 2+1+42+1 = 46
      // Row: '  ' + BOX_V + ' ' + label(20) + val(20) + ' ' + BOX_V = 2+1+1+20+20+1 = 46. Correct.
      t.println();
      t.setColor(C.BRIGHT_YELLOW, C.BLACK);
      t.println('  '+CP437.BOX_TL+CP437.BOX_H.repeat(42)+CP437.BOX_TR);
      const row = (label, val, col) => {
        t.setColor(C.BRIGHT_YELLOW, C.BLACK); t.write('  '+CP437.BOX_V+' ');
        t.setColor(col||C.WHITE, C.BLACK);
        // label up to 20 chars, value right-aligned in 20 chars, total = 40+2 spaces = 42
        const valStr = ('$'+Math.floor(val)).padStart(20);
        t.write(label.padEnd(20) + valStr + ' ');
        t.setColor(C.BRIGHT_YELLOW, C.BLACK); t.println(CP437.BOX_V);
      };
      row('Oxen team',      oxen,  C.BRIGHT_GREEN);
      row('Food',           food,  C.BRIGHT_GREEN);
      row('Ammunition',     ammo,  C.BRIGHT_GREEN);
      row('Clothing',       cloth, C.BRIGHT_GREEN);
      row('Misc supplies',  misc,  C.BRIGHT_GREEN);
      t.setColor(C.BRIGHT_YELLOW, C.BLACK);
      t.println('  '+CP437.BOX_L+CP437.BOX_H.repeat(42)+CP437.BOX_R);
      row('Cash remaining', rem,   C.BRIGHT_YELLOW);
      t.println('  '+CP437.BOX_BL+CP437.BOX_H.repeat(42)+CP437.BOX_BR);
      t.println();

      const ok = await t.askYesNo('  Confirm these purchases?', true);
      if (!ok) { t.println(); continue; }

      return { A:oxen, F:food, B:ammo*50, Cv:cloth, M1:misc, T:rem };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOOTING MINIGAME
  // ═══════════════════════════════════════════════════════════════════════════
  async _shootingMinigame(d9) {
    const t = this.terminal;
    const word = Utils.pick(SHOOT_WORDS);

    t.println();
    t.setColor(C.BRIGHT_RED, C.BLACK);
    t.println('  Your rifle is out!  Quick -- type the word and press ENTER:');
    t.println();
    // Use writeRaw for blink SGR to avoid any CP437 encoding of the ESC bytes
    t.writeRaw('\x1b[33;1m'); // bright yellow
    // setColor() with Attr.BLINK includes blink in the same SGR as the color,
    // so the implicit SGR 0 reset inside setColor() does NOT cancel the blink.
    t.setColor(C.BRIGHT_YELLOW, C.BLACK, Attr.BLINK); t.write('  >>> ');
    t.setColor(C.BRIGHT_WHITE,  C.BLACK, Attr.BLINK); t.write(word);
    t.setColor(C.BRIGHT_YELLOW, C.BLACK, Attr.BLINK); t.write(' <<<');
    t.resetAttrs(); // clears blink + color
    t.println();
    t.println();
    t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  >>> '); t.resetAttrs();

    const start = Date.now();
    const typed = (await t.readLine({maxLen:10})).trim().toUpperCase();
    const elapsed = (Date.now()-start)/1000;

    // Score: lower = better. Skill d9 gives bonus seconds.
    const bonus = (5-d9)*0.6;
    let b1 = Math.max(0, elapsed - bonus);
    if (typed!==word) b1=9;

    return b1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RIDERS ENCOUNTER
  // ═══════════════════════════════════════════════════════════════════════════
  async _doRiders(t, d9, B, T, M, A, M1, K8) {
    let died=false;
    let s5 = Math.random()<0.8 ? 0 : 1;
    if (Math.random()<=0.2) s5=1-s5; // possible flip (original line 2990)

    this._sectionHeader('RIDERS AHEAD', C.BRIGHT_RED);
    t.println();
    t.setColor(C.WHITE, C.BLACK); t.write('  Riders ahead.  They ');
    if (s5===1) { t.setColor(C.BRIGHT_GREEN, C.BLACK); t.write("DON'T "); }
    t.setColor(C.WHITE, C.BLACK); t.println('LOOK HOSTILE');
    t.println();
    t.setColor(C.BRIGHT_CYAN, C.BLACK); t.println('  TACTICS:');
    t.setColor(C.WHITE, C.BLACK);
    t.println('   [1] Run');
    t.println('   [2] Attack');
    t.println('   [3] Continue (hope for the best)');
    t.println('   [4] Circle wagons');
    t.println();

    let t1=0;
    while (t1<1||t1>4) {
      t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  Your tactic: '); t.resetAttrs();
      const line = await t.readLine({maxLen:1});
      t1 = parseInt(line.trim());
      if (isNaN(t1)||t1<1||t1>4) t1=0;
    }
    t.println();

    if (s5===0) { // hostile
      if (t1===1) { M+=20; M1-=15; B-=150; A-=40; }
      else if (t1===2) {
        const b1=await this._shootingMinigame(d9);
        B-=b1*40+80;
        if (b1<=1)      this._notice('NICE SHOOTING --- YOU DROVE THEM OFF', C.BRIGHT_GREEN);
        else if (b1<=4) this._notice('KINDA SLOW WITH YOUR COLT .45', C.YELLOW);
        else { this._notice('LOUSY SHOT --- YOU GOT KNIFED', C.BRIGHT_RED); this._notice("YOU HAVE TO SEE OL' DOC BLANCHARD", C.YELLOW); K8=1; }
      }
      else if (t1===3) {
        if (Math.random()<=0.8) { B-=150; M1-=15; }
        else this._notice('THEY DID NOT ATTACK', C.BRIGHT_GREEN);
      }
      else {
        const b1=await this._shootingMinigame(d9);
        B-=b1*30+80; M-=25;
        if (b1<=1)      this._notice('NICE SHOOTING --- YOU DROVE THEM OFF', C.BRIGHT_GREEN);
        else if (b1<=4) this._notice('KINDA SLOW WITH YOUR COLT .45', C.YELLOW);
        else { this._notice('LOUSY SHOT --- YOU GOT KNIFED', C.BRIGHT_RED); K8=1; }
      }
      this._notice('RIDERS WERE HOSTILE -- CHECK FOR LOSSES', C.BRIGHT_RED);
      if (B<0) { this._notice('YOU RAN OUT OF BULLETS AND GOT MASSACRED BY THE RIDERS', C.BRIGHT_RED); died=true; }
    } else { // friendly
      if (t1===1)      { M+=15; A-=10; }
      else if (t1===2) { M-=5; B-=100; }
      else if (t1===3) {}
      else             { M-=20; }
      this._notice('RIDERS WERE FRIENDLY, BUT CHECK FOR POSSIBLE LOSSES', C.BRIGHT_GREEN);
    }
    return {B,T,M,A,M1,K8,died};
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RANDOM EVENT SELECTION
  // ═══════════════════════════════════════════════════════════════════════════
  async _doEvent(t, d9, E, M, B, F, Cv, M1, T, A, K8, S4) {
    let died=false, deathCause=null, L1=0;
    const r1 = Math.random()*100;
    let eventId=16;
    for (let i=0;i<EVENT_THRESHOLDS.length;i++) {
      if (r1<=EVENT_THRESHOLDS[i]) { eventId=i+1; break; }
    }
    t.println();

    switch (eventId) {
      case 1:
        this._notice('WAGON BREAKS DOWN -- LOSE TIME AND SUPPLIES FIXING IT', C.YELLOW);
        M-=15+5*Math.random(); M1-=8; break;
      case 2:
        this._notice('OX INJURES LEG --- SLOWS YOU DOWN REST OF TRIP', C.YELLOW);
        M-=25; A-=20; break;
      case 3:
        this._notice("BAD LUCK --- YOUR DAUGHTER BROKE HER ARM", C.YELLOW);
        this._notice('YOU HAD TO STOP AND USE SUPPLIES TO MAKE A SLING', C.YELLOW);
        M-=5+4*Math.random(); M1-=2+3*Math.random(); break;
      case 4:
        this._notice('OX WANDERS OFF --- SPEND TIME LOOKING FOR IT', C.YELLOW);
        M-=17; break;
      case 5:
        this._notice('YOUR SON GETS LOST --- SPEND HALF THE DAY LOOKING FOR HIM', C.YELLOW);
        M-=10; break;
      case 6:
        this._notice('UNSAFE WATER -- LOSE TIME LOOKING FOR CLEAN SPRING', C.YELLOW);
        M-=10*Math.random()+2; break;
      case 7:
        if (M>950) {
          t.setColor(C.BRIGHT_CYAN, C.BLACK); t.write('  COLD WEATHER --- BRRRRRRR! --- YOU ');
          let coldSick=false;
          if (Cv<=22+4*Math.random()) { t.setColor(C.BRIGHT_RED, C.BLACK); t.write("DON'T "); coldSick=true; }
          t.setColor(C.BRIGHT_CYAN, C.BLACK); t.println('HAVE ENOUGH CLOTHING TO KEEP YOU WARM');
          if (coldSick) {
            const il=this._illnessCalc(E,M,M1,L1);
            ({M,M1,S4,L1,died,deathCause}=il);
          }
        } else {
          this._notice('HEAVY RAINS --- TIME AND SUPPLIES LOST', C.BRIGHT_CYAN);
          F-=10; B-=500; M1-=15; M-=10*Math.random()+5;
        }
        break;
      case 8: {
        this._notice('BANDITS ATTACK', C.BRIGHT_RED);
        const b1=await this._shootingMinigame(d9);
        B-=20*b1;
        if (B<0) { this._notice('YOU RAN OUT OF BULLETS --- THEY GET LOTS OF CASH', C.BRIGHT_RED); T=Math.floor(T/3); }
        else if (b1<=1) { this._notice('QUICKEST DRAW OUTSIDE OF DODGE CITY!!!', C.BRIGHT_GREEN); this._notice("YOU GOT 'EM!", C.BRIGHT_GREEN); }
        else { this._notice('YOU GOT SHOT IN THE LEG AND THEY TOOK ONE OF YOUR OXEN', C.BRIGHT_RED); this._notice('BETTER HAVE A DOC LOOK AT YOUR WOUND', C.YELLOW); K8=1; M1-=5; A-=20; }
        break;
      }
      case 9:
        this._notice('THERE WAS A FIRE IN YOUR WAGON -- FOOD AND SUPPLIES DAMAGE!', C.BRIGHT_RED);
        F-=40; B-=400; M1-=Math.random()*8+3; M-=15; break;
      case 10:
        this._notice('LOSE YOUR WAY IN HEAVY FOG --- TIME IS LOST', C.YELLOW);
        M-=10+5*Math.random(); break;
      case 11:
        this._notice('YOU KILLED A POISONOUS SNAKE AFTER IT BIT YOU', C.BRIGHT_RED);
        B-=10; M1-=5;
        if (M1<0) { this._notice('YOU DIE OF SNAKEBITE SINCE YOU HAVE NO MEDICINE', C.BRIGHT_RED); died=true; deathCause='SNAKEBITE'; }
        break;
      case 12:
        this._notice('WAGON GETS SWAMPED FORDING RIVER -- LOSE FOOD AND CLOTHES', C.BRIGHT_CYAN);
        F-=30; Cv-=20; M-=20+20*Math.random(); break;
      case 13: {
        this._notice('WILD ANIMALS ATTACK!', C.BRIGHT_RED);
        const b1=await this._shootingMinigame(d9);
        if (B<=39) { this._notice('YOU WERE TOO LOW ON BULLETS -- THE WOLVES OVERPOWERED YOU', C.BRIGHT_RED); K8=1; }
        else if (b1<=2) this._notice("NICE SHOOTIN' PARTNER --- THEY DIDN'T GET MUCH", C.BRIGHT_GREEN);
        else this._notice('SLOW ON THE DRAW --- THEY GOT AT YOUR FOOD AND CLOTHES', C.YELLOW);
        B-=20*b1; Cv-=b1*4; F-=b1*8; break;
      }
      case 14:
        this._notice('HAIL STORM --- SUPPLIES DAMAGED', C.BRIGHT_CYAN);
        M-=5+Math.random()*10; B-=200; M1-=4+Math.random()*3; break;
      case 15: {
        const il=this._illnessCalc(E,M,M1,L1);
        ({M,M1,S4,L1,died,deathCause}=il); break;
      }
      default:
        this._notice('HELPFUL INDIANS SHOW YOU WHERE TO FIND MORE FOOD', C.BRIGHT_GREEN);
        F+=14; break;
    }
    return {M,B,F,Cv,M1,T,A,K8,S4,died,deathCause};
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ILLNESS CALC (lines 6300-6460)
  // ═══════════════════════════════════════════════════════════════════════════
  _illnessCalc(E, M, M1, L1) {
    let S4=0, died=false, deathCause=null;
    if (100*Math.random() < 10+35*(E-1)) {
      this._notice('WILD ILLNESS --- MEDICINE USED', C.YELLOW);
      M-=5; M1-=2;
    } else if (100*Math.random() < 100-(40/4**(E-1))) {
      this._notice('SERIOUS ILLNESS ---', C.BRIGHT_RED);
      this._notice('YOU MUST STOP FOR MEDICAL ATTENTION', C.BRIGHT_RED);
      M1-=10; S4=1;
    } else {
      this._notice('BAD ILLNESS --- MEDICINE USED', C.BRIGHT_RED);
      M-=5; M1-=5;
    }
    if (M1<0) { this._notice('YOU RAN OUT OF MEDICAL SUPPLIES', C.BRIGHT_RED); died=true; deathCause='PNEUMONIA'; }
    return {M,M1,S4,L1,died,deathCause};
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUNTAIN LOGIC
  // ═══════════════════════════════════════════════════════════════════════════
  async _doMountains(t, M, F, B, Cv, M1, F1, F2, S4, K8) {
    let M9=0, L1=0, died=false, deathCause=null;
    const threshold = 9-((M/100-15)**2+72)/((M/100-15)**2+12);
    if (Math.random()*10>threshold) {
      t.println();
      this._sectionHeader('RUGGED MOUNTAINS', C.BRIGHT_YELLOW);
      t.println();
      const roll=Math.random();
      if (roll<=0.1) { this._notice('YOU GOT LOST --- LOSE VALUABLE TIME TRYING TO FIND TRAIL!', C.YELLOW); M-=60; }
      else if (roll<=0.21) { this._notice('WAGON DAMAGED! --- LOSE TIME AND SUPPLIES', C.BRIGHT_RED); M1-=5; B-=200; M-=20+30*Math.random(); }
      else { this._notice('THE GOING GETS SLOW', C.YELLOW); M-=45+Math.random()/0.02; }
    }
    if (F1!==1) {
      F1=1;
      if (Math.random()>=0.8) {
        t.println();
        this._notice('BLIZZARD IN MOUNTAIN PASS -- TIME AND SUPPLIES LOST', C.BRIGHT_CYAN);
        L1=1; F-=25; M1-=10; B-=300; M-=30+40*Math.random();
        if (Cv<18+2*Math.random()) {
          const il=this._illnessCalc(1,M,M1,L1);
          M=il.M; M1=il.M1; S4=il.S4; died=il.died; deathCause=il.deathCause;
          if (died) return {M,F,B,Cv,M1,F1,F2,S4,K8,M9,died,deathCause};
        }
      } else {
        this._notice('YOU MADE IT SAFELY THROUGH SOUTH PASS -- NO SNOW', C.BRIGHT_GREEN);
      }
    }
    if (M>=1700 && F2!==1) {
      F2=1;
      if (Math.random()>=0.7) {
        t.println();
        this._notice('BLIZZARD IN MOUNTAIN PASS -- TIME AND SUPPLIES LOST', C.BRIGHT_CYAN);
        L1=1; F-=25; M1-=10; B-=300; M-=30+40*Math.random();
        if (Cv<18+2*Math.random()) {
          const il=this._illnessCalc(1,M,M1,L1);
          M=il.M; M1=il.M1; S4=il.S4; died=il.died; deathCause=il.deathCause;
          if (died) return {M,F,B,Cv,M1,F1,F2,S4,K8,M9,died,deathCause};
        }
      }
    }
    if (M<=950) M9=1;
    return {M,F,B,Cv,M1,F1,F2,S4,K8,M9,died,deathCause};
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VICTORY SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  async _doVictory(M, M2, F, B, Cv, M1, T, D3) {
    const t = this.terminal;
    t.clearScreen(); t.moveTo(1,1);
    const dh=CP437.BOX2_H, dv=CP437.BOX2_V;
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println(CP437.BOX2_TL+dh.repeat(78)+CP437.BOX2_TR);
    const vlines=['',' YOU FINALLY ARRIVED AT OREGON CITY',' AFTER 2040 LONG MILES --- HOORAY!!!!!',' A REAL PIONEER!',''];
    for (const l of vlines) {
      t.write(dv);
      t.setColor(C.BRIGHT_WHITE, C.BLACK);
      const p=Math.floor((78-l.length)/2);
      t.write(' '.repeat(Math.max(0,p))+l+' '.repeat(Math.max(0,78-Math.max(0,p)-l.length)));
      t.setColor(C.BRIGHT_YELLOW, C.BLACK); t.println(dv);
    }
    t.println(CP437.BOX2_BL+dh.repeat(78)+CP437.BOX2_BR);
    t.println();

    // Arrival date calc
    const denom = M-M2;
    const f9Raw = denom>0 ? (2040-M2)/denom : 1;
    const f9Days = Math.max(0, Math.floor(f9Raw*14));
    let totalDays = D3*14+f9Days;
    let dow = ((f9Days)%7)+1;
    const DOW=['','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];
    const months=[{n:'JULY',b:93},{n:'AUGUST',b:124},{n:'SEPTEMBER',b:155},{n:'OCTOBER',b:185},{n:'NOVEMBER',b:216},{n:'DECEMBER',b:246}];
    let mname='JULY', dnum=totalDays-93;
    for (let i=0;i<months.length;i++) {
      const mo=months[i], nx=months[i+1];
      if (totalDays>mo.b && (!nx||totalDays<=nx.b)) { mname=mo.n; dnum=totalDays-mo.b; break; }
    }
    t.setColor(C.BRIGHT_CYAN, C.BLACK);
    t.println('  You arrived: '+(DOW[dow]||'MONDAY')+', '+mname+' '+Math.max(1,dnum)+' 1847');
    t.println();

    // Final supplies box -- 42 wide
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println('  '+CP437.BOX_TL+CP437.BOX_H.repeat(42)+CP437.BOX_TR);
    const fr=(label,val)=>{
      t.setColor(C.BRIGHT_YELLOW,C.BLACK); t.write('  '+CP437.BOX_V+' ');
      t.setColor(C.WHITE,C.BLACK); t.write((label+':').padEnd(20));
      t.setColor(C.BRIGHT_GREEN,C.BLACK); t.write(String(Math.max(0,Math.floor(val))).padStart(10));
      t.setColor(C.BRIGHT_YELLOW,C.BLACK); t.println('  '+CP437.BOX_V);
    };
    fr('Food',F); fr('Bullets',B); fr('Clothing',Cv); fr('Misc Supplies',M1); fr('Cash ($)',T);
    t.println('  '+CP437.BOX_BL+CP437.BOX_H.repeat(42)+CP437.BOX_BR);
    t.println();

    t.setColor(C.BRIGHT_WHITE, C.BLACK);
    t.println('         PRESIDENT JAMES K. POLK SENDS YOU HIS');
    t.println('               HEARTIEST CONGRATULATIONS');
    t.println();
    t.println('         AND WISHES YOU A PROSPEROUS LIFE AHEAD');
    t.println();
    t.println('                    AT YOUR NEW HOME');
    t.println();
    t.resetAttrs();
    t.print('  Press any key to continue...');
    await t.waitKey();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEATH / FUNERAL
  // ═══════════════════════════════════════════════════════════════════════════
  async _doFuneral(t, cause) {
    t.println();
    t.setColor(C.BRIGHT_RED, C.BLACK);
    // Skull using only CP437-safe shade chars
    const sl=CP437.LIGHT_SHADE, sm=CP437.MEDIUM_SHADE, sf=CP437.FULL_BLOCK;
    t.println('');
    t.println('                        '+sl.repeat(11));
    t.println('                      '+sl+'  '+sm+sm+'   '+sm+sm+'  '+sl);
    t.println('                     '+sl+'  '+sm+sm+sm+'   '+sm+sm+sm+'  '+sl);
    t.println('                     '+sl+'   '+sl+sl+'   '+sl+sl+'   '+sl);
    t.println('                      '+sl+'    '+sm.repeat(4)+'    '+sl);
    t.println('                       '+sl+sl+sl+' '+sm+sm+sm+' '+sl+sl+sl);
    t.println('                        '+sl+' '+sf.repeat(5)+' '+sl);
    t.println('');
    t.setColor(C.BRIGHT_WHITE, C.BLACK);
    t.println('  DUE TO YOUR UNFORTUNATE SITUATION, THERE ARE A FEW');
    t.println('  FORMALITIES WE MUST GO THROUGH');
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.print('  Would you like a minister? ');
    await t.readLine({maxLen:3});
    t.print('  Would you like a fancy funeral? ');
    await t.readLine({maxLen:3});
    t.write('  Would you like us to inform your next of kin? ');
    const kin=(await t.readLine({maxLen:3})).trim().toUpperCase();
    t.println();
    if (kin==='YES') {
      t.setColor(C.WHITE, C.BLACK);
      t.println('  That will be $4.50 for the telegraph charge.');
    } else {
      t.setColor(C.YELLOW, C.BLACK);
      t.println('  But your Aunt Sadie in St. Louis is really worried about you.');
    }
    t.println();
    t.setColor(C.WHITE, C.BLACK);
    t.println("  We thank you for this information and we are sorry you");
    t.println("  didn't make it to the great territory of Oregon.");
    t.println('  Better luck next time.');
    t.println();
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('                              Sincerely,');
    t.println();
    t.println('                   The Oregon City Chamber of Commerce');
    t.println();
    t.resetAttrs();
    t.print('  Press any key to continue...');
    await t.waitKey();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  _sectionHeader(title, color) {
    const t=this.terminal;
    // Total width: '  ' + TL + '--' + ' ' + title + ' ' + '--...' + TR
    // = 2 + 1 + 2 + 1 + title + 1 + pad + 1 = 8 + title + pad
    // Want total = 78: pad = 78 - 8 - title.length = 70 - title.length
    const padLen = Math.max(2, 70-title.length);
    t.setColor(color, C.BLACK);
    t.write('  '+CP437.BOX2_TL+CP437.BOX2_H.repeat(2)+' ');
    t.setColor(C.BRIGHT_WHITE, C.BLACK); t.write(title);
    t.setColor(color, C.BLACK);
    t.println(' '+CP437.BOX2_H.repeat(padLen)+CP437.BOX2_TR);
    t.resetAttrs();
  }

  _dateHeader(dateStr) {
    const t=this.terminal;
    // Total: '  ' + TL + '-'*74 + TR = 2+1+74+1 = 78
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println('  '+CP437.BOX_TL+CP437.BOX_H.repeat(74)+CP437.BOX_TR);
    const pad=Math.floor((74-dateStr.length)/2);
    t.write('  '+CP437.BOX_V);
    t.setColor(C.BRIGHT_WHITE, C.BLACK);
    t.write(' '.repeat(pad)+dateStr+' '.repeat(74-pad-dateStr.length));
    t.setColor(C.BRIGHT_YELLOW, C.BLACK); t.println(CP437.BOX_V);
    t.println('  '+CP437.BOX_BL+CP437.BOX_H.repeat(74)+CP437.BOX_BR);
    t.resetAttrs();
  }

  _deathHeader() {
    const t=this.terminal;
    t.setColor(C.BRIGHT_RED, C.BLACK);
    t.println('  '+CP437.BOX2_TL+CP437.BOX2_H.repeat(74)+CP437.BOX2_TR);
    const msg='YOU HAVE DIED';
    const pad=Math.floor((74-msg.length)/2);
    t.write('  '+CP437.BOX2_V);
    t.setColor(C.BRIGHT_WHITE, C.BLACK, Attr.BLINK);
    t.write(' '.repeat(pad)+msg+' '.repeat(74-pad-msg.length));
    t.resetAttrs();
    t.setColor(C.BRIGHT_RED, C.BLACK); t.println(CP437.BOX2_V);
    t.println('  '+CP437.BOX2_BL+CP437.BOX2_H.repeat(74)+CP437.BOX2_BR);
    t.resetAttrs();
  }

  _showStatus(F, B, Cv, M1, T, miles) {
    const t=this.terminal;
    t.println();
    // Box: '  ' + TL + '-'*54 + TR = 2+1+54+1 = 58
    t.setColor(C.DARK_GRAY, C.BLACK);
    t.println('  '+CP437.BOX_TL+CP437.BOX_H.repeat(54)+CP437.BOX_TR);
    // Row: '  ' + V + ' ' + label(16) + val(10) + ' ' + unit(6) + '  ' + V = 2+1+1+16+10+1+6+2+1 = 40. Hmm.
    // Let's make it: 2+1+1 + 16 + 12 + 1 + 6 + ... actually: inner = 54
    // Row = '  V ' + label(18) + val(12) + unit(6) + ' V' => V+sp+18+12+6+sp+V = 1+1+18+12+6+1+1=40. Not 54.
    // Simpler: inner = 52 chars + 2 border = 54. Row inner: ' '+label(16)+val(12)+' '+unit(8)+' ' = 1+16+12+1+8+1=39. Pad rest.
    const sr=(label,val,unit,col)=>{
      t.setColor(C.DARK_GRAY,C.BLACK); t.write('  '+CP437.BOX_V+' ');
      t.setColor(C.WHITE,C.BLACK);     t.write(label.padEnd(16));
      t.setColor(col,C.BLACK);
      const v=String(Math.max(0,Math.floor(val)));
      t.write(v.padStart(10));
      t.setColor(C.DARK_GRAY,C.BLACK);
      const u=(' '+(unit||'')).padEnd(8);
      // total so far: 1+1+16+10+8 = 36, need 54: pad 18 more
      t.write(u+'                  ');
      t.println(CP437.BOX_V);
    };
    sr('Miles traveled', miles,'miles', C.BRIGHT_CYAN);
    sr('Food',           F,    'lbs',   F<20?C.BRIGHT_RED:C.BRIGHT_GREEN);
    sr('Bullets',        B,    '',      B<50?C.BRIGHT_RED:C.BRIGHT_WHITE);
    sr('Clothing',       Cv,   '$',     Cv<15?C.BRIGHT_RED:C.BRIGHT_WHITE);
    sr('Misc supplies',  M1,   '$',     M1<5?C.BRIGHT_RED:C.BRIGHT_WHITE);
    sr('Cash',           T,    '$',     C.BRIGHT_YELLOW);
    t.setColor(C.DARK_GRAY,C.BLACK);
    t.println('  '+CP437.BOX_BL+CP437.BOX_H.repeat(54)+CP437.BOX_BR);
    t.println(); t.resetAttrs();
  }

  _notice(msg, color) {
    const t=this.terminal;
    t.setColor(color||C.WHITE, C.BLACK);
    // Clamp to 76 chars: '  >> ' (5) + msg = 5+76 = 81 max. Trim msg to 73.
    const safe = msg.length > 73 ? msg.substring(0,73) : msg;
    t.println('  '+CP437.ARROW_DBL_RIGHT+' '+safe);
    t.resetAttrs();
  }

  async _askYN(question, def) {
    const t=this.terminal;
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println('  '+CP437.BOX2_H.repeat(74));
    const pad=Math.floor((74-question.length)/2);
    t.setColor(C.BRIGHT_WHITE, C.BLACK);
    t.println('  '+' '.repeat(pad)+question);
    t.setColor(C.BRIGHT_YELLOW, C.BLACK);
    t.println('  '+CP437.BOX2_H.repeat(74));
    t.resetAttrs(); t.println();
    return t.askYesNo('  ', def);
  }
}

module.exports = OregonTrail;
