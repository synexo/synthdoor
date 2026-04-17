'use strict';

/**
 * flow.js — Transport-agnostic authentication flows.
 *
 * Dialogue adapter interface:
 * {
 *   send(text):   void             — output a line of text to the user
 *   prompt(text): Promise<string>  — display prompt, return trimmed user input
 * }
 *
 * Config object:
 * {
 *   pepper:    string,
 *   synthSalt: Buffer,
 *   db:        AuthDB,
 *   wordList:  WordList,
 *   sessions:  SessionStore,
 *   ipAddress: string|null,
 * }
 */

const {
  isValidUsernameInput,
  deriveIdentity,
  decodeRecoveryCodeToWords,
} = require('./crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOGIN_ATTEMPTS       = 5;
const RECOVER_REMINDER_AFTER   = 3;
const MAX_CONFIRM_ATTEMPTS     = 3;
const RECOVERY_CODE_RE         = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function madLibs(username, words) {
  const [w1, w2, w3] = words.map(w => w.toUpperCase());
  return [
    `  \u2022 ${username} writes songs about ${w1}, ${w2}, and ${w3}.`,
    `  \u2022 ${username} paints pictures of ${w1}, ${w2}, and ${w3}.`,
    `  \u2022 ${username} often contemplates ${w1}, ${w2}, and ${w3}.`,
  ];
}

function extractCodewords(line) {
  return line.trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean).map(w => w.toLowerCase());
}

function looksLikeRecoveryCode(input) {
  return RECOVERY_CODE_RE.test(input.trim());
}

async function tryDecodeAndVerifyRecovery(rawCode, rawUsername, config) {
  const { wordList, db } = config;

  const decoded = decodeRecoveryCodeToWords(rawCode, wordList);
  if (!decoded) return null;

  const recoveredWords = decoded.words;

  let identity;
  try {
    identity = await deriveIdentity(
      rawUsername,
      recoveredWords,
      config.pepper,
      config.synthSalt,
      wordList
    );
  } catch (e) {
    return null;
  }

  if (!db.find(identity.internalId)) return null;

  return { recoveredWords, identity };
}

async function tryDecodeRecoveryNoDB(rawCode, rawUsername, config) {
  const { wordList } = config;

  const decoded = decodeRecoveryCodeToWords(rawCode, wordList);
  if (!decoded) return null;

  let identity;
  try {
    identity = await deriveIdentity(
      rawUsername,
      decoded.words,
      config.pepper,
      config.synthSalt,
      wordList
    );
  } catch (e) {
    return null;
  }

  return { words: decoded.words, identity };
}

// ---------------------------------------------------------------------------
// Flow: Entry point
// ---------------------------------------------------------------------------

/**
 * Standard entry flow used by telnet (authenticated mode).
 * Prompt: "Enter your username or "new" (or just hit ENTER for guest):"
 *
 * ENTER         → guestFlow  (random username, auto-register, no confirmation)
 * "new"         → registrationFlow
 * <username>    → loginFlow
 */
async function entryFlow(dialogue, config) {
  dialogue.send('');

  const input = await dialogue.prompt('Enter your username or "new" (or just hit ENTER for guest): ');
  const trimmed = input.trim();

  if (trimmed === '') {
    return guestFlow(dialogue, config);
  }

  if (trimmed.toLowerCase() === 'new') {
    return registrationFlow(dialogue, config);
  }

  return loginFlow(dialogue, config, trimmed);
}

// ---------------------------------------------------------------------------
// Flow: Guest (ENTER with no input)
// ---------------------------------------------------------------------------

/**
 * Guest flow:
 * - Pick a single random word from the wordlist as the username.
 * - Pick 3 unique random words as code words.
 * - Derive identity and register (loop up to 5 times on PublicID collision).
 * - Display identity info and Mad-Libs, but DO NOT prompt for confirmation.
 * - Pass through immediately.
 */
