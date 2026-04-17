# SynthDoor Multiplayer Guide

Reference for implementing multiplayer features — from simple leaderboards
through async empire games to real-time MUDs.

---

## Multiplayer Tiers

| Tier | Examples | Mechanism |
|------|----------|-----------|
| **0 – Scores only** | Tetris, Asteroids | `db.saveScore()` + leaderboard |
| **1 – Async turn-based** | Oregon Trail, solo RPG | Player data persists between sessions |
| **2 – Async competitive** | Solar Realms, Trade Wars | Shared game_state + messages; players take turns over days |
| **3 – Soft realtime** | Lord of the Red Dragon | Daily resets, async events, in-game mail |
| **4 – Hard realtime** | MUD, chat, co-op action | Multiplayer class, event bus, active sessions |

---

## Tier 0: Scores Only

No multiplayer code needed. Just save scores and show the leaderboard.

```javascript
async run() {
  // ... gameplay ...
  this.db.saveScore(this.constructor.GAME_NAME, this.username, finalScore);
  await this.showLeaderboard(this.constructor.GAME_NAME, 'HIGH SCORES');
}
```

---

## Tier 2: Async Competitive (Solar Realms / Trade Wars style)

Players share a universe that persists in the DB. Each session reads the
current state, takes actions, and writes changes back.

```javascript
const GAME = 'solar-realms';

async run() {
  // Daily turn reset
  const lastPlay = this.db.getPlayerData(GAME, this.username, 'last_played', null);
  if (Utils.isNewDay(lastPlay)) {
    this.db.setPlayerData(GAME, this.username, 'turns_left', 100);
    this.db.setPlayerData(GAME, this.username, 'last_played', Utils.todayStr());
    // Process income, fleet movements, etc.
    this._processDaily();
  }

  // Load player empire
  const empire = this.db.getPlayerData(GAME, this.username, 'empire', {
    planets: [], ships: [], credits: 5000, turns: 100,
  });

  // Load shared universe (all players' data)
  const universe = this.db.getGameState(GAME, 'universe', {
    planets: this._generateUniverse(),
    turn:    0,
  });

  // ... gameplay loop that reads/writes universe ...

  // Save changes atomically
  const save = this.db.transaction(() => {
    this.db.setPlayerData(GAME, this.username, 'empire', empire);
    this.db.setGameState(GAME, 'universe', universe);
  });
  save();
}
```

### Async messaging (diplomacy, war declarations)
```javascript
// Send a diplomatic message
this.db.sendMessage(this.username, targetPlayer,
  'Alliance Proposal',
  'I propose a non-aggression pact. Respond with Y or N.'
);

// Check mail on login
const msgs = this.db.getMessages(this.username, /* unreadOnly */ true);
if (msgs.length > 0) {
  this._showMailbox(msgs);
  msgs.forEach(m => this.db.markMessageRead(m.id));
}
```

---

## Tier 3: Soft Realtime (LORD / Usurper style)

Adds player presence awareness and in-game events that happen "while you were offline."

```javascript
const { Multiplayer } = require('@synthdoor/engine');

async run() {
  this._mp = new Multiplayer(this.db, this.username, this.constructor.GAME_NAME);

  // See who's online
  const online = this._mp.getActivePlayers();
  if (online.length > 1) {
    this.terminal.println(`\r\n${online.length - 1} other player(s) online:`);
    online.filter(p => p.username !== this.username)
          .forEach(p => this.terminal.println(`  ${p.username}`));
  }

  // Receive news from other players' actions (via SQLite polling)
  this._mp.useSQLiteAdapter(3000);
  this._mp.on('event', (evt) => {
    if (evt.type === 'player_killed_monster') {
      this._newsQueue.push(`${evt.username} slew a ${evt.monster}!`);
    }
  });

  // ... gameplay ...
}

async onDisconnect() {
  this._mp?.close();
}
```

---

## Tier 4: Hard Realtime (MUD / co-op)

Full event-driven multiplayer using the Multiplayer class event bus.

### Room-based MUD pattern

