import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { HydraClient } from '../../src/hydra/client';
import type { HydraConfig } from '../../src/hydra/config';
import { FixedWindow } from '../../src/server/ratelimit';
import { createHandler, MAX_URL_CHARS } from '../../src/server/server';
import type { CorpusFacts, Example } from '../../src/view/home';
import type { NodeIdentity } from '../../src/view/proof';

/**
 * The whole server surface, driven over a real socket.
 *
 * The graph is the only thing faked here, and it is faked at the transport: the
 * client under test is a real `HydraClient` constructed with a `fetch` that
 * returns canned wire responses. That matters more than it sounds. A stub
 * standing in for the client would have skipped the decode path, the guard
 * checks and the error types, and those are exactly what decides whether a
 * failing graph shows up as a 502 or as a 500. Everything from the URL down to
 * the JSON on the wire is the shipped code.
 *
 * A subject with no rows behind it is a genuine out of scope answer costing one
 * query, so the answer page in these tests is rendered by the real renderer from
 * a real resolution rather than from a fixture.
 */

const CONFIG: HydraConfig = {
  baseUrl: 'http://127.0.0.1:18443',
  namespace: 'test-namespace',
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

/** Structurally the client's own `FetchLike`, which is not exported. */
type Upstream = (input: string, init: RequestInit) => Promise<Response>;

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

interface Harness {
  readonly origin: string;
  /** One entry per request that reached the transport. */
  readonly upstreamCalls: string[];
  readonly logs: string[];
  readonly close: () => Promise<void>;
}

const open: Harness[] = [];

interface HarnessOptions {
  readonly upstream?: Upstream;
  readonly limiter?: FixedWindow;
  readonly now?: () => number;
}

async function start(options: HarnessOptions = {}): Promise<Harness> {
  const upstreamCalls: string[] = [];
  const logs: string[] = [];
  const upstream = options.upstream ?? ((): Promise<Response> => Promise.resolve(emptyPage()));

  const client = new HydraClient(CONFIG, {
    fetch: (input, init) => {
      upstreamCalls.push(String(init.body ?? ''));
      return upstream(input, init);
    },
  });

  const base = {
    client,
    node: NODE,
    examples: [EXAMPLE],
    facts: FACTS,
    limiter: options.limiter ?? new FixedWindow({ limit: 100, windowMs: 1_000, maxKeys: 8 }),
    log: (line: string): void => {
      logs.push(line);
    },
  };
  const handler = createHandler(
    options.now === undefined ? base : { ...base, now: options.now },
  );

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
    upstreamCalls,
    logs,
    close: () => new Promise<void>((resolve, reject) => {
      // The client keeps the socket alive, so close() would wait on it forever.
      server.closeAllConnections();
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    }),
  };
  open.push(harness);
  return harness;
}

afterEach(async () => {
  const closing = open.splice(0, open.length).map(async (harness) => harness.close());
  await Promise.all(closing);
});

/**
 * A log line is written when the response finishes, which is not ordered against
 * the client's own read of the body. Polling for it fails loudly after a second
 * rather than flaking.
 */
async function waitForLogs(harness: Harness, count: number): Promise<readonly string[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (harness.logs.length >= count) return harness.logs;
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`expected ${count} log lines, saw ${harness.logs.length}`);
}

