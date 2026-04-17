# ⚡ SynthDoor

> A modern BBS door game engine for Node.js. Build ANSI/CP437 terminal games
> delivered over telnet, rlogin, or WebSockets — with a framework designed for
> AI-assisted game generation.

```
       ╔═╗ ╦ ╦ ╔╗╔ ╔╦╗ ╦ ╦ ╦═╗ ╔═╗ ╔═╗ ╦═╗
       ╚═╗ ╚╦╝ ║║║  ║  ╠═╣ ║ ║ ║ ║ ║ ║ ╠╦╝
       ╚═╝  ╩  ╝╚╝  ╩  ╩ ╩ ╩═╝ ╚═╝ ╚═╝ ╩╚═
         D O O R   G A M E   E N G I N E
```

## Features

- **80×25 ANSI/CP437 terminal** — full color, blinking, box drawing, block graphics
- **Two screen modes** — scrolling text (BBS-style) and fixed full-screen (game-style)
- **Rich graphics API** — boxes, menus, progress bars, sprites, gradients, block banners, 80×50 half-block pixels
- **Three transports** — telnet, rlogin, and WebSocket
- **SQLite persistence** — scores, leaderboards, player data, messaging, chat
- **Multiplayer** — in-process event bus with SQLite cross-process adapter
- **ANSI music** — MML parser, BBS sequence output, Web Audio synthesis
- **Two auth modes** — Naive (trust username) or Authenticated (SynthAuth cryptographic identity)
- **AI-optimized** — `CLAUDE.md` reference guide for generating games with Claude

## Included Games

| Game | Mode | Features |
|------|------|---------|
| **Tetris** | FIXED (full-screen) | All 7 tetrominoes, ghost piece, hold, levels, high scores |
| **Daily Horoscope** | SCROLL | Live API fetch, sign memory, zodiac lookup, CP437 art |

---

## Quick Start

```bash
git clone <repo>
cd synthdoor
npm install

# Start the game server (telnet :2323, WebSocket :8080)
npm run start:server
```

Connect via telnet:
```bash
telnet localhost 2323
```

Open in browser: http://localhost:8080

---

## Creating a New Game with Claude

SynthDoor is designed to be extended via AI. Open a conversation with Claude,
share `CLAUDE.md` and this `README.md`, and use prompts like:

```
Create a Dungeon Hack clone for SynthDoor with procedurally generated
dungeons, CP437 block graphics, first-person viewport, and persistent
character saves.
```

```
Create a cyberpunk MUD for SynthDoor with rooms, NPCs, real-time chat,
and Trade Wars-style faction warfare.
```

```
Create a daily weather and news summary app for SynthDoor that fetches
live data and displays it in scroll mode with CP437 art borders.
```

See [CLAUDE.md](CLAUDE.md) for the full developer reference.

## Configuration

All configuration lives in `config/synthdoor.conf`. The most important settings:

```ini
# Authentication mode: naive or authenticated
auth_mode = naive

# Default game to launch on telnet (leave blank for menu)
default_game =

# Transport ports
telnet_port  = 2323
rlogin_port  = 513
web_port     = 8080

# Enable/disable transports
telnet_enabled = true
rlogin_enabled = false
web_enabled    = true
```

---

## Authentication Modes

SynthDoor supports two authentication modes set via `auth_mode` in `synthdoor.conf`.

### Naive Mode (`auth_mode = naive`)

The simplest option. The username provided by the client is trusted as-is — no
passwords, no verification. Good for private or trusted deployments.

- **Telnet**: User is prompted for a username. Whatever they type is used.
- **rlogin**: The `ClientUser` field is used as the username directly.

No additional setup required.

### Authenticated Mode (`auth_mode = authenticated`)

Uses **SynthAuth** — a deterministic, passwordless identity system. Identities are
derived from a username and three words from the EFF Large Wordlist using Argon2id.
Nothing sensitive is ever stored. The same username + words always produce the same
identity, from any machine, at any time.

See https://github.com/synexo/synthauth for setup details and more information.
---

## Telnet Login Flows (Authenticated Mode)

When a user connects via telnet (or the web browser), they are presented with:

```
Enter your username or "new" (or just hit ENTER for guest):
```

