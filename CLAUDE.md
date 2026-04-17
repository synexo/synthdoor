# CLAUDE.md — SynthDoor Developer Guide
> **For AI assistants generating new SynthDoor games and applications.**
> Read this file before writing any game code.

---

## What Is SynthDoor?

SynthDoor is a Node.js framework for building BBS-style "door games" — text and
ANSI/CP437 graphics applications delivered over telnet, rlogin, or a web terminal.
It combines a full-screen terminal engine, rich CP437/ANSI graphics, persistent
SQLite storage, and multiplayer support into a single, consistent API.

Every game is a folder under `games/` containing `src/index.js` that exports a
class extending `GameBase`. The server auto-discovers and routes players to games.

---

## Repository Layout

```
synthdoor/
├── packages/
│   ├── engine/src/          # Core engine (import from here in games)
│   │   ├── index.js         # Re-exports everything
│   │   ├── terminal.js      # Low-level ANSI output + input stream
│   │   ├── screen.js        # Framebuffer (FIXED) + scroll mode
│   │   ├── draw.js          # High-level drawing primitives
│   │   ├── input.js         # Key → action mapping
│   │   ├── audio.js         # ANSI MML music + Web Audio
│   │   ├── database.js      # SQLite: scores, player data, chat, sessions
│   │   ├── multiplayer.js   # Inter-player events, presence, shared state
│   │   ├── game-base.js     # Base class all games extend
│   │   └── constants.js     # Color, Attr, CP437 character constants
│   └── server/src/
│       ├── index.js         # Starts all transports
│       ├── config.js        # .conf file parser
│       ├── game-router.js   # Discovers games, routes connections
│       └── transports/
│           ├── telnet.js    # Telnet server
│           ├── rlogin.js    # rlogin server
│           └── websocket.js # WebSocket bridge to browser (tunnels telnet)
├── games/
│   ├── tetris/src/index.js       # Working example: full-screen game
│   └── daily-horoscope/src/index.js  # Working example: scroll-mode app
├── config/
│   └── synthdoor.conf       # Main server configuration
└── data/                    # Auto-created: SQLite database lives here
```

## WebSocket implementation
---
Browser
     │  WebSocket  (binary/base64/plain sub-protocol, raw telnet bytes)
     ▼
WebSocketTransport  (port 8080)
     │  TCP (raw telnet)
     ▼
GameRouter → your game

**`websocket.js`** essentially tunnels telnet over websocket
- Accepts WebSocket connections using the standard
  `binary` / `base64` / `plain` sub-protocols
- Pipes raw bytes between the WebSocket

---

---

## Creating a New Game — Quick Start

### 1. Create the game folder
```
games/my-game/
  package.json     (copy from games/tetris/package.json, change name)
  src/
    index.js       (main game file)
```

### 2. Minimal game template
```javascript
'use strict';
const path = require('path');

// ALWAYS use path.join(__dirname, ...) for engine imports — never @synthdoor/engine
// or bare relative paths. This is required for correct resolution on all platforms.
const { GameBase, Screen, Draw, Color, CP437 } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

// Import Utils DIRECTLY from utils.js — never destructure it from the engine index.
// This prevents a Windows module-cache issue where Utils can appear undefined.
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

class MyGame extends GameBase {
  static get GAME_NAME()  { return 'my-game'; }    // used for routing & DB
  static get GAME_TITLE() { return 'My Game'; }    // shown in menu

  async run() {
    // --- FIXED (full-screen) mode ---
    // Game area: rows 1-24 only. Row 25 = status bar (use screen.statusBar()).
    this.screen.setMode(Screen.FIXED);
    this.screen.clear(Color.BLACK, Color.BLACK);
    Draw.titleBar(this.screen, 'MY GAME', Color.BRIGHT_WHITE, Color.BLUE);
    this.screen.putString(10, 12, 'Hello, world!', Color.BRIGHT_CYAN, Color.BLACK);
    this.screen.statusBar(' Q=Quit', Color.BLACK, Color.CYAN);
    this.screen.flush();          // sends only dirty cells to terminal
    await this.terminal.waitKey();

    // --- SCROLL mode ---
    this.screen.setMode(Screen.SCROLL);
    this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
    this.terminal.println('Scrolling text output...');
    this.terminal.resetAttrs();
  }
}
module.exports = MyGame;
```

### 3. Add to config (optional)
```ini
[game:my-game]
some_option = value
```

The game is now **auto-discovered** and selectable from the telnet menu.

---

## Engine API Reference

### Terminal  (`this.terminal`)
Low-level ANSI output and input. Use for scroll-mode games and direct output.

