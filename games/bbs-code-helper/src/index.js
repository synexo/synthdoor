'use strict';

/**
 * games/bbs-code-helper/src/index.js
 *
 * Helper for visiting BBS operators who want to wire their BBS into
 * SynthDoor via rlogin so that their users can connect.
 *
 * Flow:
 *   1) (Sysop only) Choose: register a new BBS, or list existing.
 *   2) Registration: ask BBS name, ask BBS address, confirm.
 *   3) Mint a BBS Code (XXXX-XXXX), persist the registration.
 *   4) Paged reader walks the operator through per-BBS-software
 *      cheat-sheets showing how to wire the code into their BBS.
 *
 * Open to all users — anyone can register their BBS and get a code.
 * Sysops additionally see a "list registered BBSes" option.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  All operator-facing text and example connection strings live in     │
 * │  the EDITABLE CONFIG block below. Edit those constants freely — the  │
 * │  rest of the file is just plumbing.                                  │
 * └──────────────────────────────────────────────────────────────────────┘
 */

const path = require('path');
const fs   = require('fs');

// Helper: canonicalise a require path so server-internal singleton-bearing
// modules (auth-flow, logger, roles) hit the same module-cache slot the
// server populated at startup. See CLAUDE.md Rule 7 for the full rationale.
// In short: `path.join` preserves the case Node gave us for __dirname,
// while the server's own short-relative `require('./logger')` resolves
// through Node's resolver which can produce a different case on Windows.
// Two different case-spellings = two separate module records = two
// separate private `_instance = null`s. Composing require.resolve with
// fs.realpathSync forces a single canonical string regardless of caller.
const _resolveServerModule = (p) => fs.realpathSync(require.resolve(p));

const { GameBase, Screen, Color } = require(
  path.join(__dirname, '..', '..', '..', 'packages', 'engine', 'src', 'index.js')
);
const { getAuth } = require(_resolveServerModule(
  path.join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'auth-flow.js')
));
const { isSysop } = require(_resolveServerModule(
  path.join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'roles.js')
));
const { getLogger } = require(_resolveServerModule(
  path.join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'logger.js')
));

// ═══════════════════════════════════════════════════════════════════════════
//                         BEGIN EDITABLE CONFIG
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything between BEGIN and END EDITABLE CONFIG is meant for the
// SynthDoor operator to edit. The rest of the file just renders what's
// defined here.
//
// What you may want to change:
//
//   1) SERVER_INFO    — the host/port your SynthDoor is reachable at.
//   2) WELCOME_LINES  — shown on the first screen before any prompts.
//   3) PROMPTS        — the wording of the registration questions.
//   4) NAIVE_MODE_NOTICE — shown if the server is in `naive` auth mode.
//   5) RECIPES        — per-BBS-software cheat-sheets (Synchronet,
//                       Mystic, WWIV, telnetdoor.exe, generic).
//   6) FOOTER_LINES   — shown on the final page after all recipes.
//   7) MACROS         — placeholder substitutions (@HOST@, etc.).
//
// All text is shown one screen-page at a time; the paged reader handles
// wrapping at the column-80 boundary. Lines that need to be exactly a
// certain width (boxes, banners) are capped at 79 visible chars to avoid
// the wrap-at-column-80 trap; this file's helpers enforce that.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Public-facing connection details for this SynthDoor instance.
 * Used to expand @HOST@ and @PORT@ in the example connection strings.
 *
 * `config` is the engine-supplied per-game config dict, which exposes
 * keys from synthdoor.conf (top-level + [game:bbs-code-helper] section).
 */
const SERVER_INFO = (config) => ({
  // The hostname or IP that partner BBSes should rlogin to.
  // Set `public_hostname` in synthdoor.conf under [game:bbs-code-helper]
  // to override per-instance. Default is a placeholder.
  host: config.public_hostname || 'your-synthdoor-host.example.com',

  // The rlogin port. Defaults to the server-wide rlogin_port (usually
  // 1513). If you've forwarded it to the standard 513, change this.
  port: config.public_rlogin_port || config.rlogin_port || 1513,
});

