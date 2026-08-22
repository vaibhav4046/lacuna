import { createHash } from 'node:crypto';

import type { HydraCloud } from '../hydra/cloud.js';
import {
  AccountStore,
  CredentialChanged,
  StoreUnavailable,
  hashToken,
  isAccount,
  isSession,
  mintToken,
  SESSION_TTL_MS,
  sessionVersionMatches,
  type Account,
  type SessionRecord,
} from './store.js';

/**
 * Where accounts live, as an interface, because there are two answers.
 *
 * Locally the answer is a directory. On the deployment it cannot be: only /tmp
 * is writable there and it does not survive an invocation, so an account
 * created on one request was gone by the next one. That is why every signed-in
 * screen was unreachable in production, and why the product had to be shown
 * through a read-only demo route rather than used.
 *
 * The methods are async because the durable answer is a network call. The file
 * backed one is synchronous underneath and simply resolves; making the
 * interface async is what lets the deployment read an account written by a
 * different instance a moment earlier, which is the whole point.
 */

export interface Accounts {
  /** False when writes cannot be accepted, so the API can say so plainly. */
  available(): Promise<boolean>;
  find(email: string): Promise<Account | null>;
  /** Null when the email is taken. The caller reports that as a conflict. */
  create(account: Account): Promise<Account | null>;
  /** Update display/onboarding metadata without rewriting credential state. */
  updateWorkspace(email: string, workspace: string): Promise<void>;
  update(account: Account): Promise<void>;
  /** Returns the raw token. Only its hash is stored. */
  /** Mint only if the account still has the credential epoch the caller authenticated. */
  startSession(email: string, now: number, expectedSessionVersion: string | undefined): Promise<string>;
  sessionFor(token: string, now: number): Promise<SessionRecord | null>;
  /**
   * Validate a session and return the already-read account in one durable
   * operation. Cloud-backed auth must not read the same account twice merely
   * to render /api/session; implementations without this optimisation keep
   * using sessionFor + find through the router fallback.
   */
  sessionAccountFor?(token: string, now: number): Promise<{ readonly record: SessionRecord; readonly account: Account } | null>;
  endSession(token: string): Promise<void>;
}

/** The local answer: the existing directory-backed store, behind the seam. */
export class FileAccounts implements Accounts {
  readonly #store: AccountStore;

  constructor(store: AccountStore) {
    this.#store = store;
  }

  async available(): Promise<boolean> {
    return this.#store.available;
  }

  async find(email: string): Promise<Account | null> {
    return this.#store.find(email);
  }

  async create(account: Account): Promise<Account | null> {
    return this.#store.create(account);
  }

  async update(account: Account): Promise<void> {
    this.#store.update(account);
  }

  async updateWorkspace(email: string, workspace: string): Promise<void> {
    this.#store.updateWorkspace(email, workspace);
  }

  async startSession(email: string, now: number, expectedSessionVersion: string | undefined): Promise<string> {
    return this.#store.startSession(email, now, expectedSessionVersion);
  }

  async sessionFor(token: string, now: number): Promise<SessionRecord | null> {
    return this.#store.sessionFor(token, now);
  }

  async sessionAccountFor(token: string, now: number): Promise<{ readonly record: SessionRecord; readonly account: Account } | null> {
    const record = this.#store.sessionFor(token, now);
    if (record === null) return null;
    const account = this.#store.find(record.email);
    return account !== null && sessionVersionMatches(account, record) ? { record, account } : null;
  }

  async endSession(token: string): Promise<void> {
    this.#store.endSession(token);
  }
}

/**
 * The durable answer: HydraDB Cloud, addressed by id.
 *
 * A context store is an odd place to keep an account, and the reason it is the
 * right one here is narrow and worth stating. The service is a document store
 * with upsert by an id its writer chooses and fetch by that same id, which is
 * exactly a key-value store; this deployment already authenticates to it; and
 * the alternative was creating another account somewhere to hold six fields.
 *
 * It is kept apart from the context it serves. Accounts live in their own
 * collection, so nothing here is ever retrieved as evidence, and no question a
 * user asks can reach them. What is stored is an email, an Argon2id hash, a
 * workspace name and two timestamps. The password itself is never seen by this
 * class, and the session token is stored only as a SHA-256 hash, so a reader of
 * the collection cannot sign in as anybody.
 */
export class CloudAccounts implements Accounts {
  readonly #cloud: HydraCloud;
  readonly #collection: string;

  constructor(cloud: HydraCloud, collection = 'accounts') {
    this.#cloud = cloud;
    this.#collection = collection;
  }