| Method | Description |
|--------|-------------|
| `moveTo(col, row)` | Position cursor (1-based) |
| `setColor(fg, bg, attr?)` | Set ANSI colors. Use `Color.*` constants |
| `print(text)` | Write text at current position |
| `println(text)` | Write text + CRLF |
| `printAt(col, row, text, fg, bg)` | Move, color, print, reset |
| `clearScreen()` | Erase entire screen |
| `clearToEOL()` | Erase to end of line |
| `blink(true/false)` | Enable/disable blinking text |
| `hideCursor() / showCursor()` | Toggle cursor visibility |
| `resetAttrs()` | Reset all ANSI attributes |
| `waitKey()` | Promise: resolves with next keypress string |
| `readLine(opts)` | Promise: reads a line (opts: echo, maxLen, mask) |
| `askYesNo(question, default?)` | Promise: returns boolean |
| `askChoice(prompt, ['a','b','c'])` | Promise: returns chosen char |
| `write(text)` | Write **content text** at current cursor position (goes through CP437 encoder) |
| `writeRaw(str)` | Write **control sequences** verbatim, bypassing CP437 encoder. Use for all ANSI escape sequences you construct manually. |
| `playMusic(mml)` | Send ANSI MML sequence (if enabled) |

**Color constants** (`Color.BRIGHT_CYAN` etc.):
`BLACK RED GREEN YELLOW BLUE MAGENTA CYAN WHITE` + `BRIGHT_*` variants.
Also: `DARK_GRAY`, `LIGHT_RED`, etc. as aliases.

**Attr constants**: `Attr.BOLD`, `Attr.BLINK`, `Attr.REVERSE`, `Attr.UNDERLINE`

### Screen  (`this.screen`)
Virtual framebuffer for FIXED mode. Only changed cells are sent on `flush()`.

| Method | Description |
|--------|-------------|
| `setMode(Screen.FIXED)` | Enable full-screen mode. Sets scroll region to rows 1-24. |
| `setMode(Screen.SCROLL)` | Switch to append/scroll mode |
| `putChar(col, row, ch, fg, bg, attr?)` | Write one character cell. **Rows 1-24 only.** |
| `putString(col, row, str, fg, bg, attr?)` | Write string — clips at col 80, no wrap |
| `fill(col, row, w, h, ch, fg, bg)` | Flood fill rectangle |
| `clear(fg?, bg?)` | Clear game area (rows 1-24) |
| `flush()` | Calculates the cheapest ANSI diff (using Erase-to-EOL & chunking)** and renders to terminal. Parks cursor at (1,1). |
| `forceRedraw()` | Mark all cells dirty (for full redraw) |
| `statusBar(text, fg, bg)` | **Write to protected row 25** (safe, never scrolls) |
| `statusBarLR(left, right, fg, bg)` | Row 25 with left + right aligned text |
| `clearStatusBar(bg?)` | Clear row 25 |
| `putPixel(x, y, fg)` | **80×48 half-block pixel** (x=1..80, y=1..48) |
| `clearPixels()` | Reset pixel canvas |

**CRITICAL 80×24 RULE:** The usable game area is always **80 columns × 24 rows**.
Row 25 is a protected status line — only write to it via `screen.statusBar()`.
Never `putChar`/`putString` at row 25. Never write to col 80 row 25. Never
write to col 80 row 24 (bottom-right of game area). These trigger terminal scroll.

### Draw  (static methods, `Draw.box(screen, ...)`)
High-level drawing. All methods return `Draw` for chaining.

| Method | Description |
|--------|-------------|
| `Draw.box(s, col, row, w, h, style, fg, bg, fill?)` | Draw a box |
| `Draw.titledBox(s, col, row, w, h, title, style, borderFg, borderBg, titleFg, titleBg)` | Box with title in top border |
| `Draw.shadowBox(s, col, row, w, h, title, style, fg, bg)` | Box with drop shadow |
| `Draw.titleBar(s, text, fg, bg)` | Full-width title bar on row 1 |
| `Draw.statusBar(s, text, fg, bg)` | Status bar on row 25 via Screen.statusBar() |
| `Draw.menu(s, col, row, items[], selected, title?, colors?)` | Navigable menu list |
| `Draw.progressBar(s, col, row, w, value, max, fillFg, bg, label?)` | Progress/health bar |
| `Draw.hLine(s, col, row, w, style, fg, bg)` | Horizontal line |
| `Draw.vLine(s, col, row, h, style, fg, bg)` | Vertical line |
| `Draw.gradientFill(s, col, row, w, h, fg, bg, dir)` | Shade-char gradient fill |
| `Draw.centerText(s, row, text, fg, bg, width?)` | Centered text |
| `Draw.sprite(s, col, row, lines[], colorMap, transparent?)` | ASCII sprite |
| `Draw.blockBanner(s, row, text, fg, bg)` | 3×5 block-letter title |
| `Draw.ansiArt(terminal, ansiStr)` | Passthrough raw ANSI art |

**Box styles**: `Draw.BOX_SINGLE` (─│┌), `Draw.BOX_DOUBLE` (═║╔), `Draw.BOX_BLOCK` (███)

### Input  (`this.input`)
Action-based input handler. Start with `this.input.start()`.

| Method | Description |
|--------|-------------|
| `input.on('action', (action) => {})` | Listen for named actions |
| `input.on('key', (key) => {})` | Listen for raw keys |
| `input.waitAction()` | Promise: next action |
| `input.waitKey()` | Promise: next raw key |
| `input.waitFor('CONFIRM', 'CANCEL')` | Promise: wait for specific action |
| `input.bind('z', 'ROTATE')` | Add custom key binding |
| `input.start() / stop()` | Enable/disable input |

