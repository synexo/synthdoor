/**
 * SBANSI engine-driven test.
 *
 * Drives the actual SynthDoor engine (Screen, Terminal) and captures the
 * byte stream from screen.flush(). Pipes that stream through encoder →
 * decoder and verifies the resulting client-side Terminal state matches
 * what direct ANSI parsing would produce.
 *
 * This validates the encoder against real engine emission patterns rather
 * than hand-crafted test vectors.
 */
'use strict';

const path = require('path');
const { Writable } = require('stream');

const ENGINE = path.join(__dirname, '../packages/engine/src');
const Screen   = require(path.join(ENGINE, 'screen'));
const Terminal = require(path.join(ENGINE, 'terminal'));
const { Color } = require(path.join(ENGINE, 'constants'));

const { SBANSIEncoder } = require(
  path.join(__dirname, '../packages/server/src/transports/sbansi-encoder'));

async function loadDecoder() {
  const dm = await import('file://' + path.join(__dirname,
    '../packages/server/src/web/public/sbansi-decoder.js'));
  return dm;
}

// ─── Engine harness ──────────────────────────────────────────────────────────
function makeEngineCapture() {
  const chunks = [];
  const out = new Writable({
    decodeStrings: false,
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary'));
      cb();
    },
  });
  const term = new Terminal({
    output: out,
    input: null,
    username: 'test',
    transport: 'web',
  });
  const screen = new Screen(term);
  screen.setMode(Screen.FIXED);
  return {
    term, screen,
    flushAndCapture() {
      chunks.length = 0;
      screen.flush();
      return Buffer.concat(chunks);
    },
  };
}

