/**
 * ansi-file.js
 *
 * General-purpose utility for preparing and displaying ANSI/CP437 art files
 * on a SynthDoor Terminal.  Usable by any game, the menu system, or the
 * server login flows — nothing here is login-specific.
 *
 * ── Supported input formats ────────────────────────────────────────────────
 *
 *   Raw CP437 / .ANS    Any file whose bytes cannot be decoded as valid UTF-8.
 *                       Treated as raw CP437 bytes; written directly to the
 *                       output stream with no conversion.
 *
 *   UTF-8 / Unicode     Detected by a UTF-8 BOM (EF BB BF) or by a strict
 *                       round-trip decode test.  Unicode characters are
 *                       converted to CP437 via the engine's UNICODE_TO_CP437
 *                       map (with NFD diacritic-strip fallback for unmapped
 *                       accented characters) before transmission.
 *
 *   Plain ASCII         A strict subset of both; passed through unchanged.
 *
 * ── SAUCE record stripping ────────────────────────────────────────────────
 *
 *   .ANS files commonly carry a trailing 128-byte SAUCE metadata record
 *   (starting with the ASCII tag "SAUCE").  The record and the SUB character
 *   (0x1A) that precedes it are stripped before display so they do not appear
 *   as garbage on screen.
 *
 * ── Line-ending normalisation ─────────────────────────────────────────────
 *
 *   All line endings are normalised to \r\n (CRLF) for correct rendering on
 *   BBS terminals.  ANSI escape sequences are preserved unmodified.
 *
 * ── Public API ────────────────────────────────────────────────────────────
 *
 *   detectEncoding(buffer)          → 'cp437' | 'utf8'
 *   stripSauce(buffer)              → Buffer
 *   normaliseCRLF(buffer)           → Buffer
 *   prepareAnsiBuffer(buffer)       → Buffer   (full pipeline)
 *   displayAnsiFile(terminal, path) → Promise<void>
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   const { displayAnsiFile, prepareAnsiBuffer } = require('./ansi-file');
 *
 *   // Display a file on a terminal (most common case):
 *   await displayAnsiFile(terminal, '/path/to/login.ans');
 *
 *   // Prepare a buffer for custom rendering (e.g. menu system):
 *   const buf = prepareAnsiBuffer(fs.readFileSync(artPath));
 *   terminal.writeRaw('\x1b[2;1H');        // position cursor
 *   terminal.output.write(buf);            // write prepared bytes
 *
 *   displayAnsiFile() is a no-op (console.warn) if the file is missing or
 *   unreadable — the caller's flow continues uninterrupted.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { encodeCP437, UNICODE_TO_CP437 } = require('./cp437-encode');

// ─── SAUCE record constants ───────────────────────────────────────────────────
// SAUCE records are always 128 bytes, beginning with the 5-byte ASCII tag.
const SAUCE_TAG = Buffer.from('SAUCE');
const SAUCE_LEN = 128;
const SUB_CHAR  = 0x1A; // CP437 / ASCII SUB — marks end of displayable content

// ─── detectEncoding ───────────────────────────────────────────────────────────

/**
 * Determine whether a buffer contains UTF-8 text or raw CP437 bytes.
 *
 * Detection order:
 *   1. UTF-8 BOM (EF BB BF) present → 'utf8'
 *   2. All bytes ≤ 0x7F (pure ASCII) → 'utf8'  (valid subset of both)
 *   3. Strict round-trip test: decode as UTF-8 and re-encode; if the bytes
 *      match the original exactly → 'utf8'
 *   4. Otherwise → 'cp437'  (high bytes present that aren't valid UTF-8)
 *
 * @param  {Buffer} buf
 * @returns {'utf8'|'cp437'}
 */
function detectEncoding(buf) {
  // 1. UTF-8 BOM
  if (buf.length >= 3 &&
      buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return 'utf8';
  }

  // 2. Pure ASCII fast-path
  let allAscii = true;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 0x7F) { allAscii = false; break; }
  }
  if (allAscii) return 'utf8';

  // 3. Strict round-trip test.
  //    Node's Buffer.toString('utf8') is lenient — it replaces invalid
  //    sequences with U+FFFD instead of throwing.  We detect real UTF-8 by
  //    re-encoding the decoded string and comparing bytes.
  try {
    const decoded   = buf.toString('utf8');
    const reEncoded = Buffer.from(decoded, 'utf8');
    if (reEncoded.equals(buf)) return 'utf8';
  } catch (_) {
    // Should not happen with Node's lenient decoder, but be safe.
  }

  // 4. High bytes present that are not valid UTF-8 → treat as CP437
  return 'cp437';
}

// ─── stripSauce ───────────────────────────────────────────────────────────────

/**
 * Remove a trailing SAUCE metadata record from a buffer if one is present.
 *
 * A SAUCE record is identified by the 5-byte ASCII tag "SAUCE" at position
 * (buf.length - SAUCE_LEN).  If found, the record and any preceding SUB
 * (0x1A) characters are removed.
 *
 * @param  {Buffer} buf
 * @returns {Buffer}  New buffer with SAUCE stripped, or the original if none.
 */