describe('the home page', () => {
  it('answers with the rendered page and the headers that protect it', async () => {
    const harness = await start();
    const response = await fetch(harness.origin);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");

    expect(body).toContain(EXAMPLE.text);
    expect(body).not.toContain(CONFIG.token);
    // The graph is not read to render this page.
    expect(harness.upstreamCalls).toHaveLength(0);
  });

  it('serves a HEAD with the headers of the GET and none of the bytes', async () => {
    const harness = await start();
    const head = await fetch(harness.origin, { method: 'HEAD' });

    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});

describe('the static files', () => {
  it('serves the stylesheet and the icon with a short cache', async () => {
    const harness = await start();

    const css = await fetch(`${harness.origin}/lacuna.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(css.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await css.text()).toContain('--');

    const icon = await fetch(`${harness.origin}/favicon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await icon.text()).toContain('<svg');
  });
});

describe('the refusals', () => {
  it('refuses a method that implies a write', async () => {
    const harness = await start();
    const response = await fetch(harness.origin, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(await response.text()).toContain('This server only reads');
  });

  it('has nothing at a path that is not one of the two pages', async () => {
    const harness = await start();
    const response = await fetch(`${harness.origin}/admin`);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('There is no page here');
    expect(harness.upstreamCalls).toHaveLength(0);
  });

  it('rejects a URL longer than any question, before parsing it', async () => {
    const harness = await start();
    const long = 'a'.repeat(MAX_URL_CHARS + 100);
    const response = await fetch(`${harness.origin}/ask?subject=${long}&predicate=x`);

    expect(response.status).toBe(414);
    expect(await response.text()).toContain('longer than any question');
  });

  it('asks for both terms when one is missing', async () => {
    const harness = await start();

    const neither = await fetch(`${harness.origin}/ask`);
    expect(neither.status).toBe(400);
    expect(await neither.text()).toContain('needs a subject and a predicate');

    const onlySubject = await fetch(`${harness.origin}/ask?subject=Meridian`);
    expect(onlySubject.status).toBe(400);

    expect(harness.upstreamCalls).toHaveLength(0);
  });

  it('rejects an unusable term without quoting it back', async () => {
    const harness = await start();
    const overlong = 'q'.repeat(201);
    const response = await fetch(
      `${harness.origin}/ask?subject=${overlong}&predicate=launch_date`,
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain('not usable');
    // The page that exists to quote a graph does not quote what was typed at it.
    expect(body).not.toContain('qqqqqqqqqqqqqqqqqqqq');
    // A term that never passed the guard costs nothing.
    expect(harness.upstreamCalls).toHaveLength(0);
  });

  it('rejects a control character in a term', async () => {
    const harness = await start();
    const response = await fetch(`${harness.origin}/ask?subject=%01&predicate=launch_date`);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('not usable');
    expect(harness.upstreamCalls).toHaveLength(0);
  });
});

describe('an answer', () => {
  it('renders a real abstention from a real read', async () => {
    const harness = await start();
    const response = await fetch(
      `${harness.origin}/ask?subject=Nowhere&predicate=launch_date`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');

    // One query, because the name lookup already settled the question.
    expect(harness.upstreamCalls).toHaveLength(1);
    expect(harness.upstreamCalls[0]).toContain('Nowhere');

    expect(body).toContain('this subject never appears in the sessions at all');
    expect(body).toContain('No node carries that name');
    // The proof panel names the node it read, and never how to reach it.
    expect(body).toContain(CONFIG.namespace);
    expect(body).not.toContain(CONFIG.token);
    expect(body).not.toContain(CONFIG.baseUrl);
  });

  it('treats an empty via field the way a submitted form means it', async () => {
    const harness = await start();
    const response = await fetch(
      `${harness.origin}/ask?subject=Nowhere&predicate=launch_date&via=`,
    );

    expect(response.status).toBe(200);
    // A via of "" is no via, so this is still the one query direct path.
    expect(harness.upstreamCalls).toHaveLength(1);
  });

  it('logs the path and the timing, and never the question', async () => {
    const harness = await start();
    await fetch(`${harness.origin}/ask?subject=Nowhere&predicate=launch_date`);
    const logs = await waitForLogs(harness, 1);

    expect(logs[0]).toMatch(/^GET \/ask 200 \d+ms$/);
    expect(logs[0]).not.toContain('Nowhere');
    expect(logs[0]).not.toContain('?');
  });
});

describe('when the graph does not answer', () => {
  it('says so with a 502 rather than inventing a result', async () => {
    // The handler writes the failure to stderr, so this test prints a line.
    const harness = await start({
      upstream: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    const response = await fetch(
      `${harness.origin}/ask?subject=Meridian&predicate=launch_date`,
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain('The graph did not answer');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain(CONFIG.token);
  });

  it('is a 500 when the failure is this server rather than the graph', async () => {
    // A well formed page carrying something the graph is not supposed to hold:
    // two entities under one name. The transport is fine and the request was
    // fine, so this is neither a 502 nor a 400.
    const harness = await start({
      upstream: () => Promise.resolve(new Response(
        JSON.stringify({
          query_id: 'test-query',
          columns: ['id', 'kind'],
          rows: [
            [{ type: 'integer', value: 1 }, { type: 'string', value: 'product' }],
            [{ type: 'integer', value: 2 }, { type: 'string', value: 'product' }],
          ],
          read_epoch: 7,
          next_cursor: null,
          bookmark: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )),
    });
    const response = await fetch(
      `${harness.origin}/ask?subject=Meridian&predicate=launch_date`,
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('Something here broke');
  });
});

describe('the rate limit', () => {
  it('refuses past the limit and says how long to wait', async () => {
    const harness = await start({
      limiter: new FixedWindow({ limit: 2, windowMs: 1_000, maxKeys: 4 }),
      // A frozen clock, so the window cannot roll over mid test.
      now: () => 0,
    });

    const first = await fetch(harness.origin);
    const second = await fetch(harness.origin);
    const third = await fetch(harness.origin);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('1');
    expect(await third.text()).toContain('Slow down');
  });

  it('counts the stylesheet too, because the limit is on the node behind it', async () => {
    const harness = await start({
      limiter: new FixedWindow({ limit: 1, windowMs: 1_000, maxKeys: 4 }),
      now: () => 0,
    });

    expect((await fetch(`${harness.origin}/lacuna.css`)).status).toBe(200);
    expect((await fetch(`${harness.origin}/lacuna.css`)).status).toBe(429);
  });
});
