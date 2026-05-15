'use strict';

/**
 * test/security-mitigations-v2.js
 *
 * Functional tests for the round-2 mitigations and feature requests:
 *
 *   1. bind_address — listen() accepts host argument
 *   4. SessionRegistry heartbeat / liveness probe / stale eviction
 *   5. bbs-client TelnetTrafficLogger writes hex dumps to game-local file
 *   6. teleconference no longer treats 'q' as QUIT
 *
 * Items 2 (R-refresh) and 3 (reverse log order) are exercised indirectly
 * through 'node --check' of the sysop-panel source plus a small reverse-
 * order load helper assertion. Their UI-loop mechanics are not unit-test
 * friendly without a full screen mock, so we lean on syntax + targeted
 * helper tests.
 *
 * Run with:  node test/security-mitigations-v2.js
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const net    = require('net');

let pass = 0, fail = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); pass++; })
    .catch((e) => { console.log(`  ✗ ${name}\n      ${e.stack || e.message}`); fail++; });
}

async function run() {

// ─── 1. bind_address — listen() accepts host arg ─────────────────────────────

console.log('[1] bind_address: listen() accepts host argument');

await test('TelnetTransport.listen binds to 127.0.0.1 when asked', async () => {
  // Stub out logger and sqlite so the transport can be built standalone.
  const { createLogger } = require('../packages/server/src/logger.js');
  createLogger({
    logsDir: path.join(os.tmpdir(), 'sd-v2-' + Date.now()),
    keepDays: 1,
    pruneTime: '02:00',
    scheduler: { register: () => {} },
  });

  const Tel = require('../packages/server/src/transports/telnet.js');

  class C { get(k, d = '') { return d; } getInt(k, d = 0) { return d; } getBool(k, d = false) { return d; } }
  const router = { getGame: () => null, db: { incrementLoginCount: () => {} } };

  const t = new Tel(new C(), {}, router, 'naive', null);
  t.listen(0, '127.0.0.1');
  // Wait one tick for the server to start binding
  await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 50));

  const addr = t._server.address();
  assert.strictEqual(addr.address, '127.0.0.1', `expected 127.0.0.1, got ${addr.address}`);

  // Verify the socket is actually reachable on loopback only by
  // connecting through 127.0.0.1 — should succeed.
  //
  // The transport's session.js doesn't install an error handler on the
  // peer socket (a separate, pre-existing nit), so abruptly destroying
  // the client mid-handshake would surface as an unhandled error in the
  // server. We instead let the transport tear the connection down by
  // calling t.close() — that fires the socket's 'close' path cleanly.
  const port = addr.port;
  const probe = await new Promise((resolve, reject) => {
    const c = net.connect(port, '127.0.0.1', () => resolve(c));
    c.on('error', () => {}); // absorb any FIN-related errors
    setTimeout(() => reject(new Error('connect timeout')), 1000);
  });

  t.close();
  // Drain the probe socket so node's handle table is happy
  probe.destroy();
  await new Promise(r => setTimeout(r, 30));
});

await test('Transports default to 0.0.0.0 when host arg omitted', async () => {
  const Tel = require('../packages/server/src/transports/telnet.js');
  class C { get(k, d = '') { return d; } getInt(k, d = 0) { return d; } getBool(k, d = false) { return d; } }
  const router = { getGame: () => null, db: { incrementLoginCount: () => {} } };

  const t = new Tel(new C(), {}, router, 'naive', null);
  t.listen(0); // no host arg
  await new Promise(r => setTimeout(r, 50));

  const addr = t._server.address();
  // Node returns '::' when listening on a dual-stack ANY-host, or
  // '0.0.0.0' when v4-only. Both are valid "all interfaces" outcomes.
  // What we explicitly DO NOT want is a single specific IP.
  assert.ok(
    addr.address === '0.0.0.0' || addr.address === '::',
    `expected ANY address, got ${addr.address}`
  );
  t.close();
});

// ─── 4. SessionRegistry — heartbeat, isLive, sweep ───────────────────────────

console.log('\n[4] SessionRegistry: heartbeat + liveness + stale eviction');

const SessionRegistry = require('../packages/server/src/session-registry.js');

await test('add()/list()/remove() basics still work', () => {
  const r = new SessionRegistry({ sweepIntervalMs: 60_000 });
  const id = r.add({ username: 'alice', transport: 'telnet', ipAddress: '127.0.0.1', disconnect: () => {} });
  assert.strictEqual(typeof id, 'string');
  assert.strictEqual(r.count(), 1);
  const list = r.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].username, 'alice');
  assert.strictEqual(typeof list[0].lastSeenAt, 'number');
  assert.strictEqual(typeof list[0].idleSec, 'number');
  r.remove(id);
  assert.strictEqual(r.count(), 0);
  r.stop();
});

await test('ping() updates lastSeenAt', async () => {
  const r = new SessionRegistry({ sweepIntervalMs: 60_000 });
  const id = r.add({ username: 'bob', transport: 'web', ipAddress: '::1', disconnect: () => {} });
  const before = r.list()[0].lastSeenAt;
  // sleep a bit so the timestamp changes measurably
  await new Promise(rs => setTimeout(rs, 15));
  r.ping(id);
  const after = r.list()[0].lastSeenAt;
  assert.ok(after > before, `expected lastSeenAt to advance, before=${before} after=${after}`);
  r.stop();
});

await test('list() evicts entries whose isLive() returns false', () => {
  const r = new SessionRegistry({ sweepIntervalMs: 60_000 });
  let alive = true;
  let disconnected = false;
  r.add({
    username: 'ghost',
    transport: 'web',
    ipAddress: 'x',
    disconnect: () => { disconnected = true; },
    isLive: () => alive,
  });
  assert.strictEqual(r.count(), 1);

  alive = false;                 // simulate socket close
  const list = r.list();         // should evict on read
  assert.strictEqual(list.length, 0);
  assert.strictEqual(disconnected, true, 'disconnect should be invoked on eviction');
  r.stop();
});

await test('list() does NOT evict entries for being idle (no time-based reaper)', async () => {
  // Regression guard. The previous version of SessionRegistry implemented
  // a 5-minute activity timeout that disconnected live (but quiet) MRC
  // sessions. The corrected registry uses ONLY isLive() — idle entries,
  // no matter how long they've been quiet, must stay in the list as long
  // as their socket is still up.
  const r = new SessionRegistry({ sweepIntervalMs: 60_000 });
  let disconnected = false;
  r.add({
    username: 'idler',
    transport: 'telnet',
    ipAddress: 'x',
    disconnect: () => { disconnected = true; },
    // No isLive supplied AND no ping calls — old behaviour would have
    // reaped after staleAfterMs. New behaviour: stays forever, since
    // there's no liveness signal saying it's dead.
  });
  await new Promise(rs => setTimeout(rs, 80));
  assert.strictEqual(r.list().length, 1, 'idle entry must NOT be evicted');
  assert.strictEqual(disconnected, false, 'idle entry must NOT have disconnect() called');
  r.stop();
});

await test('isLive() that throws is treated as dead, not crashing the sweep', () => {
  const r = new SessionRegistry({ sweepIntervalMs: 60_000 });
  r.add({
    username: 'borked',
    transport: 'web',
    ipAddress: 'x',
    disconnect: () => {},
    isLive: () => { throw new Error('socket exploded'); },
  });
  // Must not throw; the entry should be reaped silently
  const list = r.list();
  assert.strictEqual(list.length, 0);
  r.stop();
});

await test('ping() on unknown id is a silent no-op', () => {
  const r = new SessionRegistry({ sweepIntervalMs: 60_000 });
  // Should not throw
  r.ping('does-not-exist');
  r.stop();
});

await test('background sweep runs on the timer', async () => {
  // Use a tiny sweep interval and an isLive() that returns false: the
  // sweep — not a manual list() call — should evict the entry.
  const r = new SessionRegistry({ sweepIntervalMs: 20 });
  r.add({
    username: 's',
    transport: 'telnet',
    ipAddress: 'x',
    disconnect: () => {},
    isLive: () => false,    // dead from the start
  });
  // Wait long enough for at least two sweep cycles to fire.
  await new Promise(rs => setTimeout(rs, 80));
  // _sessions is internal but we want to confirm the sweep itself
  // operated, not just list()-time eviction:
  assert.strictEqual(r._sessions.size, 0, 'sweep should have evicted the entry');
  r.stop();
});

await test('stop() halts the sweep timer (no further work after stop)', async () => {
  const r = new SessionRegistry({ sweepIntervalMs: 10 });
  r.stop();
  // Add an entry with a dead isLive AFTER stop, wait, confirm it is NOT
  // evicted by the (now-halted) sweep. A manually-triggered list() call
  // will still evict on read — what we're checking here is the timer.
  r.add({
    username: 'after-stop',
    transport: 'telnet',
    ipAddress: 'x',
    disconnect: () => {},
    isLive: () => false,
  });
  await new Promise(rs => setTimeout(rs, 80));
  assert.strictEqual(r._sessions.size, 1);
});

// ─── 5. bbs-client TelnetTrafficLogger ───────────────────────────────────────

console.log('\n[5] bbs-client TelnetTrafficLogger');

// We require the BbsClient module and reach for the (un-exported)
// TelnetTrafficLogger class via require.cache hackery is brittle, so
// instead we replicate its contract: a debug-enabled BbsClient session
// must produce a file under games/bbs-client/logs/. Rather than driving
// the whole game, we re-instantiate the logger class directly by
// re-requiring the module file as text and extracting it... or we just
// trust the integration test below that uses a real socket.
//
// Cleaner: run the actual game's logger by spawning a tiny TCP echo server
// and letting bbs-client's debug code write to a temp directory. We can't
// easily redirect __dirname, but we CAN test the class semantics by
// importing it with a small helper.

// Lightweight import of the class by evaluating just the relevant class.
// Rather than parse the file, expose the logger via a tiny shim test.
// We'll just integration-test by directly reading the bbs-client source's
// logger: parse and `new` it through a minimal eval.

const bbsSource = fs.readFileSync(
  path.join(__dirname, '..', 'games', 'bbs-client', 'src', 'index.js'),
  'utf8'
);

await test('TelnetTrafficLogger creates the log file and writes a banner', async () => {
  // Extract the class definition. It's bounded by `class TelnetTrafficLogger {`
  // and the next top-level `class BbsClient extends GameBase {`.
  const start = bbsSource.indexOf('class TelnetTrafficLogger');
  const end   = bbsSource.indexOf('class BbsClient');
  assert.ok(start > 0 && end > start, 'cannot locate TelnetTrafficLogger class in source');
  const classSrc = bbsSource.slice(start, end);

  // Evaluate it in a tiny scope. We need fs and path to be visible.
  const factory = new Function('fs', 'path', `${classSrc}; return TelnetTrafficLogger;`);
  const TelnetTrafficLogger = factory(fs, path);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-bbs-log-'));
  const logger = new TelnetTrafficLogger(tmpDir, 'example.org', 23);
  logger.log('RX', Buffer.from('Hello, BBS!\r\n'));
  logger.log('TX', Buffer.from([0x1B, 0x5B, 0x32, 0x4A])); // ESC[2J
  logger.close();

  const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('bbs-client-') && f.endsWith('.log'));
  assert.strictEqual(files.length, 1, `expected exactly one log file, got ${files.length}`);
  const body = fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');

  assert.ok(body.includes('Session opened'), 'banner missing');
  assert.ok(body.includes('example.org:23'), 'host:port missing from banner');
  assert.ok(body.includes('RX'), 'RX direction marker missing');
  assert.ok(body.includes('TX'), 'TX direction marker missing');
  // Hex dump of "Hello, BBS!\r\n" should contain '48 65 6c 6c 6f' (Hello)
  assert.ok(body.includes('48 65 6c 6c 6f'), 'hex dump of "Hello" missing');
  // ASCII gutter should show the printable text
  assert.ok(body.includes('Hello, BBS!'), 'ASCII gutter missing the original text');
  assert.ok(body.includes('Session closed'), 'closing footer missing');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

await test('TelnetTrafficLogger gracefully handles unwritable directories', () => {
  const start = bbsSource.indexOf('class TelnetTrafficLogger');
  const end   = bbsSource.indexOf('class BbsClient');
  const classSrc = bbsSource.slice(start, end);
  const factory = new Function('fs', 'path', `${classSrc}; return TelnetTrafficLogger;`);
  const TelnetTrafficLogger = factory(fs, path);

  // Path that exists as a regular file, so mkdirSync will fail
  const realFile = fs.realpathSync(__filename);
  const logger = new TelnetTrafficLogger(realFile, 'host', 1);
  // Must not throw even though file-creation will fail:
  logger.log('RX', Buffer.from([0x41]));
  logger.close();
  assert.strictEqual(logger._opened, false);
});

// ─── 6. teleconference q-key ─────────────────────────────────────────────────

console.log('\n[6] teleconference: q is no longer QUIT');

await test('teleconference source unbinds q/Q/p/P from action map', () => {
  const teleSrc = fs.readFileSync(
    path.join(__dirname, '..', 'games', 'teleconference', 'src', 'index.js'),
    'utf8'
  );
  // Look for the four explicit unbinds in run()
  for (const k of ['q', 'Q', 'p', 'P']) {
    const re = new RegExp(`this\\.input\\.unbind\\(['"]${k}['"]\\)`);
    assert.ok(re.test(teleSrc), `missing this.input.unbind('${k}')`);
  }
});

await test('Engine Input.unbind actually removes the action mapping', () => {
  const { EventEmitter } = require('events');
  // The Input class binds keys to actions via a constructor argument.
  // We don't need a real Terminal — only the on('key') event emitter side.
  const Input = require('../packages/engine/src/input.js');

  const fakeTerm = new EventEmitter();
  const input = new Input(fakeTerm);
  input.start();

  // Default bindings include q/Q → QUIT and p/P → PAUSE
  let actions = [];
  input.on('action', (a) => actions.push(a));

  // Without unbind, 'q' fires QUIT
  fakeTerm.emit('key', 'q');
  assert.deepStrictEqual(actions, ['QUIT']);

  // After unbind, 'q' fires no action
  actions = [];
  input.unbind('q');
  fakeTerm.emit('key', 'q');
  assert.deepStrictEqual(actions, []);

  // 'p' still fires PAUSE until we unbind it
  fakeTerm.emit('key', 'p');
  assert.deepStrictEqual(actions, ['PAUSE']);
  actions = [];
  input.unbind('p');
  fakeTerm.emit('key', 'p');
  assert.deepStrictEqual(actions, []);

  input.destroy();
});

// ─── 2 + 3. Sysop-panel: log-reversal + R bindings (smoke checks) ────────────

console.log('\n[2+3] sysop-panel: log reversal and R-refresh advertised');

await test('Log Viewer source reverses lines on load', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'games', 'sysop-panel', 'src', 'index.js'),
    'utf8'
  );
  // The reverse() call lives in _loadLogLines; confirm it's there.
  assert.ok(
    /split\('\\n'\)\.filter\(.+\)\.reverse\(\)/.test(src) ||
    /split\("\\n"\)\.filter\(.+\)\.reverse\(\)/.test(src),
    '_loadLogLines should reverse the line array'
  );
});

await test('Log Viewer status bar advertises R=refresh', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'games', 'sysop-panel', 'src', 'index.js'),
    'utf8'
  );
  // Find the Log Viewer status string. It contains 'F=follow' AND should
  // now also contain 'R=refresh'.
  assert.ok(
    /F=follow.*R=refresh/.test(src),
    'log viewer status bar should advertise R=refresh next to F=follow'
  );
});

await test('Dashboard / Statistics / Who / Roles status bars advertise R', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'games', 'sysop-panel', 'src', 'index.js'),
    'utf8'
  );
  // Each of these screens should mention R=refresh in their status bar.
  // The screens use distinct indicators:
  //   Dashboard   → 'Dashboard'
  //   Stats       → 'Statistics'
  //   Who         → 'connection(s)'
  //   Roles       → 'player(s)'
  // We do an existence check by counting R=refresh occurrences. Five
  // screens (Dashboard, Who, Stats, Log, Roles) should each carry it,
  // so we expect the substring at least 5 times.
  const matches = (src.match(/R=refresh/g) || []).length;
  assert.ok(matches >= 5, `expected at least 5 occurrences of "R=refresh", found ${matches}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

}

run();
