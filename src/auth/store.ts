import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where accounts and sessions live.
 *
 * Not in HydraDB, and the reason is worth writing down. The graph in this
 * product is a demo corpus whose exact shape is asserted by a release gate:
 * `npm run census` checks 5,752 vertices against a plan and fails if the count
 * moves. Account records in the same cell would break that gate on the first
 * sign up, and the fix would be to loosen the gate, which is the wrong
 * direction. Accounts are also not context. They are not memory, they have no
 * evidence and no temporal state, and putting them in the context graph would
 * mean the product's own answer surface could retrieve them.
 *
 * So they live in a directory of their own, one JSON object per line, appended.
 * Two files, accounts and sessions, both compacted on load. That is a small
 * store for a small thing: one process, a handful of accounts, no query
 * beyond lookup by key.
 *
 * lacuna: single-process append log with an in-memory index. Move to a real
 * database if this ever runs behind more than one process; the seam is this
 * module and nothing above it changes.
 *
 * When the directory cannot be written, the store reports unavailable rather
 * than pretending. A read-only filesystem is a real deployment, and an auth
 * endpoint that fails plainly there is better than one that appears to work.
 */

export interface Account {
  readonly email: string;
  readonly passwordHash: string;
  /**
   * How ownership of this account was established.
   *
   * Optional only for records written before provider binding existed. Those
   * records remain readable, but an absent value must never be inferred to
   * mean Google: old password accounts and old Google accounts have the same
   * shape. A separate verified linking flow is the only safe migration.
   */
  readonly authProvider?: 'password' | 'google';
  /** Google's stable `sub`, present only on provider-bound Google accounts. */
  readonly providerSubject?: string | null;
  /**
   * Random credential epoch copied into every session minted for this account.
   *
   * Optional only for backward compatibility. An old account and an old
   * session both mean the same legacy epoch; rotating the account to a fresh
   * value immediately invalidates every session that omitted this field.
   */
  readonly sessionVersion?: string;
  /** ISO 8601. */
  readonly createdAt: string;
  /** Null until onboarding names one. */
  readonly workspace: string | null;
  readonly onboarded: boolean;
  /**
   * Argon2id of the recovery code, or null for an account created before
   * recovery existed and for accounts that sign in through Google.
   *
   * Null is a real state rather than a gap to be backfilled: a Google account
   * has no password to reset, and giving it a code would be handing somebody a
   * second credential for an account whose first one lives somewhere else.
   */
  readonly recoveryHash?: string | null;
}

export interface SessionRecord {
  /** SHA-256 of the token. The token itself is never stored. */
  readonly tokenHash: string;
  readonly email: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  /** Account credential epoch at the instant this session was created. */
  readonly sessionVersion?: string;
}

/** Thirty days, the same as the cookie. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_VERSION_SHAPE = /^[A-Za-z0-9_-]{43}$/u;

/** Rotate on credential recovery/change. This value is not a bearer token. */
export function newSessionVersion(): string {
  return randomBytes(32).toString('base64url');
}

const ACCOUNTS_FILE = 'accounts.jsonl';
const SESSIONS_FILE = 'sessions.jsonl';

export class StoreUnavailable extends Error {}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 random bytes, base64url. Long enough that guessing is not a strategy. */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant time compare for two hex digests of equal length. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function readLines(path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn final line from a killed process. Everything before it is good,
      // and dropping it is the only honest thing to do with half a record.
    }
  }
  return out;
}

export function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['email'] === 'string'
    && typeof v['passwordHash'] === 'string'
    && typeof v['createdAt'] === 'string'
    && (v['workspace'] === null || typeof v['workspace'] === 'string')
    && typeof v['onboarded'] === 'boolean'
    && (v['authProvider'] === undefined || v['authProvider'] === 'password' || v['authProvider'] === 'google')
    && (v['providerSubject'] === undefined || v['providerSubject'] === null || (
      typeof v['providerSubject'] === 'string'
      && v['providerSubject'].length > 0
      && v['providerSubject'].length <= 255
    ))
    && (v['authProvider'] !== 'google' || typeof v['providerSubject'] === 'string')
    && (v['authProvider'] !== 'password' || v['providerSubject'] === undefined || v['providerSubject'] === null)
    && (v['sessionVersion'] === undefined || (
      typeof v['sessionVersion'] === 'string' && SESSION_VERSION_SHAPE.test(v['sessionVersion'])
    ))
    // Absent on every account written before recovery codes existed, which is
    // why it is optional rather than required: rejecting those records would
    // lock out the people it is meant to help.
    && (v['recoveryHash'] === undefined || v['recoveryHash'] === null || typeof v['recoveryHash'] === 'string');
}