```javascript
const GAME = 'my-mud';

class MUD extends GameBase {
  async run() {
    this._mp = new Multiplayer(this.db, this.username, GAME);
    this._mp.useSQLiteAdapter(500); // fast poll for cross-process

    // Announce entry
    this._currentRoom = 'town_square';
    this._mp.broadcast({ type: 'entered_room', username: this.username, room: this._currentRoom });

    // Receive events from other players
    this._mp.on('event', (evt) => {
      if (evt.room !== this._currentRoom) return; // ignore other rooms
      switch (evt.type) {
        case 'entered_room': this._addToFeed(`${evt.username} has arrived.`); break;
        case 'left_room':    this._addToFeed(`${evt.username} heads ${evt.dir}.`); break;
        case 'emote':        this._addToFeed(`${evt.username} ${evt.action}`); break;
        case 'combat_hit':   this._addToFeed(`${evt.attacker} hits ${evt.target} for ${evt.dmg}!`); break;
      }
    });

    // Receive chat
    this._mp.on('chat', ({ username, message }) => {
      this._addToFeed(`[${username}]: ${message}`);
    });

    await this._gameLoop();
  }

  async _handleInput(action, key) {
    if (action === 'UP')    await this._move('north');
    if (action === 'DOWN')  await this._move('south');
    if (action === 'LEFT')  await this._move('west');
    if (action === 'RIGHT') await this._move('east');

    if (key === 's' || key === 'S') {
      // Say: read a line and broadcast as chat
      const msg = await this.terminal.readLine({ maxLen: 70 });
      this._mp.say(msg);
    }

    if (key === 'e' || key === 'E') {
      // Emote
      const act = await this.terminal.readLine({ maxLen: 60 });
      this._mp.broadcast({ type: 'emote', username: this.username, action: act, room: this._currentRoom });
    }
  }

  async _move(direction) {
    const room = this._getRoom(this._currentRoom);
    const next = room.exits[direction];
    if (!next) { this._addToFeed(`You can't go ${direction}.`); return; }

    this._mp.broadcast({ type: 'left_room', username: this.username, dir: direction, room: this._currentRoom });
    this._currentRoom = next;
    this._mp.broadcast({ type: 'entered_room', username: this.username, room: this._currentRoom });
    this._renderRoom();
  }

  async onDisconnect() {
    this._mp?.broadcast({ type: 'left_room', username: this.username, dir: 'portal', room: this._currentRoom });
    this._mp?.close();
  }
}
```

### Who's in this room?
```javascript
_getPlayersInRoom(room) {
  const active = this._mp.getActivePlayers();
  // We don't have per-room presence built in — track it in game_state
  const roomState = this.db.getGameState(GAME, `room:${room}`, { players: [] });
  return roomState.players.filter(u =>
    active.some(p => p.username === u) && u !== this.username
  );
}
```

---

## Cross-Process Multiplayer

By default, the event bus is in-process (all sessions in one Node.js process).
For production deployments where each connection is a separate process:

```javascript
// Use SQLite polling adapter — cheap, works for most door games
this._mp.useSQLiteAdapter(1000); // poll every 1 second

// For high-frequency realtime (MUDs): swap in a Redis adapter
// this._mp.useRedisAdapter('redis://localhost:6379');
// (Requires implementing RedisAdapter in multiplayer.js)
```

---

## Leaderboard Display Patterns

### Simple top-10
```javascript
await this.showLeaderboard('my-game', 'HIGH SCORES');
// Built into GameBase — just call it.
```

### Custom leaderboard with stats
```javascript
_drawLeaderboard() {
  const s      = this.screen;
  const scores = this.db.getLeaderboard(GAME, 10);

  Draw.titledBox(s, 1, 3, 78, scores.length + 4, 'GALACTIC LEADERBOARD',
    Draw.BOX_DOUBLE, Color.BRIGHT_YELLOW, Color.BLACK);

  // Header
  s.putString(3, 5, 'RANK  COMMANDER          SCORE      PLANETS  FLEETS', Color.CYAN, Color.BLACK);
  Draw.hLine(s, 3, 6, 74, Draw.BOX_SINGLE, Color.DARK_GRAY, Color.BLACK);

  scores.forEach((entry, i) => {
    const extra = entry.data ? JSON.parse(entry.data) : {};
    const rank  = String(i + 1).padStart(2);
    const name  = entry.username.padEnd(18);
    const score = String(entry.score).padStart(10);
    const pln   = String(extra.planets || 0).padStart(8);
    const flt   = String(extra.fleets  || 0).padStart(7);
    const fg    = [Color.BRIGHT_YELLOW, Color.BRIGHT_WHITE, Color.YELLOW][i] || Color.WHITE;
    s.putString(3, 7 + i, `${rank}    ${name} ${score} ${pln} ${flt}`, fg, Color.BLACK);
  });
}
```

---

## Daily Reset Pattern (LORD / Solar Realms)

```javascript
_checkDailyReset() {
  const today    = Utils.todayStr();
  const lastPlay = this.db.getPlayerData(GAME, this.username, 'last_played', null);

  if (!Utils.isNewDay(lastPlay)) return; // already played today

  const stats = this.db.getPlayerData(GAME, this.username, 'stats', {
    hp: 100, turns: 10, gold: 1000, level: 1,
  });

  // Restore daily allowances
  stats.hp    = stats.maxHp || 100;
  stats.turns = 10 + (stats.level || 1) * 2;
  // Apply passive income
  stats.gold += (stats.income || 0);

  this.db.setPlayerData(GAME, this.username, 'stats', stats);
  this.db.setPlayerData(GAME, this.username, 'last_played', today);

  this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
  this.terminal.println('\r\n  ★ Daily reset! Your turns and HP have been restored. ★\r\n');
  this.terminal.resetAttrs();
}
```
