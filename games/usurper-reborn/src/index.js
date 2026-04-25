'use strict';
const path = require('path');
const net = require('net');
const { StringDecoder } = require('string_decoder');

// CRITICAL: Always use path.join for engine imports
const { GameBase, Screen, Color } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

// --- HARDCODED CONNECTION CONFIGURATION ---
const REMOTE_HOST = 'play.usurper-reborn.net';
const REMOTE_PORT = 4000;

// Standard CP437 mapping for high ASCII (128 to 255)
const CP437_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

// Build a reverse map: Unicode Character -> Raw CP437 binary string byte
const UNICODE_TO_CP437 = {};
for (let i = 0; i < CP437_HIGH.length; i++) {
  UNICODE_TO_CP437[CP437_HIGH[i]] = String.fromCharCode(i + 128);
}

// Add a few common smart-quotes/typography fallbacks just in case
UNICODE_TO_CP437['‘'] = "'";
UNICODE_TO_CP437['’'] = "'";
UNICODE_TO_CP437['“'] = '"';
UNICODE_TO_CP437['”'] = '"';
UNICODE_TO_CP437['–'] = '-';
UNICODE_TO_CP437['—'] = '-';

class UsurperReborn extends GameBase {
  static get GAME_NAME() { return 'usurper-reborn'; }
  static get GAME_TITLE() { return 'Usurper Reborn'; }

  async run() {
    this.screen.setMode(Screen.SCROLL);
    this.terminal.clearScreen();
    
    await this._connectToServer();

    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    this.terminal.println('\nExiting Usurper Reborn...');
    this.terminal.resetAttrs();
  }

  /**
   * Main Telnet client loop. Establishes a raw TCP connection, securely decodes UTF-8
   * into CP437 box/line graphics bytes for the local terminal, and manages user input.
   */
  _connectToServer() {
    return new Promise((resolve) => {
      let isResolved = false;
      let connected = false;
      let iacState = 0; // State machine to strip Telnet IAC codes before UTF-8 decoding
      
      let echoLocally = true;
      let recentTextBuffer = ''; // Rolling buffer to detect the "Press any key" trigger
      
      const utf8Decoder = new StringDecoder('utf8');

      this.terminal.clearScreen();
      this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
      this.terminal.println(`Connecting to ${REMOTE_HOST}:${REMOTE_PORT}...`);
      this.terminal.println(`(Press Ctrl+] to forcefully disconnect at any time)`);
      this.terminal.resetAttrs();

      const socket = net.createConnection(REMOTE_PORT, REMOTE_HOST);

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

      // Process incoming raw data
      socket.on('data', (chunk) => {
        const textBytes = [];

        // 1. Strip Telnet IAC (0xFF) protocol bytes so they don't break the UTF-8 decoder
        for (let i = 0; i < chunk.length; i++) {
          const b = chunk[i];
          
          if (iacState === 0) {
            if (b === 255) { iacState = 1; } // Start of IAC
            else { textBytes.push(b); }      // Normal text byte
          } else if (iacState === 1) {
            if (b === 250) { iacState = 3; } // SB (Subnegotiation)
            else if (b >= 251 && b <= 254) { iacState = 2; } // WILL, WONT, DO, DONT
            else if (b === 255) { 
              textBytes.push(255); // Escaped 255 literal
              iacState = 0; 
            }
            else { iacState = 0; }
          } else if (iacState === 2) {
            iacState = 0; // 3rd byte of WILL/WONT/DO/DONT
          } else if (iacState === 3) {
            if (b === 255) { iacState = 4; } // Look for IAC SE
          } else if (iacState === 4) {
            if (b === 240) { iacState = 0; } // SE End of Subnegotiation
            else if (b === 255) { iacState = 3; } // Escaped 255 inside SB
            else { iacState = 3; } // Keep searching for SE
          }
        }

        // 2. Decode the clean bytes into a UTF-8 string
        const decodedStr = utf8Decoder.write(Buffer.from(textBytes));
        
        // Check if we need to disable local echo
        if (echoLocally) {
          recentTextBuffer += decodedStr;
          // Keep buffer a reasonable size so we aren't wasting memory
          if (recentTextBuffer.length > 512) {
            recentTextBuffer = recentTextBuffer.slice(-512);
          }
          
          // Strip out ANSI color codes for checking so they don't break the match
          const plainText = recentTextBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
          if (plainText.toLowerCase().includes('press any key')) {
            echoLocally = false; // Disable local typing echo permanently
          }
        }

        let cp437Out = '';

        // 3. Map the UTF-8 string back down to CP437 terminal bytes
        for (let i = 0; i < decodedStr.length; i++) {
          const char = decodedStr[i];
          const charCode = char.charCodeAt(0);

          if (charCode < 128) {
            cp437Out += char; // Standard ASCII is exactly the same
          } else if (UNICODE_TO_CP437[char]) {
            cp437Out += UNICODE_TO_CP437[char]; // Translate to CP437 raw byte
          } else {
            cp437Out += '?'; // Unrecognized extended Unicode char fallback
          }
        }

        this.terminal.writeRaw(cp437Out);
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

      // Proxies local keystrokes to the server
      const keyHandler = (key) => {
        // Intercept standard escape character (Ctrl+])
        if (key === '\x1d') {
          this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
          this.terminal.println('\n\n[Disconnecting...]');
          this.terminal.resetAttrs();
          cleanup();
          return;
        }

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
          
          'BACKSPACE': '\x08', 'Backspace': '\x08',
          'ENTER': '\r', 'Enter': '\r', 'RETURN': '\r', 'Return': '\r',
          'TAB': '\t', 'Tab': '\t',
          'ESCAPE': '\x1b', 'Escape': '\x1b',
          
          'F1': '\x1bOP', 'F2': '\x1bOQ', 'F3': '\x1bOR', 'F4': '\x1bOS',
          'F5': '\x1b[15~', 'F6': '\x1b[17~', 'F7': '\x1b[18~', 'F8': '\x1b[19~',
          'F9': '\x1b[20~', 'F10': '\x1b[21~'
        };

        const out = KEY_MAP[key] !== undefined ? KEY_MAP[key] : key;
        
        // 1. Send raw bytes to server
        sendToSocket(out);

        // 2. Locally echo the input onto the user's terminal display (if enabled)
        if (echoLocally) {
          if (out === '\x08') {
            this.terminal.writeRaw('\b \b'); // Functionally erase the character on screen
          } else if (out === '\r') {
            this.terminal.writeRaw('\r\n'); // Enter drops down visually
          } else if (out.length === 1 && out.charCodeAt(0) >= 32 && out.charCodeAt(0) <= 126) {
            this.terminal.writeRaw(out); // Only echo printable ASCII locally
          }
        }
      };

      this.terminal.on('key', keyHandler);
    });
  }
}

module.exports = UsurperReborn;