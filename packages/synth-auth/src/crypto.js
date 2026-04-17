'use strict';

const crypto = require('crypto');
const argon2 = require('argon2');

// ---------------------------------------------------------------------------
// Base62 encoding  (0-9 A-Z a-z)
// ---------------------------------------------------------------------------
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_VALID = /^[0-9A-Za-z]+$/;

function base62Encode(buf) {
  let n = BigInt('0x' + buf.toString('hex'));
  if (n === 0n) return '0';
  let result = '';
  while (n > 0n) {
    result = BASE62_CHARS[Number(n % 62n)] + result;
    n = n / 62n;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Crockford's Base32 encoding
// ---------------------------------------------------------------------------
const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crockfordEncode(n, length = 8) {
  if (n < 0n) throw new Error('crockfordEncode: negative value');
  let result = '';
  while (n > 0n) {
    result = CROCKFORD_CHARS[Number(n % 32n)] + result;
    n = n / 32n;
  }
  result = result || '0';
  while (result.length < length) result = '0' + result;
  return result;
}

function crockfordDecode(str) {
  const clean = str.replace(/-/g, '').toUpperCase()
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0');

  let n = 0n;
  for (const ch of clean) {
    const idx = CROCKFORD_CHARS.indexOf(ch);
    if (idx === -1) throw new Error(`crockfordDecode: invalid character '${ch}'`);
    n = n * 32n + BigInt(idx);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Username normalization
// ---------------------------------------------------------------------------

function isValidUsernameInput(input) {
  const stripped = input.split('-')[0];
  return BASE62_VALID.test(stripped) && stripped.length > 0;
}

function normalizeUsername(input) {
  let base = input.split('-')[0];
  base = base.substring(0, 13);
  return base.padEnd(13, '_');
}

function displayUsername(normalized) {
  return normalized.replace(/_+$/, '');
}

// ---------------------------------------------------------------------------
// Core cryptographic identity derivation
// ---------------------------------------------------------------------------

function deriveUserSalt(normalizedUsername, synthSalt) {
  return crypto
    .createHmac('sha256', synthSalt)
    .update(normalizedUsername, 'utf8')
    .digest()
    .slice(0, 16);
}

async function deriveMasterKey(normalizedUsername, alphabetizedWords, pepper, userSalt) {
  const inputStr = `${normalizedUsername}:${alphabetizedWords.join('-')}:${pepper}`;

  return argon2.hash(inputStr, {
    type:        argon2.argon2id,
    memoryCost:  65536,
    timeCost:    3,
    parallelism: 4,
    salt:        userSalt,
    raw:         true,
    hashLength:  32,
  });
}

function buildIdentity(normalizedUsername, masterKey) {
  const b62 = base62Encode(masterKey);
  const internalId = `${normalizedUsername}-${b62}`;
  const publicId   = `${displayUsername(normalizedUsername)}-${b62.substring(0, 6)}`;
  return { internalId, publicId };
}

// ---------------------------------------------------------------------------
// Recovery code
// ---------------------------------------------------------------------------

function encodeRecoveryCode(indices) {
  const [i0, i1, i2] = indices;
  const n = BigInt(i0) * 7776n * 7776n + BigInt(i1) * 7776n + BigInt(i2);
  const encoded = crockfordEncode(n, 8);
  return `${encoded.slice(0, 4)}-${encoded.slice(4)}`;
}

function decodeRecoveryCode(code) {
  const n = crockfordDecode(code);
  const i2 = Number(n % 7776n);
  const i1 = Number((n / 7776n) % 7776n);
  const i0 = Number(n / (7776n * 7776n));
  return [i0, i1, i2];
}

function generateRecoveryCode() {
  const indices = [];
  while (indices.length < 3) {
    const idx = crypto.randomInt(0, 7776);
    if (!indices.includes(idx)) indices.push(idx);
  }
  return encodeRecoveryCode(indices);
}

function decodeRecoveryCodeToWords(rawCode, wordList) {
  const RECOVERY_CODE_RE = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;
  if (!RECOVERY_CODE_RE.test(rawCode.trim())) return null;

  const normalized = rawCode.trim().replace(/-/g, '').toUpperCase();

  let indices;
  try {
    indices = decodeRecoveryCode(normalized);
  } catch (e) {
    return null;
  }

  if (indices.some(i => i < 0 || i > 7775)) return null;

  const words = indices.map(i => wordList.atIndex(i));
  // atIndex may return undefined if wordlist is small (test wordlist)
  if (words.some(w => w === undefined)) return null;

  return { indices, words };
}

// ---------------------------------------------------------------------------
// High-level identity creation helper
// ---------------------------------------------------------------------------

async function deriveIdentity(rawUsername, rawWords, pepper, synthSalt, wordList) {
  const normalized       = normalizeUsername(rawUsername);
  const alphabetized     = [...rawWords].map(w => w.toLowerCase()).sort();
  const userSalt         = deriveUserSalt(normalized, synthSalt);
  const masterKey        = await deriveMasterKey(normalized, alphabetized, pepper, userSalt);
  const { internalId, publicId } = buildIdentity(normalized, masterKey);

  const indices      = alphabetized.map(w => wordList.indexOf(w));
  const recoveryCode = encodeRecoveryCode(indices);

  return {
    normalizedUsername: normalized,
    displayName:        displayUsername(normalized),
    alphabetizedWords:  alphabetized,
    internalId,
    publicId,
    recoveryCode,
  };
}

module.exports = {
  normalizeUsername,
  displayUsername,
  isValidUsernameInput,
  deriveUserSalt,
  deriveMasterKey,
  buildIdentity,
  base62Encode,
  crockfordEncode,
  crockfordDecode,
  encodeRecoveryCode,
  decodeRecoveryCode,
  decodeRecoveryCodeToWords,
  generateRecoveryCode,
  deriveIdentity,
};