**Default actions**: `UP DOWN LEFT RIGHT CONFIRM CANCEL TAB BACKSPACE HOME END PAGEUP PAGEDOWN INSERT DELETE QUIT PAUSE F1..F10`

### Database  (`this.db`)
Synchronous SQLite (better-sqlite3). Game-specific data namespaced by `GAME_NAME`.

| Method | Description |
|--------|-------------|
| `db.saveScore(game, username, score, data?)` | Save a score |
| `db.getLeaderboard(game, limit?)` | Top N scores → `[{username, score, ...}]` |
| `db.getPlayerBestScore(game, username)` | Player's best score |
| `db.getUserRank(game, username)` | Player's current rank (1 = top) |
| `db.setPlayerData(game, username, key, value)` | Save per-player KV data |
| `db.getPlayerData(game, username, key, default?)` | Load per-player KV data |
| `db.getAllPlayerData(game, username)` | Load all KV pairs for player |
| `db.sendMessage(from, to, subject, body)` | Send async message |
| `db.getMessages(username, unreadOnly?)` | Get messages for player |
| `db.addChat(username, message, game?)` | Add global chat line |
| `db.getRecentChat(game?, limit?)` | Read recent chat |
| `db.getActivePlayers(game)` | Players active in last 5 minutes |

### Audio  (`this.audio`)
ANSI MML music. Always call `promptUser()` before `play()`.

```javascript
const ok = await this.audio.promptUser();  // asks user if they want music
if (ok) this.audio.play('T120 O4 L8 CDEFEDC');
```

**MML syntax**: `T<bpm>` `O<octave>` `L<length>` `A-G` `P<rest>` `>` `<` `#` `-`

### Multiplayer  (`new Multiplayer(db, username, game)`)
Real-time inter-player events. See `packages/engine/src/multiplayer.js`.

```javascript
// Multiplayer is already available as part of the engine import at the top of your file
const mp = new Multiplayer(this.db, this.username, 'my-game');
mp.on('chat',  ({username, message}) => { ... });
mp.on('event', (evt) => { ... });
mp.say('Hello!');
mp.broadcast({ type: 'player_moved', x: 5, y: 3 });
const online = mp.getActivePlayers();
mp.close(); // in onDisconnect()
```

### GameBase helpers  (`this.*`)
Available in every game automatically:

| Method | Description |
|--------|-------------|
| `this.showSplash(title, subtitle?)` | Full-screen splash, waits for key |
| `this.showLeaderboard(gameName, title?)` | Display score table |
| `this.pressAnyKey(row?)` | Status-bar "Press any key" prompt |
| `this.log(msg)` | Structured console log with game+user prefix |
| `this.username` | Current player's username (string) |
| `this.config` | Game config object from synthdoor.conf |
| `this.transport` | `'telnet'` \| `'rlogin'` \| `'web'` |

### Utils  (static helpers, `Utils.roll(6)` etc.)
Shared utility functions. **Always import directly from `utils.js`** — never destructure from the engine index (see Critical Rules).
```javascript
const Utils = require(require('path').join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js'));
```

| Method | Description |
|--------|-------------|
| `Utils.roll(d)` | Roll a d-sided die, return 1..d |
| `Utils.rollNd(n, d)` | Roll n dice of d sides, return sum |
| `Utils.chance(p)` | Return true with probability p (0.0–1.0) |
| `Utils.pick(arr)` | Random element from array |
| `Utils.pickN(arr, n)` | n unique random elements |
| `Utils.shuffle(arr)` | Fisher-Yates shuffle in place |
| `Utils.randInt(min, max)` | Random int in [min, max] |
| `Utils.wordWrap(text, width)` | Split text into wrapped lines array |
| `Utils.center(str, width)` | Center string in fixed-width field |
| `Utils.commaNum(n)` | Format number with commas: 1234567 → "1,234,567" |
| `Utils.todayStr()` | Today as "YYYY-MM-DD" (for daily resets) |
| `Utils.isNewDay(lastStr)` | True if date changed since lastStr |
| `Utils.now()` | Unix timestamp in seconds |
| `Utils.makeGrid(rows, cols, fill)` | 2D array filled with value |
| `Utils.generateDungeon(rows, cols)` | Cellular automata dungeon → 0/1 grid |
| `Utils.findOpenCell(grid)` | Random [row, col] where grid=1 |
| `Utils.isConnected(grid, r1,c1, r2,c2)` | Flood-fill connectivity check |
| `Utils.cycle(tick, len)` | Cycling index for animations |
| `Utils.RAINBOW` | Array of 6 bright cycling colors |
| `Utils.randomName()` | Procedural fantasy NPC name |
| `Utils.randomStarName()` | Procedural star system name |
| `Utils.fetchJSON(url, ms?)` | fetch() with timeout, returns null on failure |
| `Utils.fetchText(url, ms?)` | fetch() plain text, returns null on failure |
```javascript
const { CP437 } = require('@synthdoor/engine');
CP437.FULL_BLOCK      // █  - solid fill
CP437.UPPER_HALF_BLOCK// ▀  - top pixel (80×50 mode)
CP437.LOWER_HALF_BLOCK// ▄  - bottom pixel
CP437.LIGHT_SHADE     // ░  - 25% dither
CP437.MEDIUM_SHADE    // ▒  - 50% dither
CP437.DARK_SHADE      // ▓  - 75% dither
CP437.BOX_TL/TR/BL/BR // ┌┐└┘ single-line corners
CP437.BOX2_TL...      // ╔╗╚╝ double-line corners
CP437.BOX_H / BOX_V   // ─ │ lines
CP437.BOX2_H / BOX2_V // ═ ║ double lines
CP437.shade(0.0-1.0)  // Returns ░▒▓█ for gradient
CP437.STAR CP437.HEART CP437.SPADE CP437.CLUB ...
```