### Guest (hit ENTER)

The fastest path. No input required.

```
Enter your username or "new" (or just hit ENTER for guest):   [ENTER]

  Your identity has been created. Others will see you as: crater-r7Kx2M
  It cannot be changed.

  Your code words are:  CRABBING  ESTRANGED  SUBURB
  Your recovery key is: 2C6P-7VVJ

  - Save your recovery key. It is the only way to recover your words.
  - Remember your words. They can never be changed.

  • crater writes songs about CRABBING, ESTRANGED, and SUBURB.
  • crater paints pictures of CRABBING, ESTRANGED, and SUBURB.
  • crater often contemplates CRABBING, ESTRANGED, and SUBURB.

Welcome, crater-r7Kx2M!
```

A random username is chosen from the wordlist. Three code words are generated,
displayed with a recovery key and memory-aid phrases, and the user is passed
through immediately — **no confirmation required**. If they want to return as
the same identity in the future, they need their code words or recovery key.

### New Account (`new`)

For users who want to choose their own username:

```
Enter your username or "new" (or just hit ENTER for guest):   new
Enter your desired username:                                   Alice

  Your identity has been created. Others will see you as: Alice-r7Kx2M
  It cannot be changed.

  Your code words are:  CRABBING  ESTRANGED  SUBURB
  Your recovery key is: 2C6P-7VVJ

  - Save your recovery key. It is the only way to recover your words.
  - Remember your words. They can never be changed.

  • Alice writes songs about CRABBING, ESTRANGED, and SUBURB.
  • Alice paints pictures of CRABBING, ESTRANGED, and SUBURB.
  • Alice often contemplates CRABBING, ESTRANGED, and SUBURB.

Enter your code words to confirm registration:   crabbing estranged suburb

  Identity confirmed. Welcome, Alice-r7Kx2M!
```

The server generates three words. The user must type them back once to confirm
(muscle-memory reinforcement). Word order doesn't matter.

### Returning User (enter username)

```
Enter your username or "new" (or just hit ENTER for guest):   Alice
Enter your code words or "recover":                           crabbing estranged suburb

  Welcome back, Alice-r7Kx2M!
```

Word order is irrelevant. Entry is case-insensitive. A full PublicID
(`Alice-r7Kx2M`) is also accepted at the username prompt and works identically
to entering `Alice`.

A recovery code (`XXXX-XXXX`) can also be entered at the code words prompt as
an alternative to the three words:

```
Enter your code words or "recover":   2C6P-7VVJ

  Welcome back, Alice-r7Kx2M!
```

---

## rlogin Configuration

rlogin connections send three fields per RFC 1282:

| Field | rlogin name |
|-------|-------------|
| `ClientUser` | Username on the client machine |
| `ServerUser` | Username on the server machine |
| `TermType` | Terminal type / baud rate (e.g. `ANSI` or `ANSI/9600`) |

SynthDoor uses these fields for both username and game routing. The behavior
differs between auth modes.

### Naive Mode

| Field | SynthDoor use |
|-------|--------------|
| `ClientUser` | Username (trusted as-is) |
| `ServerUser` | Game to launch, if it matches a registered game name. Otherwise ignored → game menu shown. |
| `TermType` | Ignored |

**Examples:**
```
ClientUser  ServerUser   TermType   Result
──────────  ──────────   ────────   ──────────────────────────────────────
Alice       Alice        ANSI       Game menu for user Alice
Alice       meteoroid    ANSI       Launch meteoroid for user Alice
Alice       unknown      ANSI       Game menu for user Alice
```

### Authenticated Mode

| Field | SynthDoor use |
|-------|--------------|
| `ClientUser` | Username (used for identity derivation) |
| `ServerUser` | **Recovery code** (`XXXX-XXXX`) → silent BBS auto-login/register; **game name** → interactive auth then launch that game; **anything else** → interactive auth then game from TermType or menu |
| `TermType` | Game to launch after auth completes, if it matches a registered game name. Overridden by `ServerUser` if that is also a valid game name. Unrecognised values (e.g. `ANSI`, `vt100/9600`) are silently ignored → game menu shown. |

