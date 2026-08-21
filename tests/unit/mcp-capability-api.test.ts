import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import {
  MCP_CAPABILITY_TTL_MS,
  type IssuedMcpCapability,
  type McpCapabilities,
} from '../../src/auth/mcp-capability-store.js';
import { MCP_CAPABILITY_SHAPE, mintMcpCapability } from '../../src/auth/mcp-capability.js';
import { AccountStore } from '../../src/auth/store.js';
import { workspaceCollection } from '../../src/api/ingest.js';

class MemoryCapabilities implements McpCapabilities {
  readonly records = new Map<string, {
    workspace: string;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>();

  async issue(workspace: string, now = Date.now()): Promise<IssuedMcpCapability> {
    const capability = mintMcpCapability();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + MCP_CAPABILITY_TTL_MS).toISOString();
    this.records.set(capability, { workspace, createdAt, expiresAt, revokedAt: null });
    return { capability, workspace, createdAt, expiresAt };
  }

  async resolve(capability: string, now = Date.now()): Promise<string | null> {
    const record = this.records.get(capability);
    return record === undefined || record.revokedAt !== null
      || now < Date.parse(record.createdAt) || now >= Date.parse(record.expiresAt)
      ? null
      : record.workspace;
  }

  async revoke(capability: string, now = Date.now()): Promise<boolean> {
    const record = this.records.get(capability);
    if (record === undefined || record.revokedAt !== null
      || now < Date.parse(record.createdAt) || now >= Date.parse(record.expiresAt)) return false;
    this.records.set(capability, { ...record, revokedAt: new Date(now).toISOString() });
    return true;
  }
}

class Jar {
  readonly values = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === '') this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

let server: Server;
let base: string;
let directory: string;
let capabilities: MemoryCapabilities;
let clock: number;

async function post(jar: Jar, path: string, body: unknown, csrf = true): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      ...(csrf ? { 'x-csrf-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  jar.absorb(response);
  return response;
}

async function signedIn(email = 'mcp-owner@example.com'): Promise<Jar> {
  const jar = new Jar();
  const session = await fetch(`${base}/api/session`);
  jar.absorb(session);
  const signup = await post(jar, '/api/auth/signup', { email, password: 'correct horse battery staple' });
  expect(signup.status).toBe(201);
  return jar;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-mcp-cap-api-'));
  capabilities = new MemoryCapabilities();
  clock = Date.UTC(2026, 7, 20, 12, 0, 0);
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(directory)),
    secure: false,
    health: null,
    mcpCapabilities: capabilities,
    now: () => clock,
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('workspace MCP capability API', () => {
  it('mints a random bearer for the session-derived workspace and never returns that workspace id', async () => {
    const jar = await signedIn();
    const response = await post(jar, '/api/workspace/mcp/capabilities', {});

    expect(response.status).toBe(201);
    const body = await response.json() as {
      capability: string;
      createdAt: string;
      expiresAt: string;
      endpoint: string;
      workspace?: string;
    };
    expect(body.capability).toMatch(MCP_CAPABILITY_SHAPE);
    expect(body.createdAt).toBe(new Date(clock).toISOString());
    expect(body.expiresAt).toBe(new Date(clock + MCP_CAPABILITY_TTL_MS).toISOString());
    expect(body.endpoint).toBe('/mcp');
    expect(body.workspace).toBeUndefined();
    await expect(capabilities.resolve(body.capability, clock)).resolves.toBe(workspaceCollection('mcp-owner@example.com'));
  });

  it('requires CSRF and refuses to revoke a capability belonging to another workspace', async () => {
    const jar = await signedIn();
    const foreign = await capabilities.issue(workspaceCollection('somebody-else@example.com'), clock);

    expect((await post(jar, '/api/workspace/mcp/capabilities/revoke', {
      capability: foreign.capability,
    }, false)).status).toBe(403);
    expect((await post(jar, '/api/workspace/mcp/capabilities/revoke', {
      capability: foreign.capability,
    })).status).toBe(404);
    await expect(capabilities.resolve(foreign.capability, clock)).resolves.toBe(workspaceCollection('somebody-else@example.com'));
  });

  it('revokes its own bearer and rejects body smuggling', async () => {
    const jar = await signedIn();
    const issued = await post(jar, '/api/workspace/mcp/capabilities', {});
    const body = await issued.json() as { capability: string };

    expect((await post(jar, '/api/workspace/mcp/capabilities/revoke', {
      capability: body.capability,
      workspace: workspaceCollection('somebody-else@example.com'),
    })).status).toBe(422);
    expect((await post(jar, '/api/workspace/mcp/capabilities/revoke', {
      capability: body.capability,
    })).status).toBe(204);
    await expect(capabilities.resolve(body.capability, clock)).resolves.toBeNull();
  });

  it('refuses to revoke a capability once its explicit lifetime has elapsed', async () => {
    const jar = await signedIn();
    const issued = await post(jar, '/api/workspace/mcp/capabilities', {});
    const body = await issued.json() as { capability: string; expiresAt: string };
    clock = Date.parse(body.expiresAt);
    // Sessions and MCP capabilities both default to 30 days. Refresh the
    // account session so this request exercises capability expiry, not the
    // earlier session guard.
    const signedInAgain = await post(jar, '/api/auth/signin', {
      email: 'mcp-owner@example.com',
      password: 'correct horse battery staple',
    });
    expect(signedInAgain.status).toBe(200);

    const response = await post(jar, '/api/workspace/mcp/capabilities/revoke', {
      capability: body.capability,
    });
    expect(response.status).toBe(404);
    await expect(capabilities.resolve(body.capability, clock)).resolves.toBeNull();
    expect(capabilities.records.get(body.capability)?.revokedAt).toBeNull();
  });

  it('bounds capability issuance per workspace and returns Retry-After', async () => {
    const jar = await signedIn();
    const responses: Response[] = [];
    for (let index = 0; index < 7; index += 1) {
      responses.push(await post(jar, '/api/workspace/mcp/capabilities', {}));
    }

    expect(responses.slice(0, 6).every((response) => response.status === 201)).toBe(true);
    expect(responses[6]?.status).toBe(429);
    expect(Number(responses[6]?.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
