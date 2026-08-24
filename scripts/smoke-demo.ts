/**
 * The public surface of a deployment, exercised from outside it.
 *
 *   npm run smoke:demo -- https://lacuna-five.vercel.app
 *   npm run smoke:demo                     (defaults to http://127.0.0.1:3014)
 *
 * npm run smoke:web checks that the shell is served. This checks that the
 * product behind it answers: every read the demo screens make, and one live
 * question per outcome the resolver can reach. It talks to nothing but the
 * deployment's own HTTP surface, so it measures what a judge with a browser
 * would get rather than what the code would do if it ran.
 *
 * A gate fails loudly and the run continues, because one broken read is worth
 * knowing about alongside the rest rather than instead of it.
 */

export {};

const target = (process.argv[2] ?? 'http://127.0.0.1:3014').replace(/\/+$/, '');

interface Envelope {
  readonly status: string;
  readonly answer: string | null;
  readonly evidence: readonly unknown[];
  readonly revisions: readonly unknown[];
  readonly conflicts: readonly unknown[];
  readonly abstain_reason: string | null;
  readonly source_state: string;
  readonly took_ms: number;
}

interface Suggestion {
  readonly subject: string;
  readonly predicate: string;
}

let passed = 0;
let failed = 0;

function record(ok: boolean, name: string, detail: string): void {
  if (ok) passed += 1;
  else failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)}${detail}\n`);
}

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${target}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  try {
    return { status: response.status, body: (await response.json()) as T };
  } catch {
    return { status: response.status, body: null };
  }
}

/** The double submit token the ask endpoint requires, as a browser gets it. */
async function csrf(): Promise<string> {
  const response = await fetch(`${target}/api/session`, { headers: { Accept: 'application/json' } });
  for (const line of response.headers.getSetCookie()) {
    const match = /lacuna_csrf=([^;]+)/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error('the session endpoint issued no CSRF cookie');
}

process.stdout.write(`Demo surface, against ${target}\n\n`);

const token = await csrf();

// 1. Every read the demo screens make.
const parts = [
  'summary', 'changes', 'conflicts', 'connections', 'runs', 'health',
  'memory', 'categories', 'questions', 'hops', 'agents', 'tools',
  'evaluations', 'models', 'model',
];
for (const part of parts) {
  const { status } = await json(`/api/demo/${part}`);
  record(status === 200, `/api/demo/${part} answers`, `${status}`);
}

// 2. It holds the corpus, rather than being an empty workspace with a name.
const memory = await json<{ total: number }>('/api/demo/memory');
record(
  (memory.body?.total ?? 0) > 0,
  'the demo workspace holds the corpus',
  `${memory.body?.total ?? 0} rows`,
);

const publicConnectors = await json<{ connectors: readonly Record<string, unknown>[] }>('/api/explore/connectors');
const connectorRows = publicConnectors.body?.connectors ?? [];
const expectedConnectorIds = ['github', 'gitlab', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook', 'slack',
  'notion', 'jira', 'confluence', 'gmail'];
record(
  publicConnectors.status === 200
    && connectorRows.length === expectedConnectorIds.length
    && connectorRows.map((connector) => connector['id']).join(',') === expectedConnectorIds.join(',')
    && connectorRows.every((connector) => connector['availability'] === 'available' && connector['reason'] === null)
    && connectorRows.every((connector) => Object.keys(connector).sort().join(',') === 'availability,group,id,label,reason'),
  'public connector catalogue is complete and redacted',
  `${publicConnectors.status} ${connectorRows.length} entries`,
);

const agentRows = (await json<readonly Record<string, unknown>[]>('/api/demo/agents')).body ?? [];
const agentRoles = agentRows.map((agent) => agent['role']).sort().join(',');
record(
  agentRows.length === 2 && agentRoles === 'RESEARCHER,REVIEWER',
  'public agent catalogue exposes both bounded roles',
  `${agentRows.length} roles · ${agentRoles || 'none'}`,
);

// 3. Read only. A write to it is not a route.
const written = await fetch(`${target}/api/demo/questions`, { method: 'POST' });
record(written.status === 404, 'the demo workspace refuses writes', `${written.status}`);

// 4. One live question per outcome, through the endpoint the screens use.
const suggestions = (await json<readonly Suggestion[]>('/api/demo/questions')).body ?? [];
const hops = (await json<readonly Suggestion[]>('/api/demo/hops')).body ?? [];

async function ask(question: Suggestion & { via?: string }): Promise<Envelope | null> {
  const { body } = await json<Envelope>('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': token, Cookie: `lacuna_csrf=${token}` },
    body: JSON.stringify(question),
  });
  return body;
}

const outcomes = new Set<string>();
for (const suggestion of suggestions) {
  const envelope = await ask(suggestion);
  if (envelope === null) {
    record(false, `ask ${suggestion.subject} · ${suggestion.predicate}`, 'no envelope');
    continue;
  }
  outcomes.add(envelope.status);
  record(
    envelope.source_state === 'live' && envelope.took_ms > 0,
    `ask ${suggestion.subject} · ${suggestion.predicate}`,
    `${envelope.status} ${envelope.took_ms}ms ${envelope.source_state}`,
  );
}

const hop = hops[0];
if (hop !== undefined) {
  const envelope = await ask({ ...hop, via: 'vendor' });
  outcomes.add(envelope?.status ?? 'none');
  record(
    envelope?.status === 'ANSWERED' && (envelope?.evidence.length ?? 0) > 0,
    'a two hop question is answered and cited',
    `${envelope?.status} ${envelope?.answer} ${envelope?.took_ms}ms`,
  );
}

// 5. More than one outcome. A surface that only ever answers is not showing a
// memory system, and a suite that only ever sees answers is not testing one.
record(
  outcomes.size >= 3,
  'the questions reach more than one outcome',
  [...outcomes].sort().join(', '),
);

// 6. Health is a real round trip with a measurement in it.
const health = await json<{ ok: boolean; checks: readonly { name: string; state: string; detail: string }[] }>('/api/health');
const trip = health.body?.checks.find((check) => check.name === 'round trip');
record(health.body?.ok === true, 'health reports a working context store', `${health.status}`);
record(
  trip !== undefined && /[\d.]+\s*ms/.test(trip.detail),
  'health carries a measured round trip',
  trip?.detail ?? 'no round trip check',
);

// 7. The two public pages are served, and survive a refresh on a deep path.
for (const path of ['/judge', '/demo/dash', '/demo/ask', '/demo/hydra']) {
  const response = await fetch(`${target}${path}`, { headers: { Accept: 'text/html' } });
  const html = await response.text();
  record(
    response.status === 200 && html.includes('<div id="root">'),
    `${path} is served`,
    `${response.status}`,
  );
}

process.stdout.write(`\n${passed} of ${passed + failed} gates passed against ${target}\n`);
if (failed > 0) process.exit(1);
