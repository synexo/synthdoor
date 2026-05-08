'use strict';

/**
 * packages/server/src/transports/telnet-filter.js
 *
 * Shared telnet primitives used by both TelnetTransport and WebSocketTransport.
 *
 *   NEGOTIATE          — IAC option negotiation bytes to send on connect
 *   TelnetFilterStream — Transform stream that strips IAC sequences from input
 *   readLineEchoed     — Server-echoed line reader (naive mode login prompt)
 *   sleep              — Promise-based setTimeout helper
 *
 * Hardening
 * ─────────
 * Telnet subnegotiation (IAC SB <option> ... IAC SE) has no protocol-level
 * length limit. A peer that opens an SB block and never sends SE would have
 * caused unbounded growth of the internal _sbBuf. To prevent memory-exhaustion
 * DoS, the filter caps subnegotiation bodies at SB_BUF_MAX bytes. Once the
 * cap is exceeded, the stream emits 'sb-overflow' and the transport (telnet
 * or websocket) should destroy the underlying connection.
 *
 * Why pick the value: real subnegotiations are tiny — NAWS is 4 bytes,
 * TTYPE is the option code plus a name (typical ~20 bytes), CHARSET and
 * NEW-ENVIRON top out around 256 bytes. A 4 KiB cap is roughly 16x the
 * largest legitimate body and still trivially small in absolute terms.
 */

const { Transform } = require('stream');

// ─── Telnet option constants ──────────────────────────────────────────────
const IAC   = 255;
const WILL  = 251;
// const WONT  = 252;  // used by callers when tearing down, not needed here
const DO    = 253;
const SB    = 250;
const SE    = 240;
const ECHO  = 1;
const SGA   = 3;
const NAWS  = 31;
const TTYPE = 24;

// ─── Hard limits ──────────────────────────────────────────────────────────
//
// SB_BUF_MAX caps the subnegotiation accumulator. See header comment.
// READLINE_MAX caps readLineEchoed's username/answer length.
//
// Both numbers are deliberately conservative; raise them only if a future
// option requires more space, and keep both well below the engine's session
// memory budget.
const SB_BUF_MAX   = 4 * 1024;   // 4 KiB
const READLINE_MAX = 256;        // hard ceiling on readLineEchoed

/**
 * IAC negotiation sequence sent immediately on connect.
 * Both telnet and WebSocket transports send this to the client so that
 * fTelnet (and real telnet clients) enter full-duplex mode and report
 * their window size and terminal type.
 */
const NEGOTIATE = Buffer.from([
  IAC, WILL, ECHO,
  IAC, WILL, SGA,
  IAC, DO,   NAWS,
  IAC, DO,   TTYPE,
]);

/**
 * Transform stream that filters raw telnet IAC sequences out of the
 * incoming byte stream, emitting only clean application data.
 *
 * Also emits:
 *   'option'      { cmd, opt }          — for WILL/WONT/DO/DONT commands
 *   'naws'        { cols, rows }        — when client reports window size
 *   'ttype'       ttype (string)        — when client reports terminal type
 *   'sb-overflow' { limit }             — subnegotiation body exceeded SB_BUF_MAX;
 *                                         transport should destroy the socket
 *
 * @param {import('stream').Readable|null} source
 *   If provided, the stream auto-pipes from source (used by TelnetTransport
 *   which has a raw net.Socket). Pass null when the caller will write()
 *   chunks manually (used by WebSocketTransport).
 */
class TelnetFilterStream extends Transform {
  constructor(source) {
    super();
    this._state    = 'data';
    this._cmd      = 0;
    this._opt      = 0;
    this._sbBuf    = [];
    this._overflow = false;  // latched once SB body exceeds SB_BUF_MAX

    if (source) {
      source.on('data',  chunk => this.write(chunk));
      source.on('end',   ()    => this.end());
      source.on('error', err   => this.emit('error', err));
    }
  }

  _transform(chunk, _encoding, callback) {
    // Once the stream has overflowed, drop everything and stop processing.
    // The transport listening for 'sb-overflow' is responsible for closing
    // the underlying socket; this prevents any further work in the meantime.
    if (this._overflow) { callback(); return; }

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const out = [];

    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];