/**
 * Welcome screen lines (page 1, before the registration questions).
 * Each entry is one line; empty strings render as blank rows. Lines
 * must be <= 78 visible chars (we use 79-char content area).
 */
const WELCOME_LINES = [
  '',
  '  Welcome to the BBS Code Helper.',
  '',
  '  This tool registers your BBS with this SynthDoor server and gives',
  '  you a "BBS Code" you can use to connect your users in via rlogin.',
  '',
  '  How it works:',
  '',
  '    1. You tell us the name and connect address of your BBS.',
  '    2. We generate a BBS Code (XXXX-XXXX) tied to that registration.',
  '    3. You install the code in your BBS configuration alongside a',
  '       connect-to-SynthDoor menu entry.',
  '    4. Your users pick that menu entry, your BBS opens rlogin to us,',
  '       and we silently log them straight into the game.',
  '',
  '  After registration we\'ll walk you through the exact connection',
  '  strings for Synchronet, Mystic, WWIV, telnetdoor.exe, and generic',
  '  rlogin clients.',
  '',
];

/**
 * Wording of the registration questions. Each is shown on its own,
 * with the user typing a response on the next line.
 */
const PROMPTS = {
  bbsName:        '  Name of your BBS                : ',
  bbsAddress:     '  Connect address (host or host:port): ',
  confirmHeader:  '  Please confirm:',
  confirmYesNo:   '  Generate a BBS Code now?',
};

/**
 * Shown if the server is currently in `naive` auth mode. BBS Codes
 * (recovery codes) only function in `authenticated` mode. The code is
 * still generated and recorded; it begins working as soon as the
 * SynthDoor operator switches modes.
 */
const NAIVE_MODE_NOTICE = [
  '',
  '  NOTICE: This SynthDoor is in NAIVE auth mode. BBS Codes only',
  '  function in AUTHENTICATED mode. Your code is still recorded and',
  '  will begin working as soon as the operator switches modes.',
];

/**
 * Final-page lines shown after all recipes have been walked.
 */
const FOOTER_LINES = [
  '',
  '  That\'s it. Once your BBS is wired up, your users should be able',
  '  to choose your SynthDoor menu entry and land here automatically.',
  '',
  '  Need another code, or want to register a different BBS? Just',
  '  relaunch this helper. Each registration is independent — you can',
  '  hand a different code to each partner BBS or rotate them whenever',
  '  you like.',
  '',
  '  If you run into trouble, the full rlogin handshake is documented',
  '  in:   packages/server/src/transports/rlogin.js',
  '',
  '  Thanks for federating with us!',
  '',
];

/**
 * Per-BBS-software connection recipes. Each entry produces one page.
 *
 * Each recipe has:
 *   - `name`     : Page header.
 *   - `notes`    : Array of paragraph strings shown above the examples.
 *                  Each string is one rendered line — no auto-wrap.
 *   - `examples` : Array of { label, command } pairs. The command can
 *                  span multiple lines (\n in the string), and may use
 *                  the macros listed under MACROS below.
 *
 * Long command strings: split them across multiple lines manually with
 * \n + indent. The reader does NOT auto-wrap commands, because mid-flag
 * line breaks would invalidate the example. Each visible line of an
 * example must be <= 75 characters (we indent 4 chars + arrow).
 */
