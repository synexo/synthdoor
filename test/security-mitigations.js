'use strict';

/**
 * test/security-mitigations.js
 *
 * Functional tests for the three mitigations:
 *   1. Naive-mode username allowlist        → reserved.isValidNaiveUsername
 *   2. Handshake / SB buffer caps           → telnet-filter SB_BUF_MAX,
 *                                              rlogin handshake HANDSHAKE_MAX,
 *                                              readLineEchoed READLINE_MAX
 *   3. Trust-proxy XFF resolution           → remote-ip.resolveClientIp
 *
 * Run with:  node test/security-mitigations.js
 * Exit 0 on success, 1 on first failure.
 */

const assert = require('assert');
const path   = require('path');

const {
  isValidNaiveUsername,
  NAIVE_MAX_USERNAME_LEN,
} = require(path.join(__dirname, '..', 'packages', 'server', 'src', 'reserved.js'));

const {
  TelnetFilterStream,
  readLineEchoed,
  SB_BUF_MAX,
  READLINE_MAX,
} = require(path.join(__dirname, '..', 'packages', 'server', 'src', 'transports', 'telnet-filter.js'));

const {
  parseTrustPolicy,
  resolveClientIp,
  parseCidr,
  ipMatchesCidr,
  normalizeIp,
} = require(path.join(__dirname, '..', 'packages', 'server', 'src', 'transports', 'remote-ip.js'));

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    fail++;
  }
}

// ─── 1. Naive username validation ───────────────────────────────────────────

console.log('[1] Naive-mode username validation');

test('accepts plain alphanumeric', () => {
  assert.strictEqual(isValidNaiveUsername('alice'), true);
  assert.strictEqual(isValidNaiveUsername('Alice123'), true);
  assert.strictEqual(isValidNaiveUsername('a'), true);
  assert.strictEqual(isValidNaiveUsername('1234567890ABC'), true); // exactly 13
});

test('rejects empty string', () => {
  assert.strictEqual(isValidNaiveUsername(''), false);
});

test('rejects oversize input', () => {
  const tooLong = 'a'.repeat(NAIVE_MAX_USERNAME_LEN + 1);
  assert.strictEqual(isValidNaiveUsername(tooLong), false);
});

test('rejects path traversal characters', () => {
  assert.strictEqual(isValidNaiveUsername('../etc'), false);
  assert.strictEqual(isValidNaiveUsername('a/b'), false);
  assert.strictEqual(isValidNaiveUsername('a\\b'), false);
  assert.strictEqual(isValidNaiveUsername('.'), false);
  assert.strictEqual(isValidNaiveUsername('..'), false);
});

test('rejects whitespace and control bytes', () => {
  assert.strictEqual(isValidNaiveUsername(' alice'), false);
  assert.strictEqual(isValidNaiveUsername('alice '), false);
  assert.strictEqual(isValidNaiveUsername('al ice'), false);
  assert.strictEqual(isValidNaiveUsername('alice\x07'), false);  // BEL
  assert.strictEqual(isValidNaiveUsername('alice\x1b[m'), false); // ANSI
  assert.strictEqual(isValidNaiveUsername('alice\n'), false);
  assert.strictEqual(isValidNaiveUsername('alice\t'), false);
});

test('rejects non-string input', () => {
  assert.strictEqual(isValidNaiveUsername(null), false);
  assert.strictEqual(isValidNaiveUsername(undefined), false);
  assert.strictEqual(isValidNaiveUsername(42), false);
  assert.strictEqual(isValidNaiveUsername({}), false);
  assert.strictEqual(isValidNaiveUsername(['a']), false);
});

// ─── 2a. Telnet subnegotiation buffer cap ───────────────────────────────────

console.log('\n[2a] Telnet SB buffer cap');

test('exports a sane SB_BUF_MAX constant', () => {
  assert.strictEqual(typeof SB_BUF_MAX, 'number');
  assert.ok(SB_BUF_MAX >= 1024, `SB_BUF_MAX too small: ${SB_BUF_MAX}`);
  assert.ok(SB_BUF_MAX <= 64 * 1024, `SB_BUF_MAX surprisingly large: ${SB_BUF_MAX}`);
});

test('emits sb-overflow when SB body exceeds cap', (done) => {
  const stream = new TelnetFilterStream(null);

  let overflowed = false;
  stream.on('sb-overflow', ({ limit }) => {
    overflowed = true;
    assert.strictEqual(limit, SB_BUF_MAX);
  });

  // IAC SB <option=42> <SB_BUF_MAX+10 bytes of garbage>... no IAC SE
  const IAC = 255, SB = 250;
  const head = Buffer.from([IAC, SB, 42]);
  const body = Buffer.alloc(SB_BUF_MAX + 10, 0x41); // 'A's
  stream.write(Buffer.concat([head, body]));

  assert.strictEqual(overflowed, true, 'sb-overflow event was not emitted');
});