async function guestFlow(dialogue, config) {
  const { db, wordList, sessions, ipAddress } = config;

  // Rate-limit guest registrations same as normal registrations
  if (ipAddress) {
    const rl = db.rateLimit(`register:${ipAddress}`, 1, 60);
    if (!rl.allowed) {
      dialogue.send('Too many registration attempts. Please try again in a minute.');
      return { success: false, reason: 'rate_limited' };
    }
  }

  let identity = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const guestUsername = wordList.pickOne();
    const words         = wordList.pickUnique(3);

    let candidate;
    try {
      candidate = await deriveIdentity(
        guestUsername,
        words,
        config.pepper,
        config.synthSalt,
        wordList
      );
    } catch (e) {
      continue;
    }

    if (!db.publicIdExists(candidate.internalId)) {
      identity = candidate;
      break;
    }
  }

  if (!identity) {
    dialogue.send('Unable to create a guest identity. Please try again or enter a username.');
    return { success: false, reason: 'username_unavailable' };
  }

  const displayWords = identity.alphabetizedWords.map(w => w.toUpperCase());

  dialogue.send('');
  dialogue.send(`  Your identity has been created. Others will see you as: ${identity.publicId}`);
  dialogue.send('  It cannot be changed.');
  dialogue.send('');
  dialogue.send(`  Your code words are:  ${displayWords.join('  ')}`);
  dialogue.send(`  Your recovery key is: ${identity.recoveryCode}`);
  dialogue.send('');
  dialogue.send('  - Save your recovery key. It is the only way to recover your words.');
  dialogue.send('  - Remember your words. They can never be changed.');
  dialogue.send('');

  for (const line of madLibs(identity.displayName, identity.alphabetizedWords)) {
    dialogue.send(line);
  }
  dialogue.send('');

  // Register (TOCTOU guard)
  if (!db.publicIdExists(identity.internalId)) {
    db.register(identity.internalId, ipAddress || null);
  }

  const token = sessions.create({
    username:   identity.displayName,
    publicId:   identity.publicId,
    internalId: identity.internalId,
  });

  dialogue.send(`Welcome, ${identity.publicId}!`);
  dialogue.send('');

  return {
    success:  true,
    action:   'register',
    username: identity.publicId,   // PublicID is used as username in authenticated mode
    publicId: identity.publicId,
    token,
  };
}

// ---------------------------------------------------------------------------
// Flow: Login
// ---------------------------------------------------------------------------

