#!/usr/bin/env node
// generate-splash.js
// Run once from synthdoor/ root to create games/img2ansi/art/splash.ans
// Usage: node games/img2ansi/art/generate-splash.js

'use strict';

const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'splash.ans');

// ── ANSI helpers ────────────────────────────────────────────────────────────
const ESC = '\x1b[';

function color(fg, bg, bold) {
  const parts = [0];
  if (bold || fg >= 8) { parts.push(1); if (fg >= 8) parts.push(30 + fg - 8); else parts.push(30 + fg); }
  else parts.push(30 + fg);
  if (bg !== undefined && bg >= 0) parts.push(40 + (bg & 7));
  return `${ESC}${parts.join(';')}m`;
}

function goto(col, row) { return `${ESC}${row};${col}H`; }
function cls()          { return `${ESC}2J${ESC}H`; }
function reset()        { return `${ESC}0m`; }

// Color constants
const BK=0, DR=1, DG=2, DY=3, DB=4, DM=5, DC=6, WH=7;
const GY=8, BR=9, BG=10, BY=11, BB=12, BM=13, BC=14, BW=15;

// ── Build the art ───────────────────────────────────────────────────────────
let art = cls();

// Background: solid dark blue canvas
for (let r = 1; r <= 24; r++) {
  art += goto(1, r) + color(DB, DB) + ' '.repeat(80);
}

// ── Top decorative bar (row 1) ───────────────────────────────────────────────
art += goto(1, 1) + color(BC, DB);
for (let c = 1; c <= 80; c++) {
  const chars = ['▓','▒','░','▒','▓'];
  art += chars[(c-1) % chars.length];
}

// ── Bottom bar (row 24) ──────────────────────────────────────────────────────
art += goto(1, 24) + color(BC, DB);
for (let c = 1; c <= 80; c++) {
  const chars = ['▓','▒','░','▒','▓'];
  art += chars[(c-1) % chars.length];
}

// ── Left/Right side bars ─────────────────────────────────────────────────────
for (let r = 2; r <= 23; r++) {
  art += goto(1, r)  + color(DB==0?DC:DC, DB) + '▓';
  art += goto(80, r) + color(DC, DB) + '▓';
}

// ── Large block-art "IMG2ANSI" title (rows 3–9, centered) ───────────────────
// Hand-crafted pixel font, 5 rows tall, using block chars
// Each character is 6 cols wide with 1 space gap
const LOGO_ROWS = [
  // Row 1
  '  ██  █   █  ███  ████     ███  █   █  ██  ███ ',
  // Row 2
  ' █  █ ██ ██ █     ╚═══╗   █  █ ██  █ █    █   ',
  // Row 3
  ' █  █ █ █ █ █ ██  ████    █████ █ █ █  ██ ██  ',
  // Row 4
  ' █  █ █   █ █  █  ╔═══╝   █  █ █  ██    █ █   ',
  // Row 5
  '  ██  █   █  ███  █████   █  █ █   █ ███  ███ ',
];

const logoColors = [
  color(BC, DB),   // row 1 — bright cyan
  color(BW, DB),   // row 2 — white
  color(BY, DB),   // row 3 — bright yellow
  color(BW, DB),   // row 4 — white
  color(BC, DB),   // row 5 — bright cyan
];

const logoStartRow = 4;
const logoStartCol = 4;

for (let r = 0; r < LOGO_ROWS.length; r++) {
  art += goto(logoStartCol, logoStartRow + r);
  art += logoColors[r];
  art += LOGO_ROWS[r];
}

// ── Subtitle (row 11) ────────────────────────────────────────────────────────
const subtitle = 'CP437 / ANSI IMAGE CONVERTER FOR THE MODERN BBS';
const subCol   = Math.floor((80 - subtitle.length) / 2) + 1;
art += goto(subCol, 11) + color(DY, DB) + subtitle;

// ── Shade divider (row 12) ───────────────────────────────────────────────────
art += goto(5, 12) + color(DC, DB);
const divChars = ['░','▒','▓','█','▓','▒','░'];
for (let c = 0; c < 72; c++) {
  art += divChars[c % divChars.length];
}

// ── Feature list (rows 14–17) ────────────────────────────────────────────────
const features = [
  { icon: '▓', text: '80×24 Terminal  ·  Half-Block 80×48 Resolution',  fc: BG },
  { icon: '▒', text: '16 Foreground / 8 Background CGA Colors',          fc: BB },
  { icon: '░', text: 'Perceptual Oklab Matching  ·  Floyd-Steinberg Dither', fc: BM },
  { icon: '█', text: 'Zoom, Pan, Presets & Live Interactive Tuning',     fc: BR },
];

for (let i = 0; i < features.length; i++) {
  const f   = features[i];
  const row = 14 + i;
  const col = 12;
  art += goto(col, row) + color(f.fc, DB) + ' ' + f.icon + '  ';
  art += color(WH, DB) + f.text;
}

// ── Credits (row 20) ─────────────────────────────────────────────────────────
const credit = '[ SynthDoor BBS Engine Edition ]';
const credCol = Math.floor((80 - credit.length) / 2) + 1;
art += goto(credCol, 20) + color(DG, DB) + credit;

// ── "Press any key" (row 22, blinking not available in file so just styled) ──
const pak = '>>>  PRESS ANY KEY TO BEGIN  <<<';
const pakCol = Math.floor((80 - pak.length) / 2) + 1;
art += goto(pakCol, 22) + color(BW, DB) + pak;

// Reset at end
art += reset();

// Write file
fs.writeFileSync(OUT, art, 'binary');
console.log(`Splash written to: ${OUT}`);
console.log(`Size: ${fs.statSync(OUT).size} bytes`);
