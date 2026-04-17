'use strict';
const path = require('path');
const fs = require('fs');

const { GameBase, Screen, Color, Multiplayer } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

class Teleconference extends GameBase {
  static get GAME_NAME() { return 'teleconference'; }
  static get GAME_TITLE() { return 'Teleconference'; }

  static extensionsLoaded = false;
  static extensionInstances = [];

  async run() {
    this.running = true;
    
    // Auto-discover and load drop-in extensions exactly once globally
    this._initExtensions();

    this.maxInputLength = 240;
    this.messageThrottleMs = 1000;
    this.lastMessageTime = 0;
    
    this.inputBuffer = '';
    this.currentChannel = 'main'; 
    
    this.screen.setMode(Screen.SCROLL);
    this.terminal.clearScreen();

    for (let i = 0; i < 23; i++) {
      this.terminal.println('');
    }

    this.input.bind(' ', 'SPACE');
    this._updatePresence();

    this._mp = new Multiplayer(this.db, this.username, this.constructor.GAME_NAME);
    this._mp.useSQLiteAdapter(2000); 
    this._mp.on('event', (evt) => this._handleEvent(evt));

    this.input.start();
    this.input.on('key', (key) => this._handleKey(key));
    this.input.on('action', (action) => this._handleAction(action));

    this._printMessage(`=== TELECONFERENCE | Channel: ${this.currentChannel} ===`, Color.BRIGHT_WHITE);
    this._printMessage(`*** SYSTEM: Welcome to Teleconference, ${this.username}!`, Color.BRIGHT_GREEN);
    this._printMessage(`*** SYSTEM: Type /help for a list of commands.`, Color.BRIGHT_GREEN);
    this._broadcast({ type: 'sys', msg: `${this.username} has joined the channel.` });

    while (this.running) {
      await this._sleep(100);
    }

    this._broadcast({ type: 'sys', msg: `${this.username} has left the channel.` });
    this.input.stop();
  }

  _initExtensions() {
    if (Teleconference.extensionsLoaded) return;
    Teleconference.extensionsLoaded = true;

    // cleanup any stale sessions
    try {
      const activeUsers = this.db.getActivePlayers(Teleconference.GAME_NAME) || [];
      for (const p of activeUsers) {
        // Use the method found in multiplayer.js to clear the session
        this.db.removeSession(p.username, Teleconference.GAME_NAME);
        
        // Reset to 'main' instead of null so the bot is visible by default
        this.db.setPlayerData(Teleconference.GAME_NAME, p.username, 'current_channel', 'main');
      }
    } catch (e) {
      this.log(`Teleconference cleanup error: ${e.message}`);
    }

    const extDir = path.join(__dirname, 'extensions');
    
    if (!fs.existsSync(extDir)) {
      fs.mkdirSync(extDir, { recursive: true });
      return; 
    }

    const files = fs.readdirSync(extDir);
    for (const file of files) {
      if (file.endsWith('.js')) {
        try {
          const ExtClass = require(path.join(extDir, file));
          const instance = new ExtClass(this.db);
          Teleconference.extensionInstances.push(instance);
          this.log(`Loaded Teleconference extension: ${file}`);
        } catch (err) {
          this.log(`Error loading extension ${file}: ${err.message}`);
        }
      }
    }
  }

  async onDisconnect() {
    this.running = false;
    if (this._mp) this._mp.close();
  }

  _printMessage(text, fg) {
    this.terminal.writeRaw('\r\x1b[2K');
    const lines = Utils.wordWrap(text, 79);
    this.terminal.setColor(fg, Color.BLACK);
    for (const line of lines) {
      this.terminal.println(line);
    }
    this.terminal.resetAttrs();
    this._redrawInput();
  }

  _redrawInput() {
    const prompt = `[${this.username}]> `;
    const maxVisible = 79 - prompt.length;
    
    let displayBuffer = this.inputBuffer;
    if (displayBuffer.length > maxVisible) {
      displayBuffer = displayBuffer.slice(-maxVisible); 
    }

    this.terminal.writeRaw('\r\x1b[2K');
    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.print(prompt);
    this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
    this.terminal.print(displayBuffer);
    
    this.terminal.resetAttrs();
  }

  _handleKey(key) {
    if (key.length === 1 && key !== '\r' && key !== '\n') {
      if (this.inputBuffer.length < this.maxInputLength) {
        this.inputBuffer += key;
        this._redrawInput();
      }
    }
  }

  _handleAction(action) {
    if (action === 'BACKSPACE' || action === 'DELETE') {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this._redrawInput();
      }
    } else if (action === 'CONFIRM') {
      this._processInputLine();
    } else if (action === 'QUIT') {
      this.running = false;
    }
  }

  _processInputLine() {
    const line = this.inputBuffer.trim();

    if (!line) {
      this.inputBuffer = '';
      this._redrawInput();
      return;
    }

    const now = Date.now();
    if (now - this.lastMessageTime < this.messageThrottleMs) return;
    this.lastMessageTime = now;

    this.inputBuffer = '';
    this._redrawInput(); 

    if (line.startsWith('/')) {
      this._handleCommand(line);
    } else {
      // FIX: Print the local message BEFORE broadcasting to prevent bots appearing out of order
      this._printMessage(`<${this.username}> ${line}`, Color.BRIGHT_WHITE);
      this._broadcast({ type: 'chat', user: this.username, text: line });
    }
  }

  _updatePresence() {
    this.db.setPlayerData(this.constructor.GAME_NAME, this.username, 'current_channel', this.currentChannel);
  }

  _broadcast(payload) {
    payload.channel = this.currentChannel;
    this._mp.broadcast(payload);
  }

  _handleEvent(evt) {
    if (evt.channel !== this.currentChannel) return;
    if (evt.type === 'sys') this._printMessage(`*** ${evt.msg}`, Color.DARK_GRAY);
    else if (evt.type === 'chat') this._printMessage(`<${evt.user}> ${evt.text}`, Color.BRIGHT_CYAN);
  }

  _handleCommand(cmdLine) {
    const parts = cmdLine.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmd === '/help') {
      this._printMessage(`*** COMMANDS: /help, /channel <name>, /who, /quit`, Color.BRIGHT_YELLOW);
    } else if (cmd === '/quit') {
      this.running = false;
    } else if (cmd === '/channel') {
      const newChan = args.join(' ').trim().toLowerCase();
      if (!newChan) {
        this._printMessage(`*** SYSTEM: You are currently in: ${this.currentChannel}`, Color.BRIGHT_YELLOW);
        return;
      }
      this._broadcast({ type: 'sys', msg: `${this.username} has moved to another channel.` });
      this.currentChannel = newChan;
      this._updatePresence();
      this._printMessage(`*** SYSTEM: Changed channel to: ${this.currentChannel}`, Color.BRIGHT_YELLOW);
      this._broadcast({ type: 'sys', msg: `${this.username} has joined the channel.` });
    } else if (cmd === '/who') {
      const activeUsers = this.db.getActivePlayers(this.constructor.GAME_NAME) || [];
      const chanUsers = [];
      for (const playerObj of activeUsers) {
        const u = playerObj.username;
        const c = this.db.getPlayerData(this.constructor.GAME_NAME, u, 'current_channel', 'main');
        if (c === this.currentChannel) chanUsers.push(u);
      }
      this._printMessage(`*** USERS HERE: ${chanUsers.join(', ')}`, Color.BRIGHT_CYAN);
    } else {
      this._printMessage(`*** SYSTEM: Unknown command. Type /help`, Color.BRIGHT_RED);
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = Teleconference;