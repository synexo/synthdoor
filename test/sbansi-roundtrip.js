/**
 * SBANSI byte-for-byte round-trip test.
 *
 * For every test case, asserts:
 *     decode(encode(input)) === input
 * as raw bytes. No Terminal state involved — purely the wire-format contract.
 *
 * Reports compression ratios: how much smaller the encoded form is.
 */
'use strict';

const path = require('path');
const { SBANSIEncoder } = require(path.join(__dirname,
  '../packages/server/src/transports/sbansi-encoder'));

async function loadDecoder() {
  const m = await import('file://' + path.join(__dirname,
    '../packages/server/src/web/public/sbansi-decoder.js'));
  return m;
}

function makeBytes(...parts) {
  const bufs = parts.map(p => {
    if (typeof p === 'string')   return Buffer.from(p, 'binary');
    if (typeof p === 'number')   return Buffer.from([p]);
    if (Buffer.isBuffer(p))      return p;
    if (Array.isArray(p))        return Buffer.from(p);
    throw new Error('unknown part type');
  });
  return Buffer.concat(bufs);
}

function buffersEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hexdump(buf, max = 64) {
  const sliced = buf.slice(0, max);
  return Array.from(sliced).map(b => b.toString(16).padStart(2, '0')).join(' ') +
         (buf.length > max ? ' …' : '');
}

