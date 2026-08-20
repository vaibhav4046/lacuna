import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { createHash } from 'node:crypto';

import { MCP_CAPABILITY_SHAPE } from '../auth/mcp-capability.js';
import { FixedWindow, type RateLimitOptions } from '../server/ratelimit.js';
import { createMcpServer, type ToolContext } from './server.js';

/**
 * The Streamable HTTP transport, for clients that cannot spawn a process.
 *
 * Stateless: a fresh server and a fresh transport per request, closed when the
 * response ends. There is no session to resume and no cross-request state, so
 * there is nothing for one caller to inherit from another. Public tools are
 * reads. A private context may add `remember`, but only after a separate random
 * capability has resolved to that context.
 *
 * The Origin check is written here rather than configured on the transport
 * because the transport's own `allowedOrigins` and `enableDnsRebindingProtection`
 * options are marked deprecated in the SDK, which points at external middleware
 * instead. This is that middleware.
 */

/** Where the transport is mounted. */
export const MCP_PATH = '/mcp';

/**
 * Hosts a browser may claim to be, matching the set `src/hydra/config.ts`
 * accepts for the node itself.
 *
 * `URL` reports an IPv6 host in brackets, so both spellings are listed.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * A body cap, so a request cannot make the process buffer without limit.
 *
 * A tool call is a subject, a predicate and maybe a via. Anything approaching a
 * megabyte is not one of those.
 */
const MAX_BODY_BYTES = 1_048_576;

export const MCP_REQUEST_LIMIT = Object.freeze({ limit: 120, windowMs: 60_000, maxKeys: 8_192 });
export const MCP_TOOL_LIMIT = Object.freeze({ limit: 30, windowMs: 60_000, maxKeys: 8_192 });
export const MCP_WRITE_LIMIT = Object.freeze({ limit: 6, windowMs: 60_000, maxKeys: 8_192 });

/**
 * Is this request allowed to come from a page.
 *
 * An absent Origin is allowed: command-line MCP clients do not send one, and
 * the header exists to stop a page in a browser from reaching a loopback
 * server, not to authenticate anything. When it is present it must be a real
 * http or https URL pointing at loopback. The literal `null` origin, which is
 * what a sandboxed frame or a `file:` page sends, fails both checks.
 */
export function isLoopbackOrigin(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return false;
  }

  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return false;
  }
  return LOOPBACK_HOSTS.has(origin.hostname);
}

function refuse(res: ServerResponse, status: number, message: string, retryAfterSeconds?: number): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    ...(retryAfterSeconds === undefined ? {} : { 'retry-after': String(retryAfterSeconds) }),
  });
  res.end(JSON.stringify({ error: message }));
}

/** What a single header value is, once Node's array form is collapsed. */
function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

export interface HttpOptions {
  readonly context: ToolContext;
  /**
   * Legacy seam retained while the deployment migrates. It is deliberately not
   * consulted: a collection id derived from an email is an address, not proof
   * that the caller owns the account. Remove this option after index wiring no
   * longer passes it.
   */
  readonly contextFor?: (collection: string) => ToolContext;
  /**
   * Resolves an independently random, revocable bearer capability.
   *
   * The callback must look up a hash of the capability and return only the
   * workspace bound to that record. A deterministic collection id is not an
   * authorization decision and is never passed here.
   */
  readonly authorizeWorkspace?: (capability: string) => Promise<ToolContext | null> | ToolContext | null;
  /** Called once per rejected request. Never called with a header value. */
  readonly log?: (line: string) => void;
  /**
   * Serve requests from any origin, for a deployment rather than a laptop.
   *
   * The Origin check exists to stop a page in a browser reaching a server bound
   * to loopback, which is a real attack against a local process and not a
   * meaningful one against a public HTTPS endpoint that any client may call
   * directly. A hosted server that refuses every remote origin is a server no
   * hosted client can use.
   *
   * Turning it on does not widen what the public tools can read. Private tools
   * are reachable only after `authorizeWorkspace` returns a scoped context.
   */
  readonly allowAnyOrigin?: boolean;
  /** Test/configuration seams. Hosted limits still need a durable gateway. */
  readonly requestLimit?: RateLimitOptions;
  readonly toolLimit?: RateLimitOptions;
  readonly writeLimit?: RateLimitOptions;
  readonly now?: () => number;
}

