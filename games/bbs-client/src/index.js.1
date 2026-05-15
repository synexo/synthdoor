'use strict';
const path = require('path');
const net = require('net');

// CRITICAL: Always use path.join for engine imports
const { GameBase, Screen, Color } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

// CRITICAL: Import Utils DIRECTLY from utils.js
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

class BbsClient extends GameBase {
  static get GAME_NAME() { return 'bbs-client'; }
  static get GAME_TITLE() { return 'BBS Directory & Client'; }

  async run() {
    this.screen.setMode(Screen.SCROLL);
    this.terminal.clearScreen();
    
    const bbsList = this._getBbsList();
    if (bbsList.length === 0) {
        this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
        this.terminal.println('No BBS systems configured in synthdoor.conf.');
        this.terminal.resetAttrs();
        return;
    }

    let page = 0;
    const PAGE_SIZE = 9;

    while (true) {
      this.terminal.clearScreen();
      
      this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLUE);
      this.terminal.println(Utils.center(' B B S   D I R E C T O R Y ', 80));
      this.terminal.resetAttrs();

      const startIdx = page * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, bbsList.length);
      const totalPages = Math.ceil(bbsList.length / PAGE_SIZE);

      this.terminal.println('');

      // Draw paginated list
      for (let i = startIdx; i < endIdx; i++) {
        const itemNum = i + 1;
        const bbs = bbsList[i];
        
        this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
        this.terminal.print(`  [${itemNum}] `);
        
        this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
        this.terminal.println(`${bbs.name} (${bbs.host}:${bbs.port})`);
      }

      this.terminal.println('');
      
      // Build prompt
      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      let prompt = `Choose a BBS (1-${bbsList.length})`;
      if (totalPages > 1) {
        if (page > 0) prompt += ', [P]rev';
        if (page < totalPages - 1) prompt += ', [N]ext';
      }
      prompt += ', or [Q]uit: ';
      
      this.terminal.print(prompt);
      this.terminal.resetAttrs();

      // Get user selection
      const choice = await this.terminal.readLine({ echo: true });
      const val = choice.trim().toLowerCase();

      if (val === 'q') break;
      
      if (val === 'n' && page < totalPages - 1) {
        page++;
        continue;
      }
      
      if (val === 'p' && page > 0) {
        page--;
        continue;
      }

      const idx = parseInt(val, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < bbsList.length) {
        await this._connectToBBS(bbsList[idx].host, bbsList[idx].port);
      } else {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Invalid selection.');
        this.terminal.resetAttrs();
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    this.terminal.println('\nExiting BBS Directory...');
    this.terminal.resetAttrs();
  }

  /**
   * Generates the list of available BBSes from the configuration file.
   * Pulls in exact order configured without alphabetizing.
   */
  _getBbsList() {
    const list = [];
    if (this.config) {
      // Iterating Object.keys preserves insertion order for string keys in Node.js
      const keys = Object.keys(this.config).filter(k => k.startsWith('bbs_') || k.startsWith('host_'));

      for (const k of keys) {
        const val = this.config[k];
        let name, hostStr;
        
        if (val.includes(',')) {
          const split = val.split(',');
          name = split[0].trim();
          hostStr = split[1].trim();
        } else {
          hostStr = val.trim();
          name = hostStr.split(':')[0]; 
        }

        const parts = hostStr.split(':');
        const host = parts[0].trim();
        const port = parts.length > 1 ? parseInt(parts[1].trim(), 10) : 23;
        
        list.push({ name, host, port });
      }
    }
    return list;
  }

  /**
   * Main Telnet proxy loop. Establishes a raw TCP connection and pipes bytes bidirectionally.
   */
  _connectToBBS(host, port) {
    return new Promise((resolve) => {
      let isResolved = false;
      let connected = false;

      this.terminal.clearScreen();
      this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
      this.terminal.println(`Connecting to ${host}:${port}...`);
      this.terminal.println(`(Press Ctrl+] to forcefully disconnect at any time)`);
      this.terminal.resetAttrs();

      const socket = net.createConnection(port, host);

      const cleanup = () => {
        if (isResolved) return;
        isResolved = true;
        this.terminal.removeListener('key', keyHandler);
        if (!socket.destroyed) socket.destroy();
        resolve();
      };

      socket.on('connect', () => {
        connected = true;
      });

      // Proxies incoming remote data directly to the user.
      // Note on ♫: The CP437 music symbol is ASCII \x0E. In Telnet, \x0E is the 'Shift Out'
      // control code. Some emulators and transports silently swallow it.
      socket.on('data', (chunk) => {
        this.terminal.writeRaw(chunk.toString('binary'));
      });

      socket.on('close', () => {
        this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
        this.terminal.println('\n\n[Connection closed by remote host]');
        this.terminal.resetAttrs();
        setTimeout(cleanup, 1500);
      });

      socket.on('error', (err) => {
        this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
        this.terminal.println(`\n\n[Connection error: ${err.message}]`);
        this.terminal.resetAttrs();
        setTimeout(cleanup, 2000);
      });

      const sendToSocket = (str) => {
        if (connected && !socket.destroyed) {
          socket.write(str, 'binary');
        }
      };

      // Proxies local keystrokes directly to the remote server.
      const keyHandler = (key) => {
        // Intercept standard escape character (Ctrl+])
        if (key === '\x1d') {
          this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
          this.terminal.println('\n\n[Disconnecting...]');
          this.terminal.resetAttrs();
          cleanup();
          return;
        }

        // Map parsed string events back to their raw ASCII / ANSI equivalents
        const KEY_MAP = {
          'UP': '\x1b[A', 'ArrowUp': '\x1b[A',
          'DOWN': '\x1b[B', 'ArrowDown': '\x1b[B',
          'RIGHT': '\x1b[C', 'ArrowRight': '\x1b[C',
          'LEFT': '\x1b[D', 'ArrowLeft': '\x1b[D',
          'PAGEUP': '\x1b[5~', 'PageUp': '\x1b[5~',
          'PAGEDOWN': '\x1b[6~', 'PageDown': '\x1b[6~',
          'HOME': '\x1b[1~', 'Home': '\x1b[1~',
          'END': '\x1b[4~', 'End': '\x1b[4~',
          'INSERT': '\x1b[2~', 'Insert': '\x1b[2~',
          'DELETE': '\x1b[3~', 'Delete': '\x1b[3~',
          
          // CRITICAL: Handle text-parsed function keys
          'BACKSPACE': '\x08', 'Backspace': '\x08',
          'ENTER': '\r', 'Enter': '\r', 'RETURN': '\r', 'Return': '\r',
          'TAB': '\t', 'Tab': '\t',
          'ESCAPE': '\x1b', 'Escape': '\x1b',
          
          'F1': '\x1bOP', 'F2': '\x1bOQ', 'F3': '\x1bOR', 'F4': '\x1bOS',
          'F5': '\x1b[15~', 'F6': '\x1b[17~', 'F7': '\x1b[18~', 'F8': '\x1b[19~',
          'F9': '\x1b[20~', 'F10': '\x1b[21~'
        };

        const out = KEY_MAP[key] !== undefined ? KEY_MAP[key] : key;
        sendToSocket(out);
      };

      this.terminal.on('key', keyHandler);
    });
  }
}

module.exports = BbsClient;