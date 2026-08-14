import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { HydraClient } from '../../src/hydra/client.js';
import { loadHydraConfig, type HydraConfig } from '../../src/hydra/config.js';
import { HydraQueryError } from '../../src/hydra/errors.js';
import { mergeEdge, upsertVertices, vertexProperty } from '../../src/hydra/queries.js';

/**
 * These run against a live HydraDB node. Nothing here is mocked.
 *
 * They exist because the compatibility notes in artifacts/cypher-probe/ were
 * gathered with a Python script, and a Python script proving a query form says
 * nothing about whether this TypeScript client sends the same bytes. Every
 * builder in src/hydra/queries.ts is executed here against the real engine.
 *
 * A missing node is a failure, not a skip. A green test run that quietly tested
 * nothing is worse than a red one.
 */

const ENV_PATH = fileURLToPath(new URL('../../.env.local', import.meta.url));

const LABEL = 'LacunaContractProbe';
const EDGE = 'LACUNA_PROBE_EDGE';
const BASE = 9200000000000;
const IDS = [1, 2, 3, 4, 5].map((n) => BASE + n);

/**
 * Two cases below write their own vertex. Those ids are seeded here as well, so
 * `count(*)` over the label is the same on the first run against a fresh store
 * and on every run after it. A suite that only passes once is not a suite.
 */
const CAUSAL_READ_ID = BASE + 90;
const BOOKMARK_SCOPE_ID = BASE + 91;
const ALL_IDS = [...IDS, CAUSAL_READ_ID, BOOKMARK_SCOPE_ID];

let config: HydraConfig;
let client: HydraClient;

beforeAll(async () => {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `${ENV_PATH} is missing. Copy .env.example to .env.local and fill in the `
      + 'token from the running node before running the contract tests.',
    );
  }
  process.loadEnvFile(ENV_PATH);
  config = loadHydraConfig();
  client = new HydraClient(config);

  // Fail here, loudly, rather than letting every case below fail confusingly.
  try {
    await client.query({ cypher: `MATCH (n:${LABEL}) RETURN count(*) AS n` });
  } catch (cause) {
    throw new Error(
      `no HydraDB node answered at ${config.baseUrl}. Start one before running `
      + 'the contract tests; they do not mock the database.',
      { cause },
    );
  }

  await client.write(upsertVertices({
    label: LABEL,
    properties: ['tag', 'seq'],
    rows: ALL_IDS.map((id, i) => ({ id, tag: `probe-${i + 1}`, seq: i + 1 })),
  }));
  client.forgetWriteBookmark();
});

