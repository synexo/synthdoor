/**
 * connection.js
 *
 * WebSocket connection manager.
 *
 * Sends and receives raw binary (ArrayBuffer) frames exclusively.
 * CP437 bytes 0x80-0xFF are preserved correctly because they travel
 * as opaque binary data — never through a UTF-8 text codec.
 *
 * Handles:
 *  - Connect / disconnect lifecycle
 *  - Idle timeout detection
 */

export class WSConnection {
  /**
   * @param {object} opts
   * @param {function(Uint8Array)} opts.onData  — called with incoming bytes
   * @param {function(string,string)} opts.onStatus — called with (type, label)
   *   type: 'connecting' | 'connected' | 'disconnected' | 'error'
   */
  constructor({ onData, onStatus }) {
    this.onData    = onData;
    this.onStatus  = onStatus;
    this._ws       = null;
    this.connected = false;
  }

  connect(url) {
    if (this._ws) this.disconnect();

    this._setStatus('connecting', 'CONNECTING…');

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this._setStatus('error', 'INVALID URL');
      return;
    }

    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this._setStatus('connected', 'CONNECTED');
    });

    ws.addEventListener('message', (ev) => {
      try {
        const bytes = new Uint8Array(ev.data);
        if (bytes.length > 0) this.onData(bytes);
      } catch (e) {
        console.warn('[WSConnection] decode error:', e);
      }
    });

    ws.addEventListener('close', (ev) => {
      this.connected = false;
      const reason = ev.wasClean ? 'DISCONNECTED' : `DISCONNECTED (${ev.code})`;
      this._setStatus('disconnected', reason);
      this._ws = null;
    });

    ws.addEventListener('error', () => {
      this._setStatus('error', 'CONNECTION ERROR');
    });
  }

  disconnect() {
    if (this._ws) {
      try { this._ws.close(1000, 'user disconnect'); } catch (_) {}
      this._ws = null;
    }
    this.connected = false;
  }

  /**
   * Send raw bytes to the server.
   * @param {Uint8Array|ArrayBuffer} bytes
   */
  sendBytes(bytes) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    try {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const buf = u8.buffer.byteLength === u8.byteLength
        ? u8.buffer
        : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
      this._ws.send(buf);
    } catch (e) {
      console.warn('[WSConnection] send error:', e);
    }
  }

  /**
   * Send a string as latin1 bytes.
   * Each character's charCode is used directly as the byte value.
   * Correct for ANSI escape sequences and key codes (all below 0x80),
   * and for any intentional latin1-encoded output.
   * @param {string} str
   */
  sendString(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    this.sendBytes(bytes);
  }

  // ── Private ──────────────────────────────────────────────────

  _setStatus(type, label) {
    if (this.onStatus) this.onStatus(type, label);
  }
}
