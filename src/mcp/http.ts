import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { createMcpServer, type ToolContext } from './server.js';

/**
 * The Streamable HTTP transport, for clients that cannot spawn a process.
 *
 * Stateless: a fresh server and a fresh transport per request, closed when the
 * response ends. There is no session to resume and no cross-request state, so
 * there is nothing for one caller to inherit from another. Every tool is a
 * read, so a session would buy nothing but bookkeeping.
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

function refuse(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
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
   * Builds the context for one named workspace, when a caller asks for one.
   *
   * An MCP client that ingested a transcript through the web product should be
   * able to read that same memory from its agent, or the two halves are two
   * products. The workspace is named by the `x-lacuna-workspace` header,
   * carrying the collection id the ingest report returned. A collection id is
   * an unguessable 32-hex handle derived from the account, so possession is
   * the authorisation, the same way an unlisted document link works. Nothing
   * writable is reachable through MCP either way.
   */
  readonly contextFor?: (collection: string) => ToolContext;
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
   * Turning it on does not widen what the tools can read. Every tool is a read
   * against the context it was constructed with, and the deployment constructs
   * it over the same public demo corpus `/api/demo/*` already serves.
   */
  readonly allowAnyOrigin?: boolean;
}

/**
 * The headers a browser needs before it will make the request at all.
 *
 * A hosted client that connects from a page rather than from its own backend
 * sends a preflight first, and a 405 there means the real request is never
 * attempted: the endpoint looks broken while working perfectly for curl. That
 * was the state this was in.
 *
 * Any origin, and deliberately no credentials. Every tool is a read, the
 * default context is the corpus anybody can fetch without an account, and a
 * workspace read needs a handle that is unguessable and carried in a header
 * rather than in a cookie. Nothing here is protected by the browser refusing
 * to send the request, so refusing it bought nothing and cost the connection.
 */
const CORS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id, x-lacuna-workspace',
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

  return (req, res) => {
    /**
     * The workspace, from the path or from a header.
     *
     * The header came first and is kept, but the path is the one that works
     * everywhere. Hosted clients take a URL and little else: one dedupes
     * connectors by URL, so a second workspace on the same address cannot be
     * added at all, and another offers no way to set a header. A handle in the
     * path makes each workspace its own address, which is what those clients
     * are built to accept, and it needs no configuration beyond pasting a link.
     *
     * The handle is unguessable either way, so nothing moved from a secret
     * place to a public one: it was always a bearer value, and a URL is exactly
     * as private as a header somebody has to be given.
     */
    const url = new URL(req.url ?? '/', 'http://localhost');
    const fromPath = url.pathname.startsWith(`${MCP_PATH}/w/`)
      ? url.pathname.slice(`${MCP_PATH}/w/`.length).replace(/\/+$/, '')
      : undefined;
    const wanted = fromPath ?? header(req, 'x-lacuna-workspace');

    const scoped = wanted !== undefined && COLLECTION_SHAPE.test(wanted) && options.contextFor !== undefined
      ? options.contextFor(wanted)
      : options.context;
    void handle(req, res, scoped, log, options.allowAnyOrigin === true);
  };
}

/**
 * What a workspace handle looks like. Anything else is ignored rather than
 * refused, so a stray header cannot turn a public read into an error.
 */
const COLLECTION_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/;

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  context: ToolContext,
  log: (line: string) => void,
  allowAnyOrigin: boolean,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // `/mcp` is the public corpus and `/mcp/w/<handle>` is one workspace. A
  // handle that is not a handle already fell back to the public context above,
  // so this only has to reject a path that is neither shape.
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

  const declared = Number(header(req, 'content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    refuse(res, 413, `the body cap is ${MAX_BODY_BYTES} bytes`);
    return;
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
    await transport.handleRequest(req, res);
  } catch (error) {
    log(`the MCP endpoint failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
    if (!res.headersSent) {
      refuse(res, 500, 'the MCP endpoint failed');
    } else {
      res.end();
    }
  }
}
