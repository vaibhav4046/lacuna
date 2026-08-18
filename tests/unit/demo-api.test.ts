import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { AccountStore } from '../../src/auth/store.js';
import { buildDemo } from '../../src/server/examples.js';

/**
 * The demo workspace, read without an account.
 *
 * /judge is the page a judge or a stranger lands on, and it has no session to
 * hold, so the reads behind it have to answer to nobody. What that must not
 * mean is a hole: these check that the route is read only, that it serves the
 * demo workspace rather than an empty one, and that it did not accidentally
 * become a second way into whatever workspace a cookie happens to name.
 */

let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-demo-'));
  const router = new ApiRouter({
    store: new AccountStore(dir),
    secure: false,
    // The demo route does not touch it, and a doctor that answers keeps the
    // health branch from being the reason a demo assertion fails.
    health: async () => ({ command: 'doctor', ok: true, warnings: 0, exitCode: 0, checks: [] }),
    inventory: buildDemo().inventory,
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    void router.handle(request, response, path).then((outcome) => {
      if (!outcome.handled) {
        response.writeHead(404).end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

interface Suggestion {
  readonly label: string;
  readonly subject: string;
  readonly predicate: string;
}

describe('the demo workspace without a session', () => {
  it('suggests questions drawn from claims the graph holds', async () => {
    const response = await fetch(`${base}/api/demo/questions`);
    const body = (await response.json()) as readonly Suggestion[];

    expect(response.status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    for (const suggestion of body) {
      expect(suggestion.subject).not.toBe('');
      expect(suggestion.predicate).not.toBe('');
    }
  });

  it('suggests a hop whose second entity is actually reachable', async () => {
    const response = await fetch(`${base}/api/demo/hops`);
    const body = (await response.json()) as readonly Suggestion[];
    const inventory = buildDemo().inventory;

    expect(body).toHaveLength(1);
    const hop = body[0];
    if (hop === undefined) throw new Error('no hop suggested');

    // Both ends: the subject names a vendor, and that vendor has a contact.
    // A suggestion that satisfies only the first abstains, correctly, and
    // demonstrates nothing about hopping.
    const vendor = inventory.claims.find((row) => (
      row.subject === hop.subject && row.predicate === 'vendor' && row.state === 'current'
    ));
    expect(vendor).toBeDefined();
    const contact = inventory.claims.find((row) => (
      row.subject === vendor?.objectText && row.predicate === 'contact' && row.state === 'current'
    ));
    expect(contact).toBeDefined();
  });

  it('serves the workspace parts the signed-in route serves', async () => {
    for (const part of ['changes', 'conflicts', 'health', 'memory', 'categories', 'summary']) {
      const response = await fetch(`${base}/api/demo/${part}`);
      expect([part, response.status]).toEqual([part, 200]);
    }
  });

  it('holds the corpus, where the signed-out workspace route holds nothing', async () => {
    const demo = (await (await fetch(`${base}/api/demo/memory`)).json()) as { total: number };
    const signedOut = (await (await fetch(`${base}/api/workspace/memory`)).json()) as { total: number };

    expect(demo.total).toBeGreaterThan(0);
    expect(signedOut.total).toBe(0);
  });

  it('answers 404 for a part that does not exist rather than inventing one', async () => {
    const response = await fetch(`${base}/api/demo/nonsense`);
    expect(response.status).toBe(404);
  });

  it('is read only: a write to it is not a route', async () => {
    const response = await fetch(`${base}/api/demo/questions`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