async function main() {
  const { SBANSIDecoder } = await loadDecoder();

  const TESTS = [
    { name: 'plain ASCII',
      input: makeBytes('Hello, world!') },
    { name: 'CP437 high bytes',
      input: makeBytes([0xC9, 0xCD, 0xCD, 0xBB, 0x0D, 0x0A, 0xBA, 0x20, 0x20, 0x20, 0xBA]) },
    { name: 'cursor positioning',
      input: makeBytes('\x1b[5;10HHello\x1b[1;1HHi') },
    { name: 'short cursor home',
      input: makeBytes('\x1b[H', 'TopLeft') },
    { name: 'erase line',
      input: makeBytes('\x1b[5;1H', 'XX', '\x1b[K') },
    { name: 'erase display end',
      input: makeBytes('AAA\x1b[J', 'BBB') },
    { name: 'erase display all',
      input: makeBytes('AAA\x1b[2J', 'BBB') },
    { name: 'simple SGR fg only',
      input: makeBytes('\x1b[33mYellow\x1b[36mCyan') },
    { name: 'simple SGR bg only',
      input: makeBytes('\x1b[44mBlueBg') },
    { name: 'compound SGR fg+bg',
      input: makeBytes('\x1b[33;44mFgBg') },
    { name: 'compound SGR bold + fg + bg',
      input: makeBytes('\x1b[1;33;44mBoldFgBg') },
    { name: 'reset + colour (engine pattern)',
      input: makeBytes('\x1b[0;1;33;44mABC') },
    { name: 'reset alone',
      input: makeBytes('\x1b[1;33mBold', '\x1b[0m', 'Plain') },
    { name: 'bold-only (rare)',
      input: makeBytes('\x1b[1mB') },
    { name: 'reset + bold + fg',
      input: makeBytes('\x1b[0;1;33mABC') },
    { name: 'reset + fg',
      input: makeBytes('\x1b[0;33mABC') },
    { name: 'bold + fg',
      input: makeBytes('\x1b[1;33mABC') },
    { name: 'cursor save/restore',
      input: makeBytes('A\x1b[sB\x1b[uC') },
    { name: 'cursor hide/show',
      input: makeBytes('\x1b[?25lhidden\x1b[?25hshown') },
    { name: 'BS, TAB, CR, LF passthrough',
      input: makeBytes('Hello\x08World\tTab\rCR\nLF') },
    { name: 'BEL passthrough',
      input: makeBytes('Alert\x07Done') },
    { name: 'CP437 right-arrow (0x1A) as content',
      input: makeBytes('F', 0x1A, 'PA') },
    { name: 'CP437 low-range glyphs (0x01..0x06) as content',
      input: makeBytes(0x01, 0x02, 0x03, 0x04, 0x05, 0x06) },
    { name: 'CP437 mid-range glyphs (0x0E..0x16) as content',
      input: makeBytes(0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16) },
    { name: 'CP437 reserved-range glyphs (0x17..0x1A) as content',
      input: makeBytes(0x17, 0x18, 0x19, 0x1A) },
    { name: 'CP437 reserved-range glyphs (0x1C..0x1F) as content',
      input: makeBytes(0x1C, 0x1D, 0x1E, 0x1F) },
    { name: 'NUL byte as content',
      input: makeBytes('A', 0x00, 'B') },
    { name: 'unrecognised CSI passthrough (cursor up)',
      input: makeBytes('A\x1b[3AB') },
    { name: 'unrecognised SGR passthrough (256-color)',
      input: makeBytes('\x1b[38;5;200mX') },
    { name: 'unrecognised SGR passthrough (blink, reverse)',
      input: makeBytes('\x1b[5mblink\x1b[25m\x1b[7mrev\x1b[27m') },
    { name: 'malformed CSI',
      input: makeBytes('\x1b[ZZZ') },
    { name: 'realistic Meteoroid-like frame',
      input: makeBytes(
        '\x1b[1;1H\x1b[0m',
        '\x1b[1;33m', 'A',
        '\x1b[5;20H', '\x1b[36m', 'B',
        '\x1b[10;40H', '\x1b[1;31m', 'C',
        '\x1b[24;1H', '\x1b[K',
        '\x1b[1;1H\x1b[0m',
      ) },
    { name: 'realistic full row repaint with attribute changes',
      input: makeBytes(
        '\x1b[5;1H',
        '\x1b[33;44m', '111',
        '\x1b[31;42m', '222',
        '\x1b[36;40m', '333',
      ) },
    { name: 'empty input',
      input: Buffer.alloc(0) },
    { name: 'streaming (encode byte-by-byte)',
      input: makeBytes('\x1b[1;33;44mHi'),
      streamingEncode: true },
    { name: 'streaming (decode byte-by-byte)',
      input: makeBytes('\x1b[1;33;44mHi'),
      streamingDecode: true },
    { name: 'ANSI music passthrough',
      input: makeBytes('\x1b[M', 'L8c d e f', 0x0E, 'after') },
    { name: 'ESC c (RIS) passthrough',
      input: makeBytes('AAA\x1bcBBB') },
    { name: 'ESC M (RI — not music!) passthrough',
      input: makeBytes('AAA\x1bMBBB') },
    { name: 'ESC 7 (DECSC) passthrough',
      input: makeBytes('A\x1b7BC') },
    { name: 'ESC 8 (DECRC) passthrough',
      input: makeBytes('A\x1b8BC') },
    { name: 'all 256 byte values (smoke test)',
      input: Buffer.from(Array.from({length: 256}, (_, i) => i)) },
  ];

  let passed = 0, failed = 0;
  let totalIn = 0, totalOut = 0;

  for (const tc of TESTS) {
    const enc = new SBANSIEncoder();
    let encoded;
    if (tc.streamingEncode) {
      const parts = [];
      for (let i = 0; i < tc.input.length; i++) {
        parts.push(enc.encode(Buffer.from([tc.input[i]])));
      }
      encoded = Buffer.concat(parts);
    } else {
      encoded = enc.encode(tc.input);
    }

    const dec = new SBANSIDecoder();
    let decoded;
    if (tc.streamingDecode) {
      const parts = [];
      for (let i = 0; i < encoded.length; i++) {
        parts.push(dec.decode(new Uint8Array([encoded[i]])));
      }
      // Concatenate Uint8Arrays
      const totalLen = parts.reduce((s, p) => s + p.length, 0);
      decoded = Buffer.alloc(totalLen);
      let off = 0;
      for (const p of parts) { decoded.set(p, off); off += p.length; }
    } else {
      decoded = Buffer.from(dec.decode(encoded));
    }

    const ok = buffersEqual(tc.input, decoded);
    totalIn  += tc.input.length;
    totalOut += encoded.length;

    if (ok) {
      const ratio = tc.input.length === 0 ? 'N/A' :
                    `${tc.input.length} → ${encoded.length} (${
                      ((encoded.length / tc.input.length) * 100).toFixed(1)
                    }%)`;
      console.log(`  ✔ ${tc.name.padEnd(55)} ${ratio}`);
      passed++;
    } else {
      console.log(`  ✘ ${tc.name}`);
      console.log(`      input:   ${hexdump(tc.input)}`);
      console.log(`      encoded: ${hexdump(encoded)}`);
      console.log(`      decoded: ${hexdump(decoded)}`);
      failed++;
    }
  }

  console.log();
  console.log(`Passed: ${passed}/${TESTS.length}`);
  console.log(`Total bytes: ${totalIn} input → ${totalOut} encoded ` +
              `(${((totalOut/totalIn) * 100).toFixed(1)}% of original — ` +
              `${(100 - (totalOut/totalIn) * 100).toFixed(1)}% reduction)`);

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