const RECIPES = [
  // ─── Synchronet ────────────────────────────────────────────────────────
  {
    name: 'Synchronet',
    notes: [
      'Add a new external program (xtrn.cnf) or door menu item that',
      'uses the SyncTERM rlogin client. The rlogin fields map as:',
      '',
      '  ClientUser  ->  your BBS user\'s alias',
      '  ServerUser  ->  your BBS Code (the XXXX-XXXX value)',
      '  TermType    ->  blank, or SynthDoor game name (e.g. meteoroid)',
    ],
    examples: [
      {
        label: 'Launch the SynthDoor main menu',
        command:
          '?rlogin @HOST@:@PORT@ -h -s@BBSCODE@ -q -tANSI',
      },
      {
        label: 'Launch directly into Meteoroid',
        command:
          '?rlogin @HOST@:@PORT@ -h -s@BBSCODE@ -q -tmeteoroid',
      },
    ],
  },

  // ─── Mystic ────────────────────────────────────────────────────────────
  {
    name: 'Mystic BBS',
    notes: [
      'Mystic ships with its own rlogin client. Add a menu command of',
      'type GE (Gosub External) or a doors.dat entry pointing at the',
      'client with the parameters below. The /PROMPT flag hides the',
      'connection details from your callers (recommended).',
    ],
    examples: [
      {
        label: 'Launch the SynthDoor main menu',
        command:
          '/addr=@HOST@ /port=@PORT@ /user=@USERNAME@\n' +
          '  /pass=@BBSCODE@ /term=ANSI /PROMPT',
      },
      {
        label: 'Launch directly into Meteoroid',
        command:
          '/addr=@HOST@ /port=@PORT@ /user=@USERNAME@\n' +
          '  /pass=@BBSCODE@ /term=meteoroid /PROMPT',
      },
    ],
  },

  // ─── WWIV ──────────────────────────────────────────────────────────────
  {
    name: 'WWIV',
    notes: [
      'WWIV supports rlogin via //net or built-in chain configuration.',
      'Add a chain entry whose command line invokes an rlogin client',
      'with the parameters below. Many sysops use telnetdoor.exe or a',
      'similar shim on Windows.',
    ],
    examples: [
      {
        label: 'Generic WWIV chain command line',
        command:
          'rlogin @HOST@ @PORT@ -l @USERNAME@\n' +
          '  -s @BBSCODE@ -t ANSI',
      },
    ],
  },

  // ─── telnetdoor.exe ────────────────────────────────────────────────────
  {
    name: 'telnetdoor.exe (DOS / Windows shim)',
    notes: [
      'Widely used to bridge legacy DOS doors to rlogin servers. Flags:',
      '',
      '  -R               use rlogin instead of telnet',
      '  -S<host>:<port>  remote server',
      '  -Y"<user>"       ClientUser (your BBS user)',
      '  -X"<password>"   ServerUser (the BBS Code)',
      '  -Z<term>         TermType (game name or "ANSI")',
      '  -D<dropfile>     path to door32.sys/dorinfo1.def',
    ],
    examples: [
      {
        label: 'Launch the SynthDoor main menu',
        command:
          'telnetdoor.exe -R -S@HOST@:@PORT@\n' +
          '  -Y"@USERNAME@" -X"@BBSCODE@" -ZANSI -D%1 -W0',
      },
      {
        label: 'Launch directly into Meteoroid',
        command:
          'telnetdoor.exe -R -S@HOST@:@PORT@\n' +
          '  -Y"@USERNAME@" -X"@BBSCODE@" -Zmeteoroid -D%1 -W0',
      },
    ],
  },

  // ─── Generic rlogin ────────────────────────────────────────────────────
  {
    name: 'Generic rlogin (anything else)',
    notes: [
      'For BBS software not listed above, the underlying rlogin wire',
      'format is just three null-terminated strings on top of a TCP',
      'connection to port @PORT@:',
      '',
      '  \\0 <ClientUser> \\0 <ServerUser> \\0 <TermType> \\0',
      '',
      'Map your BBS\'s fields to:',
      '',
      '  ClientUser  ->  the username from your BBS',
      '  ServerUser  ->  the BBS Code',
      '  TermType    ->  game name (e.g. meteoroid) or "ANSI"',
    ],
    examples: [
      {
        label: 'Wire-level handshake (illustrative)',
        command:
          '<TCP connect to @HOST@:@PORT@>\n' +
          '\\0@USERNAME@\\0@BBSCODE@\\0ANSI\\0\n' +
          '<server replies \\0 to acknowledge>',
      },
    ],
  },
];

/**
 * Macro substitution map. Each key is a literal token that may appear
 * in WELCOME_LINES, PROMPTS, RECIPES, FOOTER_LINES, or NAIVE_MODE_NOTICE;
 * each value is a function that receives the runtime context and returns
 * the replacement string.
 */
