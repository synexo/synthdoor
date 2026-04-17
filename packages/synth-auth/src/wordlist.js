'use strict';

const fs   = require('fs');
const path = require('path');
const levenshtein = require('fast-levenshtein');

/**
 * WordList — loads the EFF Large Wordlist, exposes lookup, validation,
 * random selection, and Levenshtein "did you mean?" suggestions.
 */
class WordList {
  constructor(wordlistPath) {
    const filePath = wordlistPath || path.join(__dirname, 'eff_large_wordlist.txt');
    const raw = fs.readFileSync(filePath, 'utf8').trim().split('\n');

    /** @type {string[]} words[0..N-1] */
    this.words = raw.map(line => line.split('\t')[1].trim().toLowerCase());

    /** @type {Set<string>} */
    this._set = new Set(this.words);
  }

  /** Returns true if word is in the EFF list (case-insensitive). */
  isValid(word) {
    return this._set.has(word.toLowerCase());
  }

  /** Returns the 0-based index of word, or -1 if not found. */
  indexOf(word) {
    return this.words.indexOf(word.toLowerCase());
  }

  /** Returns the word at 0-based index, or undefined if out of range. */
  atIndex(index) {
    return this.words[index];
  }

  /** Total number of words in the list. */
  get size() {
    return this.words.length;
  }

  /**
   * Pick `n` unique random words from the list.
   * @param {number} n
   * @returns {string[]}
   */
  pickUnique(n) {
    const picked = new Set();
    const len    = this.words.length;
    while (picked.size < n) {
      picked.add(this.words[Math.floor(Math.random() * len)]);
    }
    return Array.from(picked);
  }

  /**
   * Pick a single random word from the list.
   * @returns {string}
   */
  pickOne() {
    return this.words[Math.floor(Math.random() * this.words.length)];
  }

  /**
   * Given a word not in the list, find the closest valid word via
   * Levenshtein distance.
   * @param {string} input
   * @returns {string}
   */
  closestMatch(input) {
    const lower = input.toLowerCase();
    let best = null;
    let bestDist = Infinity;

    for (const word of this.words) {
      const dist = levenshtein.get(lower, word);
      if (dist < bestDist) {
        bestDist = dist;
        best = word;
        if (dist === 1) break;
      }
    }

    return best;
  }

  /**
   * Validate an array of 3 raw words (any case).
   * @param {string[]} rawWords  array of exactly 3 words
   * @returns {{ valid: true, normalized: string[] } | { valid: false, errors: Array, duplicates?: boolean }}
   */
  validateThree(rawWords) {
    const errors     = [];
    const normalized = [];

    for (const raw of rawWords) {
      const lower = raw.toLowerCase();
      if (this.isValid(lower)) {
        normalized.push(lower);
      } else {
        errors.push({ input: raw, suggestion: this.closestMatch(lower) });
      }
    }

    if (errors.length === 0) {
      const unique = new Set(normalized);
      if (unique.size !== 3) {
        return { valid: false, errors: [{ input: rawWords.join(' '), suggestion: null }], duplicates: true };
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, normalized };
  }
}

module.exports = WordList;
