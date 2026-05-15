'use strict';

/**
 * transports/telnet.js
 * Telnet transport with correct RFC 854 option negotiation.
 *
 * Negotiation sequence sent on connect:
 *   IAC WILL ECHO      — server will echo characters (client must not local-echo)
 *   IAC WILL SGA       — suppress go-ahead (full-duplex mode)
 *   IAC DO   NAWS      — ask client to send window size
 *   IAC DO   TTYPE     — ask client to send terminal type
 *
 * Auth is handled by session.js (shared with WebSocketTransport).
 *
 * Subnegotiation overflow protection
 * ──────────────────────────────────
 * TelnetFilterStream caps the IAC-SB body at SB_BUF_MAX bytes and emits
 * 'sb-overflow' if a peer attempts to send more. We treat that as a hostile
 * peer and destroy the socket immediately.
 */

const net  = require('net');
const path = require('path');

const { Terminal } = require(
  path.join(__dirname, '..', '..', '..', 'engine', 'src', 'index.js')
);
const { NEGOTIATE, TelnetFilterStream, sleep } = require('./telnet-filter');
const { runSession } = require('../session');
const { getLogger }  = require('../logger');

// IAC WONT ECHO — sent on teardown to restore client-side echo
const IAC  = 255;
const WONT = 252;
const ECHO = 1;
const RESTORE_ECHO = Buffer.from([IAC, WONT, ECHO]);

class TelnetTransport {
  /**
   * @param {Config}     config
   * @param {DB}         db
   * @param {GameRouter} router
   * @param {string}     authMode  'naive' | 'authenticated'
   */
  constructor(config, db, router, authMode, registry) {
    this.config   = config;
    this.db       = db;
    this.router   = router;
    this.authMode = authMode || 'naive';
    this.registry = registry || null;
    this._server  = null;
  }

  /**
   * Start listening.
   *
   * @param {number} port
   * @param {string} [host='0.0.0.0']  Interface to bind on. Defaults to all
   *                                   interfaces. Pass '127.0.0.1' to restrict
   *                                   to loopback (e.g. when fronted by a
   *                                   reverse proxy on the same host), or any
   *                                   specific local IP on a multi-homed box.
   */
  listen(port, host = '0.0.0.0') {
    this._server = net.createServer((socket) => {
      this._handleConnection(socket).catch(err => {
        getLogger().error('[Telnet] Unhandled error:', err.message);
        socket.destroy();
      });
    });
    this._server.listen(port, host);
    return this;
  }

  close() {
    this._server?.close();
  }

  async _handleConnection(socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);

    const remoteIP = socket.remoteAddress || 'unknown';

    // Install a socket error handler immediately, before any await. Without
    // this, an early peer RST (e.g. a port scanner that drops the socket
    // mid-handshake) fires on the bare socket with no listener attached,
    // and Node's default 'error' handler crashes the process. We just
    // log-and-swallow; the rest of the handshake will short-circuit when
    // socket.destroyed flips true.
    socket.on('error', (err) => {
      getLogger().info(`[Telnet] ${remoteIP} socket error: ${err.code || err.message}`);
    });

    // Send IAC negotiation immediately, then give the client a moment to respond
    socket.write(NEGOTIATE);
    await sleep(100);

    // TelnetFilterStream with the socket as source — auto-pipes incoming data
    const filtered = new TelnetFilterStream(socket);

    // Hostile or buggy peer flooding subnegotiation: drop the connection.
    filtered.on('sb-overflow', ({ limit }) => {
      getLogger().warn(`[Telnet] SB overflow from ${remoteIP} (>${limit} bytes) — closing`);
      socket.destroy();
    });

    const terminal = new Terminal({
      output:    socket,
      input:     filtered,
      username:  'unknown',  // set by runSession after auth
      transport: 'telnet',
    });

    // Registry liveness wiring: ping on every incoming chunk (telnet's
    // raw socket gives us 'data' events directly), and report dead via
    // socket.destroyed. The 30s sweep + the 5-minute activity gap means
    // ghost rows never linger in Who's Online.
    let _sessionId = null;
    socket.on('data', () => {
      if (_sessionId && this.registry) this.registry.ping(_sessionId);
    });

    getLogger().info(`[Telnet] ${remoteIP} connected`);

    try {
      await runSession({
        terminal,
        output:     socket,
        filtered,
        authMode:   this.authMode,
        transport:  'telnet',
        ipAddress:  remoteIP,
        router:     this.router,
        config:     this.config,
        registry:   this.registry,
        disconnect: () => socket.destroy(),
        isLive:     () => !socket.destroyed,
        bindSession: (id) => { _sessionId = id; },
      });
    } catch (err) {
      getLogger().error(`[Telnet] Session error for ${remoteIP}:`, err.stack || err.message);
    } finally {
      try { socket.write(RESTORE_ECHO); } catch (_) {}
      socket.destroy();
      getLogger().info(`[Telnet] ${remoteIP} disconnected`);
    }
  }
}

module.exports = TelnetTransport;
