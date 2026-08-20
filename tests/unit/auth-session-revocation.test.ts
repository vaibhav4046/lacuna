import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CloudAccounts, FileAccounts, type Accounts } from '../../src/auth/accounts.js';
import { AccountStore, newSessionVersion, type Account } from '../../src/auth/store.js';
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
  const oldSession = await accounts.startSession(EMAIL, now);
  expect(await accounts.sessionFor(oldSession, now + 1)).not.toBeNull();

  const version = newSessionVersion();
  expect(version).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await accounts.update({ ...ACCOUNT, sessionVersion: version });
  expect(await accounts.sessionFor(oldSession, now + 2)).toBeNull();

  const newSession = await accounts.startSession(EMAIL, now + 3);
  await expect(accounts.sessionFor(newSession, now + 4)).resolves.toMatchObject({
    email: EMAIL,
    sessionVersion: version,
  });
  return { oldSession, newSession, now };
}

describe('credential-bound session versions', () => {
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
});