const MACROS = {
  '@HOST@':     (ctx) => ctx.host,
  '@PORT@':     (ctx) => String(ctx.port),
  '@BBSCODE@':  (ctx) => ctx.bbsCode,
  '@USERNAME@': (ctx) => ctx.username,
};

// ═══════════════════════════════════════════════════════════════════════════
//                          END EDITABLE CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Layout constants
const CONTENT_WIDTH = 78;   // max visible chars per content line
const PAGE_BODY_ROWS = 20;  // content rows per page (rows 3..22)

/** Replace every macro token in `s` with its expanded value. */
function expand(s, ctx) {
  let out = String(s);
  for (const [token, fn] of Object.entries(MACROS)) {
    if (out.includes(token)) {
      out = out.split(token).join(fn(ctx));
    }
  }
  return out;
}

/**
 * Strip ANSI sequences and return visible character count.
 * Unicode box-drawing characters in the source survive CP437 encoding
 * as single-cell bytes, so .length (after stripping ANSI) is correct.
 */
function visibleLen(s) {
  return String(s).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length;
}

class BBSCodeHelper extends GameBase {
  static get GAME_NAME()  { return 'bbs-code-helper'; }
  static get GAME_TITLE() { return 'BBS Code Helper'; }

  async run() {
    this.screen.setMode(Screen.SCROLL);
    this.terminal.resetAttrs();
    this.terminal.clearScreen();

    // Wrap config so isSysop can call .get()
    this._cfgProxy = {
      get: (key, def = '') => {
        const v = this.config[key];
        return (v !== undefined && v !== null) ? String(v) : def;
      },
    };

    this._authMode = (this.config.authMode || 'naive').toLowerCase();
    this._isAuthenticated = this._authMode === 'authenticated';
    this._isSysop = isSysop(this.username, this._cfgProxy, this.db, this._authMode);

    try {
      // Sysop branch: choice between register, list, exit
      if (this._isSysop) {
        await this._sysopMenu();
      } else {
        // Regular user: straight into registration
        await this._registerFlow();
      }
    } catch (err) {
      getLogger().error(`[BBSCodeHelper] Uncaught error: ${err.message}`);
      this.terminal.resetAttrs();
      this.terminal.println('');
      this.terminal.println('  An error occurred. Returning to the menu.');
      this.terminal.println('');
    }

    this.terminal.resetAttrs();
  }

  // ─── Top-level sysop menu ────────────────────────────────────────────────

  async _sysopMenu() {
    while (true) {
      this.terminal.clearScreen();
      this._heading('BBS Code Helper');
      this.terminal.setColor(Color.WHITE, Color.BLACK);
      this.terminal.println('');
      this.terminal.println('  You\'re signed in as a sysop. Choose an option:');
      this.terminal.println('');
      this.terminal.println('    [R] Register a new BBS and mint a BBS Code');
      this.terminal.println('    [L] List registered BBSes');
      this.terminal.println('    [Q] Quit');
      this.terminal.println('');
      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      this.terminal.print('  Choice: ');
      this.terminal.resetAttrs();

      const key = await this.terminal.waitKey();
      const k = (key || '').toLowerCase();

      if (k === 'r') {
        await this._registerFlow();
      } else if (k === 'l') {
        await this._listRegistrationsFlow();
      } else if (k === 'q' || k === '\x1b' || k === 'escape') {
        return;
      }
      // any other key — loop and re-show menu
    }
  }

  // ─── Registration flow ───────────────────────────────────────────────────

