import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { AccountStore } from '../../src/auth/store.js';
import { FileAccounts } from '../../src/auth/accounts.js';
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
    store: new FileAccounts(new AccountStore(dir)),
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

  it('labels the bundled demo corpus without claiming a live HydraDB connection', async () => {
    const response = await fetch(`${base}/api/explore/connections`);
    const body = await response.json() as readonly { readonly n: string; readonly st: string }[];

    expect(response.status).toBe(200);
    expect(body).toEqual([{ n: 'HydraDB', st: 'STATIC CORPUS' }]);
    expect(body.some((connection) => connection.st === 'CONNECTED')).toBe(false);
  });

  it('publishes only the redacted connector catalogue to signed-out users', async () => {
    const response = await fetch(`${base}/api/explore/connectors`);
    const body = await response.json() as {
      readonly connectors: readonly Record<string, unknown>[];
    };

    expect(response.status).toBe(200);
    expect(body.connectors).toHaveLength(9);
    for (const connector of body.connectors) {
      expect(Object.keys(connector).sort()).toEqual(['availability', 'group', 'id', 'label', 'reason']);
      expect(connector['id']).not.toBe('');
      expect(connector['label']).not.toBe('');
      expect(JSON.stringify(connector)).not.toMatch(/email|workspace|configuredAt|importedDocuments/iu);
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

  it('reports the graph walk as unavailable where no store was given one', async () => {
    const body = (await (await fetch(`${base}/api/demo/expansion`)).json()) as ExpansionReply;
    expect(body.available).toBe(false);
    expect(body.relations).toEqual([]);
  });

  it('serves the full public graph through bounded opaque pages', async () => {
    const first = await fetch(`${base}/api/explore/graph?mode=proof&limit=17`);
    const page = (await first.json()) as {
      schema: string;
      mode: string;
      scope: string;
      nodes: readonly unknown[];
      page: { limit: number; totalNodes: number; nextCursor: string | null };
    };

    expect(first.status).toBe(200);
    expect(page).toMatchObject({ schema: 'lacuna.graph.v1', mode: 'proof', scope: 'public' });
    expect(page.nodes).toHaveLength(17);
    expect(page.page.limit).toBe(17);
    expect(page.page.totalNodes).toBeGreaterThan(17);
    expect(page.page.nextCursor).toEqual(expect.any(String));
    expect(page.page.nextCursor).not.toContain('acme');

    const second = await fetch(`${base}/api/explore/graph?mode=proof&limit=17&cursor=${encodeURIComponent(page.page.nextCursor ?? '')}`);
    expect(second.status).toBe(200);
    const secondPage = (await second.json()) as { nodes: readonly { id: string }[] };
    expect(secondPage.nodes).toHaveLength(17);
  });

  it('rejects unbounded or malformed graph query controls', async () => {
    expect((await fetch(`${base}/api/explore/graph?mode=decorative`)).status).toBe(422);
    expect((await fetch(`${base}/api/explore/graph?limit=0`)).status).toBe(422);
    expect((await fetch(`${base}/api/explore/graph?limit=201`)).status).toBe(422);
    expect((await fetch(`${base}/api/explore/graph?cursor=forged.cursor`)).status).toBe(400);
  });
});

interface ExpansionReply {
  readonly available: boolean;
  readonly reason?: string;
  readonly subject: string | null;
  readonly relations: readonly {
    readonly id: string | null;
    readonly source: string | null;
    readonly target: string | null;
    readonly standing: string;
  }[];
}

/**
 * The store's own graph, walked, beside the claim graph.
 *
 * The walk itself is HydraDB's and costs seconds, so it is stubbed here and the
 * network is not touched. What is under test is the part this repository owns:
 * which subject gets walked, and whether each edge the store reached is set
 * against the right state in the claim graph. The rows below are the shape a
 * real answer returned for the corrected subject.
 */
describe('the graph walk set beside the claim graph', () => {
  let walkServer: Server;
  let walkBase: string;
  let walkDir: string;
  let asked: string[] = [];
  const inventory = buildDemo().inventory;
  const corrected = inventory.claims.find(
    (row) => row.state === 'historical' && row.predicate === 'depends_on',
  );

  function relation(target: string, id: string) {
    return {
      id,
      source: corrected?.subject ?? null,
      sourceType: 'PRODUCT',
      target,
      targetType: 'PRODUCT',
      predicate: 'depends on',
      confidence: null,
      context: `${corrected?.subject ?? 'it'} depends on ${target}.`,
    };
  }

  beforeAll(async () => {
    walkDir = mkdtempSync(join(tmpdir(), 'lacuna-walk-'));
    const current = inventory.claims.find(
      (row) => row.subject === corrected?.subject
        && row.predicate === 'depends_on'
        && row.state === 'current',
    );
    const router = new ApiRouter({
      store: new FileAccounts(new AccountStore(walkDir)),
      secure: false,
      health: null,
      inventory,
      expansion: async (subject: string) => {
        asked.push(subject);
        return [
          relation(current?.objectText ?? 'unknown', 'r-current'),
          // Lowercased, as the store returns its extracted names.
          relation((corrected?.objectText ?? 'unknown').toLowerCase(), 'r-replaced'),
          relation('a package no claim joins to this subject', 'r-unstated'),
        ];
      },
    });
    walkServer = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      void router.handle(request, response, path).then((outcome) => {
        if (!outcome.handled) response.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((resolve) => walkServer.listen(0, '127.0.0.1', resolve));
    const address = walkServer.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    walkBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => walkServer.close(() => resolve()));
    rmSync(walkDir, { recursive: true, force: true });
  });

  it('walks a subject the corpus corrected, not one written down here', async () => {
    asked = [];
    const body = (await (await fetch(`${walkBase}/api/demo/expansion`)).json()) as ExpansionReply;

    expect(corrected).toBeDefined();
    expect(body.available).toBe(true);
    expect(body.subject).toBe(corrected?.subject);
    expect(asked).toEqual([corrected?.subject]);
  });

  it('marks the replaced edge historical and the live one current', async () => {
    const body = (await (await fetch(`${walkBase}/api/demo/expansion`)).json()) as ExpansionReply;
    const standing = new Map(body.relations.map((row) => [row.id, row.standing]));

    expect(standing.get('r-current')).toBe('current');
    expect(standing.get('r-replaced')).toBe('historical');
  });

  it('calls an edge unstated rather than wrong where no claim joins the pair', async () => {
    const body = (await (await fetch(`${walkBase}/api/demo/expansion`)).json()) as ExpansionReply;
    const unstated = body.relations.find((row) => row.id === 'r-unstated');

    expect(unstated?.standing).toBe('unstated');
  });

  it('is read only: a write to the walk is not a route', async () => {
    const response = await fetch(`${walkBase}/api/demo/expansion`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

/** A store that does not answer is an unavailable walk, not a failed request. */
describe('a graph walk the store refuses', () => {
  let brokenServer: Server;
  let brokenBase: string;
  let brokenDir: string;

  beforeAll(async () => {
    brokenDir = mkdtempSync(join(tmpdir(), 'lacuna-walk-broken-'));
    const router = new ApiRouter({
      store: new FileAccounts(new AccountStore(brokenDir)),
      secure: false,
      health: null,
      inventory: buildDemo().inventory,
      expansion: async () => {
        throw new Error('the token is wrong, and this message must not travel');
      },
    });
    brokenServer = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      void router.handle(request, response, path).then((outcome) => {
        if (!outcome.handled) response.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((resolve) => brokenServer.listen(0, '127.0.0.1', resolve));
    const address = brokenServer.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    brokenBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => brokenServer.close(() => resolve()));
    rmSync(brokenDir, { recursive: true, force: true });
  });

  it('answers unavailable, and never repeats what the store said', async () => {
    const response = await fetch(`${brokenBase}/api/demo/expansion`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('token');
    expect((JSON.parse(text) as ExpansionReply).available).toBe(false);
  });
});

/**
 * The one screen that starts before the graph exists.
 *
 * Everything else in the product reads a graph built from annotations. This
 * route runs the extractor over prose, so these check the three things that
 * separate a claim graph from a pile of sentences: a later statement replaces
 * an earlier one, a suggestion never files onto the plain predicate, and a
 * forged instruction changes nothing.
 */
describe('prose into the claim graph, over HTTP', () => {
  /**
   * A transcript goes in a body, never in a URL. A query string is written to
   * access logs, kept by proxies and saved in browser history, and somebody
   * pasting a real conversation in has no reason to expect any of that.
   */
  const post = (text: string): Promise<Response> => fetch(`${base}/api/demo/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  it('refuses to read a transcript out of the query string', async () => {
    const leaked = encodeURIComponent('a: sessions are stored in Cassandra.');
    const body = await (await fetch(`${base}/api/demo/extract?text=${leaked}`)).json() as {
      claims: { objectText: string }[];
    };
    // The built in transcript comes back instead, so a URL cannot smuggle text
    // through and cannot be mistaken for a supported way to call this.
    expect(body.claims.some((claim) => claim.objectText === 'Cassandra')).toBe(false);
  });

  it('reads the built in transcript and reports what it made of it', async () => {
    const response = await fetch(`${base}/api/demo/extract`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      turns: number; sentences: number; unread: number; truncated: boolean;
      claims: { subject: string; predicate: string; property: string; mode: string; stating: boolean; objectText: string; supersedes: string | null; quote: string }[];
    };

    expect(body.turns).toBe(7);
    expect(body.truncated).toBe(false);
    // Most prose says nothing a graph can hold, and the count is reported
    // rather than hidden.
    expect(body.sentences).toBeGreaterThan(body.claims.length);

    const stated = body.claims.filter((claim) => claim.stating);
    expect(stated.length).toBeGreaterThan(0);
    // Every span is a quotation from the transcript, not a paraphrase.
    for (const claim of body.claims) expect(claim.quote.length).toBeGreaterThan(0);
  });

  it('replaces the earlier value when the later turn reports the change', async () => {
    const body = await (await fetch(`${base}/api/demo/extract`)).json() as {
      claims: { predicate: string; objectText: string; supersedes: string | null; key: string }[];
    };
    const storage = body.claims.filter((claim) => claim.predicate === 'storage');
    expect(storage.map((claim) => claim.objectText)).toEqual(['Postgres', 'Redis']);
    expect(storage[0]?.supersedes).toBeNull();
    expect(storage[1]?.supersedes).toBe(storage[0]?.key);
  });

  it('keeps a suggestion off the predicate an answer is read from', async () => {
    const body = await (await fetch(`${base}/api/demo/extract`)).json() as {
      claims: { predicate: string; property: string; mode: string; stating: boolean }[];
    };
    const proposals = body.claims.filter((claim) => claim.mode === 'PROPOSAL');
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(proposal.stating).toBe(false);
      // It is filed, and it is filed somewhere the resolver structurally
      // cannot read as current state.
      expect(proposal.predicate).not.toBe(proposal.property);
      expect(proposal.predicate.startsWith(`${proposal.property}:`)).toBe(true);
    }
  });

  it('extracts prose a reader supplies, and caps how much it will read', async () => {
    const body = await (await post('dana: The billing service is owned by Rae.')).json() as {
      turns: number; truncated: boolean; readableProperties: string[]; claims: { subject: string; objectText: string }[];
    };
    expect(body.turns).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.claims.some((claim) => claim.objectText === 'Rae')).toBe(true);
    // The response says what it can read, so prose about anything else comes
    // back empty for a stated reason rather than looking broken.
    expect(body.readableProperties).toContain('owner');

    const long = await (await post('a: x is y. '.repeat(600))).json() as { truncated: boolean };
    expect(long.truncated).toBe(true);
  });

  it('reads eleven sentence shapes and not English, and says so', async () => {
    const body = await (await post('dana: The billing service is written in Rust.')).json() as {
      claims: unknown[]; readableProperties: string[];
    };
    // The honest ceiling, pinned. This sentence states a fact a reader would
    // understand and the frame table has no shape for, so nothing is emitted
    // rather than something guessed.
    expect(body.claims).toEqual([]);
    expect(body.readableProperties.length).toBeGreaterThan(0);
    expect(body.readableProperties).not.toContain('language');
  });

  it('hands markup back as text and never as a field the page could run', async () => {
    // The endpoint is public and unauthenticated and its output is rendered, so
    // the payload has to survive as data. Verified in the browser as well:
    // window.__pwned stayed null, no img element was created, and the CSP
    // allows script-src 'self' only. This pins the server half of that.
    const payload = 'a: <script>window.x=1</script> is owned by <img src=x onerror=1>.';
    const body = await (await post(payload)).json() as {
      claims: { objectText: string; quote: string }[];
      sentences: number;
    };

    // Nothing in it becomes a claim. A name does not contain angle brackets or
    // a pipe, which is also what keeps a chat template's control tokens from
    // being filed as an entity, and that is a stronger guarantee than returning
    // the markup safely: it is never a fact about anything in the first place.
    expect(body.claims).toEqual([]);
    // The sentence was still read, so this is a refusal rather than a parser
    // that fell over on the input.
    expect(body.sentences).toBeGreaterThan(0);
  });

  it('answers rather than falls over on very long, unicode and empty input', async () => {
    const long = `a: ${'x'.repeat(3000)} is stored in y.`;
    const cases = [long, 'a: \u{1D54A}essions are stored in Valhalla.', ''];
    for (const text of cases) {
      const response = await post(text);
      expect(response.status).toBe(200);
      const body = await response.json() as { claims: unknown[] };
      expect(Array.isArray(body.claims)).toBe(true);
    }
  });

  it('writes nothing, so the workspace is unchanged after a call', async () => {
    const before = await (await fetch(`${base}/api/demo/memory`)).text();
    await post('a: sessions are stored in Cassandra.');
    const after = await (await fetch(`${base}/api/demo/memory`)).text();
    expect(after).toBe(before);
  });
});

/**
 * The public endpoints answer to nobody, which is what makes them
 * demonstrable and what makes them the cheapest thing to point a script at.
 * None of them writes, so the exposure is spend and availability.
 */
describe('what one address may spend', () => {
  it('refuses a flood of extractions with 429 rather than serving them', async () => {
    const post = (): Promise<Response> => fetch(`${base}/api/demo/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a: Sessions are stored in Redis.' }),
    });

    let limited = 0;
    let served = 0;
    for (let i = 0; i < 80; i += 1) {
      const response = await post();
      if (response.status === 429) limited += 1;
      else if (response.status === 200) served += 1;
      await response.arrayBuffer();
    }

    // A budget is only a budget if it runs out.
    expect(served).toBeGreaterThan(0);
    expect(limited).toBeGreaterThan(0);
  });
});

/**
 * The proof board answers the same way whoever is reading it.
 *
 * `/api/ask` scopes to the signed-in workspace, which is right for the product
 * and wrong for a public board: a visitor who happened to have a session was
 * shown NO EVIDENCE on every row of the page whose whole purpose is answering.
 */
describe('the public board asks the corpus that ships here', () => {
  const ask = (subject: string, predicate: string): Promise<Response> =>
    fetch(`${base}/api/demo/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, predicate }),
    });

  it('takes a question with no session and no CSRF token', async () => {
    const suggestions = await (await fetch(`${base}/api/demo/questions`)).json() as
      { subject: string; predicate: string }[];
    const first = suggestions[0];
    expect(first).toBeDefined();

    const response = await ask(first!.subject, first!.predicate);
    // This harness wires no context store, so 503 is the honest answer here and
    // is what proves the route is reached rather than rejected: a CSRF failure
    // would be 403 and a missing route would be 404.
    expect([200, 503]).toContain(response.status);
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(404);

    if (response.status === 200) {
      const body = await response.json() as { abstain_reason: string | null };
      // The subject came out of this same corpus one call earlier.
      expect(body.abstain_reason).not.toBe('out_of_scope');
    }
  });

  it('refuses a malformed question as a request error, not an outage', async () => {
    const response = await ask('', 'storage');
    expect(response.status).toBe(422);
    const body = await response.json() as { status: string; abstain_reason: string };
    expect(body.status).toBe('INVALID_REQUEST');
    expect(body.abstain_reason).toBe('subject_required');
  });
});

/** The public proof corpus exposes accepted runs but never creates new ones. */
describe('the read-only public agent preview', () => {
  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('refuses an anonymous run before provider or body processing', async () => {
    const response = await post('/api/explore/agent/run', { task: 'What is the storage?' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'public_preview_read_only' });
  });

  it('keeps the old public name read only too', async () => {
    expect((await post('/api/demo/agent/run', { task: 'anything' })).status).toBe(403);
  });

  it('is not a GET', async () => {
    expect((await fetch(`${base}/api/explore/agent/run`)).status).toBe(404);
  });
});