---

## ANSI/CP437 Graphics Techniques

### Full-screen game (FIXED mode)
```javascript
this.screen.setMode(Screen.FIXED);
this.screen.clear(Color.BLACK, Color.BLACK);
// draw everything into framebuffer...
Draw.titleBar(this.screen, 'GAME TITLE');
// ...then send all changes at once:
this.screen.flush();
```
**Only call `flush()` once per frame**, not after every cell.

### Pseudo 80×48 pixel graphics (half-blocks)
```javascript
this.screen.setMode(Screen.FIXED);
// Each terminal row = 2 pixel rows. x=1..80, y=1..48.
this.screen.putPixel(40, 24, Color.BRIGHT_RED);   // center dot
this.screen.flush();
```
**Use for:** splash screens, static art, starfield backgrounds, title screens.
**Do NOT use for arcade game objects** (ships, bullets, enemies). The half-block API
doubles perceived height due to character cell aspect ratio, making objects look
oversized. Use `putChar`/`putString` on the 80×24 character grid for all game objects.

### Gradient backgrounds
```javascript
// Horizontal gradient across the game area (rows 1-24)
Draw.gradientFill(this.screen, 1, 1, 80, 24, Color.BLUE, Color.BLACK, 'h');
```

### Sprite system
```javascript
// Define a sprite as ASCII art lines + color map
const dragonSprite = [
  '  /\\  /\\  ',
  ' (  \\/  ) ',
  '  \\    /  ',
  '  /WWWW\\  ',
  ' ( @  @ ) ',
];
const dragonColors = {
  '/': { fg: Color.BRIGHT_GREEN,  bg: Color.BLACK },
  '\\':{ fg: Color.BRIGHT_GREEN,  bg: Color.BLACK },
  'W': { fg: Color.GREEN,         bg: Color.BLACK },
  '@': { fg: Color.BRIGHT_RED,    bg: Color.BLACK },
  '(': { fg: Color.BRIGHT_GREEN,  bg: Color.BLACK },
  ')': { fg: Color.BRIGHT_GREEN,  bg: Color.BLACK },
};
Draw.sprite(this.screen, 35, 10, dragonSprite, dragonColors);
```

### Raw ANSI art (from .ans files)
```javascript
const fs   = require('fs');
const ansi = fs.readFileSync('./art/splash.ans', 'utf8');
Draw.ansiArt(this.terminal, ansi);  // passthrough to terminal (SCROLL mode)
```

### Block-letter banner
```javascript
// Renders "TETRIS" in 3×5 block characters starting at row 5
Draw.blockBanner(this.screen, 5, 'TETRIS', Color.BRIGHT_CYAN, Color.BLACK);
```

### Blinking text
```javascript
// In FIXED mode:
this.screen.putChar(40, 12, '!', Color.BRIGHT_RED, Color.BLACK, Attr.BLINK);
// In SCROLL mode:
this.terminal.blink(true).print('GAME OVER').blink(false);
```

---

## Arcade Game Patterns

Lessons from real BBS gameplay testing. These apply to any real-time game
(Asteroids, Space Invaders, Tetris, Snake, etc.).

### Use the character grid, not the pixel API, for game objects

The 80×24 character grid is the right canvas for arcade games. The 80×48
half-block pixel API doubles perceived height due to character cell aspect ratio
and produces oversized objects. Size objects relative to the play field:

| Object | Recommended size |
|--------|-----------------|
| Large asteroid / boss | 7×4 chars |
| Medium asteroid / enemy | 5×3 chars |
| Small asteroid / bullet | 3×2 chars |
| Player ship | 1–3 chars |
| Particle / debris | 1 char |

### Use only CP437-safe characters in game objects

Many Unicode block characters (`▲ ▼ ◀ ▶ ▌ ▐ ▬`) display as `?` on real BBS
and telnet clients. Safe character set for game objects:
- Standard ASCII: `. , ' * + - / \ | _ = @ # $ % ^ & ( ) [ ] { }`
- CP437 box drawing: `┌ ┐ └ ┘ ─ │ ═ ║ ╔ ╗ ╚ ╝`
- CP437 shading: `░ ▒ ▓ █`

Use plain ASCII (`.` `*` `+`) for frequently-drawn ephemeral objects like
particles — it reduces per-frame output on slow BBS connections.

### Handle input in event handlers, not the game loop

The classic "set a flag, read it in update()" pattern introduces one full frame
of lag plus BBS transmission delay. Call movement functions directly in the handler:

