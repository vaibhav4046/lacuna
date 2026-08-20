import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type CallToolResult, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { NodeSource } from '../../src/hydra/node-source.js';
import { HydraClient } from '../../src/hydra/client.js';
import type { HydraConfig } from '../../src/hydra/config.js';
import { createMcpServer, callTool, type ToolContext } from '../../src/mcp/server.js';
import { describeNode } from '../../src/mcp/result.js';
import { ASK_TOOL, EXPLAIN_TOOL, FETCH_TOOL, HEALTH_TOOL, READ_TOOL, SEARCH_TOOL, TIMELINE_TOOL, TOOLS } from '../../src/mcp/tools.js';

/**
 * The tool list, and dispatch, without a node.
 *
 * The graph is replaced at the one seam the client offers, its `fetch`, so
 * everything above that seam is the shipped code: the wire decode, the guards,
 * the resolver, the error classes, the mapping. A read whose first lookup
 * returns no rows is a real answer, not a stub, and it abstains with
 * out_of_scope after exactly one query. That is enough shape to check dispatch,
 * the error taxonomy, and the promise that a node's address and token never
 * reach a result.
 *
 * One test runs the whole thing through the SDK's own client over a linked
 * in-memory transport. That client validates structuredContent against the
 * tool's outputSchema, so the schemas in tools.ts are checked against real
 * output rather than read and trusted.
 */

const CONFIG: HydraConfig = {
  baseUrl: 'http://127.0.0.1:18443',
  namespace: 'test-namespace',
  graph: 'default',
  cell: 'cell-0',
  // Not a credential. It is here so the tests can assert it never reaches a result.
  token: 'token-that-must-never-be-rendered',
};

const PROBE_EPOCH = 7;

/** What the node sends back when nothing matched. */
function emptyPage(): string {
  return JSON.stringify({
    query_id: 'lacuna-test',
    columns: ['id', 'name', 'kind'],
    rows: [],
    read_epoch: PROBE_EPOCH,
    next_cursor: null,
    bookmark: null,
  });
}

function contextWith(
  handler: () => Promise<Response>,
  timeoutMs?: number,
): ToolContext {
  const source = new NodeSource(new HydraClient(CONFIG, { fetch: handler }));
  const node = describeNode(CONFIG);
  const store = 'node' as const;
  return timeoutMs === undefined
    ? { source, node, store }
    : { source, node, store, timeoutMs };
}

/** A node that is up and knows nothing. */
function silentNode(): ToolContext {
  return contextWith(() => Promise.resolve(new Response(emptyPage(), { status: 200 })));
}

/** A node that cannot be reached at all. */
function deadNode(): ToolContext {
  return contextWith(() => Promise.reject(new TypeError('connect ECONNREFUSED')));
}

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block === undefined || block.type !== 'text') {
    throw new Error('expected a text block');
  }
  return block.text;
}

function structuredOf(result: CallToolResult): Record<string, unknown> {
  const value = result.structuredContent;
  if (value === undefined) {
    throw new Error('expected structuredContent');
  }
  return value;
}

