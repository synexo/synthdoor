'use strict';

/**
 * packages/server/src/index.js
 * SynthDoor main server entry point.
 */

// Load .env from the project root (synthdoor/) before anything else.
// This makes PEPPER and SYNTH_SALT available via process.env in authenticated mode.
// dotenv is a no-op if the file doesn't exist, so naive mode is unaffected.
const path = require('path');
const dotenvPath = path.resolve(__dirname, '..', '..', '..', '.env');
try {
  require('dotenv').config({ path: dotenvPath });
} catch (_) {
  // dotenv not installed — env vars must be set in the shell environment directly
}

process.on('uncaughtException', (err) => {
  console.error('[Server] UNCAUGHT EXCEPTION:');
  console.error(err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] UNHANDLED REJECTION:', reason?.stack || reason);
});

const fs                  = require('fs');
const Config              = require('./config');
const { DB }              = require(path.join(__dirname, '..', '..', 'engine', 'src', 'index.js'));
const TelnetTransport     = require('./transports/telnet');
const RloginTransport     = require('./transports/rlogin');
const WebSocketTransport  = require('./transports/websocket');
const GameRouter          = require('./game-router');
const { initAuth }        = require('./auth-flow');
const Scheduler           = require('./scheduler');
const { createLogger }    = require('./logger');
const SessionRegistry     = require('./session-registry');

async function main() {
  const confPath = process.env.SYNTHDOOR_CONF
    || path.resolve(__dirname, '../../../config/synthdoor.conf');

  const config = new Config(confPath);
  config.load();

  // ─── Scheduler ────────────────────────────────────────────────────────────
  const scheduler = new Scheduler();
  scheduler.start();

  // ─── Logger ───────────────────────────────────────────────────────────────
  const projectRoot  = path.resolve(__dirname, '../../..');
  const logsDir      = path.resolve(projectRoot, config.get('logs_dir', './logs'));
  const logKeepDays  = config.getInt('log_keep_days', 7);
  const logPruneTime = config.get('log_prune_time', '02:00');

  const logger = createLogger({ logsDir, keepDays: logKeepDays, pruneTime: logPruneTime, scheduler });

  logger.info('===========================================');
  logger.info('  SynthDoor BBS Door Game Engine v1.0.0  ');
  logger.info('===========================================');

  // ─── Auth mode ────────────────────────────────────────────────────────────
  const authMode        = config.get('auth_mode', 'naive').toLowerCase().trim();
  const isAuthenticated = authMode === 'authenticated';
  logger.info(`[Auth] Mode: ${authMode}`);

  if (isAuthenticated) {
    const pepper    = process.env.PEPPER;
    const synthSalt = process.env.SYNTH_SALT;

    if (!pepper || !synthSalt) {
      logger.error('[Auth] ERROR: PEPPER and SYNTH_SALT environment variables must be set in authenticated mode.');
      logger.error(`[Auth] Looked for .env at: ${dotenvPath}`);
      logger.error('[Auth] Copy .env.example to .env and populate the values, then restart.');
      process.exit(1);
    }

    let synthSaltBuf;
    try {
      synthSaltBuf = Buffer.from(synthSalt, 'hex');
      if (synthSaltBuf.length < 16) throw new Error('too short');
    } catch (e) {
      logger.error('[Auth] ERROR: SYNTH_SALT must be a hex-encoded string of at least 16 bytes (32 hex chars).');
      process.exit(1);
    }

    const authDbPath   = config.get('auth_db_path', './data/synth-auth.db');
    const wordlistPath = path.resolve(
      __dirname, '..', '..', 'synth-auth', 'src', 'eff_large_wordlist.txt'
    );

    initAuth({
      pepper,
      synthSalt:    synthSaltBuf,
      dbPath:       authDbPath,
      wordlistPath,
    });

    logger.info(`[Auth] SynthAuth initialised. DB: ${authDbPath}`);
  }

  // ─── Main DB ──────────────────────────────────────────────────────────────
  const dbPath = config.get('db_path', './data/synthdoor.db');
  const db = new DB(dbPath);
  db.init();
  logger.info(`[DB] Database: ${dbPath}`);

  const gamesDir = config.get('games_dir', path.resolve(__dirname, '../../../games'));
  const menusDir = config.get('menus_dir', path.resolve(__dirname, '../../../config/menus'));

  // ─── Session Registry ─────────────────────────────────────────────────────
  const registry = new SessionRegistry();

  const router = new GameRouter(config, db, gamesDir, menusDir, logger, authMode, registry);
  router.discover();

  const transports = [];

  // ─── Telnet ───────────────────────────────────────────────────────────────
  if (config.getBool('telnet_enabled', true)) {
    const telnet = new TelnetTransport(config, db, router, authMode, registry);
    const port   = config.getInt('telnet_port', 2323);
    telnet.listen(port);
    transports.push(telnet);
    logger.info(`[Telnet] Listening on port ${port} (${authMode} mode)`);
  }

  // ─── rlogin ───────────────────────────────────────────────────────────────
  if (config.getBool('rlogin_enabled', false)) {
    const rlogin = new RloginTransport(config, db, router, authMode, registry);
    const port   = config.getInt('rlogin_port', 513);
    rlogin.listen(port);
    transports.push(rlogin);
    logger.info(`[rlogin] Listening on port ${port} (${authMode} mode)`);
  }

  // ─── WebSocket  ───────────────────────────────────────────────────────────
  if (config.getBool('web_enabled', true)) {
    const ws   = new WebSocketTransport(config, db, router, authMode, registry);
    const port = config.getInt('web_port', 8080);
    ws.listen(port);
    transports.push(ws);
    logger.info(`[WebSocket] UI + direct engine on port ${port} (${authMode} mode)`);
  }

  logger.info('[Server] All transports active. Ctrl+C to stop.');
  process.on('SIGINT',  () => shutdown(transports, db, scheduler, logger));
  process.on('SIGTERM', () => shutdown(transports, db, scheduler, logger));
}

function shutdown(transports, db, scheduler, logger) {
  (logger || console).info('\n[Server] Shutting down…');
  for (const t of transports) { try { t.close(); } catch (_) {} }
  if (scheduler) scheduler.stop();
  db.close();
  if (logger) logger.close();
  process.exit(0);
}

main().catch(err => {
  console.error('[Server] Fatal startup error:', err.stack || err.message);
  process.exit(1);
});