async function loginFlow(dialogue, config, prefilledUsername = null) {
  const { db, wordList, ipAddress, sessions } = config;

  let rawUsername = prefilledUsername;

  if (!rawUsername) {
    rawUsername = await dialogue.prompt('Enter your username: ');
  }

  rawUsername = rawUsername.trim();

  if (!rawUsername || !isValidUsernameInput(rawUsername)) {
    dialogue.send('Invalid username. Usernames must contain only letters and numbers.');
    return { success: false, reason: 'invalid_username' };
  }

  let failedAttempts = 0;

  while (failedAttempts < MAX_LOGIN_ATTEMPTS) {

    const showRecoverHint = failedAttempts >= RECOVER_REMINDER_AFTER;
    const promptSuffix    = showRecoverHint
      ? ' (or "recover" to use your recovery key)'
      : ' or "recover"';

    const codeInput = await dialogue.prompt(`Enter your code words${promptSuffix}: `);
    const trimmed   = codeInput.trim();

    // ── "recover" keyword ──────────────────────────────────────────────────
    if (trimmed.toLowerCase() === 'recover') {
      return recoveryFlow(dialogue, config, rawUsername);
    }

    // ── Recovery code entered directly (XXXX-XXXX) ─────────────────────────
    if (looksLikeRecoveryCode(trimmed)) {
      if (ipAddress) {
        const rl = db.rateLimit(`login:${ipAddress}`, MAX_LOGIN_ATTEMPTS, 60);
        if (!rl.allowed) {
          dialogue.send('Too many login attempts. Please try again in a minute.');
          return { success: false, reason: 'rate_limited' };
        }
      }

      // Step 1: code valid + account exists → normal login
      const recovered = await tryDecodeAndVerifyRecovery(trimmed, rawUsername, config);

      if (recovered) {
        const token = sessions.create({
          username:   recovered.identity.publicId,
          publicId:   recovered.identity.publicId,
          internalId: recovered.identity.internalId,
        });
        dialogue.send('');
        dialogue.send(`  Welcome back, ${recovered.identity.publicId}!`);
        dialogue.send('');
        return {
          success:  true,
          action:   'login',
          username: recovered.identity.publicId,
          publicId: recovered.identity.publicId,
          token,
        };
      }

      // Step 2: valid code, no account → silent BBS auto-registration
      const decoded = await tryDecodeRecoveryNoDB(trimmed, rawUsername, config);

      if (decoded) {
        const rl = ipAddress
          ? db.rateLimit(`register:${ipAddress}`, 1, 60)
          : { allowed: true };

        if (!rl.allowed) {
          dialogue.send('Too many registration attempts. Please try again in a minute.');
          return { success: false, reason: 'rate_limited' };
        }

        if (!db.publicIdExists(decoded.identity.internalId)) {
          db.register(decoded.identity.internalId, ipAddress || null);
        }

        const token = sessions.create({
          username:   decoded.identity.publicId,
          publicId:   decoded.identity.publicId,
          internalId: decoded.identity.internalId,
        });
        return {
          success:  true,
          action:   'register',
          username: decoded.identity.publicId,
          publicId: decoded.identity.publicId,
          token,
        };
      }

      // Bad format/range
      failedAttempts++;
      dialogue.send('');
      dialogue.send('Invalid identity. Contemplate the songs and pictures for your words and try again.');
      dialogue.send('');
      if (failedAttempts >= RECOVER_REMINDER_AFTER) {
        dialogue.send('  Tip: type "recover" to use your recovery key instead.');
        dialogue.send('');
      }
      continue;
    }

    // ── Three-word entry ───────────────────────────────────────────────────
    const codewords = extractCodewords(trimmed);

    if (codewords.length !== 3) {
      dialogue.send('Please enter exactly 3 code words separated by spaces.');
      continue;
    }

    const validation = wordList.validateThree(codewords);
    if (!validation.valid) {
      if (validation.duplicates) {
        dialogue.send('Code words must all be different.');
      } else {
        for (const err of validation.errors) {
          dialogue.send(
            err.suggestion
              ? `"${err.input}" is not a valid code word. Did you mean "${err.suggestion.toUpperCase()}"?`
              : `"${err.input}" is not a valid code word.`
          );
        }
      }
      continue;
    }

    if (ipAddress) {
      const rl = db.rateLimit(`login:${ipAddress}`, MAX_LOGIN_ATTEMPTS, 60);
      if (!rl.allowed) {
        dialogue.send('Too many login attempts. Please try again in a minute.');
        return { success: false, reason: 'rate_limited' };
      }
    }

    let identity;
    try {
      identity = await deriveIdentity(
        rawUsername,
        validation.normalized,
        config.pepper,
        config.synthSalt,
        wordList
      );
    } catch (err) {
      dialogue.send('An internal error occurred. Please try again.');
      return { success: false, reason: 'internal_error' };
    }

    // Match found → log in
    if (db.find(identity.internalId)) {
      const token = sessions.create({
        username:   identity.publicId,
        publicId:   identity.publicId,
        internalId: identity.internalId,
      });
      dialogue.send('');
      dialogue.send(`  Welcome back, ${identity.publicId}!`);
      dialogue.send('');
      return {
        success:  true,
        action:   'login',
        username: identity.publicId,
        publicId: identity.publicId,
        token,
      };
    }

    // No match — offer registration if no PublicID collision
    if (!db.publicIdExists(identity.internalId)) {
      dialogue.send('');
      dialogue.send('User not found. Create a new account? (yes or no)');
      const answer = await dialogue.prompt('> ');

      if (answer.trim().toLowerCase() === 'yes') {
        return registrationFlow(dialogue, config, {
          rawUsername,
          chosenWords:     validation.normalized,
          derivedIdentity: identity,
        });
      }

      dialogue.send('');
    }

    failedAttempts++;
    dialogue.send('');
    dialogue.send('Invalid identity. Contemplate the songs and pictures for your words and try again.');
    dialogue.send('');
    if (failedAttempts >= RECOVER_REMINDER_AFTER && failedAttempts < MAX_LOGIN_ATTEMPTS) {
      dialogue.send('  Tip: type "recover" to use your recovery key instead.');
      dialogue.send('');
    }
  }

  dialogue.send('Too many failed attempts. Please reconnect to try again.');
  return { success: false, reason: 'max_attempts' };
}

