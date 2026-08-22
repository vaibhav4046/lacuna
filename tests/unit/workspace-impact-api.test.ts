import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { workspaceCollection } from '../../src/api/ingest.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore } from '../../src/auth/store.js';
import type { HydraImpactReadPort } from '../../src/hydra/impact-read.js';
import type { Read } from '../../src/hydra/source.js';
import type { SubjectView } from '../../src/retrieval/types.js';

const SITE_ORIGIN = 'https://lacuna.example';
const PASSWORD = 'correct horse battery';

class Jar {
  readonly values = new Map<string, string>();
  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const at = pair.indexOf('=');
      if (at < 0) continue;
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '') this.values.delete(name); else this.values.set(name, value);
    }
  }
  cookie(): string { return [...this.values].map(([name, value]) => `${name}=${value}`).join('; '); }
  csrf(): string { return decodeURIComponent(this.values.get('lacuna_csrf') ?? ''); }
}

function subject(name: string): SubjectView {
  return {
    name,
    id: 1,
    kind: 'service',
    claims: [{
      id: 1, predicate: 'depends_on', objectText: 'Target', polarity: 'positive',
      validFrom: '2026-01-01T00:00:00.000Z', txTime: '2026-01-01T00:00:00.000Z', supersededBy: [],
    }],
    mentions: [{ claimId: 1, predicate: 'depends_on', entityId: 2, entityName: 'Target' }],
  };
}

function read<T>(value: T): Read<T> { return { value, traces: [] }; }

let server: Server;
let base: string;
let dir: string;
let collections: string[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-impact-api-'));
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(dir)),
    secure: false,
    health: null,
    siteOrigin: SITE_ORIGIN,
    impact: (collection) => {
      if (collection !== undefined) collections.push(collection);
      const port: HydraImpactReadPort = {
        queryForImpact: async () => ({
          chunks: [],
          relations: [{ relationshipId: 'r1', source: 'Root', target: 'Target', predicate: 'uses', chunkId: null, context: 'Root uses Target.' }],
        }),
        relationsForImpact: async () => [],
        subjectForImpact: async (name) => read(subject(name)),
      };
      return port;
    },
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path).then((outcome) => {
      if (!outcome.handled && !response.writableEnded) response.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

async function request(jar: Jar, path: string, method = 'GET', body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json', cookie: jar.cookie(), origin: SITE_ORIGIN,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = jar.csrf();
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  jar.absorb(response);
  return response;
}

describe('private Hydra impact route', () => {
  it('rejects anonymous and malformed subjects before constructing the scoped reader', async () => {
    collections = [];
    const anonymous = await request(new Jar(), '/api/workspace/impact?subject=Root');
    expect(anonymous.status).toBe(401);
    const jar = new Jar();
    await request(jar, '/api/session');
    const signup = await request(jar, '/api/auth/signup', 'POST', { email: 'impact@example.com', password: PASSWORD });
    expect(signup.status).toBe(201);
    expect((await request(jar, '/api/workspace/impact')).status).toBe(422);
    expect((await request(jar, '/api/workspace/impact?subject=Root&collection=other')).status).toBe(422);
    expect(collections).toEqual([]);
  });

  it('derives the collection from the authenticated account and returns bounded proof', async () => {
    collections = [];
    const jar = new Jar();
    await request(jar, '/api/session');
    expect((await request(jar, '/api/auth/signup', 'POST', { email: 'scope@example.com', password: PASSWORD })).status).toBe(201);
    const response = await request(jar, '/api/workspace/impact?subject=Root');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = await response.json() as { available: boolean; subject: string; accepted: readonly unknown[] };
    expect(body).toMatchObject({ available: true, subject: 'Root' });
    expect(body.accepted).toHaveLength(1);
    expect(collections).toEqual([workspaceCollection('scope@example.com')]);
  });
});
