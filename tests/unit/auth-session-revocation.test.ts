import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CloudAccounts, FileAccounts, type Accounts } from '../../src/auth/accounts.js';
import { AccountStore, CredentialChanged, newSessionVersion, type Account } from '../../src/auth/store.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const EMAIL = 'sessions@example.com';
const ACCOUNT: Account = {
  email: EMAIL,
  passwordHash: 'not-a-real-password-hash',
  createdAt: '2026-08-20T00:00:00.000Z',
  workspace: null,
  onboarded: false,
};

class RecordCloud {
  readonly records = new Map<string, string>();

  async inspect(id: string, _timeoutMs: number, collection: string): Promise<InspectedSource | null> {
    const text = this.records.get(`${collection}:${id}`);
    return text === undefined ? null : {
      id,
      envelope: JSON.stringify({ content: { text } }),
      latencyMs: 1,
    };
  }

  async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    for (const record of records) this.records.set(`${collection}:${record.id}`, record.text);
    return records.map((record) => ({
      id: record.id, filename: record.title, status: 'completed', error: null,
    }));
  }
}

class EventuallyConsistentRecordCloud extends RecordCloud {
  #hiddenReads = 0;

  override async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    const result = await super.ingestApp(records, collection);
    this.#hiddenReads += records.length;
    return result;
  }

  override async inspect(id: string, timeoutMs: number, collection: string): Promise<InspectedSource | null> {
    if (this.#hiddenReads > 0) {
      this.#hiddenReads -= 1;
      return null;
    }
    return super.inspect(id, timeoutMs, collection);
  }
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function provesRevocation(accounts: Accounts): Promise<{
  readonly oldSession: string;
  readonly newSession: string;
  readonly now: number;
}> {
  const now = Date.now();
  expect(await accounts.create(ACCOUNT)).not.toBeNull();
  const oldSession = await accounts.startSession(EMAIL, now, ACCOUNT.sessionVersion);
  expect(await accounts.sessionFor(oldSession, now + 1)).not.toBeNull();

  const version = newSessionVersion();
  expect(version).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await accounts.update({ ...ACCOUNT, sessionVersion: version });
  expect(await accounts.sessionFor(oldSession, now + 2)).toBeNull();

  const newSession = await accounts.startSession(EMAIL, now + 3, version);
  await expect(accounts.sessionFor(newSession, now + 4)).resolves.toMatchObject({
    email: EMAIL,
    sessionVersion: version,
  });
  return { oldSession, newSession, now };
}

async function provesStaleAuthenticationCannotMint(accounts: Accounts): Promise<void> {
  const now = Date.now();
  const authenticatedVersion = newSessionVersion();
  const rotatedVersion = newSessionVersion();
  const authenticated: Account = { ...ACCOUNT, sessionVersion: authenticatedVersion };
  expect(await accounts.create(authenticated)).not.toBeNull();

  // This is the interleaving that used to preserve access after recovery:
  // sign-in authenticated one epoch, then recovery rotated it before issue.
  const stale = await accounts.find(EMAIL);
  expect(stale?.sessionVersion).toBe(authenticatedVersion);
  await accounts.update({ ...authenticated, sessionVersion: rotatedVersion });

  await expect(accounts.startSession(EMAIL, now, stale?.sessionVersion))
    .rejects.toBeInstanceOf(CredentialChanged);
}

async function provesWorkspaceUpdateCannotResurrect(accounts: Accounts): Promise<void> {
  const now = Date.now();
  const originalVersion = newSessionVersion();
  const rotatedVersion = newSessionVersion();
  const original: Account = { ...ACCOUNT, sessionVersion: originalVersion };
  expect(await accounts.create(original)).not.toBeNull();
  const oldSession = await accounts.startSession(EMAIL, now, originalVersion);

  // Model a workspace request that authenticated before credential rotation.
  expect((await accounts.find(EMAIL))?.sessionVersion).toBe(originalVersion);
  await accounts.update({ ...original, sessionVersion: rotatedVersion });
  await accounts.updateWorkspace(EMAIL, 'Renamed workspace');

  await expect(accounts.find(EMAIL)).resolves.toMatchObject({
    sessionVersion: rotatedVersion,
    workspace: 'Renamed workspace',
    onboarded: true,
  });
  await expect(accounts.sessionFor(oldSession, now + 1)).resolves.toBeNull();
}

describe('credential-bound session versions', () => {
  it('waits for queued Hydra account writes before minting a session', async () => {
    const accounts = new CloudAccounts(new EventuallyConsistentRecordCloud() as unknown as HydraCloud);
    expect(await accounts.create(ACCOUNT)).not.toBeNull();

    const token = await accounts.startSession(EMAIL, Date.now(), ACCOUNT.sessionVersion);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(accounts.sessionFor(token, Date.now() + 1)).resolves.toMatchObject({ email: EMAIL });
  });

  it('revokes legacy sessions in the file-backed store and survives a restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lacuna-session-version-'));
    directories.push(directory);
    const first = new FileAccounts(new AccountStore(directory));
    const sessions = await provesRevocation(first);

    const reopened = new FileAccounts(new AccountStore(directory));
    await expect(reopened.sessionFor(sessions.oldSession, sessions.now + 5)).resolves.toBeNull();
    await expect(reopened.sessionFor(sessions.newSession, sessions.now + 5)).resolves.toMatchObject({ email: EMAIL });
  });

  it('revokes legacy sessions through independently reloaded Hydra-backed stores', async () => {
    const cloud = new RecordCloud();
    const sessions = await provesRevocation(new CloudAccounts(cloud as unknown as HydraCloud));

    const cold = new CloudAccounts(cloud as unknown as HydraCloud);
    await expect(cold.sessionFor(sessions.oldSession, sessions.now + 5)).resolves.toBeNull();
    await expect(cold.sessionFor(sessions.newSession, sessions.now + 5)).resolves.toMatchObject({ email: EMAIL });
  });

  it('refuses a file-backed session when recovery rotates credentials after authentication', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lacuna-session-race-'));
    directories.push(directory);
    await provesStaleAuthenticationCannotMint(new FileAccounts(new AccountStore(directory)));
  });

  it('refuses a Hydra-backed session when recovery rotates credentials after authentication', async () => {
    await provesStaleAuthenticationCannotMint(new CloudAccounts(new RecordCloud() as unknown as HydraCloud));
  });

  it('does not let a stale file-backed workspace update resurrect a rotated session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lacuna-workspace-race-'));
    directories.push(directory);
    await provesWorkspaceUpdateCannotResurrect(new FileAccounts(new AccountStore(directory)));
  });

  it('does not let a stale Hydra-backed workspace update resurrect a rotated session', async () => {
    await provesWorkspaceUpdateCannotResurrect(new CloudAccounts(new RecordCloud() as unknown as HydraCloud));
  });
});
