import { createServer, request as nodeRequest, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CloudMcpCapabilities,
  MCP_CAPABILITY_TTL_MS,
} from '../../src/auth/mcp-capability-store.js';
import { mintMcpCapability } from '../../src/auth/mcp-capability.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';
import { emptySubject } from '../../src/hydra/source.js';
import { createMcpListener, MCP_REQUEST_LIMIT, MCP_TOOL_LIMIT, type HttpOptions } from '../../src/mcp/http.js';
import type { ToolContext } from '../../src/mcp/server.js';

const CONTEXT: ToolContext = {
  source: {
    kind: 'cloud',
    subjects: async () => ({ value: [], traces: [] }),
    entity: async () => ({ value: null, traces: [] }),
    subject: async (name) => ({ value: emptySubject(name), traces: [] }),
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
  },
  node: { namespace: 'test', graph: 'public', cell: 'cloud' },
  store: 'cloud',
};

const WRITABLE: ToolContext = {
  ...CONTEXT,
  node: { namespace: 'test', graph: 'private', cell: 'cloud' },
  remember: async () => ({ claims: 1, entities: 1, turns: 1, accepted: 1, collection: 'private' }),
};

const INITIALIZE = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

const servers: Server[] = [];

class CapabilityCloud {
  readonly records = new Map<string, string>();

  async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    for (const record of records) {
      this.records.set(`${collection}:${record.id}`, JSON.stringify({ content: { text: record.text } }));
    }
    return records.map((record) => ({ id: record.id, filename: record.title, status: 'completed', error: null }));
  }

  async inspect(id: string, _timeoutMs: number, collection: string): Promise<InspectedSource | null> {
    const envelope = this.records.get(`${collection}:${id}`);
    return envelope === undefined ? null : { id, envelope, latencyMs: 1 };
  }
}

