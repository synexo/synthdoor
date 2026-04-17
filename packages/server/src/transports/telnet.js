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
 */

const net  = require('net');
const path = require('path');

const { Terminal } = require(
  path.join(__dirname, '..', '..', '..', 'engine', 'src', 'index.js')
);
const { NEGOTIATE, TelnetFilterStream, sleep } = require('./telnet-filter');
const { runSession } = require('../session');

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
  constructor(config, db, router, authMode) {
    this.config   = config;
    this.db       = db;
    this.router   = router;
    this.authMode = authMode || 'naive';
    this._server  = null;
  }

  listen(port) {
    this._server = net.createServer((socket) => {
      this._handleConnection(socket).catch(err => {
        console.error('[Telnet] Unhandled error:', err.message);
        socket.destroy();
      });
    });
    this._server.listen(port);
    return this;
  }

  close() {
    this._server?.close();
  }

  async _handleConnection(socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);

    const remoteIP = socket.remoteAddress || 'unknown';

    // Send IAC negotiation immediately, then give the client a moment to respond
    socket.write(NEGOTIATE);
    await sleep(100);

    // TelnetFilterStream with the socket as source — auto-pipes incoming data
    const filtered = new TelnetFilterStream(socket);

    const terminal = new Terminal({
      output:    socket,
      input:     filtered,
      username:  'unknown',  // set by runSession after auth
      transport: 'telnet',
    });

    console.log(`[Telnet] ${remoteIP} connected`);

    try {
      await runSession({
        terminal,
        output:    socket,
        filtered,
        authMode:  this.authMode,
        transport: 'telnet',
        ipAddress: remoteIP,
        router:    this.router,
      });
    } catch (err) {
      console.error(`[Telnet] Session error for ${remoteIP}:`, err.stack || err.message);
    } finally {
      try { socket.write(RESTORE_ECHO); } catch (_) {}
      socket.destroy();
      console.log(`[Telnet] ${remoteIP} disconnected`);
    }
  }
}

module.exports = TelnetTransport;
