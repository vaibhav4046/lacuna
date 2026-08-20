import { randomBytes } from 'node:crypto';

/**
 * A way back into an account, for a product with nowhere to send an email.
 *
 * The reset page said "password reset is not configured" and meant it: nothing
 * here sends mail, and a Send button that reported success while sending
 * nothing is the exact lie this project keeps refusing. But leaving people with
 * no way back is a worse answer than an honest dead end, so this is the third
 * option: a recovery code, generated when the account is created, shown once,
 * and stored only as a hash.
 *
 * It is the same trade the big providers offer as backup codes, and it is a
 * better fit here than mail would be. Nothing has to be trusted to deliver it,
 * nothing sits in an inbox that somebody else can read, and there is no reset
 * link to phish. What it costs is real and is stated plainly on the screen: a
 * code that is lost is an account that cannot be recovered, because there is no
 * second channel to prove who you are.
 *
 * Twenty characters from a 32-symbol alphabet is a hundred bits. Guessing it is
 * not a threat model; the rate limit exists for the same reason the sign-in one
 * does, not because the code is weak.
 */

/**
 * Crockford base32 without I, L, O and U.
 *
 * Those four are dropped because this is a string people copy off a screen and
 * type back in later, and 1/I/L and 0/O are where that goes wrong. U is out
 * because dropping it keeps accidental words from forming.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const GROUPS = 4;
const PER_GROUP = 5;
export const RECOVERY_CHARS = GROUPS * PER_GROUP;

/**
 * A fresh code, formatted for reading aloud and for copying.
 *
 * Rejection sampling rather than a modulo, because 256 is not a multiple of 32
 * only in the sense that it is: with a 32-symbol alphabet the modulo would in
 * fact be uniform. It is written this way anyway so that changing the alphabet
 * length later cannot silently introduce a bias nobody looks for again.
 */
export function newRecoveryCode(): string {
  const chars: string[] = [];
  while (chars.length < RECOVERY_CHARS) {
    for (const byte of randomBytes(RECOVERY_CHARS)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      chars.push(ALPHABET[byte % ALPHABET.length] ?? '0');
      if (chars.length === RECOVERY_CHARS) break;
    }
  }
  const groups: string[] = [];
  for (let at = 0; at < RECOVERY_CHARS; at += PER_GROUP) {
    groups.push(chars.slice(at, at + PER_GROUP).join(''));
  }
  return groups.join('-');
}

/**
 * What was typed, reduced to what was meant.
 *
 * Somebody re-entering this has copied it from a note, so it arrives with the
 * wrong case, with spaces instead of dashes, or with the dashes missing. All of
 * those are the right code. What is not forgiven is a wrong character: O is not
 * 0 here, because silently mapping it would mean two different codes verify
 * against one hash.
 */
export function normaliseRecoveryCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (stripped.length !== RECOVERY_CHARS) return null;
  for (const char of stripped) {
    if (!ALPHABET.includes(char)) return null;
  }
  return stripped;
}

/** The stored form of a code, for hashing. Never shown, never logged. */
export function canonicalRecoveryCode(code: string): string {
  return code.replace(/-/g, '');
}