function hydra(cloud: CapabilityCloud): HydraCloud {
  return cloud as unknown as HydraCloud;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function serving(options: Partial<HttpOptions> = {}): Promise<string> {
  const listener = createMcpListener({ context: CONTEXT, ...options });
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

function post(base: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

describe('MCP HTTP authorization', () => {
  it('keeps the public read-only endpoint available', async () => {
    const base = await serving();
    const response = await post(base, INITIALIZE);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ result: { serverInfo: { name: 'lacuna' } } });
  });

  it('accepts a configured production Origin but rejects a foreign private request before capability lookup', async () => {
    const capability = mintMcpCapability();
    let capabilityLookups = 0;
    const base = await serving({
      allowedOrigins: ['https://lacuna-five.vercel.app'],
      authorizeWorkspace: (candidate) => {
        capabilityLookups += 1;
        return candidate === capability ? WRITABLE : null;
      },
    });

    const sameOrigin = await post(base, INITIALIZE, { origin: 'https://lacuna-five.vercel.app' });
    expect(sameOrigin.status).toBe(200);

    capabilityLookups = 0;
    const foreignOrigin = await fetch(`${base}/mcp/w/${capability}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        origin: 'https://untrusted-origin.example',
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(foreignOrigin.status).toBe(403);
    expect(capabilityLookups).toBe(0);
  });

  it('accepts a loopback browser Origin without an explicit production allowlist', async () => {
    const base = await serving();
    const response = await post(base, INITIALIZE, { origin: 'http://localhost:5173' });
    expect(response.status).toBe(200);
  });

  it('fails closed for the deterministic collection handles previously used as write authority', async () => {
    const base = await serving({
      // The legacy callback may still be passed by old deployment wiring, but
      // the transport must never consult it as authorization.
      contextFor: () => WRITABLE,
    });
    const response = await fetch(`${base}/mcp/w/lacuna-ws-${'a'.repeat(32)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(INITIALIZE),
    });
    expect(response.status).toBe(401);
  });

  it('accepts only a random capability resolved to one scoped context', async () => {
    const capability = mintMcpCapability();
    const seen: string[] = [];
    const base = await serving({
      authorizeWorkspace: (candidate) => {
        seen.push(candidate);
        return candidate === capability ? WRITABLE : null;
      },
    });
    const response = await post(base, INITIALIZE, { authorization: `Bearer ${capability}` });
    expect(response.status).toBe(200);
    expect(seen).toEqual([capability]);
  });

  it('preserves path-only clients but denies the same bearer at its exact expiry', async () => {
    const workspace = `lacuna-ws-${'c'.repeat(32)}`;
    const start = Date.parse('2026-08-20T10:00:00.000Z');
    let clock = start;
    const capabilities = new CloudMcpCapabilities(hydra(new CapabilityCloud()));
    const issued = await capabilities.issue(workspace, start);
    const base = await serving({
      authorizeWorkspace: async (candidate) => (
        await capabilities.resolve(candidate, clock) === workspace ? WRITABLE : null
      ),
    });
    const pathResponse = await fetch(`${base}/mcp/w/${issued.capability}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(INITIALIZE),
    });
    expect(pathResponse.status).toBe(200);

    clock = start + MCP_CAPABILITY_TTL_MS;
    const expired = await post(base, INITIALIZE, { authorization: `Bearer ${issued.capability}` });
    expect(expired.status).toBe(401);
  });
});

describe('MCP HTTP resource bounds', () => {
  it('enforces the body cap on actual chunked bytes without trusting Content-Length', async () => {
    const base = await serving();
    const url = new URL('/mcp', base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = nodeRequest({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.write(Buffer.alloc(700_000, 0x20));
      req.end(Buffer.alloc(400_000, 0x20));
    });
    expect(status).toBe(413);
  });

  it('applies a bounded request budget before another protocol request is handled', async () => {
    const base = await serving({
      requestLimit: { limit: 1, windowMs: 60_000, maxKeys: 8 },
      now: () => 1_000,
    });
    expect((await post(base, INITIALIZE)).status).toBe(200);
    const limited = await post(base, INITIALIZE);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('budgets tool calls separately from protocol setup', async () => {
    const base = await serving({
      requestLimit: { limit: 10, windowMs: 60_000, maxKeys: 8 },
      toolLimit: { limit: 1, windowMs: 60_000, maxKeys: 8 },
      now: () => 1_000,
    });
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lacuna_health', arguments: {} } };
    expect((await post(base, call)).status).not.toBe(429);
    expect((await post(base, call)).status).toBe(429);
  });

  it('gives the private prose writer its own tighter budget', async () => {
    const capability = mintMcpCapability();
    const base = await serving({
      authorizeWorkspace: () => WRITABLE,
      requestLimit: { limit: 10, windowMs: 60_000, maxKeys: 8 },
      toolLimit: { limit: 10, windowMs: 60_000, maxKeys: 8 },
      writeLimit: { limit: 1, windowMs: 60_000, maxKeys: 8 },
      now: () => 1_000,
    });
    const call = {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'remember', arguments: { text: 'Junco uses Redis.' } },
    };
    const headers = { authorization: `Bearer ${capability}` };
    expect((await post(base, call, headers)).status).not.toBe(429);
    expect((await post(base, call, headers)).status).toBe(429);
  });
});

describe('the ceilings a sweep has to be able to raise', () => {
  /** One tool call, repeated, counting how many the server refuses. */
  async function refusals(base: string, calls: number): Promise<number> {
    const call = { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'lacuna_health', arguments: {} } };
    let refused = 0;
    for (let at = 0; at < calls; at += 1) {
      if ((await post(base, call)).status === 429) refused += 1;
    }
    return refused;
  }

  it('ships the production ceilings when nothing overrides them', () => {
    // The numbers are a judgement call; that a deployment gets these when no
    // flag is passed is not. A gate quietly running against looser limits than
    // production would be testing a server nobody ships.
    expect(MCP_TOOL_LIMIT).toEqual({ limit: 30, windowMs: 60_000, maxKeys: 8_192 });
    expect(MCP_REQUEST_LIMIT).toEqual({ limit: 120, windowMs: 60_000, maxKeys: 8_192 });
  });

  it('refuses a sixty-four question sweep at the production tool ceiling', async () => {
    // This is the failure that left the three-surface parity gate red without
    // anyone noticing: a sweep is exactly the traffic the ceiling exists to
    // refuse, and the gate could not tell a working limiter from a broken
    // transport. Asserted so the next reader sees a limit, not an outage.
    const base = await serving({ toolLimit: MCP_TOOL_LIMIT, now: () => 1_000 });
    expect(await refusals(base, 40)).toBeGreaterThan(0);
  });

  it('admits the same sweep when a caller raises the ceiling for its own process', async () => {
    const base = await serving({
      toolLimit: { limit: 400, windowMs: 60_000, maxKeys: 8 },
      requestLimit: { limit: 2_000, windowMs: 60_000, maxKeys: 8 },
      now: () => 1_000,
    });
    expect(await refusals(base, 40)).toBe(0);
  });
});