function stripSauce(buf) {
  if (buf.length >= SAUCE_LEN) {
    const tagOffset = buf.length - SAUCE_LEN;
    if (buf.slice(tagOffset, tagOffset + SAUCE_TAG.length).equals(SAUCE_TAG)) {
      buf = buf.slice(0, tagOffset);
      // Strip any trailing SUB characters that precede the SAUCE record
      while (buf.length > 0 && buf[buf.length - 1] === SUB_CHAR) {
        buf = buf.slice(0, buf.length - 1);
      }
    }
  }
  return buf;
}

// ─── normaliseCRLF ────────────────────────────────────────────────────────────

/**
 * Normalise line endings in a raw byte buffer to CRLF (\r\n).
 *
 *   \r\n   → \r\n   (unchanged)
 *   \n     → \r\n   (bare LF)
 *   \r     → \r\n   (bare CR)
 *
 * ANSI escape sequences (which may contain \r or \n as part of a sequence)
 * are not specifically protected here — in practice, well-formed ANSI art
 * only uses bare \r\n for line breaks, and ESC sequences do not contain
 * raw CR/LF bytes.
 *
 * @param  {Buffer} buf
 * @returns {Buffer}
 */
function normaliseCRLF(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0D) {
      // CR: emit CRLF, consume a following LF if present
      out.push(0x0D, 0x0A);
      if (i + 1 < buf.length && buf[i + 1] === 0x0A) i++;
    } else if (b === 0x0A) {
      // Bare LF → CRLF
      out.push(0x0D, 0x0A);
    } else {
      out.push(b);
    }
  }
  return Buffer.from(out);
}

// ─── prepareAnsiBuffer ────────────────────────────────────────────────────────

/**
 * Full preparation pipeline for an ANSI/text art buffer.
 *
 * Steps:
 *   1. stripSauce  — remove SAUCE metadata record if present
 *   2. detectEncoding  — determine whether content is UTF-8 or raw CP437
 *   3. Convert  — if UTF-8: strip BOM, decode to string, encode to CP437
 *                 if CP437: use as-is (raw bytes are already correct)
 *   4. normaliseCRLF  — ensure all line endings are \r\n
 *
 * The returned buffer contains only CP437 bytes and ANSI escape sequences,
 * ready to write directly to a BBS terminal via terminal.output.write().
 *
 * @param  {Buffer} buf   Raw file contents
 * @returns {Buffer}      Prepared CP437 buffer
 */
function prepareAnsiBuffer(buf) {
  // Step 1: strip SAUCE
  buf = stripSauce(buf);

  // Step 2: detect encoding
  const encoding = detectEncoding(buf);

  // Step 3: convert if needed
  if (encoding === 'utf8') {
    // Strip BOM if present before decoding
    let str;
    if (buf.length >= 3 &&
        buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      str = buf.slice(3).toString('utf8');
    } else {
      str = buf.toString('utf8');
    }
    // encodeCP437 handles Unicode→CP437 mapping + NFD diacritic fallback
    buf = encodeCP437(str);
  }
  // CP437: buf is already correct raw bytes — no conversion needed

  // Step 4: normalise line endings
  buf = normaliseCRLF(buf);

  return buf;
}

// ─── displayAnsiFile ─────────────────────────────────────────────────────────

/**
 * Read, prepare, and display a file on a Terminal.
 *
 * Handles .ANS (raw CP437), plain CP437, UTF-8, and ASCII automatically via
 * prepareAnsiBuffer().  Writes the result via terminal.writeRaw() so that
 * the already-encoded CP437 bytes bypass the terminal's internal encoder.
 *
 * This function is safe to call unconditionally: if the file does not exist
 * or cannot be read, it logs a warning and returns without throwing.  The
 * caller's login or game flow continues normally.
 *
 * The terminal is left in whatever ANSI color/attribute state the file sets.
 * Callers should call terminal.resetAttrs() and/or terminal.clearScreen()
 * afterwards as appropriate for their context.
 *
 * @param  {object} terminal   SynthDoor Terminal instance
 * @param  {string} filePath   Absolute or cwd-relative path to the art file
 * @returns {Promise<void>}
 */
async function displayAnsiFile(terminal, filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath);
  } catch (err) {
    console.warn(`[ansi-file] Cannot read "${filePath}": ${err.message}`);
    return;
  }

  const prepared = prepareAnsiBuffer(raw);

  // writeRaw bypasses the terminal's UTF-8/CP437 encoder; the buffer is
  // already CP437-encoded bytes ready for the wire.
  if (terminal.output && !terminal.output.destroyed) {
    terminal.output.write(prepared);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  detectEncoding,
  stripSauce,
  normaliseCRLF,
  prepareAnsiBuffer,
  displayAnsiFile,
};
