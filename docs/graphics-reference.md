# SynthDoor Graphics Reference

Quick visual reference for CP437 characters and ANSI color use in games.
Designed so Claude can copy examples directly into game code.

---

## Block Graphics

```
Space  ░  ▒  ▓  █    ← 0%, 25%, 50%, 75%, 100% fill
▀ ▄ ▌ ▐              ← upper/lower/left/right half-blocks (80×50 pixel mode)
```

**Usage patterns:**

```javascript
// Solid wall / filled region
CP437.FULL_BLOCK   // █  use for solid objects, walls, piece fills

// Gradient / depth shading (light → dark → solid)
CP437.LIGHT_SHADE  // ░  distant/background
CP437.MEDIUM_SHADE // ▒  mid-distance
CP437.DARK_SHADE   // ▓  near/foreground
CP437.FULL_BLOCK   // █  solid

// Dithered gradient using CP437.shade(0.0–1.0):
CP437.shade(0.0)   // ' '  (space = empty)
CP437.shade(0.25)  // ░
CP437.shade(0.5)   // ▒
CP437.shade(0.75)  // ▓
CP437.shade(1.0)   // █

// 80×50 half-block pixels (two vertical pixels per terminal row):
screen.putPixel(x, y, Color.BRIGHT_RED)  // x=1..80, y=1..50
```

---

## Box Drawing

### Single-line
```
┌─────────────┐
│             │
├──────┬──────┤
│      │      │
└──────┴──────┘
```
```javascript
Draw.BOX_SINGLE  // style constant for Draw.box()
CP437.BOX_TL     // ┌
CP437.BOX_TR     // ┐
CP437.BOX_BL     // └
CP437.BOX_BR     // ┘
CP437.BOX_H      // ─
CP437.BOX_V      // │
CP437.BOX_T      // ┬
CP437.BOX_B      // ┴
CP437.BOX_L      // ├
CP437.BOX_R      // ┤
CP437.BOX_X      // ┼
```

### Double-line
```
╔══════════════╗
║              ║
╠══════╦═══════╣
║      ║       ║
╚══════╩═══════╝
```
```javascript
Draw.BOX_DOUBLE  // style constant
CP437.BOX2_TL    // ╔   CP437.BOX2_TR  // ╗
CP437.BOX2_BL    // ╚   CP437.BOX2_BR  // ╝
CP437.BOX2_H     // ═   CP437.BOX2_V   // ║
CP437.BOX2_T     // ╦   CP437.BOX2_B   // ╩
CP437.BOX2_L     // ╠   CP437.BOX2_R   // ╣
CP437.BOX2_X     // ╬
```

---

## ANSI Color Palette

```
Standard (0-7):    Bright (8-15):
 0 BLACK            8  DARK_GRAY / BRIGHT_BLACK
 1 RED              9  BRIGHT_RED
 2 GREEN           10  BRIGHT_GREEN
 3 YELLOW          11  BRIGHT_YELLOW
 4 BLUE            12  BRIGHT_BLUE
 5 MAGENTA         13  BRIGHT_MAGENTA
 6 CYAN            14  BRIGHT_CYAN
 7 WHITE           15  BRIGHT_WHITE / INTENSE_WHITE
```

**Background colors are 0–7 only** (no bright backgrounds in standard ANSI).

---

## Classic BBS Color Combinations

| Use | FG | BG | Example |
|-----|----|----|---------|
| Title bar | BRIGHT_WHITE | BLUE | Classic BBS header |
| Status bar | BLACK | CYAN | Bottom help line |
| Menu selected | BLACK | CYAN | Highlighted item |
| Menu normal | WHITE | BLACK | Normal item |
| Border / chrome | CYAN | BLACK | Panel borders |
| Warning | BRIGHT_YELLOW | BLACK | Alert messages |
| Error | BRIGHT_RED | BLACK | Error messages |
| Success | BRIGHT_GREEN | BLACK | OK messages |
| Player name | BRIGHT_WHITE | BLACK | Username display |
| Player stats | BRIGHT_YELLOW | BLACK | HP / score values |
| Enemy | BRIGHT_RED | BLACK | Danger indicator |
| Item | BRIGHT_YELLOW | BLACK | Collectibles |
| Dimmed/inactive | DARK_GRAY | BLACK | Disabled options |

---

## Common Sprite Characters

### Dungeon / top-down map
```
@   player           (BRIGHT_WHITE)
.   floor            (DARK_GRAY)
#   wall             (DARK_GRAY, full block better: █ or ▓)
+   open door        (YELLOW)
-   horizontal wall  (DARK_GRAY)
|   vertical wall    (DARK_GRAY)
>   stairs down      (BRIGHT_WHITE)
<   stairs up        (BRIGHT_WHITE)
$   gold/treasure    (BRIGHT_YELLOW)
!   potion           (BRIGHT_RED)
/   sword/weapon     (CYAN)
~   water            (BLUE / BRIGHT_BLUE, alternating)
^   trap             (BRIGHT_RED)
*   monster (generic)(BRIGHT_RED)
g   goblin           (GREEN)
D   dragon           (BRIGHT_RED)
T   tree             (GREEN)
```

### Space / top-down space game
```
*   star             (DARK_GRAY / WHITE)
+   star (bright)    (BRIGHT_WHITE)
@   player ship      (BRIGHT_WHITE)
>   enemy ship       (BRIGHT_RED)
O   planet           (BRIGHT_CYAN / BRIGHT_GREEN)
.   debris/asteroid  (DARK_GRAY)
═   laser (horiz)    (BRIGHT_YELLOW)
║   laser (vert)     (BRIGHT_YELLOW)
☼   explosion        (BRIGHT_YELLOW, then YELLOW, then DARK_GRAY)
```