async function main() {
  const { SBANSIDecoder } = await loadDecoder();

  const SCENARIOS = [
    {
      name: 'full clear + write',
      run({ screen }) {
        screen.clear(Color.WHITE, Color.BLACK);
        screen.putString(1, 1, 'Hello World', Color.BRIGHT_YELLOW, Color.BLACK);
      },
    },
    {
      name: 'sparse sprite update',
      setup({ screen }) {
        screen.clear(Color.WHITE, Color.BLACK);
        screen.putChar(40, 12, '*', Color.BRIGHT_WHITE, Color.BLACK);
        screen.flush();
      },
      run({ screen }) {
        // Move "sprite" one cell right
        screen.putChar(40, 12, ' ', Color.WHITE, Color.BLACK);
        screen.putChar(41, 12, '*', Color.BRIGHT_WHITE, Color.BLACK);
      },
    },
    {
      name: 'colourful row',
      run({ screen }) {
        screen.clear(Color.WHITE, Color.BLACK);
        const colors = [Color.RED, Color.GREEN, Color.YELLOW, Color.BLUE,
                       Color.MAGENTA, Color.CYAN, Color.WHITE, Color.BRIGHT_RED,
                       Color.BRIGHT_GREEN, Color.BRIGHT_YELLOW];
        for (let i = 0; i < 10; i++) {
          screen.putString(1 + i*8, 5, 'COLOR' + i, colors[i], Color.BLACK);
        }
      },
    },
    {
      name: 'multi-row attr churn',
      run({ screen }) {
        screen.clear(Color.WHITE, Color.BLACK);
        for (let r = 1; r <= 10; r++) {
          for (let c = 1; c <= 80; c++) {
            const fg = ((r * c) % 8) + 8;       // bright colours, varying
            const bg = ((r + c) % 7) + 1;       // dark bgs, varying
            screen.putChar(c, r, '#', fg, bg);
          }
        }
      },
    },
    {
      name: 'CP437 box drawing',
      run({ screen }) {
        screen.clear(Color.WHITE, Color.BLACK);
        // Use Unicode strings that the engine maps via CP437
        const TL = '\u2554', TR = '\u2557', BL = '\u255A', BR = '\u255D';
        const H = '\u2550', V = '\u2551';
        screen.putChar(10, 5, TL, Color.CYAN, Color.BLACK);
        for (let c = 11; c <= 19; c++) screen.putChar(c, 5, H, Color.CYAN, Color.BLACK);
        screen.putChar(20, 5, TR, Color.CYAN, Color.BLACK);
        screen.putChar(10, 6, V, Color.CYAN, Color.BLACK);
        screen.putChar(20, 6, V, Color.CYAN, Color.BLACK);
        screen.putChar(10, 7, BL, Color.CYAN, Color.BLACK);
        for (let c = 11; c <= 19; c++) screen.putChar(c, 7, H, Color.CYAN, Color.BLACK);
        screen.putChar(20, 7, BR, Color.CYAN, Color.BLACK);
      },
    },
    {
      name: 'Meteoroid-style: starfield + sprites',
      setup({ screen }) {
        screen.clear(Color.WHITE, Color.BLACK);
        // Simulated stars
        const stars = [[5,3],[15,7],[22,11],[40,4],[55,18],[68,9],[12,20],[33,16],[71,2]];
        for (const [c,r] of stars) screen.putChar(c, r, '.', Color.WHITE, Color.BLACK);
        screen.flush();
      },
      run({ screen }) {
        // Move ship
        screen.putChar(40, 12, '^', Color.BRIGHT_WHITE, Color.BLACK);
        // Asteroid moved
        screen.putChar(20, 8, ' ', Color.WHITE, Color.BLACK);
        screen.putChar(21, 8, '*', Color.YELLOW, Color.BLACK);
        // Bullet appeared
        screen.putChar(40, 10, '|', Color.BRIGHT_WHITE, Color.BLACK);
        // Status row update
        screen.putString(1, 25, 'SCORE: 1234', Color.BLACK, Color.CYAN);
      },
    },
  ];

  let passed = 0, failed = 0;
  let totalIn = 0, totalOut = 0;

  for (const sc of SCENARIOS) {
    const cap = makeEngineCapture();
    if (sc.setup) sc.setup(cap);
    sc.run(cap);
    const ansiBytes = cap.flushAndCapture();

    // Round-trip the ANSI bytes through encoder + decoder.
    // The decoder produces ANSI bytes which must match the input byte-for-byte.
    const enc = new SBANSIEncoder();
    const dec = new SBANSIDecoder();
    const encoded = enc.encode(ansiBytes);
    const decoded = Buffer.from(dec.decode(encoded));

    // Verify byte-for-byte round-trip.
    const ok = ansiBytes.length === decoded.length &&
               ansiBytes.every((b, i) => decoded[i] === b);

    totalIn  += ansiBytes.length;
    totalOut += encoded.length;

    if (ok) {
      const ratio = ansiBytes.length === 0 ? 'N/A' :
                    `${ansiBytes.length} → ${encoded.length} bytes (${
                      ((encoded.length / ansiBytes.length) * 100).toFixed(1)
                    }%)`;
      console.log(`  ✔ ${sc.name.padEnd(45)} ${ratio}`);
      passed++;
    } else {
      console.log(`  ✘ ${sc.name}`);
      console.log(`      input  bytes: ${ansiBytes.toString('binary').replace(/\x1b/g, '\\e').slice(0, 80)}`);
      console.log(`      decoded bytes: ${decoded.toString('binary').replace(/\x1b/g, '\\e').slice(0, 80)}`);
      // Show first byte mismatch
      for (let i = 0; i < Math.max(ansiBytes.length, decoded.length); i++) {
        if (ansiBytes[i] !== decoded[i]) {
          console.log(`      first mismatch at index ${i}: input=0x${(ansiBytes[i]||0).toString(16)} decoded=0x${(decoded[i]||0).toString(16)}`);
          break;
        }
      }
      failed++;
    }
  }

  console.log();
  console.log(`Passed: ${passed}/${SCENARIOS.length}`);
  console.log(`Aggregate: ${totalIn} → ${totalOut} bytes ` +
              `(${((totalOut/totalIn) * 100).toFixed(1)}% of original — ` +
              `${(100 - (totalOut/totalIn) * 100).toFixed(1)}% reduction)`);

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