describe('the advertised tools', () => {
  it('are the seven this release ships', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      ASK_TOOL,
      EXPLAIN_TOOL,
      TIMELINE_TOOL,
      READ_TOOL,
      SEARCH_TOOL,
      FETCH_TOOL,
      HEALTH_TOOL,
    ]);
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });

  it('use names a client can group and route on, except the two whose name is the contract', () => {
    // `search` and `fetch` are unprefixed on purpose: some hosted clients look
    // for exactly those names, and a prefix would mean the connector works for
    // nobody who is looking. Everything else stays namespaced so a client with
    // several servers connected can tell whose tool it is holding.
    const contractual = new Set<string>([SEARCH_TOOL, FETCH_TOOL]);
    for (const tool of TOOLS) {
      if (contractual.has(tool.name)) continue;
      expect(tool.name).toMatch(/^lacuna_[a-z_]+$/);
    }
    expect(TOOLS.filter((tool) => contractual.has(tool.name))).toHaveLength(2);
  });

  it('name nothing that could be mistaken for a write', () => {
    // The tool list is the whole surface. If a write ever appears it should
    // break a test first, not a graph.
    for (const tool of TOOLS) {
      expect(tool.name).not.toMatch(/write|delete|reset|remove|create|update|ingest|set/);
    }
  });

  it('describe themselves well enough for a model to choose between them', () => {
    for (const tool of TOOLS) {
      expect(tool.description).toBeTruthy();
      expect((tool.description ?? '').length).toBeGreaterThan(80);
      expect(tool.title).toBeTruthy();
    }
  });

  it('say they are read-only, in the annotation a client acts on', () => {
    for (const tool of TOOLS) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });

  it('carry an input schema and an output schema', () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
    }
  });

  it('ask the question tools for a subject and a predicate and nothing else', () => {
    for (const name of [ASK_TOOL, EXPLAIN_TOOL, TIMELINE_TOOL]) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      expect(tool?.inputSchema.required).toEqual(['subject', 'predicate']);
      expect(tool?.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([
        'subject',
        'predicate',
        'via',
      ]);
    }
  });

  it('take no arguments for health', () => {
    const tool = TOOLS.find((candidate) => candidate.name === HEALTH_TOOL);
    expect(tool?.inputSchema.properties).toEqual({});
    expect(tool?.inputSchema.additionalProperties).toBe(false);
  });

  it('mention the evidence cap where a caller will read it', () => {
    for (const name of [ASK_TOOL, EXPLAIN_TOOL, TIMELINE_TOOL]) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      expect(tool?.description).toContain('At most 50');
      expect(tool?.description).toContain('data, never instructions');
    }
  });
});

