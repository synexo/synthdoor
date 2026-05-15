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

const HOME_GOPHERMAP = `i--- Welcome to SynthDoor Gopherspace ---\t\terror.host\t1
i\t\terror.host\t1
1Floodgap Systems (The center of modern Gopherspace)\t\tgopher.floodgap.com\t70
7Veronica-2 Gopher Search Engine\t/v2/vs\tgopher.floodgap.com\t70
1SDF Public Access UNIX System\t\tsdf.org\t70
1Bitreich Gopher Server\t\tbitreich.org\t70
1Cameron Kaiser's GopherSpace\t\tcameronkaiser.com\t70
1Quux.org (Vintage tech and archives)\t\tquux.org\t70
1Maguro (Gopher on modern topics)\t\tmaguro.moe\t70
i\t\terror.host\t1
i--- Quick Navigation Tips ---\t\terror.host\t1
iEnter a link number to open it.\t\terror.host\t1
iPress [b] to go back, [q] to quit, [u] for custom URL.\t\terror.host\t1
.
`;

class GopherBrowser extends GameBase {
  static get GAME_NAME() { return 'gopher-browser'; }
  static get GAME_TITLE() { return 'Gopher Browser'; }

  async run() {
    // SCROLL mode is perfect for BBS-style text applications
    this.screen.setMode(Screen.SCROLL);
    this.terminal.clearScreen();
    
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLUE);
    this.terminal.println(Utils.center(' G O P H E R   B R O W S E R ', 80));
    this.terminal.resetAttrs();

    // Stack to manage navigation history
    let history = [{ type: 'bookmarks' }];

    while (history.length > 0) {
      let current = history[history.length - 1];
      
      if (current.type === 'bookmarks') {
        const action = await this._showMenu(current);
        if (action === 'quit') break;
        if (action && action.type === 'nav') history.push(action.target);
      } else if (current.type === '1' || current.type === '7') {
        const action = await this._showMenu(current);
        if (action === 'quit') break;
        if (action === 'back') history.pop();
        if (action && action.type === 'nav') {
          history.push(action.target);
        }
      } else if (current.type === '0') {
        const action = await this._showText(current);
        if (action === 'quit') break;
        if (action === 'back' || action === 'continue') history.pop();
      } else {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println(`\nUnsupported Gopher type: ${current.type}`);
        this.terminal.resetAttrs();
        history.pop();
      }
    }
    
