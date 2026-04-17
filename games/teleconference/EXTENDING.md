# EXTENDING.md — Teleconference Developer Guide

Teleconference is designed to be easily extensible. Because it runs on the SynthDoor engine, you have full access to persistent SQLite storage, an inter-process Multiplayer event bus, and native ANSI formatting.

Here is how you can extend the app to add new features, chat commands, and bots.

---

## 1. Adding Custom `/` Commands

All user commands are processed in the `_handleCommand(cmdLine)` method inside `src/index.js`.

To add a new command (like `/roll` or `/me`), simply add a new `else if` block.

```javascript
// Inside _handleCommand(cmdLine):
else if (cmd === '/roll') {
  // Example: /roll 20
  const sides = parseInt(args[0]) || 6;
  const result = Math.floor(Math.random() * sides) + 1;

  // Broadcast to everyone else in the channel
  this._broadcast({
    type: 'sys',
    msg: `${this.username} rolled a d${sides} and got: ${result}`
  });

  // Print locally so the user sees their own roll
  this._printMessage(
    `*** You rolled a d${sides} and got: ${result}`,
    Color.BRIGHT_MAGENTA
  );
}
```

---

## 2. Drop-in Bot Extensions (The Recommended Way)

The easiest way to add complex features like bots, trivia games, or background workers is using the Drop-in Extension System.

Any `.js` file you place in the `games/teleconference/src/extensions/` directory will be automatically discovered and instantiated exactly once the next time the chat application is started. They run silently in the background of the Node process.

### Creating an Extension

Your extension just needs to export a class that accepts the SynthDoor `db` object in its constructor.

Here is a minimal example of a bot that listens for the word `"hello"`:

```javascript
// File: games/teleconference/src/extensions/hello-bot.js
'use strict';
const path = require('path');

// NOTE: Ensure your path depth matches your location in the extensions folder
const { Multiplayer } = require(
  path.join(__dirname, '..', '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

class HelloBot {
  constructor(db) {
    this.db = db;

    // Connect to the 'teleconference' multiplayer namespace
    this.mp = new Multiplayer(this.db, 'HelloBot', 'teleconference');
    this.mp.useSQLiteAdapter(2000); // Poll for events every 2 seconds

    // Listen to real-time chat
    this.mp.on('event', (evt) => {
      if (evt.type === 'chat' && evt.text.toLowerCase().includes('hello')) {

        // Broadcast a response back into the same channel
        this.mp.broadcast({
          channel: evt.channel,
          type: 'chat',
          user: 'HelloBot',
          text: `Hi there, ${evt.user}!`
        });

      }
    });

    console.log('[EXTENSION] HelloBot is online.');
  }
}

module.exports = HelloBot;
```

Simply drop this file into `src/extensions/`, restart your SynthDoor server, and the bot will immediately start monitoring the channels.

---

## 3. Handling Custom Event Types

The chat relies on the SynthDoor `Multiplayer` class. Currently, the main Teleconference client listens for `type: 'chat'` and `type: 'sys'`.

If you are building an extension (like a trivia minigame) and you want to format it distinctly on the screen, you can invent your own event types.

Update `_handleEvent(evt)` inside `src/index.js` to listen for your custom type:

```javascript
// Inside _handleEvent(evt):
} else if (evt.type === 'trivia') {
  this._printMessage(`[TRIVIA BOT] ${evt.text}`, Color.BRIGHT_YELLOW);
} else if (evt.type === 'game_invite') {
  this._printMessage(
    `*** ${evt.user} has invited you to play ${evt.game}!`,
    Color.BRIGHT_GREEN
  );
}
```

---

## 4. Helpful API References

When writing extensions or editing the main file, remember these available utilities:

- `this._printMessage(text, fgColor)`  
  Safely prints text to the screen without breaking the user's current input line.

- `this._broadcast(payload)`  
  Sends a JSON object to everyone else in the `currentChannel`.

- `this.db.getPlayerData(...)` / `this.db.setPlayerData(...)`  
  Useful for saving user preferences, RPG stats, or custom profiles natively in SynthDoor.

- `Utils.wordWrap(text, limit)`  
  Use this if you are building complex ASCII output that needs to fit within the 80-column terminal limit.