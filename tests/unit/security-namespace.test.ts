import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { HydraClient } from '../../src/hydra/client.js';
import type { HydraConfig } from '../../src/hydra/config.js';
import { loadArtifacts } from '../../src/report/load.js';
import { buildDemo } from '../../src/server/examples.js';
import { FixedWindow } from '../../src/server/ratelimit.js';
import { createHandler } from '../../src/server/server.js';
import type { CorpusFacts, Example } from '../../src/view/home.js';
import type { NodeIdentity } from '../../src/view/proof.js';

/**
 * T2 from docs/THREAT_MODEL.md: one user's memory surfacing in another's answer.
 *
 * The threat model used to promise a different test than this one. It said a
 * test would write into namespace A, read from namespace B, and assert zero rows
 * plus an abstention rather than an error. Two things were wrong with that. The
 * abstention reason it named does not exist in the code, and the behaviour it
 * predicted is not what the node does: probe `X04` sent a valid token with a
 * foreign namespace header and got **403**, which is an error and not zero rows.
 * Writing the test would have meant writing it against the documentation instead
 * of against the system, so the documentation moved.
 *
 * What is left is sharper anyway, because HydraDB refusing the crossing is
 * HydraDB's property and was already recorded. The part that belongs to Lacuna
 * is that its own code cannot be talked into asking for another namespace in the
 * first place, and that is a property of this server rather than of the node:
 *
 *   1. The namespace on the wire is a function of server configuration alone.
 *      `src/hydra/client.ts` builds the header block from `#config` and there is
 *      no per-call override, so the way this could break is not a bad default
 *      but a future request field reaching it.
 *   2. Nothing a client sends reaches it. `route()` reads three query parameters
 *      and no headers at all, so a header naming another tenant is inert.
 *   3. When the node does refuse, the refusal is surfaced as a failure. It is
 *      never rendered as an answer, never as an empty result that reads like
 *      "there is nothing here", and the engine's message is not put on the page,
 *      because that message names both namespaces.
 *
 * The first two are asserted by watching what leaves the process rather than by
 * inspecting configuration, which is why this drives the real handler over a
 * real socket with a real `HydraClient` behind a fake transport.
 */

/*
 * The real inventory, not a fixture. It costs under a tenth of a second to
 * build and it is what the Memory and Health pages render, so a route test
 * that used a hand written stand in would be testing a page the product never
 * serves.
 */
const INVENTORY = buildDemo().inventory;

const CONFIG: HydraConfig = {
  baseUrl: 'http://127.0.0.1:18443',
  namespace: 'tenant-a',
  graph: 'default',
  cell: 'cell-0',
  // Not a credential. It is here so the tests can assert it never reaches a page.
  token: 'token-that-must-never-be-rendered',
};

const NODE: NodeIdentity = {
  namespace: CONFIG.namespace,
  graph: CONFIG.graph,
  cell: CONFIG.cell,
};

/** The tenant every hostile request in this file is trying to reach. */
const FOREIGN = 'tenant-b';

const EXAMPLE: Example = {
  kind: 'stable',
  text: 'What is the launch date of Meridian?',
  subject: 'Meridian',
  predicate: 'launch_date',
  via: null,
};

const FACTS: CorpusFacts = {
  sessions: 72,
  messages: 5_268,
  claims: 118,
  entities: 66,
  estimatedTokens: 117_395,
  seed: 'lacuna-demo-v1',
};

interface Sent {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A well formed page with nothing in it, which is what a name miss looks like. */
function emptyPage(): Response {
  return new Response(
    JSON.stringify({
      query_id: 'test-query',
      columns: ['id', 'kind'],
      rows: [],
      read_epoch: 7,
      next_cursor: null,
      bookmark: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * The response the running node actually gave, copied from the recorded probe
 * rather than imagined. `artifacts/cypher-probe/round4-results.json`, probe X04.
 */
function permissionDenied(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'permission_denied',
        message: `principal bearer principal is not authorized to read graph scope `
          + `${FOREIGN}/graphs/default`,
      },
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
}

interface Harness {
  readonly origin: string;
  readonly sent: Sent[];
  readonly close: () => Promise<void>;
}

const open: Harness[] = [];

async function start(upstream: () => Response = emptyPage): Promise<Harness> {
  const sent: Sent[] = [];

  const client = new HydraClient(CONFIG, {
    fetch: (input, init) => {
      sent.push({
        url: String(input),
        headers: { ...(init.headers as Record<string, string>) },
        body: String(init.body ?? ''),
      });
      return Promise.resolve(upstream());
    },
  });

  const handler = createHandler({
    client,
    node: NODE,
    examples: [EXAMPLE],
    facts: FACTS,
    inventory: INVENTORY,
    artifacts: loadArtifacts(),
    limiter: new FixedWindow({ limit: 1_000, windowMs: 1_000, maxKeys: 8 }),
    log: (): void => {},
  });

  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server did not bind a port');
  }

  const harness: Harness = {
    origin: `http://127.0.0.1:${address.port}`,
    sent,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    }),
  };
  open.push(harness);
  return harness;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((harness) => harness.close()));
});

/**
 * Headers a client can set that name another tenant, or that a server might
 * plausibly have been written to trust.
 *
 * `x-forwarded-for` is in here for the same reason as the rest even though it is
 * not a namespace: it is a client-chosen string, the rate limiter is keyed on
 * source address, and a limiter that believed this header would let one caller
 * spend everybody's budget. `src/server/server.ts` says why it reads the socket
 * instead, and this asserts the header does not travel either.
 */
