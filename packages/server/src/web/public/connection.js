/**
 * connection.js
 *
 * WebSocket connection manager.
 *
 * Handles:
 *  - Sub-protocol negotiation (binary > base64 > plain)
 *  - Encoding / decoding of frames for each sub-protocol
 *  - Idle timeout detection
 *  - Reconnect (not automatic — caller decides)
 *
 * Sub-protocol encoding:
 *   binary — raw ArrayBuffer frames (preferred)
 *   base64 — base64-encoded text frames
 *   plain  — latin1 binary-in-text frames
 *
 * Critical: We must NEVER use TextDecoder/TextEncoder with UTF-8 for CP437
 * data — bytes 0x80-0xFF encode to two-byte sequences in UTF-8, corrupting
 * box-drawing characters, accented letters, and block graphics.
 * latin1 (ISO 8859-1) is a 1:1 byte→codepoint mapping and is the correct
 * encoding for this wire format.
 */

export class WSConnection {
  /**
   * @param {object} opts
   * @param {function(Uint8Array)} opts.onData  — called with decoded incoming bytes
   * @param {function(string,string)} opts.onStatus — called with (type, label)
   *   type: 'connecting' | 'connected' | 'disconnected' | 'error'
   */
  constructor({ onData, onStatus }) {
    this.onData   = onData;
    this.onStatus = onStatus;
    this._ws      = null;
    this._proto   = 'plain';
    this.connected = false;
  }

  connect(url) {
    if (this._ws) this.disconnect();

    this._setStatus('connecting', 'CONNECTING…');

    let ws;
    try {
      ws = new WebSocket(url, ['binary', 'base64', 'plain']);
    } catch (e) {
      this._setStatus('error', 'INVALID URL');
      return;
    }

    ws.binaryType = 'arraybuffer';
    this._ws = ws;

    ws.addEventListener('open', () => {
      this._proto    = ws.protocol || 'plain';
      this.connected = true;
      this._setStatus('connected', 'CONNECTED');
    });

    ws.addEventListener('message', (ev) => {
      try {
        const bytes = this._decode(ev.data);
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
      this._ws.send(this._encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    } catch (e) {
      console.warn('[WSConnection] send error:', e);
    }
  }

  /**
   * Send a string as latin1 bytes.
   * Each character's charCode is used directly as the byte value.
   * This is correct for ANSI escape sequences and key codes.
   * @param {string} str
   */
  sendString(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
    this.sendBytes(bytes);
  }

  // ── Private ──────────────────────────────────────────────────

  _encode(bytes) {
    if (this._proto === 'binary') {
      return bytes.buffer.byteLength === bytes.length
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    if (this._proto === 'base64') {
      return this._bytesToBase64(bytes);
    }
    // 'plain': latin1 encoding
    return this._bytesToLatin1(bytes);
  }

  _decode(data) {
    if (this._proto === 'binary') {
      return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer);
    }
    if (this._proto === 'base64') {
      return this._base64ToBytes(typeof data === 'string' ? data : new TextDecoder().decode(data));
    }
    // 'plain': latin1
    const str = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data);
    return this._latin1ToBytes(str);
  }

  _bytesToBase64(bytes) {
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str);
  }

  _base64ToBytes(b64) {
    const str = atob(b64);
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
    return out;
  }

  _bytesToLatin1(bytes) {
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return str;
  }

  _latin1ToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
    return out;
  }

  _setStatus(type, label) {
    if (this.onStatus) this.onStatus(type, label);
  }
}