  async _registerFlow() {
    // ── Welcome page ──
    this.terminal.clearScreen();
    this._heading('Register your BBS');
    this.terminal.setColor(Color.WHITE, Color.BLACK);
    const server = SERVER_INFO(this.config);
    const baseCtx = { host: server.host, port: server.port, username: this.username || 'YOUR_USER' };
    for (const line of WELCOME_LINES) {
      this.terminal.println(this._safeLine(expand(line, baseCtx)));
    }
    this.terminal.resetAttrs();
    if (!(await this._continuePrompt())) return;

    // ── Ask for BBS name ──
    this.terminal.clearScreen();
    this._heading('Register your BBS — details');
    this.terminal.setColor(Color.WHITE, Color.BLACK);
    this.terminal.println('');
    this.terminal.println('  We need two pieces of information about your BBS so the');
    this.terminal.println('  SynthDoor sysop has a record of who\'s connected:');
    this.terminal.println('');
    this.terminal.resetAttrs();

    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.print(PROMPTS.bbsName);
    this.terminal.resetAttrs();
    const bbsName = (await this.terminal.readLine({ maxLen: 60 })).trim();

    if (!bbsName) {
      this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
      this.terminal.println('');
      this.terminal.println('  A BBS name is required. Registration cancelled.');
      this.terminal.resetAttrs();
      await this._pressAnyKey();
      return;
    }

    this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
    this.terminal.print(PROMPTS.bbsAddress);
    this.terminal.resetAttrs();
    const bbsAddress = (await this.terminal.readLine({ maxLen: 60 })).trim();

    if (!bbsAddress) {
      this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
      this.terminal.println('');
      this.terminal.println('  A connect address is required. Registration cancelled.');
      this.terminal.resetAttrs();
      await this._pressAnyKey();
      return;
    }

    // ── Confirm ──
    this.terminal.println('');
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLACK);
    this.terminal.println('  ' + PROMPTS.confirmHeader);
    this.terminal.resetAttrs();
    this.terminal.println('');
    this.terminal.setColor(Color.WHITE, Color.BLACK);
    this.terminal.println(`    BBS name    : ${bbsName}`);
    this.terminal.println(`    Address     : ${bbsAddress}`);
    this.terminal.println(`    Registered by: ${this.username || 'unknown'}`);
    this.terminal.resetAttrs();
    this.terminal.println('');

    const confirmed = await this.terminal.askYesNo('  ' + PROMPTS.confirmYesNo, false);
    if (!confirmed) {
      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      this.terminal.println('');
      this.terminal.println('  Registration cancelled. No code was generated.');
      this.terminal.resetAttrs();
      await this._pressAnyKey();
      return;
    }

    // ── Mint code and persist ──
    let bbsCode;
    try {
      bbsCode = getAuth().generateBBSCode();
    } catch (err) {
      // Log the real error to the server log so the operator can see
      // exactly what failed; also surface the message on screen so the
      // user can report it back without having to grep logs.
      getLogger().error(
        `[BBSCodeHelper] generateBBSCode() failed: ${err && err.message} ` +
        `(stack: ${err && err.stack ? err.stack.split('\n').slice(0,3).join(' | ') : 'n/a'})`
      );
      this.terminal.setColor(Color.BRIGHT_RED, Color.BLACK);
      this.terminal.println('');
      this.terminal.println('  Sorry — code generation failed with this error:');
      this.terminal.println('');
      this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
      const msg = (err && err.message) ? String(err.message) : 'unknown error';
      // Wrap at ~70 chars so the message is readable
      for (let i = 0; i < msg.length; i += 70) {
        this.terminal.println('    ' + msg.slice(i, i + 70));
      }
      this.terminal.setColor(Color.WHITE, Color.BLACK);
      this.terminal.println('');
      this.terminal.println('  Please report this to the SynthDoor operator. The full error');
      this.terminal.println('  has also been recorded in the server log.');
      this.terminal.resetAttrs();
      await this._pressAnyKey();
      return;
    }

    const record = {
      code:       bbsCode,
      bbsName:    bbsName,
      address:    bbsAddress,
      issuedTo:   this.username || 'unknown',
      issuedAt:   Math.floor(Date.now() / 1000),
      authMode:   this._authMode,
    };

    try {
      this._saveRegistration(record);
    } catch (err) {
      getLogger().warn(`[BBSCodeHelper] DB save failed: ${err.message}`);
      // Continue anyway — the code is still usable, just not recorded
    }

    getLogger().info(
      `[BBSCodeHelper] code issued: bbs="${bbsName}" addr="${bbsAddress}" ` +
      `user=${this.username} authMode=${this._authMode}`
    );

