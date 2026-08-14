import { beforeEach, describe, expect, it } from 'vitest';

import { HydraClient, unwrapEngineMessage } from '../../src/hydra/client.js';
import { loadHydraConfig, type HydraLimits } from '../../src/hydra/config.js';
import {
  HydraDecodeError,
  HydraGuardError,
  HydraQueryError,
  HydraTransportError,
} from '../../src/hydra/errors.js';

const TOKEN = 'zzz-not-a-real-token-zzz';

const config = loadHydraConfig({
  HYDRA_HTTP_URL: 'http://127.0.0.1:18443',
  HYDRA_NAMESPACE: 'local',
  HYDRA_GRAPH: 'default',
  HYDRA_CELL: 'cell-0',
  HYDRA_TOKEN: TOKEN,
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: Record<string, unknown>;
}

let calls: Call[];

function client(
  responder: (call: Call, n: number) => Response | Promise<Response>,
  limits?: Partial<HydraLimits>,
): HydraClient {
  const options: { fetch: typeof fetch; limits?: Partial<HydraLimits> } = {
    fetch: (async (url: string, init: RequestInit) => {
      const call: Call = {
        url,
        init,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
      calls.push(call);
      return responder(call, calls.length);
    }) as unknown as typeof fetch,
  };
  if (limits !== undefined) options.limits = limits;
  return new HydraClient(config, options as never);
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    query_id: 'server-assigned',
    columns: ['id'],
    rows: [],
    read_epoch: 67,
    next_cursor: null,
    bookmark: null,
    ...payload,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
});

describe('local guards, which never reach the network', () => {
  const never = client(() => {
    throw new Error('the guard let a bad request through');
  });

  it('refuses an empty query', async () => {
    await expect(never.query({ cypher: '   ' })).rejects.toThrowError(HydraGuardError);
    expect(calls).toHaveLength(0);
  });

  it('refuses a second statement', async () => {
    await expect(never.query({ cypher: 'RETURN 1 AS a; DROP' }))
      .rejects.toThrowError(/one statement per request/);
    expect(calls).toHaveLength(0);
  });

  it('refuses an oversized query', async () => {
    const long = `RETURN 1 AS a // ${'x'.repeat(9000)}`;
    await expect(never.query({ cypher: long })).rejects.toThrowError(/character cap/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-positive timeout and page size', async () => {
    await expect(never.query({ cypher: 'RETURN 1 AS a', timeoutMs: 0 }))
      .rejects.toThrowError(/timeoutMs must be a positive integer/);
    await expect(never.query({ cypher: 'RETURN 1 AS a', pageSize: -1 }))
      .rejects.toThrowError(/pageSize must be a positive integer/);
    expect(calls).toHaveLength(0);
  });

  it('refuses an oversized parameter payload', async () => {
    const small = client(() => ok({}), { maxParameterBytes: 200 });
    await expect(small.query({
      cypher: 'UNWIND $rows AS row MERGE (n {id: row.id}) SET n:X, n.t = row.t',
      parameters: { rows: [{ id: 1, t: 'y'.repeat(500) }] },
    })).rejects.toThrowError(/over the 200 byte cap/);
    expect(calls).toHaveLength(0);
  });
});

describe('the wire request', () => {
  it('sends the documented body and the three headers', async () => {
    const c = client(() => ok({}));
    await c.query({ cypher: 'MATCH (c:Claim) RETURN c.id AS id', parameters: { a: 1 } });

    const call = calls[0] as Call;
    expect(call.url).toBe('http://127.0.0.1:18443/v1/graphs/default/query');
    expect(call.init.method).toBe('POST');
    expect(call.body).toMatchObject({
      cell_id: 'cell-0',
      query: 'MATCH (c:Claim) RETURN c.id AS id',
      parameters: { a: 1 },
      consistency: 'strong',
      timeout_ms: 5000,
    });

    const headers = call.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(headers['X-Graph-Namespace']).toBe('local');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('mints its own query id rather than letting the server assign one', async () => {
    const c = client(() => ok({}));
    await c.query({ cypher: 'RETURN 1 AS id' });
    expect(String((calls[0] as Call).body['query_id']))
      .toMatch(/^lacuna-[0-9a-f-]{36}$/);
  });

  it('trims the query before sending it', async () => {
    const c = client(() => ok({}));
    await c.query({ cypher: '  RETURN 1 AS id\n' });
    expect((calls[0] as Call).body['query']).toBe('RETURN 1 AS id');
  });

  it('omits parameters, page_size and cursor when they were not asked for', async () => {
    const c = client(() => ok({}));
    await c.query({ cypher: 'RETURN 1 AS id' });
    expect((calls[0] as Call).body).not.toHaveProperty('parameters');
    expect((calls[0] as Call).body).not.toHaveProperty('page_size');
    expect((calls[0] as Call).body).not.toHaveProperty('cursor');
  });
});

describe('bookmarks', () => {
  it('remembers the bookmark a write returns and sends it on the next read', async () => {
    const c = client(() => ok({ bookmark: 'sgk:1:aa:bb:cc:67' }));
    expect(c.lastWriteBookmark).toBe(null);

    await c.write({ cypher: 'MERGE (a {id: $src})-[:X]->(b {id: $dst})', parameters: {} });
    expect(c.lastWriteBookmark).toBe('sgk:1:aa:bb:cc:67');
    expect((calls[0] as Call).body).not.toHaveProperty('bookmark');

    await c.query({ cypher: 'RETURN 1 AS id' });
    expect((calls[1] as Call).body['bookmark']).toBe('sgk:1:aa:bb:cc:67');
  });

  it('sends no bookmark when the caller passes null', async () => {
    const c = client(() => ok({ bookmark: 'sgk:1:aa:bb:cc:67' }));
    await c.write({ cypher: 'MERGE (a {id: 1})-[:X]->(b {id: 2})' });
    await c.query({ cypher: 'RETURN 1 AS id', bookmark: null });
    expect((calls[1] as Call).body).not.toHaveProperty('bookmark');
  });

  it('sends the caller bookmark when one is given', async () => {
    const c = client(() => ok({ bookmark: 'from-write' }));
    await c.write({ cypher: 'MERGE (a {id: 1})-[:X]->(b {id: 2})' });
    await c.query({ cypher: 'RETURN 1 AS id', bookmark: 'from-caller' });
    expect((calls[1] as Call).body['bookmark']).toBe('from-caller');
  });

  it('forgets the bookmark on request', async () => {
    const c = client(() => ok({ bookmark: 'sgk:1:aa:bb:cc:67' }));
    await c.write({ cypher: 'MERGE (a {id: 1})-[:X]->(b {id: 2})' });
    c.forgetWriteBookmark();
    expect(c.lastWriteBookmark).toBe(null);
    await c.query({ cypher: 'RETURN 1 AS id' });
    expect((calls[1] as Call).body).not.toHaveProperty('bookmark');
  });

  it('does not overwrite a remembered bookmark with a null one', async () => {
    const c = client((_call, n) => ok({ bookmark: n === 1 ? 'first' : null }));
    await c.write({ cypher: 'MERGE (a {id: 1})-[:X]->(b {id: 2})' });
    await c.write({ cypher: 'MERGE (a {id: 3})-[:X]->(b {id: 4})' });
    expect(c.lastWriteBookmark).toBe('first');
  });
});

describe('paging', () => {
  const page = (n: number): Response => ok({
    query_id: 'echoed',
    columns: ['id'],
    rows: [[{ type: 'vertex_id', value: 2000000000000 + n }]],
    next_cursor: n < 3 ? n * 10 : null,
  });

  it('follows cursors under one query id and concatenates the rows', async () => {
    const c = client((_call, n) => page(n));
    const result = await c.query({ cypher: 'MATCH (c:Claim) RETURN c.id AS id', pageSize: 1 });

    expect(calls).toHaveLength(3);
    const ids = calls.map((call) => call.body['query_id']);
    expect(new Set(ids).size).toBe(1);
    expect(calls[0]?.body).not.toHaveProperty('cursor');
    expect(calls[1]?.body['cursor']).toBe(10);
    expect(calls[2]?.body['cursor']).toBe(20);

    expect(result.rows).toEqual([
      [2000000000001], [2000000000002], [2000000000003],
    ]);
    expect(result.nextCursor).toBe(null);
    expect(result.queryId).toBe(ids[0]);
  });

  it('stops at the page cap instead of looping forever', async () => {
    const c = client(() => ok({ rows: [[{ type: 'integer', value: 1 }]], next_cursor: 5 }),
      { maxPages: 2 });
    await expect(c.query({ cypher: 'MATCH (c:Claim) RETURN c.id AS id' }))
      .rejects.toThrowError(/over the 2 page cap/);
  });

  it('stops at the row cap', async () => {
    const c = client(() => ok({
      rows: [[{ type: 'integer', value: 1 }], [{ type: 'integer', value: 2 }]],
      next_cursor: 5,
    }), { maxRowsPerQuery: 3 });
    await expect(c.query({ cypher: 'MATCH (c:Claim) RETURN c.id AS id' }))
      .rejects.toThrowError(/exceeded the 3 row cap/);
  });

  it('refuses a page whose column list changed mid-read', async () => {
    const c = client((_call, n) => ok({
      columns: n === 1 ? ['id'] : ['other'],
      rows: [[{ type: 'integer', value: n }]],
      next_cursor: n === 1 ? 10 : null,
    }));
    await expect(c.query({ cypher: 'MATCH (c:Claim) RETURN c.id AS id' }))
      .rejects.toThrowError(HydraDecodeError);
  });

  it('queryPage does not follow anything', async () => {
    const c = client((_call, n) => page(n));
    const first = await c.queryPage({ cypher: 'MATCH (c:Claim) RETURN c.id AS id' });
    expect(calls).toHaveLength(1);
    expect(first.nextCursor).toBe(10);
  });
});

describe('failures', () => {
  it('turns an engine refusal into a HydraQueryError carrying the exact message', async () => {
    const message = 'RETURN currently supports <binding>.<property> or count(*)';
    const c = client(() => new Response(JSON.stringify({ error: { message } }), {
      status: 400,
    }));

    const error = await c.query({ cypher: 'MATCH (c:Claim) RETURN c' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HydraQueryError);
    expect((error as HydraQueryError).status).toBe(400);
    expect((error as HydraQueryError).engineMessage).toBe(message);
  });

  it('keeps the token out of every error it raises', async () => {
    const cases: HydraClient[] = [
      client(() => new Response(JSON.stringify({ error: { message: 'no' } }), { status: 403 })),
      client(() => { throw new Error('ECONNREFUSED'); }),
      client(() => new Response('<html>gateway</html>', { status: 502 })),
      client(() => new Response('not json', { status: 200 })),
    ];
    for (const c of cases) {
      const error = await c.query({ cypher: 'RETURN 1 AS id' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const serialised = `${(error as Error).message} ${(error as Error).stack ?? ''} `
        + `${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
      expect(serialised).not.toContain(TOKEN);
    }
  });

  it('reports a transport failure without inventing a status', async () => {
    const c = client(() => { throw new Error('ECONNREFUSED'); });
    await expect(c.query({ cypher: 'RETURN 1 AS id' }))
      .rejects.toThrowError(HydraTransportError);
  });

  it('cuts off a response body over the cap', async () => {
    const c = client(() => ok({ rows: [] }), { maxResponseBytes: 16 });
    await expect(c.query({ cypher: 'RETURN 1 AS id' }))
      .rejects.toThrowError(/exceeded the 16 byte cap/);
  });

  it('refuses a body that is not JSON', async () => {
    const c = client(() => new Response('not json', { status: 200 }));
    await expect(c.query({ cypher: 'RETURN 1 AS id' }))
      .rejects.toThrowError(/not valid JSON/);
  });

  it('refuses a response missing the fields it decodes', async () => {
    const c = client(() => new Response(JSON.stringify({ columns: ['id'], rows: [] }), {
      status: 200,
    }));
    await expect(c.query({ cypher: 'RETURN 1 AS id' }))
      .rejects.toThrowError(/no string query_id/);
  });
});

describe('unwrapEngineMessage', () => {
  it('pulls the message out of the documented error envelope', () => {
    expect(unwrapEngineMessage('{"error":{"message":"undirected relationships are not '
      + 'executable in Query engine"}}'))
      .toBe('undirected relationships are not executable in Query engine');
  });

  it('passes anything else through flattened and truncated', () => {
    expect(unwrapEngineMessage('<html>\n  gateway\n</html>')).toBe('<html> gateway </html>');
    expect(unwrapEngineMessage('x'.repeat(500))).toHaveLength(403);
  });
});
