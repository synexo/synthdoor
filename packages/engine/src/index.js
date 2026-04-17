/**
 * @synthdoor/engine — Core SynthDoor game engine.
 *
 * Usage in a game:
 *   const { Terminal, Screen, Draw, Input, Audio, DB, Multiplayer, Utils } = require('...');
 */

'use strict';

const path = require('path');
const dir  = __dirname; // absolute path to this file's directory

// Load each module using absolute paths to prevent any caching ambiguity
const Terminal    = require(path.join(dir, 'terminal'));
const Screen      = require(path.join(dir, 'screen'));
const Draw        = require(path.join(dir, 'draw'));
const Input       = require(path.join(dir, 'input'));
const Audio       = require(path.join(dir, 'audio'));
const DB          = require(path.join(dir, 'database'));
const Multiplayer = require(path.join(dir, 'multiplayer'));
const GameBase    = require(path.join(dir, 'game-base'));
const Utils       = require(path.join(dir, 'utils'));
const { Color, Attr, CP437 } = require(path.join(dir, 'constants'));

// Sanity check — will appear in server logs if Utils failed to load
if (!Utils || typeof Utils.center !== 'function') {
  console.error('[engine] WARNING: Utils.center is not a function! Utils:', typeof Utils);
  console.error('[engine] utils.js path:', path.join(dir, 'utils.js'));
}

module.exports = {
  Terminal,
  Screen,
  Draw,
  Input,
  Audio,
  DB,
  Multiplayer,
  GameBase,
  Utils,
  Color,
  Attr,
  CP437,
};
