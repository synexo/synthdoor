'use strict';

/**
 * packages/server/src/transports/remote-ip.js
 *
 * Resolve the real client IP for an HTTP request, with safe defaults.
 *
 * The default is to use req.socket.remoteAddress and ignore any X-Forwarded-*
 * or Forwarded headers. Trusting those headers without explicit configuration
 * is a well-known anti-pattern: any client can supply them, and on a
 * direct-internet-facing server that lets attackers spoof the IP that
 * downstream rate limiters and audit logs see.
 *
 * If the operator wants to deploy behind a reverse proxy (nginx, Caddy,
 * Cloudflare, an HAProxy box, etc.) they must opt in via:
 *
 *   trust_proxy = false              # default — always use socket peer
 *   trust_proxy = true               # trust ANY upstream's XFF (loopback only)
 *   trust_proxy = loopback           # alias for the line above
 *   trust_proxy = 10.0.0.0/8, 192.168.0.0/16, 127.0.0.1
 *                                    # explicit CIDR / IP allowlist
 *
 * Only when the immediate peer (req.socket.remoteAddress) matches one of
 * the trusted entries do we honor the rightmost untrusted IP from the
 * X-Forwarded-For chain. Any other configuration falls back to the socket
 * peer, with a warning logged.
 *
 * "loopback" expands to: 127.0.0.0/8 and ::1.
 *
 * Why rightmost-untrusted, not leftmost: leftmost is whatever the original
 * client wrote in the header, which it controls. The rightmost entries are
 * appended by trusted proxies. We walk right-to-left, popping any entries
 * inside the trust list, and the first one that is *not* in the trust list
 * is the real edge client.
 *
 *   XFF: <attacker-spoofed>, <real-client>, <proxy-A>, <proxy-B>
 *                                            ^^^ trusted     ^^^ trusted
 *                            ^^^^^^^^^^^^^^ first untrusted = real client
 */

const net = require('net');

/**
 * @typedef {{ trust: 'none' | 'all' | 'list', cidrs: Array<{kind:'v4'|'v6', addr: bigint, mask: bigint, prefix: number}> }} TrustPolicy
 */

const LOOPBACK_TOKENS = new Set(['loopback', 'true', 'yes', '1']);
const NONE_TOKENS     = new Set(['', 'false', 'no', '0', 'off']);

/**
 * Parse the trust_proxy configuration value into a TrustPolicy.
 *
 * @param {string|null} raw  config value (already lower-cased to spaces only)
 * @returns {TrustPolicy}
 */
function parseTrustPolicy(raw) {
  const v = (raw == null ? '' : String(raw)).trim().toLowerCase();

  if (NONE_TOKENS.has(v)) {
    return { trust: 'none', cidrs: [] };
  }

  // "true" / "loopback" → loopback v4 + v6
  if (LOOPBACK_TOKENS.has(v)) {
    return { trust: 'list', cidrs: [
      parseCidr('127.0.0.0/8'),
      parseCidr('::1/128'),
    ].filter(Boolean) };
  }

  // Comma-separated list. We accept individual IPs and CIDR blocks.
  const cidrs = [];
  for (const piece of v.split(',')) {
    const tok = piece.trim();
    if (!tok) continue;
    const c = parseCidr(tok);
    if (c) cidrs.push(c);
  }
  if (cidrs.length === 0) {
    // Unparseable — be safe and trust nothing.
    return { trust: 'none', cidrs: [] };
  }
  return { trust: 'list', cidrs };
}

/**
 * Strip the IPv4-mapped-IPv6 prefix ("::ffff:1.2.3.4" → "1.2.3.4") so v4
 * peers behind a dual-stack listener compare correctly against v4 CIDRs.
 *
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice(7);
    if (net.isIPv4(tail)) return tail;
  }
  return ip;
}

/**
 * Convert an IPv4 string to a BigInt in network order, or null on failure.
 * @param {string} ip
 * @returns {bigint|null}
 */