test('does not overflow on a normal NAWS subnegotiation', () => {
  const stream = new TelnetFilterStream(null);

  let overflowed = false;
  stream.on('sb-overflow', () => { overflowed = true; });

  let nawsCols = -1, nawsRows = -1;
  stream.on('naws', ({ cols, rows }) => { nawsCols = cols; nawsRows = rows; });

  // IAC SB NAWS 0x00 0x50 0x00 0x18 IAC SE  (80 cols × 24 rows)
  const IAC = 255, SB = 250, SE = 240, NAWS = 31;
  stream.write(Buffer.from([IAC, SB, NAWS, 0x00, 0x50, 0x00, 0x18, IAC, SE]));

  assert.strictEqual(overflowed, false);
  assert.strictEqual(nawsCols, 80);
  assert.strictEqual(nawsRows, 24);
});

test('still passes data bytes through after SB termination', () => {
  const stream = new TelnetFilterStream(null);

  let received = Buffer.alloc(0);
  stream.on('data', (chunk) => { received = Buffer.concat([received, chunk]); });

  const IAC = 255, SB = 250, SE = 240, NAWS = 31;
  // NAWS sub then "hi"
  stream.write(Buffer.from([IAC, SB, NAWS, 0, 80, 0, 24, IAC, SE, 0x68, 0x69]));

  // Give the readable side a tick to flush
  return new Promise((res) => setImmediate(() => {
    assert.strictEqual(received.toString('ascii'), 'hi');
    res();
  }));
});

// ─── 2b. readLineEchoed length cap ──────────────────────────────────────────

console.log('\n[2b] readLineEchoed length cap');

test('READLINE_MAX is exported and reasonable', () => {
  assert.strictEqual(typeof READLINE_MAX, 'number');
  assert.ok(READLINE_MAX >= 32, `READLINE_MAX too small: ${READLINE_MAX}`);
  assert.ok(READLINE_MAX <= 4096, `READLINE_MAX surprisingly large: ${READLINE_MAX}`);
});

test('honours the lower of caller maxLen and absolute ceiling', async () => {
  const { EventEmitter } = require('events');
  const stream = new EventEmitter();
  const echoed = [];
  const sock = { write: (s) => echoed.push(s) };

  // maxLen=8 — only 8 chars accepted then a CR triggers resolve
  const p = readLineEchoed(stream, sock, 8);

  // Push 20 'a's then a CR
  stream.emit('data', Buffer.from('a'.repeat(20) + '\r', 'ascii'));

  const result = await p;
  assert.strictEqual(result.length, 8, `expected 8 chars, got ${result.length}`);
  // Each accepted char should also have been echoed
  assert.strictEqual(echoed.filter(s => s === 'a').length, 8);
});

test('caller maxLen above READLINE_MAX is silently clamped', async () => {
  const { EventEmitter } = require('events');
  const stream = new EventEmitter();
  const echoed = [];
  const sock = { write: (s) => echoed.push(s) };

  // Caller asks for 1<<30; we should still cap at READLINE_MAX
  const p = readLineEchoed(stream, sock, 1 << 30);

  // Push READLINE_MAX+50 'a's then CR
  stream.emit('data', Buffer.from('a'.repeat(READLINE_MAX + 50) + '\r', 'ascii'));

  const result = await p;
  assert.strictEqual(result.length, READLINE_MAX);
});

// ─── 3. Trust-proxy XFF resolution ──────────────────────────────────────────

console.log('\n[3] trust_proxy / X-Forwarded-For resolution');

function fakeReq(socketIp, xffHeader) {
  const headers = {};
  if (xffHeader != null) headers['x-forwarded-for'] = xffHeader;
  return { socket: { remoteAddress: socketIp }, headers };
}

test('default policy ignores XFF entirely', () => {
  const policy = parseTrustPolicy('false');
  // Spoofed XFF must not win
  const ip = resolveClientIp(fakeReq('203.0.113.5', '1.2.3.4'), policy);
  assert.strictEqual(ip, '203.0.113.5');
});

test('"loopback" trusts only 127/8 and ::1', () => {
  const policy = parseTrustPolicy('loopback');

  // Trusted upstream → use rightmost untrusted XFF entry
  assert.strictEqual(
    resolveClientIp(fakeReq('127.0.0.1', '198.51.100.7'), policy),
    '198.51.100.7'
  );
  // Untrusted upstream → ignore XFF
  assert.strictEqual(
    resolveClientIp(fakeReq('203.0.113.5', '198.51.100.7'), policy),
    '203.0.113.5'
  );
});