```javascript
// WRONG — laggy on BBS
this.input.on('action', (action) => { this._keys[action] = true; });
// in _update(): if (this._keys.LEFT) this._ship.rotate(-1);

// CORRECT — responsive on BBS
this.input.on('action', (action) => {
  if (action === 'LEFT')    this._ship.rotate(-Math.PI / 4);
  if (action === 'RIGHT')   this._ship.rotate( Math.PI / 4);
  if (action === 'UP')      this._ship.thrust();
  if (action === 'CONFIRM') this._ship.fire();
  if (action === 'QUIT')    this._running = false;
});
// game loop only handles physics: position += velocity, apply drag, etc.
```

### Arrow keys fire action events, not key strings

Arrow keys arrive as `UP`/`DOWN`/`LEFT`/`RIGHT` action events. Listening for
`'ArrowLeft'` on `input.on('key')` will silently do nothing.

```javascript
// WRONG
this.terminal.on('key', (key) => { if (key === 'ArrowLeft') ... });

// CORRECT
this.input.on('action', (action) => { if (action === 'LEFT') ... });
```

Numpad arrow keys (2/4/6/8) fire the same `UP`/`DOWN`/`LEFT`/`RIGHT` actions
as cursor arrows — the engine maps them automatically.

### 45° rotation per keypress suits BBS latency

With BBS latency, rapid taps can be missed. `Math.PI / 4` (45°) per keypress
means every received keypress produces a full visible step. Held keys fire
repeated events naturally.

### Use one handler for arrows, one for character keys

```javascript
// Character keys (space, letters)
this.terminal.on('key', (key) => {
  if (key === ' ')          this._fire();
  if (key === 'p' || key === 'P') this._togglePause();
  if (key === 'h' || key === 'H') this._showHelp();
});

// Arrow / direction actions
this.input.on('action', (action) => {
  if (action === 'LEFT')  this._rotateLeft();
  if (action === 'RIGHT') this._rotateRight();
  if (action === 'UP')    this._thrust();
  if (action === 'QUIT')  this._running = false;
});
```

Remove all listeners when the game loop exits to prevent stale handlers
bleeding into the next screen (leaderboard, menu, etc.).

### Guard wave/level transitions with a pending flag

A transition check inside the game loop fires every frame while the condition
is true. Without a guard, a `setTimeout`-delayed spawn will trigger 30+ times:

```javascript
// WRONG — wavePending increments 30+ times during the setTimeout delay
if (this._asteroids.length === 0) { this._wave++; setTimeout(() => this._spawn(), 2000); }

// CORRECT
if (this._asteroids.length === 0 && !this._wavePending) {
  this._wavePending = true;
  this._wave++;
  setTimeout(() => { this._spawn(); this._wavePending = false; }, 2000);
}
```

### Cap particles hard

Explosions multiplied across simultaneous events stall BBS sessions.

```javascript
const MAX_PARTICLES = 50;
const PARTICLES_PER_EXPLOSION = 5; // never more than 6

_explode(x, y) {
  for (let i = 0; i < PARTICLES_PER_EXPLOSION; i++) {
    if (this._particles.length >= MAX_PARTICLES) break;
    this._particles.push({ x, y, life: 5, ch: Utils.pick(['.', '*', '+', ''']) });
  }
}

// In _update(): short lifetimes
this._particles = this._particles.filter(p => --p.life > 0);
```
(Note: See "Performance & Connection Speed" below — on slow connections, consider bypassing the particle system entirely)
### Scale difficulty through count, not speed

Increasing object speed on slow connections makes the game feel broken.
Adding one more enemy every two waves feels natural. Always cap the maximum:

```javascript
const maxAsteroids = Math.min(3 + Math.floor(this._wave / 2), 12);
```

### Use a consistent liveness flag

Pick one flag and use it everywhere. Mixing `dead` and `alive` causes silent bugs:

```javascript
// WRONG — ship.alive is undefined (falsy), silently disabling input checks
if (!ship.alive) return;

// CORRECT — pick one convention and use it everywhere
if (ship.dead) return;
```

---

## Common Game Patterns

### Game loop with timer + input
```javascript
async run() {
  this._running = true;
  this.input.start();

  this.input.on('action', (action) => {
    if (action === 'QUIT') this._running = false;
    if (action === 'LEFT') this._movePlayer(-1);
    if (action === 'RIGHT') this._movePlayer(1);
  });

  while (this._running) {
    this._update();
    this._draw();
    this.screen.flush();
    await this._sleep(50); // ~20fps
  }
}

_sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

### Navigable menu
```javascript
async _showMenu(items) {
  let selected = 0;
  while (true) {
    Draw.menu(this.screen, 20, 8, items, selected, 'CHOOSE');
    this.screen.flush();
    const action = await this.input.waitFor('UP','DOWN','CONFIRM','CANCEL');
    if (action === 'UP')      selected = Math.max(0, selected - 1);
    if (action === 'DOWN')    selected = Math.min(items.length - 1, selected + 1);
    if (action === 'CONFIRM') return selected;
    if (action === 'CANCEL')  return -1;
  }
}
```

### Saving and loading player state
```javascript
// Save player position, inventory, etc.
this.db.setPlayerData(this.constructor.GAME_NAME, this.username, 'save', {
  x: this._player.x,
  y: this._player.y,
  hp: this._player.hp,
  inventory: this._player.inventory,
});