/**
 * The headers a browser needs before it will make the request at all.
 *
 * A hosted client that connects from a page rather than from its own backend
 * sends a preflight first, and a 405 there means the real request is never
 * attempted: the endpoint looks broken while working perfectly for curl. That
 * was the state this was in.
 *
 * Any origin, and deliberately no cookies. The default context is the corpus
 * anybody can fetch without an account. A workspace call needs an independent
 * random capability in an Authorization/header field or, for clients that
 * cannot set headers, in the path. CORS is not treated as authorization.
 */
const CORS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id, x-lacuna-capability',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '86400',
};

/**
 * A request listener for the MCP endpoint.
 *
 * Only POST is served, plus the OPTIONS a browser sends before it. In stateless
 * mode the GET stream carries nothing, since this server never sends an
 * unsolicited notification, and answering 405 is more honest than holding a
 * stream open that will stay empty. The specification allows exactly that and
 * requires clients to accept it.
 */
export function createMcpListener(
  options: HttpOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const log = options.log ?? ((): void => {});
  const requests = new FixedWindow(options.requestLimit ?? MCP_REQUEST_LIMIT);
  const tools = new FixedWindow(options.toolLimit ?? MCP_TOOL_LIMIT);
  const writes = new FixedWindow(options.writeLimit ?? MCP_WRITE_LIMIT);
  const now = options.now ?? Date.now;

  return (req, res) => {
    void handle(req, res, options, log, options.allowAnyOrigin === true, requests, tools, writes, now);
  };
}

class BodyLimitExceeded extends Error {}

async function boundedBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new BodyLimitExceeded();
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new SyntaxError('invalid JSON');
  }
}

function bearer(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/iu.exec(value.trim());
  return match?.[1];
}

interface CapabilityRequest {
  readonly privateRequested: boolean;
  readonly capability: string | null;
  readonly conflicting: boolean;
}

function requestedCapability(req: IncomingMessage, url: URL): CapabilityRequest {
  const privateRequested = url.pathname.startsWith(`${MCP_PATH}/w/`);
  const path = privateRequested
    ? url.pathname.slice(`${MCP_PATH}/w/`.length).replace(/\/+$/, '')
    : undefined;
  const supplied = [
    path,
    header(req, 'x-lacuna-capability'),
    bearer(header(req, 'authorization')),
  ].filter((value): value is string => value !== undefined && value !== '');
  const unique = [...new Set(supplied)];
  return {
    privateRequested: privateRequested || unique.length > 0,
    capability: unique.length === 1 && MCP_CAPABILITY_SHAPE.test(unique[0] ?? '') ? unique[0] ?? null : null,
    conflicting: unique.length > 1,
  };
}

