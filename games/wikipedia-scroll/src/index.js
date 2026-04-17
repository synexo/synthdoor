'use strict';
const path = require('path');

// CRITICAL: Always use path.join for engine imports
const { GameBase, Screen, Color } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);

// CRITICAL: Import Utils DIRECTLY from utils.js
const Utils = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'utils.js')
);

// Configurable User-Agent
const WIKI_USER_AGENT = 'Synthdoor/0.0 (http://bbs.birdenuf.com)';

const TOPICS = [
  { name: 'Culture', category: 'Category:Culture' },
  { name: 'History', category: 'Category:History' },
  { name: 'Society', category: 'Category:Society' },
  { name: 'The Arts', category: 'Category:The_arts' },
  { name: 'Religion', category: 'Category:Religion' },
  { name: 'Geography', category: 'Category:Geography' },
  { name: 'Literature', category: 'Category:Literature' },
  { name: 'Philosophy', category: 'Category:Philosophy' },
  { name: 'Technology', category: 'Category:Technology' },
  { name: 'Mathematics', category: 'Category:Mathematics' },
  { name: 'Law & Justice', category: 'Category:Law' },
  { name: 'Popular Culture', category: 'Category:Popular_culture' }, 
  { name: 'Social Sciences', category: 'Category:Social_sciences' }, 
  { name: 'Natural Sciences', category: 'Category:Natural_sciences' },
  { name: 'Internet Culture', category: 'Category:Internet_culture' },
  { name: 'Business & Economics', category: 'Category:Business' },
  { name: 'Politics & Government', category: 'Category:Politics' },
  { name: 'Media & Communication', category: 'Category:Media' },
  { name: 'Language & Linguistics', category: 'Category:Language' }
];

class WikipediaScroll extends GameBase {
  static get GAME_NAME() { return 'wikipedia-scroll'; }
  static get GAME_TITLE() { return 'Wikipedia Scroll'; }

  async run() {
    this.lastApiCallTime = 0; // Initialize rate-limiter timer

    // SCROLL mode is perfect for CLI-style apps
    this.screen.setMode(Screen.SCROLL);
    this.terminal.clearScreen();
    
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLUE);
    this.terminal.println(Utils.center(' W I K I P E D I A   S C R O L L ', 80));
    this.terminal.resetAttrs();

    // 1. Show Daily News
    const newsResult = await this._showNews();
    if (newsResult === 'quit') return this._exitApp();

    // 2. Show On This Day
    const otdResult = await this._showOnThisDay();
    if (otdResult === 'quit') return this._exitApp();

    // 3. Endless Random Article Loop
    await this._randomLoop();
    