function v4ToBigInt(ip) {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split('.').map(p => Number(p));
  if (parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return (BigInt(parts[0]) << 24n) | (BigInt(parts[1]) << 16n) | (BigInt(parts[2]) << 8n) | BigInt(parts[3]);
}

/**
 * Convert an IPv6 string to a 128-bit BigInt, or null on failure.
 * Handles "::" elision but not zone IDs (we strip them defensively).
 *
 * @param {string} ip
 * @returns {bigint|null}
 */
function v6ToBigInt(ip) {
  const stripped = ip.split('%')[0];      // drop %eth0 zone IDs if present
  if (!net.isIPv6(stripped)) return null;

  // Expand IPv4-suffix forms (rare in this code path because we already
  // normalize IPv4-mapped, but cheap and safe to handle).
  let work = stripped;
  if (work.includes('.')) {
    const lastColon = work.lastIndexOf(':');
    const v4Part    = work.slice(lastColon + 1);
    const v4Big     = v4ToBigInt(v4Part);
    if (v4Big === null) return null;
    const high16 = Number((v4Big >> 16n) & 0xFFFFn);
    const low16  = Number(v4Big & 0xFFFFn);
    work = work.slice(0, lastColon + 1)
      + high16.toString(16) + ':' + low16.toString(16);
  }

  // Expand "::"
  let head = '', tail = '';
  if (work.includes('::')) {
    const [h, t] = work.split('::');
    head = h;
    tail = t || '';
  } else {
    head = work;
  }
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing   = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const groups = [
    ...headParts,
    ...new Array(missing).fill('0'),
    ...tailParts,
  ];
  if (groups.length !== 8) return null;

  let n = 0n;
  for (const g of groups) {
    const v = parseInt(g || '0', 16);
    if (Number.isNaN(v) || v < 0 || v > 0xFFFF) return null;
    n = (n << 16n) | BigInt(v);
  }
  return n;
}

/**
 * Parse a CIDR ("10.0.0.0/8", "::1/128") or single IP ("192.168.1.5") into
 * a comparable record, or null on failure.
 *
 * @param {string} cidr
 * @returns {{kind:'v4'|'v6', addr: bigint, mask: bigint, prefix: number}|null}
 */
function parseCidr(cidr) {
  if (typeof cidr !== 'string' || cidr === '') return null;
  const slash = cidr.indexOf('/');
  const ipStr = slash === -1 ? cidr : cidr.slice(0, slash);
  const norm  = normalizeIp(ipStr);

  if (net.isIPv4(norm)) {
    const prefix = slash === -1 ? 32 : parseInt(cidr.slice(slash + 1), 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const addr = v4ToBigInt(norm);
    if (addr === null) return null;
    const mask = prefix === 0 ? 0n : (((1n << BigInt(prefix)) - 1n) << BigInt(32 - prefix));
    return { kind: 'v4', addr: addr & mask, mask, prefix };
  }

  if (net.isIPv6(norm)) {
    const prefix = slash === -1 ? 128 : parseInt(cidr.slice(slash + 1), 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    const addr = v6ToBigInt(norm);
    if (addr === null) return null;
    const mask = prefix === 0 ? 0n : (((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix));
    return { kind: 'v6', addr: addr & mask, mask, prefix };
  }

  return null;
}

/**
 * @param {string} ip
 * @param {{kind:'v4'|'v6', addr: bigint, mask: bigint}} cidr
 */
function ipMatchesCidr(ip, cidr) {
  const norm = normalizeIp(ip);
  if (cidr.kind === 'v4') {
    if (!net.isIPv4(norm)) return false;
    const n = v4ToBigInt(norm);
    if (n === null) return false;
    return (n & cidr.mask) === cidr.addr;
  } else {
    if (!net.isIPv6(norm)) return false;
    const n = v6ToBigInt(norm);
    if (n === null) return false;
    return (n & cidr.mask) === cidr.addr;
  }
}

/**
 * @param {string} ip
 * @param {TrustPolicy} policy
 * @returns {boolean}
 */
function isTrusted(ip, policy) {
  if (policy.trust === 'none') return false;
  if (policy.trust === 'all')  return true;
  return policy.cidrs.some(c => ipMatchesCidr(ip, c));
}

/**
 * Resolve the client IP for an HTTP request given a trust policy.
 *
 * @param {import('http').IncomingMessage} req
 * @param {TrustPolicy} policy
 * @returns {string}  The resolved client IP, or 'unknown' if no peer is known.
 */
function resolveClientIp(req, policy) {
  const socketIp = normalizeIp(req?.socket?.remoteAddress || '');
  if (!socketIp) return 'unknown';

  // If the immediate peer isn't trusted, ignore proxy headers entirely.
  if (!isTrusted(socketIp, policy)) {
    return socketIp;
  }

  // Walk the X-Forwarded-For chain right-to-left, peeling off trusted hops.
  // Multiple XFF headers concatenate; Node merges them with commas in
  // req.headers['x-forwarded-for'] already, but be explicit.
  const xffHeader = req.headers['x-forwarded-for'];
  const xff = (typeof xffHeader === 'string' ? xffHeader : '')
    .split(',')
    .map(s => normalizeIp(s.trim()))
    .filter(Boolean);

  // The rightmost entry is the one our trusted proxy added (which equals
  // socketIp). Walk leftwards skipping anything that's also trusted; the
  // first non-trusted hop is the real client.
  for (let i = xff.length - 1; i >= 0; i--) {
    const hop = xff[i];
    if (!isTrusted(hop, policy)) {
      return hop;
    }
  }

  // Whole chain was trusted (or empty) — fall back to the socket.
  return socketIp;
}

/**
 * Build a TrustPolicy from a Config instance and emit a single startup
 * log line summarising what we will and won't trust. Call this once during
 * server startup; pass the resulting policy into every transport.
 *
 * @param {Config} config
 * @param {{info:Function, warn:Function}} logger
 * @returns {TrustPolicy}
 */
function loadTrustPolicy(config, logger) {
  const raw = config ? config.get('trust_proxy', '') : '';
  const policy = parseTrustPolicy(raw);
  const log    = logger || console;

  if (policy.trust === 'none') {
    log.info('[Net] trust_proxy: disabled — using socket peer for all client IPs');
  } else if (policy.trust === 'all') {
    // Not currently emitted by parseTrustPolicy (we collapse "true" to a
    // loopback list) but keep the branch for forward compatibility.
    log.warn('[Net] trust_proxy: trusting ALL upstream IPs — only safe behind a closed perimeter');
  } else {
    const summary = policy.cidrs.map(c => `${c.kind}/${c.prefix}`).join(', ');
    log.info(`[Net] trust_proxy: enabled for ${policy.cidrs.length} entries (${summary})`);
  }

  return policy;
}

module.exports = {
  parseTrustPolicy,
  resolveClientIp,
  loadTrustPolicy,
  // Internals re-exported for tests:
  parseCidr,
  ipMatchesCidr,
  normalizeIp,
};