### Tetris / block game
```
██  filled cell (2 chars wide for square appearance)
░░  empty cell
```

### Health / progress bars
```
[████████░░░░░░░░░░░░]   full block fill
[▓▓▓▓▓▓▒▒░░░░░░░░░░░]   gradient fill
 HP:  [████████░░░░] 80%
```

---

## CP437 Symbols & Decorations

```
★  ☆  ♦  ◆   STAR DIAMOND  (decoration, rating stars)
♥  ♠  ♣  ♦   HEART SPADE CLUB DIAMOND  (suits, HP)
♪  ♫           MUSIC NOTE
☺  ☻           SMILEY
►  ◄  ▲  ▼   SOLID ARROWS  (navigation indicators)
→  ←  ↑  ↓   OUTLINE ARROWS
·  •  ◦       BULLETS
─  │  ═  ║   LINES
░  ▒  ▓  █   SHADES
▀  ▄  ▌  ▐   HALF BLOCKS
```

---

## Viewport Simulation Techniques

### Top-down RPG / dungeon (80×25 with side panels)
```
Playable area:  ~40 cols × 20 rows (centered)
Player:         always centered, world scrolls
Visibility:     use DARK_SHADE for "fog of war" cells

// Render: for each visible cell offset from player:
const worldCol = player.x + (viewCol - viewCenterX);
const worldRow = player.y + (viewRow - viewCenterY);
const cell = map[worldRow]?.[worldCol];
const ch   = cell ? TILE_CHARS[cell.type] : ' ';
const fg   = cell ? TILE_COLORS[cell.type] : Color.BLACK;
screen.putChar(viewCol, viewRow, ch, fg, Color.BLACK);
```

### First-person DOOM-style viewport (raycasting with CP437)
```
Use shade characters to simulate depth:
  Close walls:  █ (FULL_BLOCK) in bright color
  Mid walls:    ▓ (DARK_SHADE) in normal color
  Far walls:    ▒ (MEDIUM_SHADE) in dark color
  Very far:     ░ (LIGHT_SHADE) in DARK_GRAY
  Ceiling:      spaces in DARK_GRAY background
  Floor:        · or ░ in dark brown/gray

Column rendering:
  for each screen column (1..80):
    cast ray, get wall distance
    wallHeight = Math.floor(screenRows / distance)
    shade = distance < 3 ? '█' : distance < 6 ? '▓' : distance < 10 ? '▒' : '░'
    draw wallHeight rows of shade centered vertically
```

### Scrolling starfield
```javascript
// Initialize stars
const stars = Array.from({length: 200}, () => ({
  x: Utils.randInt(1, 80),
  y: Utils.randInt(1, 50),    // 80×50 half-block space
  speed: Utils.randInt(1, 3),
  ch: Utils.pick(['.', '·', '+', '*']),
  fg: Utils.pick([Color.WHITE, Color.BRIGHT_WHITE, Color.DARK_GRAY]),
}));

// Each frame:
screen.clearPixels();
for (const star of stars) {
  screen.putPixel(star.x, star.y, star.fg);
  star.x -= star.speed;
  if (star.x < 1) { star.x = 80; star.y = Utils.randInt(1, 50); }
}
screen.flush();
```

---

## Animation Patterns

### Color cycling (psychedelic / rainbow)
```javascript
let frame = 0;
// in game loop:
const fg = Utils.RAINBOW[Utils.cycle(frame++, Utils.RAINBOW.length)];
screen.putString(col, row, text, fg, Color.BLACK);
```

### Blinking text
```javascript
// In FIXED mode: set attr to Attr.BLINK
screen.putChar(col, row, '!', Color.BRIGHT_RED, Color.BLACK, Attr.BLINK);

// In SCROLL mode:
terminal.blink(true).print('ALERT!').blink(false);
```

### Explosion / burst effect
```javascript
const BURST = ['*', '+', '.', ' '];
for (let f = 0; f < BURST.length; f++) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      screen.putChar(cx + dx, cy + dy, BURST[f],
        f === 0 ? Color.BRIGHT_WHITE :
        f === 1 ? Color.BRIGHT_YELLOW :
        f === 2 ? Color.YELLOW : Color.BLACK, Color.BLACK);
    }
  }
  screen.flush();
  await sleep(80);
}
```

### Loading / progress animation
```javascript
const SPIN = ['|', '/', '─', '\\'];
let i = 0;
while (loading) {
  screen.putChar(40, 12, SPIN[i++ % 4], Color.BRIGHT_CYAN, Color.BLACK);
  screen.flush();
  await sleep(100);
}
```

---

## Procedural Sprite Generation

For games that need random/unique monster sprites:

```javascript
function generateMonsterSprite(seed) {
  // Use seed to deterministically generate a unique CP437 sprite
  const rng  = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const body = pick(['O', '0', '@', '&', '%']);
  const eyes = pick(['o', '*', 'ö', '°', '^']);
  const arms = pick(['/', '\\', '|', '+', 'x']);

  return [
    `  ${pick(['^','v','-'])}${body}${pick(['^','v','-'])}  `,
    ` ${arms}${eyes}${body}${eyes}${arms} `,
    `  ${pick(['|','l','!'])} ${pick(['|','l','!'])}  `,
  ];
}

// Simple seeded RNG (Mulberry32):
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```