// Load on next login
const save = this.db.getPlayerData(this.constructor.GAME_NAME, this.username, 'save', null);
if (save) {
  this._player = { ...this._player, ...save };
}
```

### Async multiplayer (Solar Realms / Trade Wars style)
```javascript
async run() {
  this._mp = new Multiplayer(this.db, this.username, this.constructor.GAME_NAME);

  // Show chat from other players
  this._mp.on('chat', ({ username, message }) => {
    this._addChatLine(`${username}: ${message}`);
    this._drawChat();
    this.screen.flush();
  });

  // Receive game events from other players
  this._mp.on('event', (evt) => {
    if (evt.type === 'player_attacked') this._handleAttack(evt);
  });

  this._mp.useSQLiteAdapter(2000); // poll every 2s for cross-process delivery

  // ... game loop ...
}

async onDisconnect() {
  this._mp?.close();
}
```

### MUD-style room system
```javascript
// Store world state in the shared DB game_state table
this.db.setGameState('my_mud', 'room:tavern', {
  players: [],
  items: ['sword', 'ale'],
  exits: { north: 'forest', east: 'market' },
});

// Rooms are just JS objects; load/save to DB each tick
const room = this.db.getGameState('my_mud', 'room:tavern', { players:[], items:[], exits:{} });
```

### World News / Weather (external API fetch)
```javascript
async _fetchWeather(city) {
  const res  = await fetch(`https://wttr.in/${city}?format=j1`);
  const data = await res.json();
  return data.current_condition[0];
}
```

### ELIZA-style chatbot
```javascript
// Pattern rules in an array, matched in order
const RULES = [
  [/i am (.*)/i,      'Why do you say you are $1?'],
  [/i feel (.*)/i,    'Tell me more about feeling $1.'],
  [/why (.*)/i,       'Why do you think $1?'],
  [/hello|hi/i,       'Hello. How are you feeling today?'],
  [/.*/,              'Please tell me more about that.'],
];