    this._exitApp();
  }

  // --- Data Cleaning ---

  /**
   * Strips HTML tags, decodes HTML entities, and transliterates common 
   * typographic Unicode characters into standard ASCII/CP437 symbols.
   */
  _cleanText(str) {
    if (!str) return '';
    return str
      .replace(/<[^>]+>/g, '')         // Strip all HTML tags
      .replace(/&quot;/g, '"')         // Decode entities
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&ndash;/g, '-')
      .replace(/&mdash;/g, '-')
      .replace(/[\u2018\u2019]/g, "'") // Smart single quotes
      .replace(/[\u201C\u201D]/g, '"') // Smart double quotes
      .replace(/[\u2013\u2014]/g, '-') // En and Em dashes
      .replace(/\u2026/g, '...')       // Ellipsis
      .replace(/\u00A0/g, ' ')         // Non-breaking space
      .trim();
  }

  // --- Caching Utilities ---
  
  _cleanupCache() {
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    // Clean Summaries
    for (const cat in WikipediaScroll.G_CACHE.summaries) {
      const map = WikipediaScroll.G_CACHE.summaries[cat];
      for (const [title, entry] of map.entries()) {
        if (now - entry.ts > THIRTY_DAYS) map.delete(title);
      }
      // Keep max 100 rolling LRU
      while (map.size > 100) map.delete(map.keys().next().value);
    }
    
    // Clean Articles
    const artMap = WikipediaScroll.G_CACHE.articles;
    for (const [title, entry] of artMap.entries()) {
      if (now - entry.ts > THIRTY_DAYS) artMap.delete(title);
    }
    while (artMap.size > 100) artMap.delete(artMap.keys().next().value);
  }

  // --- Core Application Loops ---

  async _showNews() {
    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.println('\nFetching daily news...');
    this.terminal.resetAttrs();

    // Get today's date formatted for Wikipedia API (YYYY/MM/DD)
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;

    let data = null;
    const cache = WikipediaScroll.G_CACHE.news;
    
    // Global cache layer for news: valid for 1 hour OR until date rolls over
    if (cache.dateStr === dateStr && cache.data && (Date.now() - cache.ts < 3600000)) {
      data = cache.data;
    } else {
      const url = `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${day}`;
      data = await this._fetchWiki(url);
      if (data) {
        cache.data = data;
        cache.ts = Date.now();
        cache.dateStr = dateStr;
      }
    }

    let items = [];
    if (data && data.news) {
      // Clean HTML and Unicode out of the story text and titles
      items = data.news.map(n => ({
        text: this._cleanText(n.story),
        title: n.links && n.links.length > 0 ? this._cleanText(n.links[0].title) : null
      })).filter(n => n.title);
    }

    if (items.length === 0) {
      this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
      this.terminal.println('No news available right now.');
      this.terminal.resetAttrs();
      return 'continue';
    }

    let needsRedraw = true;

    // News prompt loop
    while (true) {
      if (needsRedraw) {
        this.terminal.setColor(Color.BRIGHT_MAGENTA, Color.BLACK);
        this.terminal.println(`\n=== Today on Wikipedia (${dateStr}) ===`);
        this.terminal.resetAttrs();

        for (let i = 0; i < items.length; i++) {
          this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
          this.terminal.print(`\n[${i + 1}] `);
          
          // Set main text color
          this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
          
          const wrapped = Utils.wordWrap(items[i].text, 74); // 80 - len('[x] ')
          this.terminal.println(wrapped[0]);
          for (let j = 1; j < wrapped.length; j++) {
            this.terminal.println('    ' + wrapped[j]);
          }
        }

        this.terminal.setColor(Color.WHITE, Color.BLACK);
        this.terminal.println('\nResults provided by Wikipedia (CC BY-SA 4.0)');
        needsRedraw = false;
      }

      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      this.terminal.print('\nChoose an item or hit enter for more (q to quit, i for info): ');
      this.terminal.resetAttrs();
      
      const choice = await this.terminal.readLine({ echo: true });
      const val = choice.trim().toLowerCase();
      
      if (val === 'q') return 'quit';
      if (val === '') return 'continue'; // Move to On This Day
      if (val === 'i') {
        await this._showInfo();
        needsRedraw = true; // Repaint the menu list after info
        continue;
      }

      const idx = parseInt(val, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        await this._readArticle(items[idx].title);
        needsRedraw = true; // Repaint the menu list after returning from a long article
      } else {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Invalid selection.');
        this.terminal.resetAttrs();
      }
    }
  }

  async _showOnThisDay() {
    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.println('\nFetching On This Day events...');
    this.terminal.resetAttrs();

    const d = new Date();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const dateStr = `${m}/${day}`;

    let data = null;
    const cache = WikipediaScroll.G_CACHE.otd;
    
    // Global cache layer for OTD: valid for current date
    if (cache.dateStr === dateStr && cache.data) {
      data = cache.data;
    } else {
      const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${m}/${day}`;
      data = await this._fetchWiki(url);
      if (data) {
        cache.data = data;
        cache.dateStr = dateStr;
      }
    }

    let items = [];
    if (data && data.selected) {
      items = data.selected.map(n => ({
        year: n.year,
        text: this._cleanText(n.text),
        title: n.pages && n.pages.length > 0 ? this._cleanText(n.pages[0].title) : null
      })).filter(n => n.title);
    }

    if (items.length === 0) {
      return 'continue';
    }

    // Limit output to maximum 19 rows so prompt remains visible
    let finalItems = [];
    let rowsUsed = 2; // header uses 2 lines
    
    for (let item of items) {
      const combinedText = `[${item.year}] ${item.text}`;
      const wrapped = Utils.wordWrap(combinedText, 74);
      const itemRows = 1 + wrapped.length; // 1 spacing line + wrapped content lines
      
      if (rowsUsed + itemRows > 19) break;
      
      finalItems.push({ item, wrapped });
      rowsUsed += itemRows;
    }

    let needsRedraw = true;

    while (true) {
      if (needsRedraw) {
        this.terminal.setColor(Color.BRIGHT_MAGENTA, Color.BLACK);
        this.terminal.println(`\n=== On This Day (${dateStr}) ===`);
        this.terminal.resetAttrs();

        for (let i = 0; i < finalItems.length; i++) {
          this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
          this.terminal.print(`\n[${i + 1}] `);
          
          this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
          const wrapped = finalItems[i].wrapped;
          this.terminal.println(wrapped[0]);
          for (let j = 1; j < wrapped.length; j++) {
            this.terminal.println('    ' + wrapped[j]);
          }
        }

        this.terminal.setColor(Color.WHITE, Color.BLACK);
        this.terminal.println('\nResults provided by Wikipedia (CC BY-SA 4.0)');
        needsRedraw = false;
      }

      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      this.terminal.print('\nChoose an item or hit enter for more (q to quit, i for info): ');
      this.terminal.resetAttrs();
      
      const choice = await this.terminal.readLine({ echo: true });
      const val = choice.trim().toLowerCase();
      
      if (val === 'q') return 'quit';
      if (val === '') return 'continue'; // Move to random articles
      if (val === 'i') {
        await this._showInfo();
        needsRedraw = true;
        continue;
      }

      const idx = parseInt(val, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < finalItems.length) {
        await this._readArticle(finalItems[idx].item.title);
        needsRedraw = true; // Repaint the menu list after returning
      } else {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Invalid selection.');
        this.terminal.resetAttrs();
      }
    }
  }

  async _randomLoop() {
    let currentTopic = null;
    const historyKey = 'summary_history';

    while (true) {
      this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
      this.terminal.print('\n--- Finding next article...');
      this.terminal.resetAttrs();

      let summary = null;
      
      // Load user's rolling history of the last 100 viewed summaries
      let history = this.db.getPlayerData(WikipediaScroll.GAME_NAME, this.username, historyKey, []);
      
      const topicKey = currentTopic ? currentTopic.name : 'General';
      if (!WikipediaScroll.G_CACHE.summaries[topicKey]) {
        WikipediaScroll.G_CACHE.summaries[topicKey] = new Map();
      }
      const catCache = WikipediaScroll.G_CACHE.summaries[topicKey];

      // 1. CACHE FIRST: Attempt to locate a summary in global cache this user hasn't seen
      for (const [title, cachedSum] of catCache.entries()) {
        if (!history.includes(title)) {
          summary = cachedSum.data;
          
          // Re-insert to bump LRU ordering
          catCache.delete(title);
          catCache.set(title, { data: summary, ts: Date.now() });
          break;
        }
      }

      // 2. FETCH FALLBACK: No unseen cache entries exist, pull from API
      if (!summary) {
        if (currentTopic) {
          // Check if we already have the category members list
          let members = WikipediaScroll.G_CACHE.categoryMembers[topicKey];
          if (!members) {
            const listUrl = `https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmnamespace=0&cmtitle=${encodeURIComponent(currentTopic.category)}&cmlimit=500&format=json`;
            const listData = await this._fetchWiki(listUrl, true);
            if (listData && listData.query && listData.query.categorymembers) {
              members = listData.query.categorymembers.map(m => m.title);
              WikipediaScroll.G_CACHE.categoryMembers[topicKey] = members;
            }
          }

          if (members && members.length > 0) {
            const available = members.filter(m => !history.includes(m));
            const pageTitle = available.length > 0 ? Utils.pick(available) : Utils.pick(members);
            const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
            summary = await this._fetchWiki(sumUrl, true);
          }
        } else {
          // General random article
          const sumUrl = 'https://en.wikipedia.org/api/rest_v1/page/random/summary';
          summary = await this._fetchWiki(sumUrl, true);
        }

        // Add successful fetches to the global cache
        if (summary && summary.title) {
          catCache.set(summary.title, { data: summary, ts: Date.now() });
          this._cleanupCache();
        }
      }

      // Finish the "Finding next article..." line that may have dot-appended via rate limiting
      this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
      this.terminal.println(' ---');
      this.terminal.resetAttrs();

      if (!summary || !summary.title) {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Error fetching article. Retrying...');
        this.terminal.resetAttrs();
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      // 3. UPDATE USER HISTORY
      if (!history.includes(summary.title)) {
        history.push(summary.title);
        if (history.length > 100) history.shift();
        this.db.setPlayerData(WikipediaScroll.GAME_NAME, this.username, historyKey, history);
      }

      const cleanTitle = this._cleanText(summary.title);
      const cleanExtract = this._cleanText(summary.extract || 'No overview available.');

      // Display the summary/overview header
      this.terminal.setColor(Color.BRIGHT_MAGENTA, Color.BLACK);
      this.terminal.println(`\n=== ${cleanTitle} ===`);
      
      // Display the extract text in BRIGHT_WHITE
      this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
      const extractLines = Utils.wordWrap(cleanExtract, 79);
      extractLines.forEach(l => this.terminal.println(l));

      this.terminal.setColor(Color.WHITE, Color.BLACK);
      this.terminal.println('\nResults provided by Wikipedia (CC BY-SA 4.0)');

      // Random article prompt loop
      while (true) {
        this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
        this.terminal.print('\n[R]ead article, switch [T]opic, [S]earch, [I]nfo or [Q]uit ? ');
        this.terminal.resetAttrs();

        const ans = await this.terminal.readLine({ echo: true });
        const val = ans.trim().toLowerCase();

        if (val === 'q') return; // Exit loop, effectively quitting the app
        if (val === '') break;   // Break inner loop to fetch next random article
        
        if (val === 'r') {
          await this._readArticle(summary.title); // Send raw title to API, not the cleaned one
          break; // Break loop so we immediately fetch the next article after reading
        } else if (val === 't') {
          currentTopic = await this._chooseTopic();
          break; // Break inner loop to fetch a NEW random article using the new topic
        } else if (val === 's') {
          await this._searchArticle();
          break; // Break inner loop to get a fresh random article after searching
        } else if (val === 'i') {
          await this._showInfo();
        } else {
          this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
          this.terminal.println('Unknown command.');
          this.terminal.resetAttrs();
        }
      }
    }
  }

  // --- Utility Views ---

  async _showInfo() {
    this.terminal.setColor(Color.WHITE, Color.BLACK);
    this.terminal.println('----------------------------------------------------------------------------');
    this.terminal.println('                            SERVICE INFORMATION');
    this.terminal.println('----------------------------------------------------------------------------');
    this.terminal.println('\nDisclaimer: This service is not affiliated with the Wikimedia Foundation.');
    this.terminal.println('Results provided by Wikipedia (CC BY-SA 4.0)');
    this.terminal.println('All text output licensed CC BY-SA 4.0');
    this.terminal.println('https://creativecommons.org/licenses/by-sa/4.0/');
    this.terminal.println('\n--- License Summary ---');
    this.terminal.println('You are free to Share (copy/redistribute) and Adapt (remix/transform) this');
    this.terminal.println('material for any purpose, even commercially, under these terms:');
    this.terminal.println('\n* Attribution: You must give appropriate credit and indicate if changes');
    this.terminal.println('  were made to the original text.');
    this.terminal.println('* ShareAlike: If you remix, transform, or build upon the material, you');
    this.terminal.println('  must distribute your contributions under the same license.');
    this.terminal.println('\nNo warranties are given. This application performs real-time technical');
    this.terminal.println('transformations for terminal display. All original content remains the');
    this.terminal.println('intellectual property of Wikipedia editors.');
    this.terminal.println('\nFull Legal Code: https://creativecommons.org/licenses/by-sa/4.0/legalcode');
    this.terminal.resetAttrs();
  }

  async _searchArticle() {
    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.print('\nEnter search query: ');
    this.terminal.resetAttrs();

    const query = await this.terminal.readLine({ echo: true });
    const qTrimmed = query.trim();
    if (!qTrimmed) return;

    this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
    this.terminal.println('Searching...');
    this.terminal.resetAttrs();

    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(qTrimmed)}&format=json&srlimit=10`;
    const data = await this._fetchWiki(url);

    if (!data || !data.query || !data.query.search || data.query.search.length === 0) {
      this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
      this.terminal.println('No results found.');
      this.terminal.resetAttrs();
      return;
    }

    const results = data.query.search;

    // Attempt to provide exact article match first
    const exactMatch = results.find(r => r.title.toLowerCase() === qTrimmed.toLowerCase());
    if (exactMatch) {
      this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
      this.terminal.println(`\nExact match found for "${exactMatch.title}"!`);
      this.terminal.resetAttrs();
      await this._readArticle(exactMatch.title);
      return;
    }

    // If no exact match, show the short list of possibilities
    this.terminal.setColor(Color.BRIGHT_MAGENTA, Color.BLACK);
    this.terminal.println(`\n=== Search Results for "${qTrimmed}" ===`);
    this.terminal.resetAttrs();

    for (let i = 0; i < results.length; i++) {
      this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
      this.terminal.print(`[${i + 1}] `);
      this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
      this.terminal.println(this._cleanText(results[i].title));
    }

    while (true) {
      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      this.terminal.print('\nChoose article number (or enter to cancel): ');
      this.terminal.resetAttrs();

      const ans = await this.terminal.readLine({ echo: true });
      const val = ans.trim();

      if (val === '') return; // Cancel search
      
      const idx = parseInt(val, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < results.length) {
        await this._readArticle(results[idx].title);
        return;
      } else {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Invalid selection.');
        this.terminal.resetAttrs();
      }
    }
  }

  async _readArticle(title) {
    this.terminal.setColor(Color.CYAN, Color.BLACK);
    this.terminal.println(`\nLoading full article: ${this._cleanText(title)}...`);
    this.terminal.resetAttrs();

    let formattedLines;
    const artCache = WikipediaScroll.G_CACHE.articles;

    // Utilize Article Cache Memory Layer First
    if (artCache.has(title)) {
      const entry = artCache.get(title);
      artCache.delete(title); // Remap for LRU order bump
      entry.ts = Date.now();
      artCache.set(title, entry);
      formattedLines = entry.data;
    } else {
      // Fetch plain text extract (explaintext=1 removes HTML formatting at the API level)
      const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json`;
      const res = await this._fetchWiki(url);

      if (!res || !res.query || !res.query.pages) {
        this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
        this.terminal.println('Could not load article.');
        this.terminal.resetAttrs();
        return;
      }

      const pages = res.query.pages;
      const pageId = Object.keys(pages)[0];
      let rawExtract = pages[pageId].extract || 'No text available.';
      
      // Strip standard appendix sections and everything after them
      rawExtract = rawExtract.replace(/(?:^|\n)={2,}\s*(See also|References|Further reading|External links|Notes|Bibliography)\s*={2,}[\s\S]*/i, '');

      // Separate paragraphs and isolate headers
      const rawParagraphs = rawExtract.split('\n');
      formattedLines = [];

      for (let p of rawParagraphs) {
        p = p.trim();
        
        // Preserve paragraph breaks
        if (!p) {
          if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== '') {
            formattedLines.push('');
          }
          continue;
        }

        // Check for section headers (e.g., == Header == or === Subheader ===)
        const headerMatch = p.match(/^(=+)\s*(.*?)\s*\1$/);
        if (headerMatch) {
          if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== '') {
            formattedLines.push('');
          }
          formattedLines.push(`[ ${headerMatch[2].toUpperCase()} ]`);
          formattedLines.push('');
        } else {
          // Standard text paragraph
          const cleanP = this._cleanText(p);
          const wrapped = Utils.wordWrap(cleanP, 79);
          formattedLines.push(...wrapped);
          formattedLines.push('');
        }
      }

      // Add to Cache Memory
      artCache.set(title, { data: formattedLines, ts: Date.now() });
      this._cleanupCache();
    }

    const cleanTitle = this._cleanText(title);
    const lines = formattedLines;
    const CHUNK_SIZE = 20;

    // Set article header color to BRIGHT_BLUE
    this.terminal.setColor(Color.BRIGHT_BLUE, Color.BLACK);
    this.terminal.println(`\n--- ${cleanTitle} ---`);
    
    // Set article text color to BRIGHT_WHITE
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);

    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
      // Print chunk
      for (let j = 0; j < CHUNK_SIZE && (i + j) < lines.length; j++) {
        this.terminal.println(lines[i + j]);
      }

      // Pause if there is more to read
      if (i + CHUNK_SIZE < lines.length) {
        this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
        this.terminal.print('\n[Enter] to continue, [s] to search, or [q] to go back... ');
        
        // Ensure inputs register without color artifacts bleeding
        this.terminal.resetAttrs();
        
        const ans = await this.terminal.readLine({ echo: true });
        const val = ans.trim().toLowerCase();
        
        if (val === 'q') {
          break;
        } else if (val === 's') {
          await this._searchArticle();
          return; // Exit the current article pagination to allow the fresh search to proceed
        }
        
        // Restore main text color if we continue reading
        this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
      }
    }

    // Source link mapping spaces to underscores for the Wikipedia URL
    this.terminal.setColor(Color.WHITE, Color.BLACK);
    const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    this.terminal.println(`\nSource: Wikipedia (CC BY-SA 4.0)`);
    this.terminal.println(`${articleUrl}`);

    this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
    this.terminal.println('\n--- End of Article ---');
    this.terminal.resetAttrs();

    this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
    this.terminal.print('\n[Enter] for next or [s] to search... ');
    
    // Ensure inputs register without color artifacts bleeding
    this.terminal.resetAttrs();
        
    const ans = await this.terminal.readLine({ echo: true });
    const val = ans.trim().toLowerCase();
        
    if (val === 's') {
      await this._searchArticle();
      return; // Exit the current article pagination to allow the fresh search to proceed
    }
        
    // Restore main text color if we continue reading
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);

  }

  async _chooseTopic() {
    this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
    this.terminal.println('\nSelect a Topic Filter:\n');
    
    for (let i = 0; i < TOPICS.length; i++) {

      this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
      if (i < 9 ) {this.terminal.print(' ');} //placeholder
      this.terminal.print(`[${i + 1}] `);
      this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);     
      this.terminal.println(`${TOPICS[i].name}`);
    }

    this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
    this.terminal.print(` [0] `);
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    this.terminal.println(`Any (Random)`);
    this.terminal.resetAttrs();

    while (true) {
      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      this.terminal.print('\nChoose topic number: ');
      this.terminal.resetAttrs();
      
      const ans = await this.terminal.readLine({ echo: true });
      const val = ans.trim();
      
      if (val === '0') return null;

      const idx = parseInt(val, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < TOPICS.length) {
        this.terminal.setColor(Color.BRIGHT_GREEN, Color.BLACK);
        this.terminal.println(`Topic set to: ${TOPICS[idx].name}`);
        this.terminal.resetAttrs();
        return TOPICS[idx];
      }
      
      this.terminal.setColor(Color.LIGHT_RED, Color.BLACK);
      this.terminal.println('Invalid selection.');
      this.terminal.resetAttrs();
    }
  }

  // --- Network Wrapper ---

  async _fetchWiki(url, echoDots = false) {
    try {
      // 1. Enforce per-user API rate limit of 1 outbound request every 5 seconds
      const now = Date.now();
      const elapsed = now - this.lastApiCallTime;
      if (elapsed < 5000) {
        const waitMs = 5000 - elapsed;
        const ticks = Math.ceil(waitMs / 1000);
        
        for (let i = 0; i < ticks; i++) {
          await new Promise(r => setTimeout(r, 1000));
          if (echoDots) {
            this.terminal.setColor(Color.DARK_GRAY, Color.BLACK);
            this.terminal.print('.');
            this.terminal.resetAttrs();
          }
        }
      }
      this.lastApiCallTime = Date.now();

      // 2. Perform outbound request
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 6000);
      
      const res = await fetch(url, {
        headers: { 'User-Agent': WIKI_USER_AGENT },
        signal: controller.signal
      });
      clearTimeout(id);
      
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      this.log(`Wiki API Error: ${e.message}`);
      return null;
    }
  }

  _exitApp() {
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    this.terminal.println('\nExiting Wikipedia Scroll...');
    this.terminal.resetAttrs();
  }
}

// Ensure the class cache structure exists
WikipediaScroll.G_CACHE = {
  news: { data: null, ts: 0, dateStr: '' },
  otd: { data: null, dateStr: '' },
  summaries: {},           // Map strings -> Map{ title -> cache data }
  articles: new Map(),     // Map{ title -> array of wrapped string lines }
  categoryMembers: {}      // Map strings -> String[]
};

module.exports = WikipediaScroll;