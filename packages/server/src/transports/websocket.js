'use strict';

/**
 * packages/server/src/transports/websocket.js
 *
 * Direct WebSocket transport for browser clients.
 *
 * Accepts WebSocket connections and talks directly to the engine,
 * eliminating the intermediate TCP connection.
 *
 * This transport runs TelnetFilterStream on incoming data and 
 * sends the IAC NEGOTIATE sequence to the client on connect.
 *
 * Sub-protocol support:
 *   'binary'  — ArrayBuffer frames  (preferred, fastest)
 *   'base64'  — base64-encoded text frames
 *   'plain'   — UTF-8 / binary text frames (fallback)
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
const { NEGOTIATE, TelnetFilterStream, sleep } = require('./telnet-filter');
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

    this._wss = new WebSocketServer({
      server: this._server,
      handleProtocols: (protocols) => {
        // Prefer binary, then base64, then plain
        for (const p of ['binary', 'base64', 'plain']) {
          if (protocols.has(p)) return p;
        }
        return false;
      },
    });

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
    const protocol = ws.protocol || 'plain';

    console.log(`[WebSocket] ${remoteIP} connected [${protocol}]`);

    const maxIdleMs = this.config.getInt('web_max_idle_minutes', 10) * 60 * 1000;
    let lastActivity = Date.now();

    // ── Idle timeout ────────────────────────────────────────────────────────
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > maxIdleMs) {
        console.log(`[WebSocket] Idle timeout: ${remoteIP}`);
        try { ws.send(_encode('\r\nIdle timeout — disconnecting.\r\n', protocol)); } catch (_) {}
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
    // decodeStrings: false is critical — without it Node converts strings to
    // UTF-8 Buffers before our write() handler sees them, corrupting CP437
    // bytes 0x80-0xFF into two-byte sequences.  We handle encoding ourselves.
    const output = new Writable({
      decodeStrings: false,
      write(chunk, _encoding, callback) {
        lastActivity = Date.now();
        if (ws.readyState !== 1 /* OPEN */) { callback(); return; }
        try {
          ws.send(_encode(chunk, protocol));
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
        rawInput.push(_decode(data, protocol));
      } catch (_) {}
    });

    // TelnetFilterStream strips IAC sequences; pass null source and feed manually.
    const filtered = new TelnetFilterStream(null);
    rawInput.on('data',  chunk => filtered.write(chunk));
    rawInput.on('end',   ()    => filtered.end());
    rawInput.on('error', err   => filtered.emit('error', err));

    // ── Send IAC negotiation ─────────────────────────────────────────────────
    try {
      ws.send(_encode(NEGOTIATE, protocol));
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

// ─── Sub-protocol encode/decode helpers ──────────────────────────────────

/**
 * Encode outgoing bytes for the negotiated sub-protocol.
 *
 * IMPORTANT: Buffer.from(str) uses UTF-8 by default, which corrupts CP437
 * bytes 0x80-0xFF into two-byte sequences.  latin1 is a 1:1 byte mapping
 * and is the correct encoding for CP437/ANSI terminal data on the wire.
 *
 * @param {Buffer|string} chunk
 * @param {string} protocol  'binary' | 'base64' | 'plain'
 * @returns {Buffer|string}
 */
function _encode(chunk, protocol) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1');
  if (protocol === 'binary') return buf;
  if (protocol === 'base64') return buf.toString('base64');
  return buf.toString('binary');
}

/**
 * Decode incoming WebSocket message bytes for the negotiated sub-protocol.
 * @param {Buffer|string} data
 * @param {string} protocol
 * @returns {Buffer}
 */
function _decode(data, protocol) {
  if (protocol === 'binary') {
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
  if (protocol === 'base64') {
    return Buffer.from(data.toString(), 'base64');
  }
  return Buffer.from(data.toString(), 'binary');
}

module.exports = WebSocketTransport;
