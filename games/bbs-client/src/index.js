'use strict';
const path = require('path');
const fs   = require('fs');
const net  = require('net');

// CRITICAL: Always use path.join for engine imports
const { GameBase, Screen, Color } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

// CRITICAL: Import Utils DIRECTLY from utils.js
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

// ─── Debug logging ────────────────────────────────────────────────────────
//
// Set debug_log = true in [game:bbs-client] in synthdoor.conf to capture
// every byte the bbs-client proxies in either direction. The log lands in
// this game's own directory (logs/bbs-client-YYYY-MM-DD.log) so it travels
// with the game folder for hand-off when troubleshooting missing ANSI
// sequences in the web client's parser.
//
// Format per chunk:
//
//   [timestamp]  RX  78 bytes  from <host>:<port>
//     0000  1B 5B 32 4A 1B 5B 48 0D  0A 57 65 6C 63 6F 6D 65   .[2J.[H..Welcome
//     0010  20 74 6F 20 4D 79 42 42  53 21 0D 0A 0D 0A         to MyBBS!....
//
// Direction markers:
//   RX  bytes received from the remote BBS (going to the user's screen)
//   TX  bytes the user typed, going out to the remote BBS
//
// We hex-dump the raw bytes (not decoded latin1) because that's the
// representation the web client's ANSI parser actually sees. This makes it
// trivial to identify which CSI sequence is being skipped.
//
// The log file is opened lazily on first write and never closed explicitly
// — when the connection ends we flush via fs.appendFileSync inside a small
// queue so partial writes don't corrupt the dump. The file rotates daily
// based on UTC date; this matches the main server log convention.

class TelnetTrafficLogger {
  /**
   * @param {string} logDir   absolute path to the directory the log file
   *                          will be written into; created if missing
   * @param {string} host     remote host (for the file's first banner line)
   * @param {number} port     remote port
   */
  constructor(logDir, host, port) {
    this.logDir   = logDir;
    this.host     = host;
    this.port     = port;
    this.filePath = null;
    this._opened  = false;
  }

  _open() {
    if (this._opened) return;
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      const d     = new Date();
      const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      this.filePath = path.join(this.logDir, `bbs-client-${stamp}.log`);
      const banner = `\n=== Session opened ${new Date().toISOString()} → ${this.host}:${this.port} ===\n`;
      fs.appendFileSync(this.filePath, banner, 'utf8');
      this._opened = true;
    } catch (e) {
      // Logging must never crash the game. If the file can't be opened,
      // silently disable further writes for this session.
      this._opened = false;
      this.filePath = null;
    }
  }

  /**
   * Append a chunk of bytes to the log.
   *
   * @param {'RX'|'TX'} direction
   * @param {Buffer|string} chunk
   */
  log(direction, chunk) {
    this._open();
    if (!this._opened || !this.filePath) return;

    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), 'binary');
    const ts  = new Date().toISOString();

    let out = `[${ts}]  ${direction}  ${buf.length} bytes\n`;

    // 16-byte rows: hex columns + ASCII gutter. Non-printables become '.'.
    for (let i = 0; i < buf.length; i += 16) {
      const slice = buf.slice(i, i + 16);
      const hex = Array.from(slice)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      // Pad hex to a fixed width so the ASCII gutter aligns even on the
      // last (short) row. Each byte takes 3 columns ('XX '), and we add
      // a single space gap between bytes 7 and 8 for readability.
      const hexPart = hex.padEnd(16 * 3 - 1, ' ');
      const hexSplit = hexPart.length > 23
        ? hexPart.slice(0, 23) + '  ' + hexPart.slice(24)
        : hexPart;
      const ascii = Array.from(slice)
        .map((b) => (b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : '.'))
        .join('');
      const offset = i.toString(16).padStart(4, '0');
      out += `  ${offset}  ${hexSplit}  ${ascii}\n`;
    }

    try {
      fs.appendFileSync(this.filePath, out, 'utf8');
    } catch (_) {
      this._opened = false;
    }
  }

  close() {
    if (!this._opened || !this.filePath) return;
    try {
      fs.appendFileSync(
        this.filePath,
        `=== Session closed ${new Date().toISOString()} ===\n`,
        'utf8',
      );
    } catch (_) {}
    this._opened = false;
  }
}

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
      this.terminal.println(Utils.center(' B B S   D I R E C T O R Y ', 79));
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
   * Resolve whether debug logging is enabled for this session. Reads the
   * `debug_log` key under [game:bbs-client] in synthdoor.conf, accepting
   * the same boolean tokens the Config class uses elsewhere
   * (true/yes/1/on, anything else → false).
   */
  _debugLogEnabled() {
    if (!this.config) return false;
    const raw = this.config.debug_log;
    if (raw === undefined || raw === null) return false;
    const v = String(raw).trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(v);
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

      // Optional debug capture. Lives in this game's own directory so the
      // file is easy to find when triaging "the web client mangled this
      // ANSI sequence" reports — `cat games/bbs-client/logs/bbs-client-*.log`
      // gives the reproduction trace next to the game source.
      let debug = null;
      if (this._debugLogEnabled()) {
        const logDir = path.join(__dirname, '..', 'logs');
        debug = new TelnetTrafficLogger(logDir, host, port);

        this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
        this.terminal.println(`[DEBUG] Telnet traffic logging is ON.`);
        this.terminal.println(`[DEBUG] Writing to: ${path.join(logDir, 'bbs-client-YYYY-MM-DD.log')}`);
        this.terminal.println('');
        this.terminal.resetAttrs();
      }

      // Give the user ~2 seconds to read the connect / force-disconnect /
      // debug-log lines, then clear the screen so the remote BBS's opening
      // banner draws onto a clean canvas. Without this clear, BBSes that
      // do not (or cannot) immediately send ESC[2J end up overlaying their
      // banner on top of our local debug output, and BBSes that *do* send
      // ESC[2J still leave the user briefly seeing the debug text before
      // it's cleared. The outer `_connectToBBS` returns a Promise (not an
      // async function), so this is implemented as a setTimeout rather
      // than `await sleep(...)`. All socket creation and handler wiring
      // moves inside the callback so the closure over `connected`,
      // `isResolved`, `keyHandler`, `cleanup`, and `resolve` stays intact.
      setTimeout(() => {
        this.terminal.clearScreen();

      const socket = net.createConnection(port, host);

      const cleanup = () => {
        if (isResolved) return;
        isResolved = true;
        this.terminal.removeListener('key', keyHandler);
        if (!socket.destroyed) socket.destroy();
        if (debug) debug.close();
        resolve();
      };

      socket.on('connect', () => {
        connected = true;
      });

      // Proxies incoming remote data directly to the user.
      // Note on ♫: The CP437 music symbol is ASCII \x0E. In Telnet, \x0E is the 'Shift Out'
      // control code. Some emulators and transports silently swallow it.
      socket.on('data', (chunk) => {
        if (debug) debug.log('RX', chunk);
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
          if (debug) debug.log('TX', Buffer.from(str, 'binary'));
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
      }, 2000);  // end of 2-second pause / clearScreen wrapper
    });
  }
}

module.exports = BbsClient;
