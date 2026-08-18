import { randomBytes } from 'node:crypto';

import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Password hashing, and the only place in this codebase that touches one.
 *
 * argon2id with the parameters OWASP publishes as the low-memory profile:
 * 19MiB, two passes, one lane. The choice worth explaining is not the numbers
 * but the implementation: hash-wasm is WebAssembly, so there is no native
 * module to compile, no prebuilt binary to fetch per platform, and no build
 * toolchain in the deployment path. A password hash that fails to install on
 * one of the machines that runs this is not a security control.
 *
 * The output is a PHC string, which carries its own parameters. Raising the
 * cost later does not invalidate the hashes written under the old cost: verify
 * reads the parameters out of the stored string.
 */

const MEMORY_KIB = 19_456;
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

/** Below this a password is refused. Length is the only rule; no character classes. */
export const MIN_PASSWORD_CHARS = 12;

/** Above this the hash cost becomes a denial of service someone can post. */
export const MAX_PASSWORD_CHARS = 256;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: new Uint8Array(randomBytes(SALT_BYTES)),
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: HASH_BYTES,
    outputType: 'encoded',
  });
}

/**
 * False for a wrong password and false for a stored string that is not a hash.
 * A corrupted record is a failed sign in, never a thrown error that a caller
 * might turn into a different answer than "no".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: stored });
  } catch {
    return false;
  }
}