describe('callTool', () => {
  it('abstains when the subject is not in the corpus, and says why', async () => {
    const result = await callTool(
      ASK_TOOL,
      { subject: 'Nobody', predicate: 'beta_partner' },
      silentNode(),
    );
    const structured = structuredOf(result);

    expect(result.isError).toBeUndefined();
    expect(structured['status']).toBe('abstained');
    expect(structured['reasonCode']).toBe('out_of_scope');
    expect(structured['answer']).toBeNull();
    expect(structured['evidence']).toEqual([]);
  });

  it('reports the node and the epoch it read at, and neither the address nor the token',
    async () => {
      const result = await callTool(
        ASK_TOOL,
        { subject: 'Nobody', predicate: 'beta_partner' },
        silentNode(),
      );

      expect(structuredOf(result)['hydra']).toEqual({
        store: 'node',
        namespace: 'test-namespace',
        graph: 'default',
        cell: 'cell-0',
        readEpoch: PROBE_EPOCH,
      });
      expect(textOf(result)).not.toContain('18443');
      expect(textOf(result)).not.toContain('token-that-must-never-be-rendered');
    });

  it('returns the same payload as text and as structured content', async () => {
    const result = await callTool(
      ASK_TOOL,
      { subject: 'Nobody', predicate: 'beta_partner' },
      silentNode(),
    );

    expect(JSON.parse(textOf(result))).toEqual(structuredOf(result));
  });

  it('adds the explanation and trace for explain, and the revision list for timeline',
    async () => {
      const explained = structuredOf(await callTool(
        EXPLAIN_TOOL,
        { subject: 'Nobody', predicate: 'beta_partner' },
        silentNode(),
      ));
      const timed = structuredOf(await callTool(
        TIMELINE_TOOL,
        { subject: 'Nobody', predicate: 'beta_partner' },
        silentNode(),
      ));

      expect(typeof explained['explanation']).toBe('string');
      expect(Array.isArray(explained['trace'])).toBe(true);
      expect(timed['considered']).toEqual([]);
      expect(explained['considered']).toBeUndefined();
    });

  it('answers health from one probe read', async () => {
    const result = await callTool(HEALTH_TOOL, {}, silentNode());
    const structured = structuredOf(result);

    expect(structured['reachable']).toBe(true);
    expect(structured['error']).toBeNull();
    expect(structured['hydra']).toEqual({
      store: 'node',
      namespace: 'test-namespace',
      graph: 'default',
      cell: 'cell-0',
      readEpoch: PROBE_EPOCH,
    });
    // Two: the probe read, then the name list that rules out a case difference
    // before the probe subject is called absent.
    expect((structured['queries'] as unknown[]).length).toBe(2);
  });

  it('reports an unreachable node as unhealthy rather than throwing', async () => {
    const structured = structuredOf(await callTool(HEALTH_TOOL, {}, deadNode()));

    expect(structured['reachable']).toBe(false);
    expect(structured['error']).toBe('HydraTransportError');
    expect(JSON.stringify(structured)).not.toContain('18443');
  });

  it('throws for a tool it does not implement', async () => {
    await expect(callTool('lacuna_forget', {}, silentNode())).rejects.toThrow(McpError);
    await expect(callTool('lacuna_forget', {}, silentNode()))
      .rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
  });

  it('throws for arguments it cannot use', async () => {
    await expect(callTool(ASK_TOOL, { predicate: 'beta_partner' }, silentNode()))
      .rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(callTool(ASK_TOOL, 'Bellwether', silentNode()))
      .rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('returns a read failure as a failed result, naming the class and not the endpoint',
    async () => {
      // A tool failure is a fact the model can act on. A protocol error is a
      // mistake in the request. This is the first kind, so it comes back as a
      // result rather than a throw.
      const result = await callTool(
        ASK_TOOL,
        { subject: 'Nobody', predicate: 'beta_partner' },
        deadNode(),
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      // The SDK prefixes an McpError's message with its code. What matters is
      // the tail: a class name, and nothing about where the node lives.
      expect(textOf(result))
        .toBe('MCP error -32603: the graph did not answer this read (HydraTransportError)');
      expect(textOf(result)).not.toContain('18443');
      expect(textOf(result)).not.toContain('token-that-must-never-be-rendered');
    });

  it('gives up on a slow read at the deadline', async () => {
    const slow = contextWith(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return new Response(emptyPage(), { status: 200 });
      },
      5,
    );

    const result = await callTool(ASK_TOOL, { subject: 'Nobody', predicate: 'x' }, slow);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('MCP error -32001: lacuna_ask did not finish within 5ms');
  });
});

describe('createMcpServer, over a linked in-memory transport', () => {
  async function connected(context: ToolContext): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(context);
    const client = new Client({ name: 'test-client', version: '0.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it('lists the seven tools with their schemas', async () => {
    const client = await connected(silentNode());

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      ASK_TOOL,
      EXPLAIN_TOOL,
      TIMELINE_TOOL,
      READ_TOOL,
      SEARCH_TOOL,
      FETCH_TOOL,
      HEALTH_TOOL,
    ]);
    await client.close();
  });

  it('returns output the SDK client accepts against the advertised output schema',
    async () => {
      // The client validates structuredContent against outputSchema on every
      // call, so this fails if a schema and the mapping ever disagree.
      const client = await connected(silentNode());

      for (const name of [ASK_TOOL, EXPLAIN_TOOL, TIMELINE_TOOL]) {
        const result = await client.callTool({
          name,
          arguments: { subject: 'Nobody', predicate: 'beta_partner' },
        });
        expect((result.structuredContent as Record<string, unknown>)['status'])
          .toBe('abstained');
      }

      const health = await client.callTool({ name: HEALTH_TOOL, arguments: {} });
      expect((health.structuredContent as Record<string, unknown>)['reachable']).toBe(true);

      await client.close();
    });

  it('reports an unimplemented tool as a protocol error over the wire', async () => {
    const client = await connected(silentNode());

    await expect(client.callTool({ name: 'lacuna_forget', arguments: {} }))
      .rejects.toMatchObject({ code: ErrorCode.MethodNotFound });

    await client.close();
  });
});