**Examples:**
```
ClientUser  ServerUser   TermType     Result
──────────  ──────────   ────────     ──────────────────────────────────────────────
Alice       Alice        ANSI         Interactive auth → game menu
Alice       meteoroid    ANSI         Interactive auth → launch meteoroid
Alice       Y2Z1-X53H   ANSI         Silent BBS login → game menu
Alice       Y2Z1-X53H   meteoroid    Silent BBS login → launch meteoroid
Alice       meteoroid    tetris       Interactive auth → launch meteoroid (ServerUser wins)
Alice       unknown      meteoroid    Interactive auth → launch meteoroid (from TermType)
Alice       unknown      ANSI         Interactive auth → game menu
```

> **Note:** `TermType` speed suffixes are handled automatically.
> `meteoroid/9600` and `meteoroid` are treated identically.

### BBS Auto-Registration (Silent rlogin Path)

This feature lets a BBS pass users into SynthDoor without any prompts. Each
user gets a unique, persistent identity tied to both their BBS username and the
BBS's system code, silently created on first connection and recognized on every
subsequent one.

**Setup:**

1. Generate a system code for your BBS (do this once, store it securely):
   ```bash
   node -e "
     const path = require('path');
     const SynthAuth = require('./packages/synth-auth');
     // requires PEPPER and SYNTH_SALT in environment
     require('dotenv').config();
     const auth = new SynthAuth({
       pepper: process.env.PEPPER,
       synthSalt: Buffer.from(process.env.SYNTH_SALT, 'hex'),
     });
     console.log(auth.generateBBSCode());
   "
   ```

2. Configure your BBS to send rlogin connections to SynthDoor with:
   - `ClientUser` = the player's username on your BBS
   - `ServerUser` = the system code generated above (e.g. `H8F3-9A2X`)
   - `TermType` = terminal type, or a game name to launch directly

**What happens on first connection:**
```
  Your identity has been created. Others will see you as: Alice-r7Kx2M
Welcome, Alice-r7Kx2M!
```

**What happens on every subsequent connection:** nothing — the user is silently
logged in and routed directly to the game or menu.

**Security note:** The system code functions like a password. If it leaks,
anyone who knows a player's username can impersonate them. Store it in a secrets
manager. Generate a new one to rotate — all players will transparently
re-register as new accounts on their next connection.

---

## Transport Summary

| Transport | Default Port | Auth: Naive | Auth: Authenticated |
|-----------|-------------|-------------|---------------------|
| Telnet | 2323 | Prompted username | Full SynthAuth entry flow |
| rlogin | 513 | ClientUser trusted | ClientUser + SynthAuth; ServerUser routes |
| websocket | 8080 | Prompted username | Full SynthAuth entry flow |

---

## Architecture

```
Transport Layer          Engine Layer             Game Layer
─────────────────        ───────────────────      ──────────────────
telnet.js     ──┐          terminal.js              games/tetris/
rlogin.js     ──┼──────→   screen.js       ──────→  games/horoscope/
websocket.js  ──┘          draw.js                  games/your-game/
             ↕           input.js
          config.js      audio.js
         game-router.js  database.js
         auth-flow.js    multiplayer.js
      [synth-auth/]      game-base.js
```

---

## Adding a Game

1. Create `games/my-game/src/index.js` extending `GameBase`
2. Set `static get GAME_NAME()` and `static get GAME_TITLE()`
3. Create `games/my-game/package.json` (copy from tetris, update name)
4. Optionally add `[game:my-game]` section to `config/synthdoor.conf`
5. Restart — the game is auto-discovered

See `CLAUDE.md` for the full developer reference and AI game generation guide.

---

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start all servers |
| `npm run start:server` | Start all servers (alias) |
| `npm run start:web` | Start web auth test server (http://localhost:3000) |
| `npm run generate-secrets` | Print fresh PEPPER and SYNTH_SALT values for `.env` |
| `npm run game <name>` | Run a game directly in your terminal (no server needed) |
| `npm run test:list` | List all installed games |
| `npm run test:tetris` | Run tetris directly |

---

## Windows Notes

If `npm start` says "Missing script", run directly:
```
node start.js           # starts all servers
node start-web.js       # starts web auth server
```

Test games directly in Windows Terminal or PowerShell:
```
node test-game.js tetris
node test-game.js --list
```