    // ── Show the paged help ──
    await this._showPagedHelp(record);
  }

  // ─── Sysop list view ────────────────────────────────────────────────────

  async _listRegistrationsFlow() {
    const all = this._loadAllRegistrations();
    all.sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0));

    const ROWS_PER_PAGE = 15;
    const totalPages = Math.max(1, Math.ceil(all.length / ROWS_PER_PAGE));
    let page = 0;

    while (true) {
      this.terminal.clearScreen();
      this._heading(`Registered BBSes (${all.length} total)`);

      // Column widths (must sum + 2 lead-spaces to <= 78 visible chars).
      // Code(11) + Name(18) + Address(22) + Issuer(13) + Date(10) = 74 + 2 = 76.
      this.terminal.setColor(Color.BRIGHT_CYAN, Color.BLACK);
      this.terminal.println('');
      this.terminal.println(
        '  ' +
        this._padR('Code', 11) +
        this._padR('BBS Name', 18) +
        this._padR('Address', 22) +
        this._padR('Issuer', 13) +
        this._padR('Date', 10)
      );
      // 76-char separator (NOT 80) to dodge the wrap-at-80 trap.
      this.terminal.println('  ' + '-'.repeat(74));
      this.terminal.resetAttrs();

      if (all.length === 0) {
        this.terminal.setColor(Color.WHITE, Color.BLACK);
        this.terminal.println('');
        this.terminal.println('  No BBSes have been registered yet.');
        this.terminal.resetAttrs();
      } else {
        const start = page * ROWS_PER_PAGE;
        const end   = Math.min(start + ROWS_PER_PAGE, all.length);
        this.terminal.setColor(Color.WHITE, Color.BLACK);
        for (let i = start; i < end; i++) {
          const r = all[i];
          const date = r.issuedAt
            ? new Date(r.issuedAt * 1000).toISOString().slice(0, 10)
            : '----------';
          this.terminal.println(
            '  ' +
            this._padR(r.code || '', 11) +
            this._padR(r.bbsName || '', 18) +
            this._padR(r.address || '', 22) +
            this._padR(r.issuedTo || '', 13) +
            this._padR(date, 10)
          );
        }
        this.terminal.resetAttrs();
      }

      // Status bar
      this.terminal.println('');
      this.terminal.setColor(Color.BLACK, Color.CYAN);
      let nav = '  [Q] Back to menu  ';
      if (totalPages > 1) {
        nav += `[N] Next  [P] Prev   Page ${page + 1}/${totalPages}  `;
      }
      // pad to 78
      const pad = Math.max(0, 78 - visibleLen(nav));
      this.terminal.print(nav + ' '.repeat(pad));
      this.terminal.resetAttrs();

      const key = await this.terminal.waitKey();
      const k = (key || '').toLowerCase();
      if (k === 'q' || k === '\x1b' || k === 'escape') return;
      if (k === 'n' && page < totalPages - 1) page++;
      if (k === 'p' && page > 0) page--;
    }
  }

  // ─── Paged help reader ───────────────────────────────────────────────────

  async _showPagedHelp(record) {
    const server = SERVER_INFO(this.config);
    const ctx = {
      host:     server.host,
      port:     server.port,
      bbsCode:  record.code,
      username: this.username || 'YOUR_USER',
    };

    // Build pages: page 0 = code reveal, pages 1..N = recipes, page N+1 = footer.
    const pages = [];

    // Page 0: code reveal
    pages.push({
      title: 'Your BBS Code',
      build: () => {
        const lines = [];
        lines.push('');
        lines.push('  Registration complete. Here\'s your BBS Code:');
        lines.push('');

        // Aligned code box — 64 chars total visible width.
        // Top/bottom: 2 spaces + corner + 60 dashes + corner = 64
        // Side rows : 2 spaces + bar  + 60-char interior + bar = 64
        // Interior width: 60 (between the bars, inclusive of padding).
        const INNER = 60;
        const code  = record.code;
        const reach = `${ctx.host}:${ctx.port}`;
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  ┌' + '─'.repeat(INNER) + '┐' });
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  │' + ' '.repeat(INNER) + '│' });
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  │' + this._padBox('   BBS Code:    ' + code, INNER) + '│' });
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  │' + this._padBox('   Reachable at: ' + reach, INNER) + '│' });
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  │' + this._padBox('   For user:    ' + (record.issuedTo || ''), INNER) + '│' });
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  │' + ' '.repeat(INNER) + '│' });
        lines.push({ color: Color.BRIGHT_GREEN,
                     text: '  └' + '─'.repeat(INNER) + '┘' });
        lines.push('');
        lines.push('  Make a note of this code — you\'ll paste it into your BBS.');
        lines.push('  It\'s also been recorded in our registry under the name you');
        lines.push(`  gave us ("${record.bbsName}").`);

        if (!this._isAuthenticated) {
          for (const ln of NAIVE_MODE_NOTICE) {
            lines.push({ color: Color.BRIGHT_YELLOW, text: ln });
          }
        }

        return lines;
      },
    });

    // Pages 1..N: recipes
    for (const recipe of RECIPES) {
      pages.push({
        title: recipe.name,
        build: () => this._buildRecipePage(recipe, ctx),
      });
    }

    // Last page: footer
    pages.push({
      title: 'All done',
      build: () => {
        const lines = [];
        for (const ln of FOOTER_LINES) lines.push(this._safeLine(expand(ln, ctx)));
        lines.push('');
        lines.push({ color: Color.BRIGHT_GREEN, text: '  Your BBS Code:  ' + ctx.bbsCode });
        return lines;
      },
    });

    await this._runPager(pages);
  }

  _buildRecipePage(recipe, ctx) {
    const lines = [];
    lines.push('');
    for (const ln of recipe.notes) {
      lines.push(this._safeLine('  ' + expand(ln, ctx)));
    }
    for (const ex of recipe.examples) {
      lines.push('');
      lines.push({ color: Color.BRIGHT_CYAN, text: '  ' + ex.label + ':' });
      const expanded = expand(ex.command, ctx);
      for (const cmdLine of expanded.split('\n')) {
        lines.push({ color: Color.BRIGHT_WHITE, text: this._safeLine('    ' + cmdLine) });
      }
    }
    return lines;
  }

  /**
   * Runs the full-screen paged reader over the supplied pages.
   * Each page builds an array of lines (string OR {color, text}).
   * Pagination is controlled by N (next) / P (prev) / Q (quit).
   *
   * Each page is rendered in full per keypress, so scrollback shows the
   * current page only — no cross-page corruption.
   */
  async _runPager(pages) {
    let i = 0;
    while (true) {
      const page = pages[i];
      this.terminal.clearScreen();
      this._heading(page.title);

      const lines = page.build();
      for (const ln of lines) {
        if (typeof ln === 'string') {
          this.terminal.resetAttrs();
          this.terminal.println(this._safeLine(ln));
        } else {
          this.terminal.setColor(ln.color || Color.WHITE, Color.BLACK);
          this.terminal.println(this._safeLine(ln.text || ''));
          this.terminal.resetAttrs();
        }
      }

      this._statusBar(i, pages.length);
      const key = await this.terminal.waitKey();
      const k = (key || '').toLowerCase();
      if (k === 'q' || k === '\x1b' || k === 'escape') return;
      if (k === 'n' || k === ' ' || k === '\r' || k === '\n' ||
          k === 'right' || k === 'arrowright' || k === 'pagedown') {
        if (i < pages.length - 1) i++;
        else return;  // already on last page — exit
      } else if (k === 'p' || k === 'left' || k === 'arrowleft' || k === 'pageup') {
        if (i > 0) i--;
      }
      // any other key: re-render same page
    }
  }

  // ─── Rendering helpers ───────────────────────────────────────────────────

  /**
   * Render the heading bar at the top of the screen.
   * Uses a 78-char-wide bar (NOT 80) to avoid the wrap-at-80 trap
   * documented in CLAUDE.md Rule 6.
   */
  _heading(title) {
    this.terminal.setColor(Color.BRIGHT_WHITE, Color.BLUE);
    const text = '  ' + title;
    const pad  = Math.max(0, 78 - visibleLen(text));
    this.terminal.println(text + ' '.repeat(pad));
    this.terminal.resetAttrs();
  }

  /**
   * Render the status bar at the bottom of a pager screen.
   * Stays under 79 visible chars to avoid wrap.
   */
  _statusBar(pageIdx, totalPages) {
    this.terminal.println('');
    this.terminal.setColor(Color.BLACK, Color.CYAN);
    const prev = pageIdx > 0              ? '[P] Prev  ' : '          ';
    const next = pageIdx < totalPages - 1 ? '[N] Next  ' : '[N] Exit  ';
    const text = `  ${prev}${next}[Q] Quit   Page ${pageIdx + 1} of ${totalPages}`;
    const pad  = Math.max(0, 78 - visibleLen(text));
    this.terminal.print(text + ' '.repeat(pad));
    this.terminal.resetAttrs();
  }

  /**
   * Clip a line to CONTENT_WIDTH (78) visible chars to ensure it
   * neither hits the println auto-clip at 80 nor the wrap-at-80 trap.
   */
  _safeLine(s) {
    s = String(s);
    if (visibleLen(s) <= CONTENT_WIDTH) return s;
    // Walk the string, preserving ANSI, until we've kept CONTENT_WIDTH visible chars
    let out = '', count = 0, i = 0;
    while (i < s.length && count < CONTENT_WIDTH) {
      if (s[i] === '\x1b') {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]/);
        if (m) { out += m[0]; i += m[0].length; continue; }
      }
      out += s[i++];
      count++;
    }
    return out;
  }

  /** Right-pad to exactly n visible chars (truncate if longer). */
  _padR(s, n) {
    s = String(s);
    if (s.length > n) return s.slice(0, n);
    return s + ' '.repeat(n - s.length);
  }

  /**
   * Pad a string to exactly `width` visible chars by appending spaces.
   * If the input is already too long, truncate.
   */
  _padBox(s, width) {
    s = String(s);
    if (s.length >= width) return s.slice(0, width);
    return s + ' '.repeat(width - s.length);
  }

  // ─── Flow helpers ────────────────────────────────────────────────────────

  async _continuePrompt() {
    this.terminal.println('');
    this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
    this.terminal.print('  Press any key to continue (Q to quit)... ');
    this.terminal.resetAttrs();
    const key = await this.terminal.waitKey();
    this.terminal.println('');
    if (key === 'q' || key === 'Q' || key === '\x1b' || key === 'ESCAPE' || key === 'Escape') {
      return false;
    }
    return true;
  }

  async _pressAnyKey() {
    this.terminal.println('');
    this.terminal.setColor(Color.BRIGHT_YELLOW, Color.BLACK);
    this.terminal.print('  Press any key to continue... ');
    this.terminal.resetAttrs();
    await this.terminal.waitKey();
    this.terminal.println('');
  }

  // ─── DB persistence ──────────────────────────────────────────────────────

  /**
   * Append a record to the registrations list and store a per-code
   * lookup row. Tolerant of older / missing rows.
   */
  _saveRegistration(record) {
    if (!this.db || typeof this.db.setGameState !== 'function') return;

    // Master list under 'registrations'
    let list = [];
    try {
      const stored = this.db.getGameState(BBSCodeHelper.GAME_NAME, 'registrations', []);
      if (Array.isArray(stored)) list = stored;
    } catch (_) { list = []; }

    list.push(record);
    this.db.setGameState(BBSCodeHelper.GAME_NAME, 'registrations', list);

    // Per-code lookup (handy for future "look up code X" features)
    this.db.setGameState(BBSCodeHelper.GAME_NAME, `code:${record.code}`, record);
  }

  /** Read all registrations. Returns an array (possibly empty). */
  _loadAllRegistrations() {
    if (!this.db || typeof this.db.getGameState !== 'function') return [];
    try {
      const stored = this.db.getGameState(BBSCodeHelper.GAME_NAME, 'registrations', []);
      return Array.isArray(stored) ? stored : [];
    } catch (_) { return []; }
  }
}

module.exports = BBSCodeHelper;
