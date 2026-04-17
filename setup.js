#!/usr/bin/env node
/**
 * setup.js — SynthDoor install validator and quick-start helper.
 *
 * Run this after npm install to:
 *   1. Check Node.js version
 *   2. Verify required dependencies are installed
 *   3. Create the data/ directory and initialize the SQLite database
 *   4. Discover and list available games
 *   5. Print quick-start instructions
 *
 * Usage:
 *   node setup.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const OK   = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36m→\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';

console.log('\n\x1b[36m╔══════════════════════════════════════════╗');
console.log('║   SynthDoor Setup & Validation v1.0.0   ║');
console.log('╚══════════════════════════════════════════╝\x1b[0m\n');

let errors = 0;

// ─── 1. Node.js version ───────────────────────────────────────────────────
const nodeVer = parseInt(process.versions.node.split('.')[0]);
if (nodeVer >= 18) {
  console.log(`${OK} Node.js ${process.versions.node} (18+ required)`);
} else {
  console.log(`${FAIL} Node.js ${process.versions.node} — version 18+ required`);
  errors++;
}

// ─── 2. Dependencies ──────────────────────────────────────────────────────
console.log();
const deps = [
  { name: 'better-sqlite3', optional: false },
  { name: 'ws',             optional: false },
  { name: 'express',        optional: false },
  { name: 'express-session',optional: false },
];

for (const dep of deps) {
  const paths = [
    path.join(__dirname, 'node_modules', dep.name),
  ];
  const found = paths.some(p => fs.existsSync(p));
  if (found) {
    console.log(`${OK} ${dep.name}`);
  } else if (dep.optional) {
    console.log(`${WARN} ${dep.name} (optional — not found)`);
  } else {
    console.log(`${FAIL} ${dep.name} — run: npm install`);
    errors++;
  }
}

// ─── 3. Data directory + DB ───────────────────────────────────────────────
console.log();
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`${OK} Created data/ directory`);
} else {
  console.log(`${OK} data/ directory exists`);
}

const dbPath = path.join(dataDir, 'synthdoor.db');
try {
  // Try to init the DB
  const DB = require('./packages/engine/src/database');
  const db = new DB(dbPath);
  db.init();
  db.close();
  console.log(`${OK} SQLite database initialized: ${dbPath}`);
} catch (e) {
  console.log(`${WARN} Could not initialize DB (better-sqlite3 may not be installed): ${e.message}`);
}

// ─── 4. Config file ───────────────────────────────────────────────────────
console.log();
const confPath = path.join(__dirname, 'config', 'synthdoor.conf');
if (fs.existsSync(confPath)) {
  console.log(`${OK} Config file: config/synthdoor.conf`);
} else {
  console.log(`${WARN} Config file not found at config/synthdoor.conf — using defaults`);
}

// ─── 5. Game discovery ────────────────────────────────────────────────────
console.log();
console.log('\x1b[36mDiscovered games:\x1b[0m');

const gamesDir = path.join(__dirname, 'games');
let gameCount  = 0;

if (fs.existsSync(gamesDir)) {
  for (const dir of fs.readdirSync(gamesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const entry = path.join(gamesDir, dir.name, 'src', 'index.js');
    if (!fs.existsSync(entry)) continue;
    try {
      const GameClass = require(entry);
      const name  = GameClass.GAME_NAME  || dir.name;
      const title = GameClass.GAME_TITLE || name;
      console.log(`  ${OK} ${name.padEnd(22)} ${title}`);
      gameCount++;
    } catch (e) {
      console.log(`  ${FAIL} ${dir.name.padEnd(22)} (load error: ${e.message})`);
      errors++;
    }
  }
}

if (gameCount === 0) {
  console.log(`  ${WARN} No games found in games/ directory`);
}

// ─── 6. Summary ───────────────────────────────────────────────────────────
console.log();
if (errors === 0) {
  console.log('\x1b[32m✓ Setup complete! SynthDoor is ready.\x1b[0m\n');
} else {
  console.log(`\x1b[31m✗ Setup completed with ${errors} error(s). Fix the issues above.\x1b[0m\n`);
}

// ─── Quick-start instructions ─────────────────────────────────────────────
console.log('\x1b[36mQuick Start:\x1b[0m');
console.log();
console.log('  Test a game in your terminal (no server needed):');
console.log('    \x1b[33mnode test-game.js tetris\x1b[0m');
console.log('    \x1b[33mnode test-game.js caverns\x1b[0m');
console.log('    \x1b[33mnode test-game.js eliza\x1b[0m');
console.log('    \x1b[33mnode test-game.js --list\x1b[0m');
console.log();
console.log('  Start all servers (telnet :2323, WebSocket :8080):');
console.log('    \x1b[33mnpm start\x1b[0m');
console.log();
console.log('  Start the web auth/test server (http://localhost:3000):');
console.log('    \x1b[33mnpm run start:web\x1b[0m');
console.log();
console.log('  Connect via telnet:');
console.log('    \x1b[33mtelnet localhost 2323\x1b[0m');
console.log();
console.log('  Create a new game with Claude:');
console.log('    Share CLAUDE.md and docs/ with Claude, then prompt:');
console.log('    \x1b[33m"Create a Trade Wars clone for SynthDoor"\x1b[0m');
console.log();