_eliza(input) {
  for (const [pattern, response] of RULES) {
    const m = input.match(pattern);
    if (m) return response.replace('$1', m[1] || '');
  }
}
```

---

## Prompt Guide for Game Generation

When asking Claude to generate a new game, use prompts like:

### Arcade games
> "Create a Tetris clone for SynthDoor. Use Screen.FIXED mode, full CP437 block graphics, standard tetrominoes, ghost piece, hold, levels, and SQLite high scores."

> "Create an Asteroids clone for SynthDoor. Use the 80×24 character grid with CP437 characters for the ship and asteroids — NOT the half-block pixel API (objects become oversized). Include high score table and ANSI music."

> "Create a Space Invaders clone for SynthDoor using CP437 sprite characters."

### RPG / Adventure
> "Create a Zork-style text adventure for SynthDoor with 10 rooms, inventory, and saved game state."

> "Create a Pokemon-style RPG for SynthDoor with procedurally generated monsters using CP437 sprites, turn-based battle, and persistent progress."

> "Create a Zelda-style top-down RPG for SynthDoor. Render the world using CP437 characters (░ for grass, ═ for walls, ~ for water). Use putChar on the 80×24 character grid for the game viewport."

> "Create a Dungeon Master clone for SynthDoor with a simulated 3D first-person viewport drawn using CP437 shading and block characters."

### Strategy / Multiplayer
> "Create a Solar Realms Elite clone for SynthDoor. Async multiplayer: players manage a planet empire, send attacks and diplomacy messages. Use Multiplayer.say() for global chat and DB game_state for universe data."

> "Create a Trade Wars 2002 clone for SynthDoor with space trading, ports, combat, and the Multiplayer class for real-time player interaction."

> "Create a Legend of the Red Dragon clone for SynthDoor. Daily-reset combat, marriage, bard songs, forest/town/tavern areas. SQLite for all player state."

### MUD / Online
> "Create a cyberpunk-themed MUD for SynthDoor with rooms, NPCs, combat, chat, and the Multiplayer class for real-time player interaction."

> "Create a Planets TEOS clone for SynthDoor. Strategy game with colonization, production, military, and async diplomacy via DB messages."

### Utilities / Apps
> "Create a daily news and weather summary application for SynthDoor. Fetch from a free API, display in SCROLL mode with CP437 borders."

> "Create a Wikipedia browser for SynthDoor. Use the Wikipedia API to search and display articles, paginated, in SCROLL mode."

> "Create an ELIZA psychotherapy chatbot for SynthDoor in SCROLL mode."

> "Create a daily horoscope reader for SynthDoor (see games/daily-horoscope for reference)."

### Graphics showcase
> "Create a cool animated splash screen for SynthDoor featuring a dragon made of CP437 block characters. Use blinking, color cycling, and the half-block pixel API."

> "Create a procedural starfield animation for SynthDoor. Draw 200 stars as varying CP437 dots that scroll, using the 80×48 half-block pixel API for the background layer."

> "Create a DOOM-style 1st person viewport renderer for SynthDoor using CP437 shading characters (░▒▓█) to simulate walls at varying depths."

---

## Conventions

- **GAME_NAME** must be lowercase, hyphen-separated, URL-safe: `trade-wars`, `daily-horoscope`
- **GAME_TITLE** is the human-readable display name shown in menus
- Always call `this.input.start()` before reading input in `run()`
- Always call `this.screen.flush()` after all screen updates in FIXED mode — never in a tight loop without a `sleep()`
- Always call `mp.close()` in `onDisconnect()` to clean up multiplayer sessions
- Player data keys should be short and consistent: `'save'`, `'prefs'`, `'turn'`, `'gold'`
- For games with daily resets (LORD, etc.), store `last_play_date` in player data and compare to `new Date().toDateString()`
- Use `this.log(msg)` for all debug output — never `console.log` directly in game code

---

## Critical Rules (Learned from Production)

These rules are non-negotiable. Violating them causes hard-to-diagnose bugs on Windows.

### 1. Always import Utils directly from utils.js

**WRONG — causes `Utils is undefined` on Windows:**
```javascript
const { GameBase, Color, Utils } = require(path.join(__dirname, '...', 'index.js'));
```

**CORRECT — import Utils separately, always:**
```javascript
const { GameBase, Color } = require(path.join(__dirname, '...', 'packages', 'engine', 'src', 'index.js'));
const Utils = require(path.join(__dirname, '...', 'packages', 'engine', 'src', 'utils.js'));
```

This is because the engine `index.js` can be loaded into two separate Node.js module
cache slots on Windows (due to path normalisation differences), and only one of those
slots may have `Utils` populated. Requiring `utils.js` directly is always unambiguous.

### 2. Always use path.join(__dirname, ...) for engine imports

**WRONG:**
```javascript
require('@synthdoor/engine')          // npm workspace symlinks may intercept this
require('../../../packages/engine/src/index.js')  // breaks on Windows path resolution
```

**CORRECT:**
```javascript
const path = require('path');
require(path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js'))
```

`__dirname` is always the absolute directory of the current file, resolved by Node.js
itself at load time. It is immune to working directory, symlinks, and Windows junction issues.

### 3. Use writeRaw() for ANSI control sequences, write() only for content

**WRONG — sends ANSI escape bytes through CP437 encoder:**
```javascript
this.terminal.write('\x1b[5m');          // blink
this.terminal.write(`\x1b[${r};${c}H`); // cursor move
```

**CORRECT — bypass the CP437 encoder for control sequences:**
```javascript
this.terminal.writeRaw('\x1b[5m');
this.terminal.writeRaw(`\x1b[${r};${c}H`);
this.terminal.write('█');  // write() is correct for CP437 content characters
```

The `write()` method passes text through the Unicode→CP437 encoder (for telnet/rlogin).
ANSI escape sequences are pure ASCII and safe through the encoder — but using `writeRaw()`
is more explicit and correct for sequences you construct yourself.

### 4. Game area is 80×24. Row 25 is a protected status line.

**WRONG — triggers terminal scroll:**
```javascript
this.screen.putString(1, 25, 'Press any key...');  // writing to row 25 via framebuffer
this.screen.fill(1, 25, 80, 1, ' ', fg, bg);       // filling row 25 via framebuffer
```

**CORRECT:**
```javascript
this.screen.statusBar(' Press any key...', Color.BLACK, Color.CYAN);
// or
Draw.statusBar(this.screen, 'Q=Quit  H=Help', Color.BLACK, Color.CYAN);
```

Row 25 is written using save-cursor / restore-cursor so it never interferes with the
game area. The framebuffer (`putChar`, `putString`, `fill`, `clear`) covers rows 1-24
only. Col 80 of row 24 is also never written (another common scroll trigger).

### 5. package.json for new games must NOT list @synthdoor/engine as a dependency

**WRONG — causes npm to create workspace symlinks that break module resolution:**
```json
{ "dependencies": { "@synthdoor/engine": "*" } }
```

**CORRECT — no dependencies at all (engine is imported by path):**
```json
{
  "name": "@synthdoor/game-my-game",
  "version": "1.0.0",
  "description": "My game description",
  "main": "src/index.js",
  "license": "MIT"
}
```

---
## Implemented screen.js enhancements

Mathematical Screen Bridging & Erase-to-EOL (screen.js): The engine now dynamically calculates the byte-cost of absolute cursor moves vs. \x1b[K (clear to EOL) vs. printing spaces to bridge gaps. Lesson: Games don't need to manually track dirty rectangles; they should just draw the whole frame and let screen.flush() do the math.

Smart Chunk Buffering (screen.js): Network writes are now grouped. Lesson: TCP fragmentation and input lag are mitigated at the engine level.

### Performance & Connection Speed (Baud Rate) Optimization

Recent engine upgrades to `screen.js` introduced mathematical "bridging", Erase-to-EOL (`\x1b[K`) cost analysis, and Smart Chunk Buffering to eliminate TCP fragmentation. To take advantage of this and support users on slow (9600bps) connections, adhere to the following patterns.

#### 1. Trust the Screen Engine (No Manual Dirty Rects)
Do not try to manually erase old player positions by drawing spaces before moving them. Draw your entire frame every tick and call `this.screen.flush()`. The engine compares the new buffer against the previous frame and mathematically calculates the absolute cheapest ANSI sequence to send over the wire.

```javascript
// WRONG - Manual dirty tracking wastes CPU and risks graphical glitches
this.screen.putChar(oldX, oldY, ' '); 
this.screen.putChar(newX, newY, '@');

// CORRECT - Just clear the screen, draw the current state, and flush
this.screen.clear(Color.BLACK, Color.BLACK);
this._drawPlayer();
this._drawEnemies();
this.screen.flush();

---

## Developing high-action games that work on both fast (internet) and slow (modem) connections

Lessons learned optizing ASTEROIDS

Decoupled Physics & Rendering: To support a "SLOW" network mode (10 FPS) without breaking game speed, physics must run on a fixed timestep (e.g., 50ms / 20 FPS reference) while rendering runs at whatever FPS the connection allows.

Attribute Churn Reduction: ANSI color changes cost bytes. Asteroids implements a "Mono" mode and disables sprite highlighting on slow connections to prevent the engine from emitting \x1b[3Xm sequences for every character, allowing the Screen engine to optimize better.

Particle Dropping : Ephemeral graphics (particles/explosions) destroy bandwidth. They must be aggressively culled or entirely skipped on slow connections.

### Arcade Game Patterns

#### Fast vs. Slow Network Modes

Give players the option to select their connection speed at startup. Use this choice to scale your game's visual fidelity and rendering frame rate.
```
// Example Connection Speed Options:
const FPS_FAST = 20; // 115,200bps / local
const FPS_SLOW = 10; // 9600bps
```
#### Decouple Physics from Render FPS

If a user selects "SLOW" (10 FPS), the game shouldn't run at half speed. Use a fixed timestep loop to simulate physics independently of the render rate.
```
const PHYSICS_REF_MS = 50; // 20 FPS physics baseline

// Inside your main game loop:
const now = Date.now();
const elapsed = Math.max(1, now - lastTime);
lastTime = now;

// If rendering at 10 FPS (100ms elapsed), this loop will run twice
let timeToSimulate = elapsed / PHYSICS_REF_MS;
const MAX_STEP = 1.0;

while (timeToSimulate > 0) {
  const stepDt = Math.min(timeToSimulate, MAX_STEP);
  this._update(stepDt); // Move ships, check collisions
  timeToSimulate -= stepDt;
}

this._draw();
this.screen.flush();
```
#### Reduce "Attribute Churn" on Slow Connections

Changing colors requires sending ANSI sequences (e.g., \x1b[33;1m), which bloats the payload. On slow connections, simplify your sprites to use uniform colors. This allows the screen engine's Erase-to-EOL and continuous-write optimizations to shine.
```
_drawAsteroid(r) {
  for (let c = 0; c < line.length; c++) {
    let ch = line[c];
    let fg = r.baseColor;
    
    if (this._baseFps === FPS_SLOW) {
      // SLOW MODE: Use a single uniform character and color.
      // This prevents the engine from emitting ANSI color swaps mid-line.
      ch = '▓'; 
    } else {
      // FAST MODE: Detailed highlighting
      if (ch === '█') fg = Color.WHITE; 
    }
    this._setCell(x, y, ch, fg);
  }
}
```
#### Cull Particles on Slow Connections

Particles and explosions look great but require constant cursor repositioning (\x1b[Y;XH) across the screen, devastating 9600bps connections. Simply drop them if the user is on a slow connection.
```
_updateParticles(dt) {
  if (this._baseFps === FPS_SLOW) {
    this._particles = []; // Skip entirely to save bandwidth
    return;
  }
  // ... process particles normally
}
```
#### Mono Color Toggles

Provide a way for users to toggle a "Mono" color mode (e.g., pressing C switches everything to Bright Green). The engine detects uniform colors and drastically compresses the network payload. Include this in your input handlers if applicable.

---

## Running SynthDoor

```bash
# Install dependencies
npm install

# Start all servers (telnet :2323, web :8080)
npm run start:server

# Start the testing auth server (http://localhost:3000)
npm run start:web

# Run a specific game directly (for testing without server)
node games/tetris/src/index.js

# Connect via telnet
telnet localhost 2323

# Open in browser
http://localhost:3000
```

---

## Adding a Game to the Server

1. Create `games/my-game/src/index.js` with a class extending `GameBase`
2. Set `static get GAME_NAME()` and `static get GAME_TITLE()`
3. Create `games/my-game/package.json` (copy from tetris, update name)
4. Optionally add `[game:my-game]` section to `config/synthdoor.conf`
5. Restart the server — the game is auto-discovered

---

## Additional Documentation

| File | Contents |
|------|----------|
| `docs/graphics-reference.md` | CP437 character visual reference, viewport techniques, sprite patterns, animation recipes |
| `docs/multiplayer-guide.md` | Tier-by-tier multiplayer guide from leaderboards through MUDs, daily resets, room systems |
| `docs/game-template.md` | Fill-in-the-blank design document template to hand Claude for game generation |

---

*SynthDoor — Peak ANSI aesthetics for the modern terminal.*