  /**
   * Ids are derived, never assigned by the service.
   *
   * An address has to be computable from what a request carries — an email or
   * a token — because there is no index to search and a scan would be both
   * slower and a way to enumerate every account.
   */
  #accountId(email: string): string {
    return `lacuna:account:${createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex').slice(0, 32)}`;
  }

  #sessionId(tokenHash: string): string {
    return `lacuna:session:${tokenHash.slice(0, 32)}`;
  }

  #profileId(email: string): string {
    return `lacuna:profile:${createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex').slice(0, 32)}`;
  }

  /**
   * Hydra accepts app-ingest before the record is readable from another
   * invocation. Auth cannot return a session on that acknowledgement alone:
   * the next request would look signed out. Keep the write boundary bounded,
   * then read the exact id until the service exposes it.
   */
  async #waitForWrite(id: string): Promise<void> {
    let delayMs = 25;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        if (await this.#cloud.inspect(id, 1_000, this.#collection) !== null) return;
      } catch {
        // A transient inspect failure is indistinguishable from an index that
        // has not caught up. The bounded loop below still fails closed.
      }
      if (attempt === 5) break;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 400);
    }
    throw new StoreUnavailable('the account write was not readable yet');
  }

  async #read<T>(id: string): Promise<T | null> {
    const source = await this.#cloud.inspect(id, 10_000, this.#collection);
    if (source === null) return null;
    try {
      const envelope = JSON.parse(source.envelope) as { content?: { text?: unknown } };
      const text = envelope.content?.text;
      if (typeof text !== 'string' || text === '') return null;
      return JSON.parse(text) as T;
    } catch {
      // A record that does not parse is not a record. Treating it as absent is
      // the safe reading: it can fail a sign in, never grant one.
      return null;
    }
  }

  async #write(id: string, title: string, value: unknown): Promise<void> {
    const results = await this.#cloud.ingestApp([{
      id,
      title,
      type: 'custom',
      timestamp: new Date().toISOString(),
      text: JSON.stringify(value),
      metadata: { lacuna_record: 'account' },
    }], this.#collection);
    const refused = results.find((result) => result.error !== null && result.error !== '');
    if (refused !== undefined) {
      throw new StoreUnavailable('the account store refused the write');
    }
    await this.#waitForWrite(id);
  }

  async available(): Promise<boolean> {
    try {
      return await this.#cloud.readyForIngestion();
    } catch {
      return false;
    }
  }

  async find(email: string): Promise<Account | null> {
    const value = await this.#read<unknown>(this.#accountId(email));
    if (!isAccount(value)) return null;
    const profile = await this.#read<unknown>(this.#profileId(email));
    if (typeof profile !== 'object' || profile === null) return value;
    const fields = profile as Record<string, unknown>;
    if (typeof fields['workspace'] !== 'string' || fields['workspace'] === '' || fields['onboarded'] !== true) return value;
    return { ...value, workspace: fields['workspace'], onboarded: true };
  }

  async create(account: Account): Promise<Account | null> {
    // Read before write rather than a conditional put, which this service does
    // not offer. This is not safe for public password sign-up: two same-address
    // requests can both succeed and the later upsert can replace credential and
    // recovery hashes. Hosted password sign-up must remain disabled until the
    // identity store can enforce a unique/conditional create.
    if (await this.find(account.email) !== null) return null;
    await this.#write(this.#accountId(account.email), account.email, account);
    return account;
  }

  async update(account: Account): Promise<void> {
    await this.#write(this.#accountId(account.email), account.email, account);
  }

  async updateWorkspace(email: string, workspace: string): Promise<void> {
    // Workspace labels are deliberately isolated from credentials. A request
    // authenticated just before password recovery may finish afterwards, but
    // this record can no longer overwrite the rotated hashes/session epoch.
    await this.#write(this.#profileId(email), 'workspace profile', { workspace, onboarded: true });
  }

  async startSession(email: string, now: number, expectedSessionVersion: string | undefined): Promise<string> {
    const account = await this.find(email);
    if (account === null) throw new StoreUnavailable('cannot start a session for a missing account');
    if ((account.sessionVersion ?? '') !== (expectedSessionVersion ?? '')) {
      throw new CredentialChanged('credentials changed before the session was created');
    }
    const token = mintToken();
    const record: SessionRecord = {
      tokenHash: hashToken(token),
      email,
      expiresAt: now + SESSION_TTL_MS,
      ...(account.sessionVersion === undefined ? {} : { sessionVersion: account.sessionVersion }),
    };
    await this.#write(this.#sessionId(record.tokenHash), 'session', record);
    return token;
  }

  async sessionFor(token: string, now: number): Promise<SessionRecord | null> {
    const tokenHash = hashToken(token);
    const value = await this.#read<unknown>(this.#sessionId(tokenHash));
    if (!isSession(value) || value.tokenHash !== tokenHash) return null;
    const record = value;
    // Expiry is checked here rather than trusted from storage, so a clock the
    // store does not enforce cannot extend a session.
    if (record.expiresAt <= now) return null;
    const account = await this.find(record.email);
    if (account === null || !sessionVersionMatches(account, record)) return null;
    return record;
  }

  /** Validate the token and retain the account read used for epoch checking. */
  async sessionAccountFor(token: string, now: number): Promise<{ readonly record: SessionRecord; readonly account: Account } | null> {
    const tokenHash = hashToken(token);
    const value = await this.#read<unknown>(this.#sessionId(tokenHash));
    if (!isSession(value) || value.tokenHash !== tokenHash || value.expiresAt <= now) return null;
    const account = await this.find(value.email);
    return account !== null && sessionVersionMatches(account, value)
      ? { record: value, account }
      : null;
  }

  async endSession(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    // Overwritten with an expiry in the past rather than deleted: the record
    // is what a later read consults, and one that is gone and one that has
    // expired are the same answer, but only one of them survives a retry.
    await this.#write(this.#sessionId(tokenHash), 'session', { tokenHash, email: '', expiresAt: 0 });
  }
}