function sourceKey(req: IncomingMessage, capability: string | null): string {
  const forwarded = header(req, 'x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded === undefined || forwarded === '' ? req.socket.remoteAddress ?? 'unknown' : forwarded;
  const scope = capability === null
    ? 'public'
    : createHash('sha256').update(capability, 'utf8').digest('hex').slice(0, 24);
  return `${scope}:${address}`;
}

function calls(parsed: unknown): readonly { readonly method: string; readonly tool: string | null }[] {
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return [];
    const record = row as Readonly<Record<string, unknown>>;
    if (record['method'] !== 'tools/call') return [];
    const params = record['params'];
    const tool = typeof params === 'object' && params !== null && !Array.isArray(params)
      && typeof (params as Readonly<Record<string, unknown>>)['name'] === 'string'
      ? String((params as Readonly<Record<string, unknown>>)['name'])
      : null;
    return [{ method: 'tools/call', tool }];
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpOptions,
  log: (line: string) => void,
  allowAnyOrigin: boolean,
  requests: FixedWindow,
  tools: FixedWindow,
  writes: FixedWindow,
  now: () => number,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // `/mcp` is the public corpus and `/mcp/w/<capability>` is one workspace.
  // The latter still has to pass capability resolution below.
  const workspacePath = url.pathname.startsWith(`${MCP_PATH}/w/`);
  if (url.pathname !== MCP_PATH && !workspacePath) {
    refuse(res, 404, `nothing is mounted at ${url.pathname}`);
    return;
  }

  // Answered before the origin check, because a preflight is the request that
  // asks whether the origin is acceptable. Refusing it with a 403 tells the
  // browser nothing except that the endpoint is broken.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, allowAnyOrigin ? { ...CORS, 'content-length': '0' } : { allow: 'POST', 'content-length': '0' });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, {
      'content-type': 'application/json',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      allow: 'POST, OPTIONS',
      ...(allowAnyOrigin ? CORS : {}),
    });
    res.end(JSON.stringify({ error: 'the MCP endpoint accepts POST' }));
    return;
  }

  if (allowAnyOrigin) {
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value);
  }

  if (!allowAnyOrigin && !isLoopbackOrigin(header(req, 'origin'))) {
    log('rejected a request with a non-loopback Origin');
    refuse(res, 403, 'this endpoint serves loopback origins only');
    return;
  }

  const requested = requestedCapability(req, url);
  const requestKey = sourceKey(req, null);
  // Count before capability lookup. Otherwise a stream of wrong capabilities
  // spends unbounded persistence reads without entering any budget.
  const requestVerdict = requests.check(requestKey, now());
  if (!requestVerdict.allowed) {
    refuse(res, 429, 'the MCP request limit was reached', requestVerdict.retryAfterSeconds);
    return;
  }

  let context = options.context;
  if (requested.privateRequested) {
    if (requested.conflicting || requested.capability === null || options.authorizeWorkspace === undefined) {
      refuse(res, 401, 'a valid workspace capability is required');
      return;
    }
    try {
      const scoped = await options.authorizeWorkspace(requested.capability);
      if (scoped === null) {
        refuse(res, 401, 'a valid workspace capability is required');
        return;
      }
      context = scoped;
    } catch {
      refuse(res, 503, 'workspace authorization is unavailable');
      return;
    }
  }

  const key = sourceKey(req, requested.capability);

  const declared = Number(header(req, 'content-length') ?? '0');
  if (!Number.isFinite(declared) || declared < 0) {
    refuse(res, 400, 'content-length is invalid');
    return;
  }
  if (declared > MAX_BODY_BYTES) {
    refuse(res, 413, `the body cap is ${MAX_BODY_BYTES} bytes`);
    return;
  }

  let parsed: unknown;
  try {
    parsed = await boundedBody(req);
  } catch (error) {
    // Keep consuming an oversized request so a persistent connection cannot
    // smuggle its remaining bytes into the next request.
    req.resume();
    refuse(res, error instanceof BodyLimitExceeded ? 413 : 400,
      error instanceof BodyLimitExceeded ? `the body cap is ${MAX_BODY_BYTES} bytes` : 'the request body is not valid JSON');
    return;
  }

  const toolCalls = calls(parsed);
  for (const call of toolCalls) {
    const verdict = tools.check(key, now());
    if (!verdict.allowed) {
      refuse(res, 429, 'the MCP tool limit was reached', verdict.retryAfterSeconds);
      return;
    }
    if (call.tool === 'remember') {
      const writeVerdict = writes.check(key, now());
      if (!writeVerdict.allowed) {
        refuse(res, 429, 'the MCP write limit was reached', writeVerdict.retryAfterSeconds);
        return;
      }
    }
  }

  const server = createMcpServer(context);
  // Leaving `sessionIdGenerator` out is what selects stateless mode. The SDK
  // documents omission, not `undefined`, and under `exactOptionalPropertyTypes`
  // only omission type-checks.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    // The cast covers one SDK type mismatch and nothing else. `Transport`
    // declares `onclose?: () => void`, while this transport exposes it as an
    // accessor typed `(() => void) | undefined`. Under
    // `exactOptionalPropertyTypes` those are different types, though at runtime
    // they are the same field.
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, parsed);
  } catch (error) {
    log(`the MCP endpoint failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
    if (!res.headersSent) {
      refuse(res, 500, 'the MCP endpoint failed');
    } else {
      res.end();
    }
  }
}
