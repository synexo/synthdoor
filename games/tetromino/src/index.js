/**
 * games/tetromino/src/index.js
 * SynthDoor Tetromino
 *
 * Full-screen ANSI/CP437 Tetromino for 80x25 terminal.
 * Features:
 *   - 7-Bag randomizer (Official standard)
 *   - Ghost piece (shows where piece will land)
 *   - Hold piece & Next piece preview
 *   - 500ms Lock Delay (allows sliding pieces at high speeds)
 *   - Simplified SRS wall kicks
 *   - Level progression (Official Guideline exponential speed curve)
 *   - Scoring: Singles, Doubles, Triples, Tetris + Back-to-Back bonuses + Drop points
 *   - Persistent high score table via SQLite
 *   - Full CP437 block graphics
 *   - ANSI music (optional) — plays a simple tune during gameplay
 */

'use strict';

const { GameBase, Screen, Draw, Color, CP437 } = require(require('path').join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js'));

// ─── Tetromino definitions ────────────────────────────────────────────────
// Each piece: array of 4 rotations, each rotation is array of [col, row] offsets
const PIECES = {
  I: {
    color: Color.BRIGHT_CYAN,
    rotations: [
      [[0,1],[1,1],[2,1],[3,1]],
      [[2,0],[2,1],[2,2],[2,3]],
      [[0,2],[1,2],[2,2],[3,2]],
      [[1,0],[1,1],[1,2],[1,3]],
    ],
  },
  O: {
    color: Color.BRIGHT_YELLOW,
    rotations: [
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
    ],
  },
  T: {
    color: Color.BRIGHT_MAGENTA,
    rotations: [
      [[1,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[2,1],[1,2]],
      [[1,0],[0,1],[1,1],[1,2]],
    ],
  },
  S: {
    color: Color.BRIGHT_GREEN,
    rotations: [
      [[1,0],[2,0],[0,1],[1,1]],
      [[1,0],[1,1],[2,1],[2,2]],
      [[1,1],[2,1],[0,2],[1,2]],
      [[0,0],[0,1],[1,1],[1,2]],
    ],
  },
  Z: {
    color: Color.BRIGHT_RED,
    rotations: [
      [[0,0],[1,0],[1,1],[2,1]],
      [[2,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[1,2],[2,2]],
      [[1,0],[0,1],[1,1],[0,2]],
    ],
  },
  J: {
    color: Color.BRIGHT_BLUE,
    rotations: [
      [[0,0],[0,1],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[1,2]],
      [[0,1],[1,1],[2,1],[2,2]],
      [[1,0],[1,1],[0,2],[1,2]],
    ],
  },
  L: {
    color: Color.BRIGHT_WHITE,
    rotations: [
      [[2,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,1],[0,2]],
      [[0,0],[1,0],[1,1],[1,2]],
    ],
  },
};

const PIECE_NAMES = Object.keys(PIECES);

// Board dimensions (in cells — each cell is 2 chars wide for square appearance)
const BOARD_W = 10;
const BOARD_H = 20;

// Screen layout (in terminal columns/rows)
const BOARD_LEFT   = 31;  // column where board starts
const BOARD_TOP    = 3;   // row where board starts
const CELL_W       = 2;   // each board cell = 2 terminal columns

// Score values per line clear (Guideline standard)
const SCORE_TABLE  = [0, 100, 300, 500, 800];

class Tetromino extends GameBase {
  static get GAME_NAME()  { return 'tetromino'; }
  static get GAME_TITLE() { return 'TETROMINO'; }

  async run() {
    // Optional music prompt
    const musicEnabled = await this.audio.promptUser();

    await this.showSplash('TETROMINO', 'Classic Block Puzzle Game');

    let playAgain = true;
    while (playAgain) {
      await this._playGame();
      this._drawGameOver();
      this.screen.flush();
      await this._sleep(1200);
      playAgain = await this.terminal.askYesNo('\r\n\r\nPlay again?', true);
    }

    await this.showLeaderboard('tetromino', 'TETROMINO HIGH SCORES');
  }

  // ─── Main game loop ───────────────────────────────────────────────────
  async _playGame() {
    this._initBoard();
    this._score  = 0;
    this._level  = 1;
    this._lines  = 0;
    this._gameOver = false;
    
    // Modern mechanic states
    this._bag = [];
    this._b2bTetris = false;
    this._lastTick = Date.now();
    this._lockDelayStarted = 0;

    this._nextPiece = this._randomPiece();
    this._holdPiece = null;
    this._holdUsed  = false;
    this._spawnPiece();

    this.screen.setMode(Screen.FIXED);
    this._drawFrame();
    this.screen.flush();

    // Play game music
    if (this.audio.enabled) {
      this.audio.play('T160 O4 L8 EDCDEEE>CCC<DDD>EGG<EDCDEEEEDDEDCE');
    }

    let dropInterval = this._dropInterval();
    this.input.start();

    return new Promise((resolve) => {
      // Action handler: arrow keys, space, quit
      const inputHandler = (action) => {
        if (this._gameOver) return;
        switch (action) {
          case 'LEFT':   
            if (this._movePiece(-1, 0) && this._lockDelayStarted) {
              this._lockDelayStarted = Date.now(); // Reset lock delay on successful movement
            }
            break;
          case 'RIGHT':  
            if (this._movePiece(1, 0) && this._lockDelayStarted) {
              this._lockDelayStarted = Date.now(); // Reset lock delay on successful movement
            }  
            break;
          case 'DOWN':   
            if (this._movePiece(0, 1)) {
              this._score += 1; // 1 point per cell soft-dropped
              this._lastTick = Date.now(); // Reset gravity timer
              this._lockDelayStarted = 0; // Cancel lock delay since we fell further
            }
            break;
          case 'UP':     
            this._rotatePiece(1);   
            break; 
          case 'CONFIRM':
            this._hardDrop();       
            break;
          case 'QUIT':   
            this._gameOver = true;  
            break;
        }
        this._drawBoard();
        this.screen.flush();
      };

      // Raw key handler: f=hold, a=CCW rotate, d=CW rotate
      const rawKeyHandler = (key) => {
        if (this._gameOver) return;
        if ((key === 'g' || key === 'G') && !this._holdUsed) {
          this._doHold();
          this._drawBoard();
          this.screen.flush();
        }
        if (key === 'd' || key === 'D') {
          this._rotatePiece(-1);
          this._drawBoard();
          this.screen.flush();
        }
        if (key === 'f' || key === 'F') {
          this._rotatePiece(1);
          this._drawBoard();
          this.screen.flush();
        }
      };

      this.input.on('action', inputHandler);
      this.terminal.on('key', rawKeyHandler);

      const tick = () => {
        if (this._gameOver) {
          this.input.removeListener('action', inputHandler);
          this.terminal.removeListener('key', rawKeyHandler);
          this.input.stop();
          resolve();
          return;
        }

        const now = Date.now();
        if (now - this._lastTick >= dropInterval) {
          this._lastTick = now;
          dropInterval = this._dropInterval();

          if (!this._movePiece(0, 1)) {
            // Hit bottom, begin or check lock delay
            if (!this._lockDelayStarted) {
              this._lockDelayStarted = now; // Give 500ms to slide
            } else if (now - this._lockDelayStarted >= 500) {
              this._lockAndAdvance();
            }
          } else {
            // Gravity pulled it down, cancel lock delay
            this._lockDelayStarted = 0; 
          }

          this._drawBoard();
          this.screen.flush();
        }

        setTimeout(tick, 16); // ~60fps poll
      };

      tick();
    });
  }

  // ─── Board ─────────────────────────────────────────────────────────────
  _initBoard() {
    this._board = [];
    for (let r = 0; r < BOARD_H; r++) {
      this._board.push(new Array(BOARD_W).fill(0)); // 0 = empty, color = filled
    }
  }

  // ─── Pieces ────────────────────────────────────────────────────────────
  _randomPiece() {
    // 7-Bag standard randomizer
    if (!this._bag || this._bag.length === 0) {
      this._bag = [...PIECE_NAMES];
      // Shuffle bag
      for (let i = this._bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this._bag[i], this._bag[j]] = [this._bag[j], this._bag[i]];
      }
    }
    const name = this._bag.pop();
    return { name, rotation: 0, x: 3, y: -1 };
  }

  _spawnPiece() {
    this._current   = this._nextPiece;
    this._current.x = 3;
    this._current.y = -1;
    this._nextPiece = this._randomPiece();
    this._holdUsed  = false;
    this._lastTick  = Date.now();
    this._lockDelayStarted = 0;

    // Block-out condition: If it collides on spawn, Game Over
    if (!this._isValid(this._current)) {
      this._gameOver = true;
    }
  }

  _getCells(piece) {
    const def = PIECES[piece.name];
    return def.rotations[piece.rotation].map(([dc, dr]) => [piece.x + dc, piece.y + dr]);
  }

  _isValid(piece) {
    return this._getCells(piece).every(([c, r]) =>
      c >= 0 && c < BOARD_W && r < BOARD_H && (r < 0 || this._board[r][c] === 0)
    );
  }

  _movePiece(dx, dy) {
    const next = { ...this._current, x: this._current.x + dx, y: this._current.y + dy };
    if (this._isValid(next)) { this._current = next; return true; }
    return false;
  }

  _rotatePiece(dir = 1) {
    const def  = PIECES[this._current.name];
    const rots = def.rotations.length;
    const next = { ...this._current, rotation: ((this._current.rotation + dir) + rots) % rots };
    
    // Simplified Super Rotation System (SRS): Try normal, then 1 left, 1 right, 1 up.
    for (const [dx, dy] of [[0,0], [-1,0], [1,0], [0,-1]]) {
      const kicked = { ...next, x: next.x + dx, y: next.y + dy };
      if (this._isValid(kicked)) { 
        this._current = kicked; 
        if (this._lockDelayStarted) {
          this._lockDelayStarted = Date.now(); // Give another 500ms upon successful spin
        }
        return; 
      }
    }
  }

  _hardDrop() {
    let dropped = 0;
    while (this._movePiece(0, 1)) { dropped++; }
    this._score += (dropped * 2); // 2 points per cell hard-dropped
    this._lockDelayStarted = 0;
    this._lockAndAdvance();
  }

  _lockAndAdvance() {
    this._lockPiece();
    const cleared = this._clearLines();
    this._updateScore(cleared);
    this._spawnPiece();
  }

  _lockPiece() {
    const color = PIECES[this._current.name].color;
    this._getCells(this._current).forEach(([c, r]) => {
      if (r >= 0) this._board[r][c] = color;
    });
  }

  _doHold() {
    if (this._holdUsed) return;
    const cur = this._current.name;
    if (this._holdPiece) {
      this._current  = { name: this._holdPiece, rotation: 0, x: 3, y: -1 };
      this._lastTick = Date.now();
      this._lockDelayStarted = 0;
      if (!this._isValid(this._current)) {
        this._gameOver = true;
      }
    } else {
      this._spawnPiece();
    }
    this._holdPiece = cur;
    this._holdUsed  = true;
  }

  _ghostRow() {
    const ghost = { ...this._current };
    while (true) {
      const next = { ...ghost, y: ghost.y + 1 };
      if (this._isValid(next)) ghost.y = next.y; else break;
    }
    return ghost;
  }

  _clearLines() {
    let cleared = 0;
    for (let r = BOARD_H - 1; r >= 0; r--) {
      if (this._board[r].every(c => c !== 0)) {
        this._board.splice(r, 1);
        this._board.unshift(new Array(BOARD_W).fill(0));
        cleared++;
        r++; // recheck same row
      }
    }
    return cleared;
  }

  _updateScore(cleared) {
    if (cleared === 0) return;
    
    let points = SCORE_TABLE[cleared] || 0;
    
    // Back-to-Back Bonus (1.5x score for consecutive Tetrises)
    if (cleared === 4) {
      if (this._b2bTetris) points *= 1.5;
      this._b2bTetris = true;
    } else {
      this._b2bTetris = false;
    }

    this._score += points * this._level;
    this._lines += cleared;
    this._level  = Math.floor(this._lines / 10) + 1;
  }

  _dropInterval() {
    // Official Guideline Exponential Curve
    const level = Math.min(this._level, 15); // Cap math at Level 15 (20G instant drop)
    const seconds = Math.pow((0.8 - ((level - 1) * 0.007)), (level - 1));
    return Math.max(16, seconds * 1000); // Floor at ~16ms to avoid negatives/zero
  }

  // ─── Rendering ────────────────────────────────────────────────────────
  _drawFrame() {
    const s = this.screen;

    s.clear(Color.BLACK, Color.BLACK);

    // Title bar
    Draw.titleBar(s, '★ SYNTHDOOR TETROMINO ★', Color.BRIGHT_WHITE, Color.BLUE);

    // Board border (double-line box)
    Draw.box(s,
      BOARD_LEFT - 1, BOARD_TOP - 1,
      BOARD_W * CELL_W + 2, BOARD_H + 2,
      Draw.BOX_DOUBLE, Color.CYAN, Color.BLACK, false
    );

    // Right panel: score box
    Draw.titledBox(s, 53, 3, 24, 5, 'SCORE', Draw.BOX_SINGLE, Color.YELLOW, Color.BLACK);
    Draw.titledBox(s, 53, 9, 24, 5, 'LEVEL', Draw.BOX_SINGLE, Color.YELLOW, Color.BLACK);
    Draw.titledBox(s, 53, 15, 24, 5, 'LINES', Draw.BOX_SINGLE, Color.YELLOW, Color.BLACK);

    // Next piece box (Manually drawn without bottom line to avoid corruption)
    s.putString(53, 20, CP437.BOX_TL + 'NEXT' + CP437.BOX_H.repeat(5) + CP437.BOX_TR, Color.CYAN, Color.BLACK);


    // Hold piece box (Manually drawn without bottom line)
    s.putString(66, 20, CP437.BOX_TL + 'HOLD' + CP437.BOX_H.repeat(5) + CP437.BOX_TR, Color.MAGENTA, Color.BLACK);


    // Left panel: controls
    Draw.titledBox(s, 3, 3, 26, 18, 'CONTROLS', Draw.BOX_SINGLE, Color.DARK_GRAY, Color.BLACK);
    const controls = [
      [Color.CYAN,   '< >    Move'],
      [Color.CYAN,   'Down   Soft drop'],
      [Color.CYAN,   'Up/F   Rotate CW'],
      [Color.CYAN,   'D      Rotate CCW'],
      [Color.CYAN,   'SPACE  Hard drop'],
      [Color.CYAN,   'G      Hold piece'],
      [Color.RED,    'Q      Quit'],
    ];
    controls.forEach(([fg, text], i) => {
      s.putString(5, 5 + i * 2, text, fg, Color.BLACK);
    });

    // Status bar
    s.statusBar(' SPACE=Hard Drop  G=Hold  Q=Quit  D/F=Rotate', Color.BLACK, Color.CYAN);
  }

  _drawBoard() {
    const s      = this.screen;
    const ghost  = this._ghostRow();
    const ghostCells = new Set(this._getCells(ghost).map(([c,r]) => `${c},${r}`));
    const currCells  = new Set(this._getCells(this._current).map(([c,r]) => `${c},${r}`));

    // Draw board cells
    for (let r = 0; r < BOARD_H; r++) {
      for (let c = 0; c < BOARD_W; c++) {
        const termCol = BOARD_LEFT + c * CELL_W;
        const termRow = BOARD_TOP + r;
        const key     = `${c},${r}`;

        if (currCells.has(key)) {
          // Active piece (Textured block)
          const clr = PIECES[this._current.name].color;
          s.putString(termCol, termRow, CP437.DARK_SHADE + CP437.DARK_SHADE, clr, Color.BLACK);
        } else if (ghostCells.has(key) && !this._board[r]?.[c]) {
          // Ghost piece
          s.putString(termCol, termRow, CP437.MEDIUM_SHADE + CP437.MEDIUM_SHADE, Color.DARK_GRAY, Color.BLACK);
        } else if (this._board[r]?.[c]) {
          // Locked cell (Textured block)
          const clr = this._board[r][c];
          s.putString(termCol, termRow, CP437.DARK_SHADE + CP437.DARK_SHADE, clr, Color.BLACK);
        } else {
          // Empty
          s.putString(termCol, termRow, CP437.LIGHT_SHADE + CP437.LIGHT_SHADE, Color.BLACK, Color.BLACK);
        }
      }
    }

    // Helper to center text within the inner width of right panel boxes (22 columns, X: 54 to 75)
    const centerText = (val, width) => {
      const str = String(val);
      const leftPad = Math.max(0, Math.floor((width - str.length) / 2));
      const rightPad = Math.max(0, width - str.length - leftPad);
      return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
    };

    // Centered Score panel values
    s.putString(54, 6, centerText(this._score, 22), Color.BRIGHT_WHITE, Color.BLACK);
    s.putString(60, 7, '──────────', Color.DARK_GRAY, Color.BLACK); // Centered bottom divider
    s.putString(54, 12, centerText(this._level, 22), Color.BRIGHT_YELLOW, Color.BLACK);
    s.putString(54, 18, centerText(this._lines, 22), Color.BRIGHT_GREEN, Color.BLACK);

    // High score
    const best = this.db?.getPlayerBestScore('tetromino', this.username)?.best || 0;
    s.putString(54, 8, centerText(`BEST: ${best}`, 22), Color.DARK_GRAY, Color.BLACK);

    // Next piece preview
    this._drawMiniPiece(this._nextPiece.name, 55, 21, Color.BLACK);

    // Hold piece preview
    if (this._holdPiece) {
      this._drawMiniPiece(this._holdPiece, 68, 21, Color.BLACK);
    } else {
      s.fill(68, 21, 8, 3, ' ', Color.BLACK, Color.BLACK);
    }
  }

  _drawMiniPiece(name, startCol, startRow, bg) {
    const s   = this.screen;
    const def = PIECES[name];
    const clr = def.color;

    // Clear area first
    s.fill(startCol, startRow, 8, 3, ' ', bg, bg);

    // Draw piece at rotation 0 (Textured block)
    def.rotations[0].forEach(([dc, dr]) => {
      if (dr < 3) {
        s.putString(startCol + dc * 2, startRow + dr, CP437.DARK_SHADE + CP437.DARK_SHADE, clr, bg);
      }
    });
  }

  _drawGameOver() {
    // Save score to DB
    if (this.db && this._score > 0) {
      this.db.saveScore('tetromino', this.username, this._score);
    }

    // Game over overlay
    Draw.shadowBox(this.screen, 28, 8, 24, 8, 'GAME OVER',
      Draw.BOX_DOUBLE, Color.BRIGHT_RED, Color.BLACK);
    Draw.centerText(this.screen, 11, `Score: ${this._score}`, Color.BRIGHT_WHITE, Color.BLACK, 80);
    Draw.centerText(this.screen, 13, `Level: ${this._level}`, Color.YELLOW, Color.BLACK, 80);

    // Check if new high score
    const rank = this.db?.getUserRank('tetromino', this.username);
    if (rank && rank <= 3) {
      Draw.centerText(this.screen, 12,
        rank === 1 ? '★ NEW HIGH SCORE! ★' : `★ RANK #${rank}! ★`,
        Color.BRIGHT_YELLOW, Color.BLACK, 80);
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = Tetromino;