'use strict';

/**
 * @synthdoor/synth-auth — Deterministic Identity System
 * Integrated into SynthDoor as a combined package.
 *
 * Usage:
 *   const SynthAuth = require('./packages/synth-auth');
 *
 *   const auth = new SynthAuth({
 *     pepper:    process.env.PEPPER,
 *     synthSalt: Buffer.from(process.env.SYNTH_SALT, 'hex'),
 *     dbPath:    './data/synth-auth.db',         // optional
 *   });
 *
 *   const result = await auth.entryFlow(dialogue, ipAddress);
 */

const path         = require('path');
const WordList     = require('./src/wordlist');
const AuthDB       = require('./src/db');
const SessionStore = require('./src/session');
const {
  entryFlow,
  guestFlow,
  loginFlow,
  registrationFlow,
  recoveryFlow,
  looksLikeRecoveryCode,
  RECOVERY_CODE_RE,
} = require('./src/flow');
const crypto = require('./src/crypto');

class SynthAuth {
  /**
   * @param {object} opts
   * @param {string}  opts.pepper          PEPPER secret (required in authenticated mode)
   * @param {Buffer}  opts.synthSalt       SYNTH_SALT as Buffer (required in authenticated mode)
   * @param {string}  [opts.dbPath]        Path to SQLite file
   * @param {string}  [opts.wordlistPath]  Path to EFF wordlist
   * @param {number}  [opts.sessionTtl]    Session TTL in seconds (default 3600)
   */
  constructor(opts = {}) {
    if (!opts.pepper)    throw new Error('SynthAuth: opts.pepper is required');
    if (!opts.synthSalt) throw new Error('SynthAuth: opts.synthSalt is required');
    if (!Buffer.isBuffer(opts.synthSalt) || opts.synthSalt.length < 16) {
      throw new Error('SynthAuth: opts.synthSalt must be a Buffer of at least 16 bytes');
    }

    this._pepper    = opts.pepper;
    this._synthSalt = opts.synthSalt;

    const wordlistPath = opts.wordlistPath
      || path.join(__dirname, 'src', 'eff_large_wordlist.txt');

    this.wordList = new WordList(wordlistPath);
    this.db       = new AuthDB(opts.dbPath);
    this.sessions = new SessionStore({ ttlSeconds: opts.sessionTtl || 3600 });

    this.crypto = crypto;
  }

  /**
   * Build the config object passed to all flow functions.
   * @param {string|null} ipAddress
   * @returns {object}
   */
  _config(ipAddress = null) {
    return {
      pepper:    this._pepper,
      synthSalt: this._synthSalt,
      db:        this.db,
      wordList:  this.wordList,
      sessions:  this.sessions,
      ipAddress,
    };
  }

  // ---------------------------------------------------------------------------
  // High-level flow methods
  // ---------------------------------------------------------------------------

  /**
   * Full entry flow for telnet (authenticated mode).
   * Handles ENTER (guest), "new" (register), or username (login).
   */
  async entryFlow(dialogue, ipAddress = null) {
    return entryFlow(dialogue, this._config(ipAddress));
  }

  /**
   * Guest flow only — auto-register with random username, no confirmation.
   */
  async guestFlow(dialogue, ipAddress = null) {
    return guestFlow(dialogue, this._config(ipAddress));
  }

  /**
   * Login flow only.
   *
   * For rlogin BBS integration: pass prefilledUsername + have the transport
   * supply the recovery code at the code words prompt. If the code decodes to
   * a valid word triple but no account exists, the account is silently created
   * and a session token returned — no prompts or word disclosure.
   */
  async loginFlow(dialogue, ipAddress = null, prefilledUsername = null) {
    return loginFlow(dialogue, this._config(ipAddress), prefilledUsername);
  }

  /**
   * Registration flow only.
   */
  async registrationFlow(dialogue, ipAddress = null) {
    return registrationFlow(dialogue, this._config(ipAddress));
  }

  /**
   * Recovery flow only.
   */
  async recoveryFlow(dialogue, rawUsername, ipAddress = null) {
    return recoveryFlow(dialogue, this._config(ipAddress), rawUsername);
  }

  // ---------------------------------------------------------------------------
  // Direct identity derivation
  // ---------------------------------------------------------------------------

  async deriveIdentity(rawUsername, rawWords) {
    return crypto.deriveIdentity(
      rawUsername, rawWords,
      this._pepper, this._synthSalt,
      this.wordList
    );
  }

  // ---------------------------------------------------------------------------
  // BBS helpers
  // ---------------------------------------------------------------------------

  generateBBSCode() {
    return crypto.generateRecoveryCode();
  }

  /**
   * Check if a string looks like a recovery code (structural check only).
   */
  looksLikeRecoveryCode(input) {
    return looksLikeRecoveryCode(input);
  }
}

module.exports = SynthAuth;
module.exports.RECOVERY_CODE_RE = RECOVERY_CODE_RE;