const HOSTILE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'x-graph-namespace': FOREIGN,
  'X-Graph-Namespace': FOREIGN,
  'x-graph-cell': 'cell-9',
  'x-lacuna-namespace': FOREIGN,
  'x-forwarded-for': '10.0.0.1',
  'x-forwarded-host': `${FOREIGN}.example.invalid`,
  'authorization': 'Bearer a-token-the-client-chose',
  'cookie': `namespace=${FOREIGN}`,
  'origin': `http://${FOREIGN}.example.invalid`,
  'referer': `http://${FOREIGN}.example.invalid/`,
});

/** Question shapes that try to carry a namespace in a field that is read. */
const HOSTILE_QUERIES: readonly { readonly name: string; readonly path: string }[] =
  Object.freeze([
    {
      name: 'an ordinary question',
      path: '/ask?subject=Meridian&predicate=launch_date',
    },
    {
      name: 'a subject naming the other tenant',
      path: `/ask?subject=${FOREIGN}&predicate=launch_date`,
    },
    {
      name: 'a subject shaped like a graph scope',
      path: `/ask?subject=${encodeURIComponent(`${FOREIGN}/graphs/default`)}&predicate=vendor`,
    },
    {
      name: 'a predicate shaped like a header',
      path: `/ask?subject=Meridian&predicate=${encodeURIComponent(`x-graph-namespace: ${FOREIGN}`)}`,
    },
    {
      name: 'a via naming the other tenant',
      path: `/ask?subject=Meridian&predicate=contact&via=${encodeURIComponent(FOREIGN)}`,
    },
    {
      name: 'traversal in the subject',
      path: `/ask?subject=${encodeURIComponent(`../../${FOREIGN}`)}&predicate=vendor`,
    },
    {
      name: 'a query parameter that names the namespace directly',
      path: `/ask?subject=Meridian&predicate=vendor&namespace=${FOREIGN}`,
    },
    {
      name: 'a repeated parameter, in case the last one wins somewhere',
      path: `/ask?subject=Meridian&subject=${FOREIGN}&predicate=vendor`,
    },
  ]);

describe('the namespace on the wire', () => {
  for (const query of HOSTILE_QUERIES) {
    it(`is the configured one for ${query.name}`, async () => {
      const harness = await start();

      const response = await fetch(`${harness.origin}${query.path}`, {
        headers: HOSTILE_HEADERS,
      });
      expect(response.status).toBe(200);
      await response.text();

      expect(harness.sent.length).toBeGreaterThan(0);
      for (const request of harness.sent) {
        expect(request.headers['X-Graph-Namespace']).toBe(CONFIG.namespace);
        expect(request.url).toBe(
          `${CONFIG.baseUrl}/v1/graphs/${CONFIG.graph}/query`,
        );
      }
    });
  }

  it('travels in exactly three headers, none of them from the client', async () => {
    const harness = await start();

    await (await fetch(`${harness.origin}/ask?subject=Meridian&predicate=vendor`, {
      headers: HOSTILE_HEADERS,
    })).text();

    expect(harness.sent.length).toBe(1);
    const [request] = harness.sent;

    // Named exhaustively rather than checked for absence of the hostile set. A
    // header this server does not send today cannot be enumerated by a test
    // written today, so the assertion has to be that the set is closed.
    expect(Object.keys(request!.headers).sort()).toEqual([
      'Authorization',
      'Content-Type',
      'X-Graph-Namespace',
    ]);
    expect(request!.headers['Authorization']).toBe(`Bearer ${CONFIG.token}`);
  });

  it('is absent from the request body, which carries parameters and nothing else', async () => {
    const harness = await start();

    await (await fetch(
      `${harness.origin}/ask?subject=${FOREIGN}&predicate=vendor`,
      { headers: HOSTILE_HEADERS },
    )).text();

    const [request] = harness.sent;
    const body = JSON.parse(request!.body) as Record<string, unknown>;

    // The subject was the foreign tenant's name, so it is legitimately in the
    // bound parameters. Everywhere else, that string is a routing instruction.
    expect(JSON.stringify(body['parameters'])).toContain(FOREIGN);
    expect(Object.keys(body)).not.toContain('namespace');
    expect(String(body['query'])).not.toContain(FOREIGN);
  });
});

describe('a refusal from the node', () => {
  it('is surfaced as a failure rather than as an answer', async () => {
    const harness = await start(permissionDenied);

    const response = await fetch(
      `${harness.origin}/ask?subject=Meridian&predicate=launch_date`,
    );
    const page = await response.text();

    expect(response.status).toBe(502);
    expect(page).toContain('The graph did not answer');
  });

  it('does not put the engine message, either namespace, or the token on the page', async () => {
    const harness = await start(permissionDenied);

    const page = await (await fetch(
      `${harness.origin}/ask?subject=Meridian&predicate=launch_date`,
    )).text();

    // The engine's own message names the scope it refused, which is how a
    // refusal turns into a disclosure of who else is on the node.
    expect(page).not.toContain(FOREIGN);
    expect(page).not.toContain('permission_denied');
    expect(page).not.toContain('not authorized');
    expect(page).not.toContain(CONFIG.token);

    // The configured namespace is a different matter: the answer pages print it
    // on purpose, since an answer that does not say which node it came from is
    // not evidence. This page is not an answer page, so it should not.
    expect(page).not.toContain(CONFIG.namespace);
  });

  it('is a failure at the first query, so nothing downstream runs', async () => {
    const harness = await start(permissionDenied);

    await (await fetch(
      `${harness.origin}/ask?subject=Meridian&predicate=launch_date`,
    )).text();

    // An entity lookup that throws should end the request. Retrying it, or
    // pressing on to the claim queries with an empty subject, would turn one
    // refusal into a burst against a node that just said no.
    expect(harness.sent.length).toBe(1);
  });
});
