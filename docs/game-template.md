# SynthDoor Game Design Template

Use this template when designing a new SynthDoor game. Fill in each section,
then hand the completed document to Claude along with CLAUDE.md to generate
the full implementation.

---

## Game Overview

**Name (GAME_NAME):** `my-game`  ← lowercase, hyphen-separated
**Title (GAME_TITLE):** `My Game`  ← human-readable, shown in menu
**Genre:** arcade | rpg | strategy | simulation | adventure | utility | mud
**Screen mode:** FIXED (full-screen) | SCROLL (append/BBS-style) | both
**Players:** single | async-multiplayer | realtime-multiplayer

---

## Gameplay Description

*1–3 paragraphs describing what the player does.*

---

## Screen Layout (FIXED mode only)

Sketch the 80×25 terminal layout. Mark each region:

```
╔══════════════════════════════════════════════════════════════════════════════╗  row 1
║                           GAME TITLE BAR                                    ║
╠══════════════╦══════════════════════════════════╦═══════════════════════════╣  row 2
║              ║                                  ║                           ║
║   LEFT       ║          MAIN VIEWPORT           ║      RIGHT PANEL          ║
║   PANEL      ║        (game board, map,         ║   (score, stats, etc.)    ║
║  (controls,  ║         dungeon view, etc.)       ║                           ║
║   minimap,   ║                                  ║                           ║
║   etc.)      ║                                  ║                           ║
║              ║                                  ║                           ║
╠══════════════╩══════════════════════════════════╩═══════════════════════════╣ row 24
║                           STATUS BAR                                        ║  row 25
╚══════════════════════════════════════════════════════════════════════════════╝
```

*Describe each panel's content in detail.*

---

## Player Controls

| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move / navigate |
| Space / Enter | Confirm / fire / interact |
| Escape | Cancel / menu |
| Q | Quit |
| *add game-specific keys* | *action* |

---

## Data Model

### Per-player saved data (db.setPlayerData)
```
save_slot     : { level, hp, x, y, inventory, gold }
preferences   : { music: bool, color_scheme: string }
last_played   : "YYYY-MM-DD"
total_turns   : number
```

### High scores (db.saveScore)
```
score         : number
data          : { level_reached, time_taken, kills }
```

### Game state (async multiplayer, db.setGameState)
```
universe      : { planets: [...], ships: [...] }
turn_number   : number
```

---

## Visual Design

### Color scheme
- Primary UI: `Color.CYAN` / `Color.DARK_GRAY` background
- Player: `Color.BRIGHT_WHITE`
- Enemies: `Color.BRIGHT_RED`
- Items: `Color.BRIGHT_YELLOW`
- Environment: `Color.GREEN` / `Color.DARK_GRAY`

### CP437 character usage
| Element | Character | Color |
|---------|-----------|-------|
| Player  | `@`       | BRIGHT_WHITE |
| Wall    | `█`       | DARK_GRAY |
| Floor   | `·`       | DARK_GRAY |
| Enemy   | describe  | BRIGHT_RED |
| Item    | describe  | BRIGHT_YELLOW |

### Splash screen
*Describe the splash screen art concept.*
Example: "A large ASCII dragon made of ▓▒░ block characters, in shades of green,
 with the game title in blockBanner style below it."

---

## Multiplayer (if applicable)

**Type:** async (Solar Realms, Trade Wars) | realtime (MUD, action)

### Shared events broadcast via `mp.broadcast()`:
```javascript
{ type: 'player_moved',   username, x, y }
{ type: 'player_attacked', by, target, damage }
{ type: 'item_taken',     username, item, room }
```

### Chat: `mp.say(message)` for in-game global chat

### Daily reset (async games):
```javascript
const lastPlay = db.getPlayerData(GAME_NAME, username, 'last_played', null);
if (Utils.isNewDay(lastPlay)) {
  // reset daily turns, income, etc.
  db.setPlayerData(GAME_NAME, username, 'last_played', Utils.todayStr());
}
```

---

## Game Loop Pseudocode

```
run():
  show splash screen
  prompt for music (if desired)
  load player save data
  check daily reset

  main loop:
    render screen
    handle input
    update game state
    check win/lose conditions
    if multiplayer: send events, receive events

  on exit:
    save player data
    show final score / leaderboard
```

---

## External APIs (if applicable)

| Data needed | API | Endpoint |
|-------------|-----|----------|
| Weather | wttr.in | `https://wttr.in/{city}?format=j1` |
| News    | NewsAPI | `https://newsapi.org/v2/top-headlines?country=us` |
| Wikipedia | Wikipedia | `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` |
| Horoscope | Aztro | `POST https://aztro.sameerkumar.website/?sign={sign}&day=today` |

---

## Implementation Notes

*Any specific technical notes, tricky parts, or algorithms to implement.*

---

## Prompt to send to Claude

Once you've filled out this template, use a prompt like:

```
I'm building a new SynthDoor game. Here is the design document:
[paste this filled-out template]

Using CLAUDE.md as the framework reference, implement the complete game
in games/my-game/src/index.js. Include:
- Full splash screen with [describe art]
- Complete game loop
- All described features
- Persistent high scores via this.db
- CP437 graphics throughout
```
