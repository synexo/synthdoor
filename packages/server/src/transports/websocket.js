'use strict';

/**
 * packages/server/src/transports/websocket.js
 *
 * Direct WebSocket transport for browser clients.
 *
 * Accepts WebSocket connections and talks directly to the engine,
 * eliminating the intermediate TCP connection.
 *
 * This transport runs TelnetFilterStream on incoming data and sends a
 * minimal Telnet negotiation (WILL ECHO, WILL SGA) to the client on
 * connect to establish full-duplex mode.  NAWS and TTYPE are omitted
 * because the web client is fixed at 80×25 and reports no terminal type.
 *
 * Binary WebSocket frames (ArrayBuffer) are used exclusively.
 *
 * Static file serving is also handled directly.
 *
 * Config keys read from synthdoor.conf:
 *   web_port              (default 8080)
 *   web_max_idle_minutes  (default 10)
 */

const fs   = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Writable, Readable } = require('stream');

const { Terminal } = require(
  path.join(__dirname, '..', '..', '..', 'engine', 'src', 'index.js')
);
const { TelnetFilterStream, sleep } = require('./telnet-filter');

// Minimal Telnet negotiation for browser clients:
//   IAC WILL ECHO  — server echoes (client must not local-echo)
//   IAC WILL SGA   — suppress go-ahead (full-duplex mode)
// NAWS and TTYPE are intentionally omitted: the web client is fixed at
// 80×25 and does not report a terminal type.
const IAC  = 255;
const WILL = 251;
const WS_NEGOTIATE = Buffer.from([IAC, WILL, 1, IAC, WILL, 3]);
const { runSession } = require('../session');

// ─── MIME types for static file serving ──────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

class WebSocketTransport {
  /**
   * @param {Config}     config
   * @param {DB}         db
   * @param {GameRouter} router
   * @param {string}     authMode   'naive' | 'authenticated'
   */
  constructor(config, db, router, authMode) {
    this.config   = config;
    this.db       = db;
    this.router   = router;
    this.authMode = authMode || 'naive';

    this._server = null;
    this._wss    = null;
  }

  listen(port) {
    const publicDir = path.resolve(__dirname, '..', '..', 'src', 'web', 'public');

    if (!fs.existsSync(publicDir)) {
      console.warn(`[WebSocket] WARNING: public dir not found: ${publicDir}`);
    }

    this._server = http.createServer((req, res) => {
      this._handleHttp(req, res, publicDir);
    });

    this._wss = new WebSocketServer({ server: this._server });

    this._wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req).catch(err => {
        console.error('[WebSocket] Unhandled connection error:', err.message);
        try { ws.close(); } catch (_) {}
      });
    });

    this._server.listen(port, () => {
      console.log(`[WebSocket] Listening on port ${port} (${this.authMode} mode)`);
    });

    return this;
  }

  close() {
    this._wss?.close();
    this._server?.close();
  }

  // ─── HTTP: static files  ────────────────────────────────

  _handleHttp(req, res, publicDir) {
    const urlPath = (req.url || '/').split('?')[0];

    // Static files
    let fileRelative;
    if (urlPath === '/' || urlPath === '' || urlPath === '/index.html') {
      fileRelative = 'index.html';
    } else {
      fileRelative = urlPath.replace(/^\/+/, '');
    }

    const resolvedPublic = path.resolve(publicDir);
    const resolvedFile   = path.resolve(publicDir, fileRelative);

    // Path traversal guard
    if (!resolvedFile.startsWith(resolvedPublic + path.sep) &&
         resolvedFile !== resolvedPublic) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    const ext  = path.extname(resolvedFile);
    const mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(resolvedFile, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  }

  // ─── WebSocket connection handler ─────────────────────────────────────────

  async _handleConnection(ws, req) {
    const remoteIP = req.socket?.remoteAddress || 'unknown';

    console.log(`[WebSocket] ${remoteIP} connected`);

    const maxIdleMs = this.config.getInt('web_max_idle_minutes', 10) * 60 * 1000;
    let lastActivity = Date.now();

    // ── Idle timeout ────────────────────────────────────────────────────────
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > maxIdleMs) {
        console.log(`[WebSocket] Idle timeout: ${remoteIP}`);
        try { ws.send(Buffer.from('\r\nIdle timeout — disconnecting.\r\n', 'latin1')); } catch (_) {}
        ws.close();
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(idleTimer);
      console.log(`[WebSocket] ${remoteIP} disconnected`);
    });

    ws.on('error', () => {
      clearInterval(idleTimer);
    });

    // ── Writable adapter: Terminal output → WebSocket ───────────────────────
    const output = new Writable({
      decodeStrings: false,
      write(chunk, _encoding, callback) {
        lastActivity = Date.now();
        if (ws.readyState !== 1 /* OPEN */) { callback(); return; }
        try {
          ws.send(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1'));
        } catch (_) {}
        callback();
      },
    });

    // ── Readable adapter: WebSocket messages → TelnetFilterStream ───────────
    // We create a pass-through Readable that we push decoded bytes into,
    // then pipe through TelnetFilterStream.
    const rawInput = new Readable({ read() {} });

    ws.on('message', (data) => {
      lastActivity = Date.now();
      try {
        rawInput.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      } catch (_) {}
    });

    // TelnetFilterStream strips IAC sequences; pass null source and feed manually.
    const filtered = new TelnetFilterStream(null);
    rawInput.on('data',  chunk => filtered.write(chunk));
    rawInput.on('end',   ()    => filtered.end());
    rawInput.on('error', err   => filtered.emit('error', err));

    // ── Send Telnet negotiation ──────────────────────────────────────────────
    try {
      ws.send(WS_NEGOTIATE);
    } catch (_) {}
    await sleep(100);

    // ── Build Terminal ───────────────────────────────────────────────────────
    const terminal = new Terminal({
      output,
      input:     filtered,
      username:  'unknown',  // set by runSession after auth
      transport: 'web',
    });

    // ── Run session (auth + game router) ────────────────────────────────────
    try {
      await runSession({
        terminal,
        output,
        filtered,
        authMode:  this.authMode,
        transport: 'web',
        ipAddress: remoteIP,
        router:    this.router,
      });
    } catch (err) {
      console.error(`[WebSocket] Session error for ${remoteIP}:`, err.stack || err.message);
    } finally {
      clearInterval(idleTimer);
      try { ws.close(); } catch (_) {}
    }
  }
}

module.exports = WebSocketTransport;