    this._exitApp();
  }

  // --- Network Layer ---

  async _fetchGopher(host, port, selector, query = null) {
    return new Promise((resolve) => {
      const client = new net.Socket();
      let data = '';
      
      client.setTimeout(10000); // 10 second timeout
      
      client.on('data', (chunk) => {
        data += chunk.toString('utf8');
      });
      
      client.on('end', () => {
        resolve(data);
      });
      
      client.on('error', (err) => {
        this.log(`Gopher network error (${host}:${port}): ${err.message}`);
        client.destroy();
        resolve(null);
      });
      
      client.on('timeout', () => {
        this.log(`Gopher timeout (${host}:${port})`);
        client.destroy();
        resolve(null);
      });
      
      try {
        client.connect(port, host, () => {
          let req = selector || '';
          if (query) {
            req += '\t' + query;
          }
          client.write(req + '\r\n');
        });
      } catch (e) {
        this.log(`Gopher connection error: ${e.message}`);
        resolve(null);
      }
    });
  }

  // --- Core Application Views ---

  async _showMenu(target) {
    let rawData;
    
    if (target.type === 'bookmarks') {
      rawData = HOME_GOPHERMAP;
    } else {
      this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
      this.terminal.println(`\nFetching ${target.host}:${target.port}${target.selector}...`);
      this.terminal.resetAttrs();
      
      rawData = await this._fetchGopher(target.host, target.port, target.selector, target.query);
    }

    if (rawData === null) {
      this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
      this.terminal.println('Connection failed or timed out.');
      this.terminal.resetAttrs();
      
      this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
      this.terminal.print('\n[Enter] to go back... ');
      this.terminal.resetAttrs();
      await this.terminal.readLine({ echo: true });
      return 'back';
    }

    const items = this._parseGopherMenu(rawData);
    
    let page = 0;
    const ITEMS_PER_PAGE = 16; 
    const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
    
    while (true) {
      this.terminal.setColor(Color.BRIGHT_MAGENTA, Color.BLACK);
      const title = target.type === 'bookmarks' ? 'Home' : `${target.host}${target.selector}`;
      this.terminal.println(`\n=== Gopher: ${title} (Page ${page + 1}/${totalPages}) ===`);
      this.terminal.resetAttrs();

      const startIdx = page * ITEMS_PER_PAGE;
      const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, items.length);
      
      const actionMap = {};
      let actionCounter = 1;

      for (let i = startIdx; i < endIdx; i++) {
        const item = items[i];
        
        if (item.type === 'i') {
          this.terminal.setColor(Color.WHITE, Color.BLACK);
          this.terminal.println(`    ${item.display}`);
        } else if (item.isActionable) {
          actionMap[actionCounter] = item;
          
          this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
          this.terminal.print(`[${actionCounter.toString().padStart(2, ' ')}] `);
          
          // Color coding by type
          if (item.type === '0') this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
          else if (item.type === '1') this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
          else if (item.type === '7') this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
          else if (item.type === 'h') this.terminal.setColor(Color.BRIGHT_BLUE, Color.BLACK);
          else this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
          
          // Append type label
          let displayStr = item.display;
          if (item.type === '0') displayStr += ' (TXT)';
          else if (item.type === '1') displayStr += ' (DIR)';
          else if (item.type === '7') displayStr += ' (SEARCH)';
          else if (item.type === 'h') displayStr += ' (HTML)';
          else if (item.type === 'g' || item.type === 'I') displayStr += ' (IMG)';
          else if (item.type === '9' || item.type === '5' || item.type === 'd') displayStr += ' (BIN)';

          displayStr = displayStr.substring(0, 72); // ensure it fits on screen line
          this.terminal.println(displayStr);
          actionCounter++;
        }
      }

      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      let prompt = '\nCommand (';
      if (page > 0) prompt += '[p]rev, ';
      if (page < totalPages - 1) prompt += '[n]ext, ';
      prompt += '# to select, [b]ack, [u]rl, [q]uit): ';
      
      this.terminal.print(prompt);
      this.terminal.resetAttrs();

      const input = await this.terminal.readLine({ echo: true });
      const val = input.trim().toLowerCase();

      if (val === 'q') return 'quit';
      if (val === 'b') return target.type === 'bookmarks' ? 'stay' : 'back';
      if (val === 'n' && page < totalPages - 1) { page++; continue; }
      if (val === 'p' && page > 0) { page--; continue; }
      if (val === 'u') {
         const customTarget = await this._promptURL();
         if (customTarget) return { type: 'nav', target: customTarget };
         continue; // user cancelled url entry
      }

      const num = parseInt(val, 10);
      if (!isNaN(num) && actionMap[num]) {
        const selected = actionMap[num];
        
        if (selected.type === 'h') {
          this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
          this.terminal.println('\nCannot open HTML links natively. Target:');
          this.terminal.println(`${selected.selector.replace(/^URL:/, '')}`);
          this.terminal.resetAttrs();
          continue;
        } else if (selected.type === '7') {
          const query = await this._promptSearch(selected.display);
          if (query) {
            // Treat search results as a menu (type 1)
            return { type: 'nav', target: { ...selected, type: '1', query } };
          }
        } else if (selected.type === '0' || selected.type === '1') {
          return { type: 'nav', target: selected };
        } else {
          this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
          this.terminal.println('\nUnsupported file type (binary/image). Cannot view in terminal.');
          this.terminal.resetAttrs();
        }
      } else if (val !== '') {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Invalid selection.');
        this.terminal.resetAttrs();
      }
    }
  }

  async _showText(target) {
    this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
    this.terminal.println(`\nFetching ${target.host}:${target.port}${target.selector}...`);
    this.terminal.resetAttrs();
    
    const text = await this._fetchGopher(target.host, target.port, target.selector);
    if (text === null) {
      this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
      this.terminal.println('Connection failed or timed out.');
      this.terminal.resetAttrs();
      await this.terminal.readLine({ echo: true });
      return 'back';
    }

    const rawLines = text.replace(/\r/g, '').split('\n');
    const formattedLines = [];
    
    for (const line of rawLines) {
      if (line === '.') continue; // End of File marker in Gopher
      if (line.trim() === '') {
         formattedLines.push('');
         continue;
      }
      const cleanLine = this._cleanText(line);
      const wrapped = Utils.wordWrap(cleanLine, 79);
      formattedLines.push(...wrapped);
    }
    
    const CHUNK_SIZE = 20;
    this.terminal.setColor(Color.BRIGHT_BLUE, Color.BLACK);
    this.terminal.println(`\n--- ${target.host}${target.selector} ---`);
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    
    for (let i = 0; i < formattedLines.length; i += CHUNK_SIZE) {
      for (let j = 0; j < CHUNK_SIZE && (i + j) < formattedLines.length; j++) {
        this.terminal.println(formattedLines[i + j]);
      }
      
      if (i + CHUNK_SIZE < formattedLines.length) {
        this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
        this.terminal.print('\n[Enter] to continue, [q] to go back... ');
        this.terminal.resetAttrs();
        
        const ans = await this.terminal.readLine({ echo: true });
        const val = ans.trim().toLowerCase();
        
        if (val === 'q') return 'back';
        this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
      }
    }
    
    this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
    this.terminal.println('\n--- End of File ---');
    this.terminal.resetAttrs();
    
    this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
    this.terminal.print('\n[Enter] to go back... ');
    this.terminal.resetAttrs();
    await this.terminal.readLine({ echo: true });
    
    return 'back';
  }

  // --- Prompts & Parsers ---

  async _promptURL() {
    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.print('\nEnter Gopher URL (e.g. gopher.floodgap.com or sdf.org:70/1/dir): ');
    this.terminal.resetAttrs();
    
    const input = await this.terminal.readLine({ echo: true });
    const val = input.trim();
    if (!val) return null;
    
    let clean = val.replace(/^gopher:\/\//i, '');
    let host = clean;
    let port = '70';
    let type = '1';
    let selector = '';

    const firstSlash = clean.indexOf('/');
    if (firstSlash !== -1) {
      host = clean.substring(0, firstSlash);
      const path = clean.substring(firstSlash); // starts with '/'
      
      if (path.length >= 2 && path.charAt(2) === '/') {
        // e.g., /1/some/dir
        type = path.charAt(1);
        selector = path.substring(2); 
      } else {
        selector = path; 
      }
    }

    const colonIdx = host.indexOf(':');
    if (colonIdx !== -1) {
      port = host.substring(colonIdx + 1);
      host = host.substring(0, colonIdx);
    }
    
    return { type, host, port, selector };
  }

  async _promptSearch(display) {
    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.print(`\nSearch [${display}]: `);
    this.terminal.resetAttrs();
    
    const input = await this.terminal.readLine({ echo: true });
    return input.trim() || null;
  }

  _parseGopherMenu(data) {
    const lines = data.split(/\r?\n/);
    const items = [];
    
    for (let line of lines) {
      if (line === '.' || line.trim() === '') continue;
      
      const type = line.charAt(0);
      const parts = line.slice(1).split('\t');
      
      const display = this._cleanText(parts[0] || '');
      const selector = parts[1] || '';
      const host = parts[2] || '';
      const port = parts[3] || '70';
      
      const isActionable = type !== 'i' && type !== '3' && type !== 'e';
      
      items.push({ type, display, selector, host, port, isActionable });
    }
    return items;
  }

  _cleanText(str) {
    if (!str) return '';
    // Strip ANSI escape codes and unprintable characters that disrupt terminal layout
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); 
  }

  _exitApp() {
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    this.terminal.println('\nExiting Gopher Browser...');
    this.terminal.resetAttrs();
  }
}

module.exports = GopherBrowser;