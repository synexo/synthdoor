/**
 * audio.js
 * ANSI music (MML - Music Macro Language) support.
 *
 * ANSI MUSIC SEQUENCE FORMAT (BBS standard):
 *   ESC [ M <mml_string> \x0e
 *
 * Where:
 *   ESC [ M  = the trigger sequence (0x1B 0x5B 0x4D)
 *   mml_string = the MML music commands (ASCII only)
 *   \x0e     = Shift-Out byte, terminates the sequence
 *
 * This is the format understood by SyncTERM, NetRunner, mTelnet,
 * and other BBS-compatible clients that support ANSI music.
 *
 * MML syntax:
 *   T<n>     - Tempo in BPM (e.g. T120)
 *   O<n>     - Octave 0-6 (e.g. O4)
 *   L<n>     - Default note length: 1=whole, 2=half, 4=quarter, 8=eighth, etc.
 *   A-G      - Play note (append length to override: C8 = eighth-note C)
 *   #  or +  - Sharp (e.g. C#4)
 *   -        - Flat  (e.g. D-4)
 *   .        - Dotted note (1.5x duration)
 *   P<n>     - Pause/rest (e.g. P4 = quarter rest)
 *   >        - Octave up
 *   <        - Octave down
 *   MN       - Music Normal mode (default)
 *   ML       - Music Legato mode
 *   MS       - Music Staccato mode
 *   ;        - Separator / comment (ignored)
 *
 * Example:
 *   T160 O4 L8 CDEFEDC     (ascending/descending scale at 160bpm)
 *   T120 O5 L4 C.D.E2       (dotted notes)
 *
 * Usage:
 *   const audio = new Audio(terminal, transport);
 *   const ok = await audio.promptUser();   // REQUIRED before play()
 *   if (ok) audio.play('T120 O4 L8 CDEFEDC');
 *   audio.stop();
 */

'use strict';

// ─── ANSI music escape sequence constants ────────────────────────────────
// ESC [ M <mml> SO
const ANSI_MUSIC_START = '\x1b[M';  // ESC [ M
const ANSI_MUSIC_END   = '\x0e';    // SO (Shift-Out) — terminator

// Standard note frequencies for Web Audio path (A4 = 440 Hz)
const NOTE_FREQ = {
  C: [16.35,  32.70,  65.41,  130.81, 261.63, 523.25, 1046.50],
  D: [18.35,  36.71,  73.42,  146.83, 293.66, 587.33, 1174.66],
  E: [20.60,  41.20,  82.41,  164.81, 329.63, 659.25, 1318.51],
  F: [21.83,  43.65,  87.31,  174.61, 349.23, 698.46, 1396.91],
  G: [24.50,  49.00,  98.00,  196.00, 392.00, 783.99, 1567.98],
  A: [27.50,  55.00,  110.00, 220.00, 440.00, 880.00, 1760.00],
  B: [30.87,  61.74,  123.47, 246.94, 493.88, 987.77, 1975.53],
};

class Audio {
  /**
   * @param {Terminal} terminal
   * @param {string}   [transport] - 'telnet'|'rlogin'|'web'
   */
  constructor(terminal, transport = 'telnet') {
    this.terminal  = terminal;
    this.transport = transport;
    this.enabled   = false;
    this._webSend  = null;
  }

  /**
   * Prompt the user asking if ANSI music should be enabled.
   * MUST be called before play(). Returns true if user said yes.
   */
  async promptUser() {
    const answer = await this.terminal.askYesNo(
      'This application supports ANSI music. Enable audio?',
      false
    );
    this.enabled = answer;
    this.terminal.enableMusic(answer);
    return answer;
  }

  /**
   * Play an MML string.
   *
   * telnet/rlogin: sends  ESC [ M <mml> \x0e  directly to terminal.
   * web:           parses MML and sends note events to the browser.
   *
   * @param {string} mml - MML string, e.g. 'T120 O4 L8 CDEFEDC'
   */
  play(mml) {
    if (!this.enabled) return this;

    if (this.transport === 'web' && this._webSend) {
      const events = this.parseMML(mml);
      this._webSend({ type: 'audio', events });
    } else {
      // Send raw ANSI music sequence.
      // Bypass the CP437 encoder — this is a control sequence, all ASCII.
      // The \x0e terminator must be sent as a literal byte.
      this.terminal.writeRaw(ANSI_MUSIC_START + mml + ANSI_MUSIC_END);
    }
    return this;
  }

  /**
   * Stop playback.
   * Sends an empty MML sequence which clears the music queue on most clients.
   */
  stop() {
    if (!this.enabled) return this;
    if (this.transport !== 'web') {
      this.terminal.writeRaw(ANSI_MUSIC_START + ANSI_MUSIC_END);
    } else if (this._webSend) {
      this._webSend({ type: 'audio_stop' });
    }
    return this;
  }

  // ─── MML Parser (for Web Audio path) ─────────────────────────────────────
  /**
   * Parse an MML string into an array of timed note events.
   * Used only by the web transport to drive Web Audio API in the browser.
   *
   * @param {string} mml
   * @returns {Array<{type:'note'|'rest', freq:number, duration:number}>}
   */
  parseMML(mml) {
    const events  = [];
    let tempo     = 120;
    let octave    = 4;
    let baseLen   = 4;
    let i         = 0;
    const s       = mml.toUpperCase().replace(/\s+/g, '');

    const beatMs   = ()          => 60000 / tempo;
    const noteMs   = (len, dots) => {
      let ms = (beatMs() * 4) / len;
      if (dots > 0) ms *= 1.5;
      return Math.round(ms);
    };

    const readInt = () => {
      let n = '';
      while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++];
      return n ? parseInt(n) : null;
    };

    const readDots = () => {
      let d = 0;
      while (i < s.length && s[i] === '.') { d++; i++; }
      return d;
    };

    while (i < s.length) {
      const ch = s[i];

      if (ch === 'T') {
        i++;
        const n = readInt();
        if (n) tempo = Math.max(32, Math.min(255, n));

      } else if (ch === 'O') {
        i++;
        const n = readInt();
        if (n !== null) octave = Math.max(0, Math.min(6, n));

      } else if (ch === 'L') {
        i++;
        const n = readInt();
        if (n) baseLen = n;

      } else if (ch === '>') {
        octave = Math.min(6, octave + 1); i++;

      } else if (ch === '<') {
        octave = Math.max(0, octave - 1); i++;

      } else if ('ABCDEFG'.includes(ch)) {
        i++;
        let sharp = 0;
        if (s[i] === '#' || s[i] === '+') { sharp = 1;  i++; }
        else if (s[i] === '-')            { sharp = -1; i++; }

        const len  = readInt() || baseLen;
        const dots = readDots();

        let freq = NOTE_FREQ[ch]?.[octave] ?? 440;
        if (sharp !== 0) freq *= Math.pow(2, sharp / 12);

        events.push({ type: 'note', freq, duration: noteMs(len, dots) });

      } else if (ch === 'P' || ch === 'R') {
        i++;
        const len  = readInt() || baseLen;
        const dots = readDots();
        events.push({ type: 'rest', freq: 0, duration: noteMs(len, dots) });

      } else if (ch === 'M') {
        i++;
        if ('NLS'.includes(s[i])) i++; // skip mode letter

      } else {
        i++; // skip unknown chars, semicolons, spaces
      }
    }

    return events;
  }

  /**
   * Attach a web-socket send function for the web transport.
   * Called by the web transport when a client connects.
   * @param {Function} fn
   */
  setWebSender(fn) {
    this._webSend = fn;
    return this;
  }
}

module.exports = Audio;
