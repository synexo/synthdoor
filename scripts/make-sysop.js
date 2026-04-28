#!/usr/bin/env node
'use strict';

/**
 * scripts/make-sysop.js
 * Bootstrap script to grant sysop role to a user in authenticated mode.
 *
 * Safe to run while the server is running — better-sqlite3 handles
 * concurrent access correctly.
 *
 * Usage:
 *   node scripts/make-sysop.js <username>
 *   node scripts/make-sysop.js <username> --demote     # remove sysop role
 *   node scripts/make-sysop.js --list                  # list all sysops
 *
 * The script reads db_path from synthdoor.conf (or SYNTHDOOR_CONF env var).
 * It only affects the authenticated-mode players table — in naive mode,
 * sysop access is controlled by the sysop_users config key instead.
 */

const path = require('path');
const fs   = require('fs');

// ─── Resolve config ───────────────────────────────────────────────────────

const confPath = process.env.SYNTHDOOR_CONF
  || path.resolve(__dirname, '../config/synthdoor.conf');

if (!fs.existsSync(confPath)) {
  die(`Config file not found: ${confPath}\nSet SYNTHDOOR_CONF env var to override.`);
}

// Minimal config reader (avoids pulling in the full server stack)
function readConf(filePath) {
  const data = {};
  for (let line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    data[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return data;
}

const conf     = readConf(confPath);
const authMode = (conf.auth_mode || 'naive').toLowerCase().trim();

if (authMode !== 'authenticated') {
  die(
    `This script is for authenticated mode only.\n` +
    `In naive mode, grant sysop access by adding the username to\n` +
    `sysop_users in synthdoor.conf.`
  );
}

const projectRoot = path.resolve(__dirname, '..');
const dbPathRaw   = conf.db_path || './data/synthdoor.db';
const dbPath      = path.resolve(projectRoot, dbPathRaw);

if (!fs.existsSync(dbPath)) {
  die(`Database not found: ${dbPath}\nHas the server been run at least once?`);
}

// ─── Open DB ──────────────────────────────────────────────────────────────

let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  die('better-sqlite3 is not installed. Run: npm install');
}

const db = new Database(dbPath);

// ─── Parse args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

if (args[0] === '--list') {
  listSysops();
  process.exit(0);
}

const username = args[0];
const demote   = args.includes('--demote');

if (!username) {
  usage();
  process.exit(1);
}

// ─── Verify user exists ───────────────────────────────────────────────────

const player = db.prepare('SELECT username, role FROM players WHERE username = ?').get(username);

if (!player) {
  die(
    `User "${username}" not found in the players table.\n` +
    `They must log in at least once before a role can be assigned.`
  );
}

// ─── Apply role change ────────────────────────────────────────────────────

const newRole = demote ? 'user' : 'sysop';
const oldRole = player.role || 'user';

if (oldRole === newRole) {
  console.log(`"${username}" already has role: ${newRole}. No change made.`);
  process.exit(0);
}

db.prepare('UPDATE players SET role = ? WHERE username = ?').run(newRole, username);

console.log(`\n  ✓ Role updated`);
console.log(`    User:     ${username}`);
console.log(`    Previous: ${oldRole}`);
console.log(`    New role: ${newRole}`);
console.log('');

db.close();

// ─── Helpers ──────────────────────────────────────────────────────────────

function listSysops() {
  const rows = db.prepare(
    `SELECT username, last_seen FROM players WHERE role = 'sysop' ORDER BY username`
  ).all();

  if (rows.length === 0) {
    console.log('\n  No sysop accounts found.\n');
    return;
  }

  console.log('\n  Sysop accounts:');
  for (const row of rows) {
    const seen = row.last_seen
      ? new Date(row.last_seen * 1000).toISOString().slice(0, 10)
      : 'never';
    console.log(`    ${row.username.padEnd(30)} last seen: ${seen}`);
  }
  console.log('');
  db.close();
}

function usage() {
  console.log(`
Usage:
  node scripts/make-sysop.js <username>           Grant sysop role
  node scripts/make-sysop.js <username> --demote  Remove sysop role
  node scripts/make-sysop.js --list               List all sysop accounts

Note: authenticated mode only. For naive mode, edit sysop_users in synthdoor.conf.
`);
}

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}