// ---------------------------------------------------------------------------
// Flow: Registration
// ---------------------------------------------------------------------------

async function registrationFlow(dialogue, config, prefilled = null) {
  const { db, wordList, ipAddress, sessions } = config;

  if (!prefilled && ipAddress) {
    const rl = db.rateLimit(`register:${ipAddress}`, 1, 60);
    if (!rl.allowed) {
      dialogue.send('Too many registration attempts. Please try again in a minute.');
      return { success: false, reason: 'rate_limited' };
    }
  }

  let identity;

  if (prefilled) {
    identity = prefilled.derivedIdentity;
  } else {
    const rawUsername = await dialogue.prompt('Enter your desired username: ');

    if (!rawUsername || !isValidUsernameInput(rawUsername.trim())) {
      dialogue.send('Invalid username. Use only letters and numbers (A-Z, a-z, 0-9).');
      return { success: false, reason: 'invalid_username' };
    }

    identity = null;
    for (let i = 0; i < 5; i++) {
      const candidate = await deriveIdentity(
        rawUsername.trim(),
        wordList.pickUnique(3),
        config.pepper,
        config.synthSalt,
        wordList
      );
      if (!db.publicIdExists(candidate.internalId)) { identity = candidate; break; }
    }

    if (!identity) {
      dialogue.send('');
      dialogue.send(`The username "${rawUsername.trim()}" is unavailable. Please try a different username.`);
      dialogue.send('');
      return { success: false, reason: 'username_unavailable' };
    }
  }

  const displayWords = identity.alphabetizedWords.map(w => w.toUpperCase());

  dialogue.send('');
  dialogue.send(`  Your identity has been created. Others will see you as: ${identity.publicId}`);
  dialogue.send('  It cannot be changed.');
  dialogue.send('');
  dialogue.send(`  Your code words are:  ${displayWords.join('  ')}`);
  dialogue.send(`  Your recovery key is: ${identity.recoveryCode}`);
  dialogue.send('');
  dialogue.send('  - Save your recovery key. It is the only way to recover your words.');
  dialogue.send('  - Remember your words. They can never be changed.');
  dialogue.send('');

  for (const line of madLibs(identity.displayName, identity.alphabetizedWords)) {
    dialogue.send(line);
  }
  dialogue.send('');

  let confirmed       = false;
  let confirmAttempts = 0;

  while (!confirmed && confirmAttempts < MAX_CONFIRM_ATTEMPTS) {
    const confirmInput = await dialogue.prompt('Enter your code words to confirm registration: ');
    const confirmWords = extractCodewords(confirmInput.trim());

    if (confirmWords.length !== 3) {
      dialogue.send('Please enter all 3 code words.');
      confirmAttempts++;
      continue;
    }

    const sortedInput   = [...confirmWords].sort().join(',');
    const sortedCorrect = [...identity.alphabetizedWords].sort().join(',');

    if (sortedInput === sortedCorrect) {
      confirmed = true;
    } else {
      confirmAttempts++;
      dialogue.send('');
      dialogue.send('Those are not the words shown. Please check the words above and try again.');
      dialogue.send(`  Your words are: ${displayWords.join('  ')}`);
      dialogue.send('');
    }
  }

  if (!confirmed) {
    dialogue.send('Registration cancelled. Your identity was not saved.');
    return { success: false, reason: 'confirmation_failed' };
  }

  if (db.publicIdExists(identity.internalId)) {
    dialogue.send('');
    dialogue.send('Error: This identity was claimed by another session while you were confirming.');
    dialogue.send('Please reconnect and try a different username.');
    dialogue.send('');
    return { success: false, reason: 'username_unavailable' };
  }

  db.register(identity.internalId, ipAddress || null);

  const token = sessions.create({
    username:   identity.publicId,
    publicId:   identity.publicId,
    internalId: identity.internalId,
  });

  dialogue.send('');
  dialogue.send(`  Identity confirmed. Welcome, ${identity.publicId}!`);
  dialogue.send('');

  return {
    success:  true,
    action:   'register',
    username: identity.publicId,
    publicId: identity.publicId,
    token,
  };
}