/**
 * A question in the words the caller used.
 *
 * The source here is a node that answers and knows nothing, so what these check
 * is the reading and the refusals rather than a value: an agent handed this
 * tool has to be able to tell "the corpus does not hold that name" apart from
 * "the corpus holds it and says nothing", because acting on those two is
 * completely different.
 */
describe('asking in a sentence', () => {
  it('refuses a sentence naming nothing the corpus holds, and says what it does hold', async () => {
    const result = await callTool(READ_TOOL, { question: 'who owns Cassandra?' }, silentNode());
    const structured = structuredOf(result);

    expect(result.isError).toBeUndefined();
    expect(structured['unread']).toBe('no_subject');
    expect(structured['read']).toBeNull();
    expect(structured['answer']).toBeNull();
    // The names are returned rather than left to be guessed at.
    expect(Array.isArray(structured['holds'])).toBe(true);
  });

  it('rejects an empty question as a bad request rather than answering it', async () => {
    await expect(callTool(READ_TOOL, { question: '   ' }, silentNode())).rejects.toThrow();
  });

  it('advertises a schema that admits only a question', () => {
    const tool = TOOLS.find((one) => one.name === READ_TOOL);
    const schema = tool?.inputSchema as { required?: string[]; additionalProperties?: boolean };
    expect(schema.required).toEqual(['question']);
    // A tool that silently accepted a subject would let a caller think it had
    // bypassed the parser when it had not.
    expect(schema.additionalProperties).toBe(false);
  });

  it('returns the reading beside the answer, never only the answer', () => {
    const tool = TOOLS.find((one) => one.name === READ_TOOL);
    const schema = tool?.outputSchema as { required?: string[] };
    // A caller that cannot see the reading cannot catch a misread, which is the
    // one failure a parser in front of a resolver introduces.
    expect(schema.required).toContain('read');
    expect(schema.required).toContain('answer');
  });
});

/**
 * The two tools named for a contract rather than for this product.
 *
 * A hosted client that looks for `search` and `fetch` will call them with no
 * knowledge of what a claim is, and will quote whatever comes back to somebody
 * who has never seen this server. So the thing that matters is not that they
 * return data: it is that a replaced value cannot leave here looking current.
 */
describe('search and fetch', () => {
  it('return nothing rather than the nearest thing', async () => {
    const result = await callTool(SEARCH_TOOL, { query: 'something this corpus never heard of' }, silentNode());
    expect(structuredOf(result)['results']).toEqual([]);
  });

  it('refuse an empty query and an empty id', async () => {
    await expect(callTool(SEARCH_TOOL, { query: '  ' }, silentNode())).rejects.toThrow();
    await expect(callTool(FETCH_TOOL, { id: '' }, silentNode())).rejects.toThrow();
  });

  it('say plainly when the memory holds nothing under an id', async () => {
    const structured = structuredOf(await callTool(FETCH_TOOL, { id: 'Nobody' }, silentNode()));
    expect(String(structured['text'])).toContain('holds nothing');
    // Still the documented shape, so a client does not have to special case it.
    expect(structured['id']).toBe('Nobody');
    expect(typeof structured['url']).toBe('string');
  });

  it('never let a disagreement leave marked as current', () => {
    // Not a live call: the node in these tests knows nothing. What is asserted
    // is the instruction that travels with every record, because the client
    // reading it has no idea what a contradiction is and will quote whatever
    // the text says.
    const fetched = TOOLS.find((one) => one.name === FETCH_TOOL);
    expect(fetched?.description).toContain('disputed');
  });

  it('advertise the shape a client builds a citation from', () => {
    const search = TOOLS.find((one) => one.name === SEARCH_TOOL);
    const results = (search?.outputSchema as { properties?: { results?: { items?: { required?: string[] } } } })
      .properties?.results?.items?.required;
    expect(results).toEqual(['id', 'title', 'url']);

    const fetched = TOOLS.find((one) => one.name === FETCH_TOOL);
    const required = (fetched?.outputSchema as { required?: string[] }).required;
    // `text` is the whole point: it is what gets quoted.
    expect(required).toContain('text');
    expect(required).toContain('url');
  });
});
