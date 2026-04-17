#!/usr/bin/env node
/**
 * test-game.js — Run any SynthDoor game in your local terminal.
 * Windows-compatible (PowerShell / cmd / Windows Terminal).
 */

'use strict';

// ─── Global error handlers ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  process.stderr.write('\n[test-game] UNCAUGHT EXCEPTION:\n');
  process.stderr.write((err.stack || err.message) + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write('\n[test-game] UNHANDLED REJECTION:\n');
  process.stderr.write((reason?.stack || String(reason)) + '\n');
  process.exit(1);
});

const path = require('path');
const fs   = require('fs');

// ─── Args ─────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const gameName = args.find(a => !a.startsWith('--'));
const userIdx  = args.indexOf('--user');
const dbIdx    = args.indexOf('--db');
const listMode = args.includes('--list');
const username = userIdx !== -1 ? args[userIdx + 1]
               : (process.env.USERNAME || process.env.USER || 'dev');
const dbPath   = dbIdx   !== -1 ? args[dbIdx + 1] : './data/synthdoor.db';

// ─── Discover games ───────────────────────────────────────────────────────
const gamesDir = path.resolve(__dirname, 'games');
const games    = new Map();

if (fs.existsSync(gamesDir)) {
  for (const dir of fs.readdirSync(gamesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const ep = path.join(gamesDir, dir.name, 'src', 'index.js');
    if (!fs.existsSync(ep)) continue;
    try {
      const G = require(ep);
      games.set(G.GAME_NAME || dir.name, { GameClass: G });
    } catch (e) {
      process.stderr.write('[test-game] Load error ' + dir.name + ': ' + e.message + '\n');
      process.stderr.write(e.stack + '\n');
    }
  }
}

// ─── --list ───────────────────────────────────────────────────────────────
if (listMode) {
  process.stdout.write('\nAvailable games:\n\n');
  for (const [name, { GameClass }] of games) {
    process.stdout.write('  ' + name.padEnd(22) + (GameClass.GAME_TITLE || name) + '\n');
  }
  process.stdout.write('\n');
  process.exit(0);
}

if (!gameName) {
  process.stderr.write('Usage: node test-game.js <game>  |  node test-game.js --list\n');
  process.exit(1);
}

const entry = games.get(gameName);
if (!entry) {
  process.stderr.write('Game not found: "' + gameName + '"\n');
  process.stderr.write('Run: node test-game.js --list\n');
  process.exit(1);
}

// ─── TTY / raw mode (Windows-safe) ───────────────────────────────────────
process.stdin.resume();

let rawOk = false;
try {
  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
    rawOk = true;
  }
} catch (_) {}

if (!rawOk) {
  process.stderr.write(
    '[test-game] WARNING: Raw input mode unavailable.\n' +
    'For best results use Windows Terminal or PowerShell.\n\n'
  );
}

try { process.stdout.write('\x1b[?1049h'); } catch (_) {}

// ─── Cleanup ──────────────────────────────────────────────────────────────
let done = false;
function cleanup() {
  if (done) return;
  done = true;
  try { if (rawOk) process.stdin.setRawMode(false); } catch (_) {}
  try { process.stdout.write('\x1b[?1049l\x1b[0m\r\n'); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT',  cleanup);
process.on('SIGTERM', cleanup);

process.stdin.on('data', (chunk) => {
  if ((Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).includes(0x03)) cleanup();
});

// ─── Engine ───────────────────────────────────────────────────────────────
const { Terminal, DB } = require(path.join(__dirname, 'packages', 'engine', 'src', 'index.js'));

const terminal = new Terminal({
  output:    process.stdout,
  input:     process.stdin,
  username,
  transport: 'telnet',
  encoding:  'utf8',  // local terminal is UTF-8
});

terminal.on('disconnect', cleanup);

const db = new DB(dbPath);
try { db.init(); } catch (e) {
  process.stderr.write('[test-game] DB warning: ' + e.message + '\n');
}

// ─── Launch ───────────────────────────────────────────────────────────────
const game = new entry.GameClass({ terminal, db, username, transport: 'telnet' });

process.stderr.write('[test-game] Starting "' + gameName + '" as "' + username + '"...\n');

game.start()
  .then(cleanup)
  .catch(err => {
    process.stderr.write('\n[test-game] FATAL ERROR:\n');
    process.stderr.write((err.stack || err.message) + '\n');
    cleanup();
  });