// ---------------------------------------------------------------------------
// Flow: Recovery
// ---------------------------------------------------------------------------

async function recoveryFlow(dialogue, config, rawUsername) {
  const { db, wordList, sessions, ipAddress } = config;

  let attempts = 0;

  while (attempts < MAX_LOGIN_ATTEMPTS) {
    if (ipAddress) {
      const rl = db.rateLimit(`login:${ipAddress}`, MAX_LOGIN_ATTEMPTS, 60);
      if (!rl.allowed) {
        dialogue.send('Too many attempts. Please try again in a minute.');
        return { success: false, reason: 'rate_limited' };
      }
    }

    const codeInput = await dialogue.prompt('Enter your 8-character recovery key: ');

    const recovered = await tryDecodeAndVerifyRecovery(
      codeInput.trim(),
      rawUsername,
      config
    );

    if (!recovered) {
      attempts++;
      dialogue.send('Recovery code invalid.');
      if (attempts < MAX_LOGIN_ATTEMPTS) {
        dialogue.send('');
        continue;
      }
      dialogue.send('Too many failed attempts. Please reconnect to try again.');
      return { success: false, reason: 'invalid_recovery_code' };
    }

    const { recoveredWords, identity } = recovered;
    const displayWords = recoveredWords.map(w => w.toUpperCase());

    dialogue.send('');
    dialogue.send('  Recovery accepted. Your code words are:');
    dialogue.send(`    ${displayWords.join('  ')}`);
    dialogue.send('');

    for (const line of madLibs(identity.displayName, identity.alphabetizedWords)) {
      dialogue.send(line);
    }
    dialogue.send('');

    let confirmed  = false;
    let reAttempts = 0;

    while (!confirmed && reAttempts < MAX_CONFIRM_ATTEMPTS) {
      const reInput = await dialogue.prompt('Enter your code words to proceed: ');
      const reWords = extractCodewords(reInput.trim());

      if (reWords.length !== 3) {
        dialogue.send('Please enter all 3 code words.');
        reAttempts++;
        continue;
      }

      const sortedInput   = [...reWords].sort().join(',');
      const sortedCorrect = [...recoveredWords].sort().join(',');

      if (sortedInput === sortedCorrect) {
        confirmed = true;
      } else {
        reAttempts++;
        dialogue.send('');
        dialogue.send('Those are not the words shown. Please check above and try again.');
        dialogue.send(`    ${displayWords.join('  ')}`);
        dialogue.send('');
      }
    }

    if (!confirmed) {
      dialogue.send('Recovery failed. Please reconnect to try again.');
      return { success: false, reason: 'recovery_failed' };
    }

    const token = sessions.create({
      username:   identity.publicId,
      publicId:   identity.publicId,
      internalId: identity.internalId,
    });

    dialogue.send('');
    dialogue.send(`  Welcome back, ${identity.publicId}!`);
    dialogue.send('');

    return {
      success:  true,
      action:   'recover',
      username: identity.publicId,
      publicId: identity.publicId,
      token,
    };
  }

  return { success: false, reason: 'max_attempts' };
}

module.exports = {
  entryFlow,
  guestFlow,
  loginFlow,
  registrationFlow,
  recoveryFlow,
  madLibs,
  looksLikeRecoveryCode,
  RECOVERY_CODE_RE,
};