export function isSession(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['tokenHash'] === 'string'
    && typeof v['email'] === 'string'
    && typeof v['expiresAt'] === 'number'
    && (v['sessionVersion'] === undefined || (
      typeof v['sessionVersion'] === 'string' && SESSION_VERSION_SHAPE.test(v['sessionVersion'])
    ));
}

/** Legacy records match each other until the account epoch is first rotated. */
export function sessionVersionMatches(
  account: Pick<Account, 'sessionVersion'>,
  session: Pick<SessionRecord, 'sessionVersion'>,
): boolean {
  return (account.sessionVersion ?? '') === (session.sessionVersion ?? '');
}

export class AccountStore {
  readonly #dir: string;
  readonly #accounts = new Map<string, Account>();
  readonly #sessions = new Map<string, SessionRecord>();
  #writable = false;

  constructor(dir: string) {
    this.#dir = dir;
    try {
      mkdirSync(dir, { recursive: true });
      this.#writable = true;
    } catch {
      this.#writable = false;
    }
    for (const row of readLines(join(dir, ACCOUNTS_FILE))) {
      if (isAccount(row)) this.#accounts.set(row.email, row);
    }
    const now = Date.now();
    for (const row of readLines(join(dir, SESSIONS_FILE))) {
      if (!isSession(row)) continue;
      if (row.expiresAt <= now) { this.#sessions.delete(row.tokenHash); continue; }
      // An expiry of zero is how a sign out is recorded, so it lands here as a
      // deletion rather than as a record that outlives the log line above it.
      this.#sessions.set(row.tokenHash, row);
    }
  }

  get available(): boolean {
    return this.#writable;
  }

  get accountCount(): number {
    return this.#accounts.size;
  }

  #append(file: string, record: unknown): void {
    if (!this.#writable) throw new StoreUnavailable('the account store is not writable');
    const path = join(this.#dir, file);
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
    } catch (error) {
      this.#writable = false;
      throw new StoreUnavailable(error instanceof Error ? error.message : 'write failed');
    }
  }

  find(email: string): Account | null {
    return this.#accounts.get(email) ?? null;
  }

  /** Null when the email is taken. The caller reports that as a conflict. */
  create(account: Account): Account | null {
    if (this.#accounts.has(account.email)) return null;
    this.#append(ACCOUNTS_FILE, account);
    this.#accounts.set(account.email, account);
    return account;
  }

  update(account: Account): void {
    this.#append(ACCOUNTS_FILE, account);
    this.#accounts.set(account.email, account);
  }

  /**
   * Rewrites the account log with one line per current account. Only called
   * when the log has grown past the point where replaying it is free.
   */
  compact(): void {
    if (!this.#writable) return;
    const lines = [...this.#accounts.values()].map((a) => JSON.stringify(a)).join('\n');
    writeFileSync(join(this.#dir, ACCOUNTS_FILE), lines === '' ? '' : lines + '\n', 'utf8');
  }

  /** Returns the raw token. Only the hash is stored. */
  startSession(email: string, now: number): string {
    const account = this.#accounts.get(email);
    if (account === undefined) throw new StoreUnavailable('cannot start a session for a missing account');
    const token = mintToken();
    const record: SessionRecord = {
      tokenHash: hashToken(token),
      email,
      expiresAt: now + SESSION_TTL_MS,
      ...(account.sessionVersion === undefined ? {} : { sessionVersion: account.sessionVersion }),
    };
    this.#append(SESSIONS_FILE, record);
    this.#sessions.set(record.tokenHash, record);
    return token;
  }

  sessionFor(token: string, now: number): SessionRecord | null {
    const record = this.#sessions.get(hashToken(token));
    if (record === undefined) return null;
    if (record.expiresAt <= now) {
      this.#sessions.delete(record.tokenHash);
      return null;
    }
    const account = this.#accounts.get(record.email);
    if (account === undefined || !sessionVersionMatches(account, record)) {
      this.#sessions.delete(record.tokenHash);
      return null;
    }
    return record;
  }

  endSession(token: string): void {
    const tokenHash = hashToken(token);
    const record = this.#sessions.get(tokenHash);
    if (record === undefined) return;
    this.#sessions.delete(tokenHash);
    // Recorded as an expired line so a replay of the log reaches the same
    // state. A sign out that only lives in memory is not a sign out.
    this.#append(SESSIONS_FILE, { tokenHash, email: record.email, expiresAt: 0 });
  }
}
