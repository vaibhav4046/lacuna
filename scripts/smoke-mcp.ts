/**
 * The MCP surface of a deployment, exercised the way a client reaches it.
 *
 *   npm run smoke:mcp -- https://lacuna-five.vercel.app
 *   npm run smoke:mcp                      (defaults to http://127.0.0.1:3014)
 *
 * smoke:demo checks the REST surface a browser uses. This checks the one an
 * assistant uses: the handshake, the published catalog, and every tool in it
 * actually called over Streamable HTTP. Cursor and Grok Bot read the same
 * `.cursor/mcp.json` and take this exact path, so a green run here is the
 * connection check for both of them.
 *
 * The catalog is asserted as a closed set rather than a minimum. A client that
 * gains a tool nobody published is a bigger problem than one that loses a tool,
 * because the published catalog is a promise that Lacuna cannot write.
 *
 * A gate fails loudly and the run continues, because one broken tool is worth
 * knowing about alongside the rest rather than instead of it.
 */

export {};

const target = (process.argv[2] ?? 'http://127.0.0.1:3014').replace(/\/+$/, '');
const PROTOCOL_VERSION = '2025-06-18';

/** The public catalog, exactly. Nothing here writes, resets, deletes or schedules. */
const PUBLISHED = [
  'lacuna_ask',
  'lacuna_explain',
  'lacuna_timeline',
  'lacuna_read_question',
  'search',
  'fetch',
  'lacuna_health',
] as const;

let passed = 0;
let failed = 0;

function record(ok: boolean, name: string, detail: string): void {
  if (ok) passed += 1;
  else failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)}${detail}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let nextId = 1;

/** One JSON-RPC round trip. Accepts both framings the transport may answer in. */
async function rpc(method: string, params?: unknown): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${target}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  const text = await response.text();
  // A Streamable HTTP server may answer as JSON or as one SSE frame.
  const payload = text.startsWith('event:') || text.startsWith('data:')
    ? (/^data:\s*(.+)$/mu.exec(text)?.[1] ?? '')
    : text;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The text content of a tools/call result, or null if it reported a failure. */
function toolText(frame: Record<string, unknown> | null): string | null {
  const result = frame?.['result'];
  if (!isRecord(result) || result['isError'] === true) return null;
  const content = result['content'];
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (isRecord(item) && typeof item['text'] === 'string') parts.push(item['text']);
  }
  return parts.length === 0 ? null : parts.join('\n');
}

process.stdout.write(`MCP surface, against ${target}\n\n`);

// 1. The handshake.
const initialize = await rpc('initialize', {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: 'lacuna-smoke', version: '1' },
});
const initResult = isRecord(initialize?.['result']) ? initialize['result'] : null;
const serverInfo = isRecord(initResult?.['serverInfo']) ? initResult['serverInfo'] : null;
record(
  initResult?.['protocolVersion'] === PROTOCOL_VERSION,
  'handshake agrees the protocol version',
  String(initResult?.['protocolVersion'] ?? 'no answer'),
);
record(serverInfo?.['name'] === 'lacuna', 'server identifies itself', String(serverInfo?.['name'] ?? '-'));
record(
  isRecord(initResult?.['capabilities']) && isRecord(initResult['capabilities']['tools']),
  'server advertises tools',
  'capabilities.tools',
);

// 2. The catalog, as a closed set.
const listed = await rpc('tools/list');
const listResult = isRecord(listed?.['result']) ? listed['result'] : null;
const tools = Array.isArray(listResult?.['tools']) ? listResult['tools'] : [];
const names = tools
  .map((tool) => (isRecord(tool) && typeof tool['name'] === 'string' ? tool['name'] : ''))
  .filter((name) => name !== '')
  .sort();
const expected = [...PUBLISHED].sort();
record(
  names.length === expected.length && names.every((name, index) => name === expected[index]),
  'the published catalog is exactly seven tools',
  names.join(', ') || 'none',
);
const forbidden = names.filter((name) => /write|remember|reset|delete|schedule|run_agent/u.test(name));
record(forbidden.length === 0, 'no write, reset, delete or schedule tool', forbidden.join(', ') || 'none published');
for (const tool of tools) {
  if (!isRecord(tool)) continue;
  const schema = tool['inputSchema'];
  record(
    isRecord(schema) && schema['type'] === 'object',
    `${String(tool['name'])} publishes an input schema`,
    isRecord(schema) ? 'object' : 'missing',
  );
}

// 3. Every tool, actually called.
const health = toolText(await rpc('tools/call', { name: 'lacuna_health', arguments: {} }));
// The health envelope reports reachability and a null error, not a status word.
record(
  health !== null && health.includes('"reachable": true') && health.includes('"error": null'),
  'lacuna_health reports a reachable store',
  health === null ? 'no content' : 'reachable, no error',
);

const ask = toolText(await rpc('tools/call', {
  name: 'lacuna_ask',
  arguments: { subject: 'Meridian', predicate: 'launch_date' },
}));
record(
  ask !== null && ask.includes('"answered"') && ask.includes('25 July 2026'),
  'lacuna_ask settles a question the graph answers',
  ask === null ? 'no content' : 'answered with a value',
);

const explain = toolText(await rpc('tools/call', {
  name: 'lacuna_explain',
  arguments: { subject: 'Meridian', predicate: 'launch_date' },
}));
record(
  explain !== null && explain.includes('"evidence"') && explain.includes('"quote"'),
  'lacuna_explain returns evidence, not reasoning',
  explain === null ? 'no content' : 'evidence with quotes',
);

const timeline = toolText(await rpc('tools/call', {
  name: 'lacuna_timeline',
  arguments: { subject: 'Everstone', predicate: 'migration_window' },
}));
record(timeline !== null, 'lacuna_timeline walks a revised pair', timeline === null ? 'no content' : 'claims returned');

const read = toolText(await rpc('tools/call', {
  name: 'lacuna_read_question',
  arguments: { question: 'When does Meridian launch?' },
}));
record(read !== null, 'lacuna_read_question takes a sentence', read === null ? 'no content' : 'answered');

const searched = toolText(await rpc('tools/call', { name: 'search', arguments: { query: 'Meridian' } }));
record(searched !== null, 'search returns results', searched === null ? 'no content' : 'results returned');

// `fetch` takes an id that `search` produced, so the two are checked as a pair.
const firstId = searched === null ? null : (/"id"\s*:\s*"([^"]+)"/u.exec(searched)?.[1] ?? null);
if (firstId === null) {
  record(false, 'search yields an id fetch can take', 'no id in search results');
} else {
  const fetched = toolText(await rpc('tools/call', { name: 'fetch', arguments: { id: firstId } }));
  record(fetched !== null, 'fetch retrieves what search found', fetched === null ? 'no content' : firstId.slice(0, 24));
}

// 4. The refusals a client will meet.
const unknownTool = await rpc('tools/call', { name: 'lacuna_write', arguments: {} });
const unknownResult = unknownTool?.['result'];
record(
  unknownTool?.['error'] !== undefined || (isRecord(unknownResult) && unknownResult['isError'] === true),
  'an unpublished tool is refused',
  'lacuna_write',
);

const badArgs = await rpc('tools/call', { name: 'lacuna_ask', arguments: { subject: 'Meridian' } });
const badResult = badArgs?.['result'];
record(
  badArgs?.['error'] !== undefined || (isRecord(badResult) && badResult['isError'] === true),
  'a call missing a required argument is refused',
  'lacuna_ask without predicate',
);

process.stdout.write(`\n${passed} of ${passed + failed} gates passed against ${target}\n`);
if (failed > 0) process.exit(1);