      switch (this._state) {
        case 'data':
          if (byte === IAC) {
            this._state = 'iac';
          } else {
            if (byte === 0) break;
            out.push(byte);
          }
          break;

        case 'iac':
          if (byte === IAC) {
            out.push(0xFF);
            this._state = 'data';
          } else if (byte === SB) {
            this._state = 'sb';
            this._sbBuf = [];
          } else if (byte === SE || byte === 241 || byte === 243) {
            this._state = 'data';
          } else {
            this._cmd   = byte;
            this._state = 'cmd';
          }
          break;

        case 'cmd':
          this._opt = byte;
          this.emit('option', { cmd: this._cmd, opt: this._opt });
          this._state = 'data';
          break;

        case 'sb':
          if (byte === IAC) {
            this._state = 'iac_se';
          } else {
            // Bound the subnegotiation body. Real options (NAWS, TTYPE, etc.)
            // never exceed a few hundred bytes; if we're past SB_BUF_MAX the
            // peer is misbehaving and we cut them off.
            if (this._sbBuf.length >= SB_BUF_MAX) {
              this._overflow = true;
              this._sbBuf    = [];
              this.emit('sb-overflow', { limit: SB_BUF_MAX });
              if (out.length > 0) this.push(Buffer.from(out));
              callback();
              return;
            }
            this._sbBuf.push(byte);
          }
          break;

        case 'iac_se':
          if (byte === SE) {
            this._handleSubneg(this._sbBuf);
            this._sbBuf = [];   // release the body once consumed
          } else if (byte === IAC) {
            // Escaped 0xFF inside SB body
            if (this._sbBuf.length >= SB_BUF_MAX) {
              this._overflow = true;
              this._sbBuf    = [];
              this.emit('sb-overflow', { limit: SB_BUF_MAX });
              if (out.length > 0) this.push(Buffer.from(out));
              callback();
              return;
            }
            this._sbBuf.push(0xFF);
          }
          this._state = byte === IAC ? 'sb' : 'data';
          break;
      }
    }

    if (out.length > 0) this.push(Buffer.from(out));
    callback();
  }

  _handleSubneg(data) {
    if (data.length < 1) return;
    const opt = data[0];
    if (opt === NAWS && data.length >= 5) {
      const cols = (data[1] << 8) | data[2];
      const rows = (data[3] << 8) | data[4];
      this.emit('naws', { cols, rows });
    }
    if (opt === TTYPE && data.length >= 2 && data[1] === 0) {
      const ttype = Buffer.from(data.slice(2)).toString('ascii');
      this.emit('ttype', ttype);
    }
  }
}

/**
 * Read a single line from `stream`, echoing each character back to `socket`.
 * Used only in naive mode for the initial username prompt.
 *
 * Length policy
 * ─────────────
 * Both maxLen (callable parameter) and READLINE_MAX (the absolute ceiling
 * defined in this module) are enforced. The caller-supplied limit may not
 * exceed the absolute ceiling. This guarantees a memory bound regardless of
 * caller mistakes — a misconfigured maxLen of 1<<30 still produces a
 * 256-byte line.
 *
 * @param {Transform}                   stream   Filtered input stream to read
 * @param {import('net').Socket|object} socket   Writable used for echo output
 * @param {number}                      [maxLen=32]
 * @returns {Promise<string>}
 */
function readLineEchoed(stream, socket, maxLen = 32) {
  const cap = Math.min(Math.max(1, maxLen | 0), READLINE_MAX);

  return new Promise((resolve) => {
    let buf = '';
    const handler = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of bytes) {
        const ch = String.fromCharCode(byte);

        if (byte === 13 || byte === 10) {
          stream.removeListener('data', handler);
          resolve(buf);
          return;
        }

        if (byte === 127 || byte === 8) {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            socket.write('\x08 \x08');
          }
          continue;
        }

        if (byte < 32 || byte > 126) continue;

        if (buf.length < cap) {
          buf += ch;
          socket.write(ch);
        }
        // Silently drop further input once the cap is reached. The user
        // sees no echo, which is the standard "input full" cue.
      }
    };
    stream.on('data', handler);
  });
}

/**
 * Simple Promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  NEGOTIATE,
  TelnetFilterStream,
  readLineEchoed,
  sleep,
  // Exported for tests and for transports that want to log the constant.
  SB_BUF_MAX,
  READLINE_MAX,
};