test('"true" is an alias for loopback', () => {
  const policy = parseTrustPolicy('true');
  assert.strictEqual(
    resolveClientIp(fakeReq('127.0.0.1', '198.51.100.7'), policy),
    '198.51.100.7'
  );
});

test('CIDR list trusts matching upstream', () => {
  const policy = parseTrustPolicy('10.0.0.0/8, 192.168.0.0/16');
  assert.strictEqual(
    resolveClientIp(fakeReq('10.20.30.40', '198.51.100.7'), policy),
    '198.51.100.7'
  );
  assert.strictEqual(
    resolveClientIp(fakeReq('192.168.1.1', '198.51.100.7'), policy),
    '198.51.100.7'
  );
  // Outside the trust list — ignore XFF
  assert.strictEqual(
    resolveClientIp(fakeReq('11.0.0.1', '198.51.100.7'), policy),
    '11.0.0.1'
  );
});

test('XFF chain walked right-to-left through trusted hops', () => {
  // Two trusted proxies in a chain, real client at the leftmost untrusted hop.
  const policy = parseTrustPolicy('10.0.0.0/8');
  const ip = resolveClientIp(
    fakeReq('10.0.0.1', 'spoofed-by-attacker, 198.51.100.7, 10.0.0.2'),
    policy
  );
  assert.strictEqual(ip, '198.51.100.7');
});

test('attacker-injected XFF entries cannot impersonate when peer untrusted', () => {
  const policy = parseTrustPolicy('10.0.0.0/8');
  // Attacker connects directly from a public IP and tries to inject XFF.
  // We must use the socket peer, not the spoofed XFF.
  const ip = resolveClientIp(
    fakeReq('203.0.113.99', '127.0.0.1, 8.8.8.8'),
    policy
  );
  assert.strictEqual(ip, '203.0.113.99');
});

test('IPv4-mapped-v6 peer matches v4 CIDR', () => {
  const policy = parseTrustPolicy('10.0.0.0/8');
  const ip = resolveClientIp(
    fakeReq('::ffff:10.0.0.5', '198.51.100.7'),
    policy
  );
  assert.strictEqual(ip, '198.51.100.7');
});

test('IPv6 loopback trusts only ::1, not larger blocks', () => {
  const policy = parseTrustPolicy('loopback');
  assert.strictEqual(
    resolveClientIp(fakeReq('::1', '198.51.100.7'), policy),
    '198.51.100.7'
  );
  assert.strictEqual(
    resolveClientIp(fakeReq('2001:db8::1', '198.51.100.7'), policy),
    '2001:db8::1'
  );
});

test('all-trusted XFF chain falls back to socket peer', () => {
  const policy = parseTrustPolicy('10.0.0.0/8');
  // Every entry in XFF is itself in the trust list — no real client identified
  const ip = resolveClientIp(
    fakeReq('10.0.0.1', '10.0.0.2, 10.0.0.3'),
    policy
  );
  assert.strictEqual(ip, '10.0.0.1');
});

test('garbage trust_proxy values fall back to "trust nothing"', () => {
  const policy = parseTrustPolicy('!!! not an IP !!!');
  assert.strictEqual(policy.trust, 'none');
  assert.strictEqual(
    resolveClientIp(fakeReq('127.0.0.1', '8.8.8.8'), policy),
    '127.0.0.1'
  );
});

test('parseCidr / ipMatchesCidr basic correctness', () => {
  const c = parseCidr('192.168.1.0/24');
  assert.ok(c);
  assert.strictEqual(ipMatchesCidr('192.168.1.5', c), true);
  assert.strictEqual(ipMatchesCidr('192.168.2.5', c), false);
  assert.strictEqual(ipMatchesCidr('::1', c), false);

  const c6 = parseCidr('2001:db8::/32');
  assert.ok(c6);
  assert.strictEqual(ipMatchesCidr('2001:db8:abcd::1', c6), true);
  assert.strictEqual(ipMatchesCidr('2001:db9::1', c6), false);
});

test('normalizeIp strips IPv4-mapped prefix', () => {
  assert.strictEqual(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.strictEqual(normalizeIp('1.2.3.4'), '1.2.3.4');
  assert.strictEqual(normalizeIp('::1'), '::1');
});

// ─── Summary ────────────────────────────────────────────────────────────────

(async () => {
  // Wait for any test that returned a promise to settle
  await new Promise((r) => setImmediate(r));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
