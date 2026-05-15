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
 *   trust_proxy           (default: disabled — see remote-ip.js)
 *
 * Reverse-proxy / X-Forwarded-For
 * ───────────────────────────────
 * By default we ignore X-Forwarded-For and use the immediate socket peer
 * as the client IP. Operators deploying behind nginx, Cloudflare, etc.
 * MUST set `trust_proxy` in synthdoor.conf or rate limiters will see the
 * proxy IP for every connection. See remote-ip.js for syntax.
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
const { SBANSIEncoder } = require(path.join(__dirname, 'sbansi-encoder'));
const { resolveClientIp, loadTrustPolicy } = require('./remote-ip');

// Minimal Telnet negotiation for browser clients:
//   IAC WILL ECHO  — server echoes (client must not local-echo)
//   IAC WILL SGA   — suppress go-ahead (full-duplex mode)
// NAWS and TTYPE are intentionally omitted: the web client is fixed at
// 80×25 and does not report a terminal type.
const IAC  = 255;
const WILL = 251;
const WS_NEGOTIATE = Buffer.from([IAC, WILL, 1, IAC, WILL, 3]);
const { runSession } = require('../session');
const { getLogger }  = require('../logger');

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
  constructor(config, db, router, authMode, registry) {
    this.config   = config;
    this.db       = db;
    this.router   = router;
    this.authMode = authMode || 'naive';
    this.registry = registry || null;

    // Resolve the proxy-trust policy once at construction time. Logged on
    // creation rather than per-connection so it appears with the rest of
    // the server startup banner.
    this._trustPolicy = loadTrustPolicy(config, getLogger());

    this._server = null;
    this._wss    = null;
  }

  /**
   * Start listening.
   *
   * @param {number} port
   * @param {string} [host='0.0.0.0']  Interface to bind on. Defaults to all
   *                                   interfaces. Pass '127.0.0.1' (paired
   *                                   with a reverse-proxy + trust_proxy in
   *                                   synthdoor.conf) to restrict the engine
   *                                   to loopback while exposing TLS via the
   *                                   proxy on the public NIC.
   */
  listen(port, host = '0.0.0.0') {
    const publicDir = path.resolve(__dirname, '..', '..', 'src', 'web', 'public');

    if (!fs.existsSync(publicDir)) {
      getLogger().warn(`[WebSocket] WARNING: public dir not found: ${publicDir}`);
    }

    this._server = http.createServer((req, res) => {
      this._handleHttp(req, res, publicDir);
    });

    this._wss = new WebSocketServer({ server: this._server });

    this._wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req).catch(err => {
        getLogger().error('[WebSocket] Unhandled connection error:', err.message);
        try { ws.close(); } catch (_) {}
      });
    });

    this._server.listen(port, host, () => {
      getLogger().info(`[WebSocket] Listening on ${host}:${port} (${this.authMode} mode)`);
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
    // Resolve the real client IP. With trust_proxy unset (the default),
    // this is just req.socket.remoteAddress. With it configured, we honor
    // X-Forwarded-For from trusted upstreams and reject spoofed entries.
    const remoteIP = resolveClientIp(req, this._trustPolicy) || 'unknown';

    getLogger().info(`[WebSocket] ${remoteIP} connected`);

    const maxIdleMs = this.config.getInt('web_max_idle_minutes', 10) * 60 * 1000;
    let lastActivity = Date.now();

    // ── Idle timeout ────────────────────────────────────────────────────────
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > maxIdleMs) {
        getLogger().info(`[WebSocket] Idle timeout: ${remoteIP}`);
        try { ws.send(Buffer.from('\r\nIdle timeout — disconnecting.\r\n', 'latin1')); } catch (_) {}
        ws.close();
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(idleTimer);
      getLogger().info(`[WebSocket] ${remoteIP} disconnected`);
    });

    ws.on('error', () => {
      clearInterval(idleTimer);
    });

    // ── Writable adapter: Terminal output → SBANSI encoder → WebSocket ───────
    //
    // Engine emits ANSI/CP437 bytes. The SBANSI encoder transduces them to a
    // tighter binary opcode stream that the client decodes back to the
    // original ANSI bytes byte-for-byte. The client then feeds those decoded
    // bytes into its existing ANSIParser exactly as if they had arrived
    // directly. Sequences the encoder doesn't recognise pass through verbatim
    // starting with 0x1B. See sbansi-spec.js for the wire format.
    //
    // Telnet/rlogin transports do not use this — they emit raw ANSI/CP437.
    const sbansi = new SBANSIEncoder();

    // ── Small-write coalescer ────────────────────────────────────────────────
    //
    // The engine's screen.flush() emits many tiny writes per frame (typically
    // 5-byte cursor moves and SGR sequences). Without coalescing, each one
    // becomes its own ws.send → its own per-message-deflate frame, whose
    // ~4-byte minimum overhead dominates over a 2-3 byte payload. Per-message
    // deflate then provides little benefit and can even inflate small writes.
    //
    // Coalescing collects buffered writes for up to COALESCE_MS milliseconds
    // (or until they exceed COALESCE_BYTES bytes) and flushes them as a single
    // ws.send. The deflate dictionary still persists across messages, but each
    // message is now large enough that deflate's per-message overhead is
    // amortised properly.
    //
    // Timing semantics: a timer is started when the first byte enters an empty
    // buffer. The timer fires on a fixed wall-clock schedule (setTimeout)
    // independent of game-loop CPU usage. Subsequent writes within the window
    // append without resetting the timer. A previous coalescing attempt that
    // anchored flushes to setImmediate yield points caused frame jitter in
    // animated games because flush timing varied with per-frame CPU cost; the
    // wall-clock timer here is immune to that.
    //
    // Trade-offs:
    //   - 5ms is well below human input-latency perception (~50ms threshold)
    //   - Below most game-frame intervals (50ms at 20fps, 33ms at 30fps), so
    //     each frame's writes flush together with one ws.send before the next
    //     frame begins
    //   - Big writes (≥ COALESCE_BYTES) flush immediately without waiting,
    //     preserving low latency for art file display etc.
    const COALESCE_MS    = 5;
    const COALESCE_BYTES = 16 * 1024;
    let pendingChunks    = [];
    let pendingSize      = 0;
    let pendingTimer     = null;

    function flushPending() {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (pendingChunks.length === 0) return;
      const merged = pendingChunks.length === 1 ? pendingChunks[0] : Buffer.concat(pendingChunks, pendingSize);
      pendingChunks = [];
      pendingSize   = 0;
      if (ws.readyState !== 1 /* OPEN */) return;
      try { ws.send(merged); } catch (_) {}
    }

    const output = new Writable({
      decodeStrings: false,
      write(chunk, _encoding, callback) {
        lastActivity = Date.now();
        if (ws.readyState !== 1 /* OPEN */) { callback(); return; }
        try {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1');
          const encoded = sbansi.encode(buf);
          if (encoded.length > 0) {
            pendingChunks.push(encoded);
            pendingSize += encoded.length;
            if (pendingSize >= COALESCE_BYTES) {
              flushPending();
            } else if (pendingTimer === null) {
              pendingTimer = setTimeout(flushPending, COALESCE_MS);
            }
          }
        } catch (_) {}
        callback();
      },
    });

    ws.on('close', () => {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      pendingChunks = [];
      pendingSize   = 0;
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

    // Subnegotiation overflow: a peer that opens IAC SB and never closes it
    // could grow the filter's internal buffer. The filter caps that and
    // emits 'sb-overflow' when hit. Treat it as a hostile peer and close.
    filtered.on('sb-overflow', ({ limit }) => {
      getLogger().warn(`[WebSocket] SB overflow from ${remoteIP} (>${limit} bytes) — closing`);
      try { ws.close(); } catch (_) {}
    });

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

    // ── Registry liveness wiring ────────────────────────────────────────────
    //
    // Two channels: a periodic ping driven by the same incoming-message
    // handler that tracks idle activity, and an isLive() probe that
    // returns false once the WebSocket leaves the OPEN state. Together
    // they guarantee the Who's Online list never holds rows whose
    // connection has actually gone away — even if the disconnect path
    // misfires.
    let _sessionId = null;
    const onIncomingMessage = () => {
      lastActivity = Date.now();
      if (_sessionId && this.registry) this.registry.ping(_sessionId);
    };
    // Replace the message bookkeeping that previously only updated the
    // local lastActivity. The original handler is still installed below;
    // here we add a second listener so both run.
    ws.on('message', onIncomingMessage);

    // ── Run session (auth + game router) ────────────────────────────────────
    try {
      await runSession({
        terminal,
        output,
        filtered,
        authMode:   this.authMode,
        transport:  'web',
        ipAddress:  remoteIP,
        router:     this.router,
        config:     this.config,
        registry:   this.registry,
        disconnect: () => { try { ws.close(); } catch (_) {} },
        // ws.readyState OPEN === 1. Anything else (CLOSING, CLOSED) means
        // the registry should consider this entry dead.
        isLive:     () => ws.readyState === 1,
        bindSession: (id) => { _sessionId = id; },
      });
    } catch (err) {
      getLogger().error(`[WebSocket] Session error for ${remoteIP}:`, err.stack || err.message);
    } finally {
      clearInterval(idleTimer);
      try { ws.close(); } catch (_) {}
    }
  }
}

module.exports = WebSocketTransport;