describe('the transport', () => {
  it('reaches the node and decodes a count', async () => {
    const rows = await client.queryObjects({
      cypher: `MATCH (n:${LABEL}) RETURN count(*) AS n`,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['n']).toBe(ALL_IDS.length);
  });

  it('gets back the query id it minted, not one the server chose', async () => {
    const page = await client.queryPage({
      cypher: `MATCH (n:${LABEL}) RETURN n.id AS id`,
    }, { queryId: 'lacuna-contract-echo-check' });
    expect(page.queryId).toBe('lacuna-contract-echo-check');
  });
});

describe('the query builders, executed', () => {
  it('upsertVertices writes rows the engine accepts, and is idempotent', async () => {
    const query = upsertVertices({
      label: LABEL,
      properties: ['tag', 'seq'],
      rows: [{ id: IDS[0] as number, tag: 'probe-1', seq: 1 }],
    });
    const first = await client.write(query);
    expect(first.bookmark).not.toBe(null);

    // Same ids again. A duplicate vertex would show up as a changed count.
    await client.write(query);
    const rows = await client.queryObjects({
      cypher: `MATCH (n:${LABEL}) RETURN count(*) AS n`,
    });
    expect(rows[0]?.['n']).toBe(ALL_IDS.length);
  });

  it('vertexProperty reads back what upsertVertices wrote', async () => {
    const rows = await client.queryObjects(vertexProperty(IDS[2] as number, 'tag'));
    expect(rows).toEqual([{ value: 'probe-3' }]);
  });

  it('reads an integer property back as a number', async () => {
    const rows = await client.queryObjects(vertexProperty(IDS[3] as number, 'seq'));
    expect(rows).toEqual([{ value: 4 }]);
  });

  it('mergeEdge creates an edge that is actually there afterwards', async () => {
    await client.write(mergeEdge(EDGE, IDS[0] as number, IDS[1] as number));

    const rows = await client.queryObjects({
      cypher: `MATCH (a {id: $src})-[:${EDGE}]->(b) RETURN b.tag AS tag`,
      parameters: { src: IDS[0] },
    });
    expect(rows).toEqual([{ tag: 'probe-2' }]);
  });
});

describe('causal reads', () => {
  it('sends the write bookmark on the following read, and sees the write', async () => {
    const id = CAUSAL_READ_ID;
    const tag = `bookmark-${Date.now()}`;

    const write = await client.write(upsertVertices({
      label: LABEL,
      properties: ['tag', 'seq'],
      rows: [{ id, tag, seq: 90 }],
    }));
    expect(write.bookmark).not.toBe(null);
    expect(client.lastWriteBookmark).toBe(write.bookmark);

    const rows = await client.queryObjects(vertexProperty(id, 'tag'));
    expect(rows).toEqual([{ value: tag }]);

    // Leave the probe set at its expected size for the other cases.
    client.forgetWriteBookmark();
  });
});

describe('server-side paging', () => {
  it('hands out a cursor when a page size is set', async () => {
    const page = await client.queryPage({
      cypher: `MATCH (n:${LABEL}) RETURN n.id AS id`,
      pageSize: 2,
    });
    expect(page.rows.length).toBeLessThanOrEqual(2);
    expect(page.nextCursor).not.toBe(null);
  });

  it('follows the cursor to the end and returns every row once', async () => {
    const paged = await client.query({
      cypher: `MATCH (n:${LABEL}) RETURN n.id AS id`,
      pageSize: 2,
    });
    const unpaged = await client.query({
      cypher: `MATCH (n:${LABEL}) RETURN n.id AS id`,
    });

    expect(paged.rows.length).toBe(unpaged.rows.length);
    const ids = paged.rows.map((row) => row[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ALL_IDS) expect(ids).toContain(id);
  });
});

describe('controls that SECURITY.md relies on', () => {
  /**
   * Two separate controls, and it is worth not confusing them. The header is
   * checked by authorization: a token scoped to one namespace cannot ask for
   * another, and the answer is 403 permission_denied. The bookmark is checked
   * by scope validation: a bookmark carries the scope it was minted in, so a
   * foreign one is a 400, not a way in. Both are asserted, because a test that
   * only covers the header would pass even if bookmarks were trusted blindly.
   */
  it('refuses a foreign namespace in the header, as an authorization failure', async () => {
    const other = new HydraClient({ ...config, namespace: 'other-tenant' });
    const error = await other.query({ cypher: `MATCH (n:${LABEL}) RETURN count(*) AS n` })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HydraQueryError);
    expect((error as HydraQueryError).status).toBe(403);
    expect((error as HydraQueryError).engineMessage)
      .toContain('not authorized to read graph scope other-tenant/graphs/default');
  });

  it('refuses a foreign bookmark, so a bookmark is not a capability that travels', async () => {
    // Take a bookmark the node actually minted and rewrite only the namespace
    // segment, so the forgery stays well formed. Deriving it from a real one
    // rather than hard-coding the layout means a format change fails loudly
    // here instead of quietly testing a string the engine no longer parses.
    const write = await client.write(upsertVertices({
      label: LABEL,
      properties: ['tag', 'seq'],
      rows: [{ id: BOOKMARK_SCOPE_ID, tag: 'bookmark-scope', seq: 91 }],
    }));
    client.forgetWriteBookmark();

    const minted = write.bookmark;
    expect(minted).not.toBe(null);
    const parts = (minted as string).split(':');
    expect(parts).toHaveLength(6);
    expect(parts[2]).toBe(Buffer.from(config.namespace, 'utf8').toString('hex'));

    parts[2] = Buffer.from('other-tenant', 'utf8').toString('hex');
    const error = await client.query({
      cypher: `MATCH (n:${LABEL}) RETURN count(*) AS n`,
      bookmark: parts.join(':'),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HydraQueryError);
    expect((error as HydraQueryError).status).toBe(400);
    expect((error as HydraQueryError).engineMessage).toContain('graph scope mismatch');
  });

  it('reports an engine refusal verbatim instead of swallowing it', async () => {
    // "RETURN currently supports <binding>.<property> or count(*)"
    const error = await client.query({ cypher: `MATCH (n:${LABEL}) RETURN n` })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HydraQueryError);
    expect((error as HydraQueryError).status).toBeGreaterThanOrEqual(400);
    expect((error as HydraQueryError).engineMessage).toMatch(/RETURN currently supports/);
  });

  it('keeps the bearer token out of the error it raises for a failed query', async () => {
    const error = await client.query({ cypher: `MATCH (n:${LABEL}) RETURN n` })
      .catch((e: unknown) => e) as Error;
    const serialised = `${error.message} ${error.stack ?? ''}`;
    expect(serialised).not.toContain(config.token);
  });
});
