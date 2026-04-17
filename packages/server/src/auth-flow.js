'use strict';

/**
 * auth-flow.js
 *
 * Bridges SynthAuth flows to a SynthDoor Terminal instance.
 * Provides a terminal dialogue adapter and convenience wrappers
 * used by both the telnet and rlogin transports.
 */

const path      = require('path');
const SynthAuth = require(path.join(__dirname, '..', '..', 'synth-auth', 'index.js'));

// Singleton — created once when the server starts, shared across connections.
let _authInstance = null;

/**
 * Initialise (or return) the shared SynthAuth instance.
 * Must be called once during server startup in authenticated mode.
 *
 * @param {object} opts
 * @param {string}  opts.pepper
 * @param {Buffer}  opts.synthSalt
 * @param {string}  [opts.dbPath]
 * @param {string}  [opts.wordlistPath]
 * @returns {SynthAuth}
 */
function initAuth(opts) {
  if (_authInstance) return _authInstance;
  _authInstance = new SynthAuth(opts);
  return _authInstance;
}

/**
 * Return the shared SynthAuth instance (must have been initialised).
 * @returns {SynthAuth}
 */
function getAuth() {
  if (!_authInstance) throw new Error('[auth-flow] SynthAuth not initialised. Call initAuth() first.');
  return _authInstance;
}

/**
 * Build a dialogue adapter that wraps a Terminal instance.
 * send() → terminal.println()
 * prompt() → terminal.readLine({ echo: true })
 *
 * @param {Terminal} terminal
 * @returns {{ send: Function, prompt: Function }}
 */
function makeDialogue(terminal) {
  return {
    send(text) {
      terminal.println(text || '');
    },
    prompt(text) {
      if (text) terminal.print(text);
      return terminal.readLine({ echo: true, maxLen: 200 });
    },
  };
}

/**
 * Run the full entry flow (telnet authenticated mode).
 * Handles ENTER → guest, "new" → register, username → login.
 *
 * @param {Terminal} terminal
 * @param {string|null} ipAddress
 * @returns {Promise<AuthResult>}
 */
async function runEntryFlow(terminal, ipAddress) {
  const auth      = getAuth();
  const dialogue  = makeDialogue(terminal);
  return auth.entryFlow(dialogue, ipAddress);
}

/**
 * Run a silent BBS rlogin login using a pre-supplied recovery code.
 * No terminal prompts are sent (the dialogue adapter returns the
 * recovery code automatically).
 *
 * If the code maps to an existing account  → login.
 * If the code is valid but no account yet  → silent auto-register.
 * If the code is invalid                   → failure.
 *
 * @param {string}      rawUsername   ClientUser from rlogin handshake
 * @param {string}      recoveryCode  ServerUser (the BBS system code)
 * @param {string|null} ipAddress
 * @returns {Promise<AuthResult>}
 */
async function runSilentBBSLogin(rawUsername, recoveryCode, ipAddress) {
  const auth = getAuth();

  // Build a silent dialogue: send() discards output, prompt() returns recoveryCode.
  // loginFlow is called with prefilledUsername so the only prompt() call is
  // the code words prompt — we supply the BBS recovery code automatically.
  const dialogue = {
    send(_text) { /* silent — no terminal output */ },
    prompt(_text) {
      return Promise.resolve(recoveryCode);
    },
  };

  return auth.loginFlow(dialogue, ipAddress, rawUsername);
}

/**
 * Run login flow for rlogin when no recovery code is in ServerUser —
 * the user must authenticate interactively via the terminal.
 *
 * @param {Terminal}    terminal
 * @param {string}      rawUsername   Pre-filled from ClientUser // currently unused
 * @param {string|null} ipAddress
 * @returns {Promise<AuthResult>}
 */
async function runInteractiveLogin(terminal, rawUsername, ipAddress) {
  const auth     = getAuth();
  const dialogue = makeDialogue(terminal);
  return auth.entryFlow(dialogue, ipAddress);
}

module.exports = {
  initAuth,
  getAuth,
  makeDialogue,
  runEntryFlow,
  runSilentBBSLogin,
  runInteractiveLogin,
};
