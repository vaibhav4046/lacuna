/**
 * The landing page's own copy, lifted from the design's class fields.
 *
 * This is marketing prose, not workspace data: the Redis-to-Postgres story is
 * how the page explains temporal resolution to someone who has never signed
 * in. It is frozen copy and it stays frozen. The same story inside the signed
 * in app is a different thing entirely and comes from the API there.
 */

export const FAQ: readonly (readonly [string, string])[] = [
  ['What is Lacuna?', 'Lacuna is a context layer for AI agents. It keeps useful memory available across sessions, models and tools.'],
  ['Is Lacuna a database?', 'No. HydraDB is the graph and state substrate. Lacuna controls how agents use that state.'],
  ['Why not just use a vector database?', 'Similarity is useful, but an agent also needs relationships, history, source context and a way to tell current information from old information.'],
  ['What is context rot?', 'Context rot happens when an agent keeps collecting stale, duplicate, conflicting or weak context until more memory starts making the next answer worse.'],
  ['What is a Context Pack?', 'It is the small set of facts, constraints, evidence and open questions needed for one task.'],
  ['Does Lacuna replace my model?', 'No. Models do the work. Lacuna keeps the context.'],
  ['Can I use a local model?', 'Lacuna is designed to support local and self-hosted model adapters such as Ollama, vLLM and compatible endpoints.'],
  ['Can different agents share memory?', 'Yes. The product is designed around a shared workspace context rather than separate memory silos for every client.'],
  ['What happens when information changes?', 'The old state remains in history while the current state becomes clear.'],
  ['What happens when two sources disagree?', 'The conflict stays visible until evidence or policy resolves it.'],
  ['What happens when the answer is missing?', 'Lacuna returns no supporting evidence instead of inventing a value.'],
  ['Why HydraDB?', 'HydraDB gives Lacuna a persistent graph-first context substrate for memory, knowledge, relationships, history and retrieval.'],
  ['Does Lacuna work with MCP?', 'MCP is a first-class Lacuna developer surface. Connection state and exact tools must reflect the real implementation.'],
  ['Does Lacuna have an SDK?', 'The finished MVP will expose a Lacuna SDK and API around the same context contract used by the web product, CLI and MCP.'],
  ['Does Lacuna have a CLI?', 'Yes in the product design. The approved CLI contract becomes the real implementation next.'],
  ['Does Lacuna expose chain of thought?', 'No. Lacuna shows evidence, retrieval and system traces, not hidden model reasoning.']
];

/**
 * The three developer surfaces, and which of them exist.
 *
 * Two of these are now real and one is not, and they used to carry a single
 * NOT SHIPPED banner across all three. That understated the two that work as
 * badly as it would have overstated the one that does not: a reader was told
 * the MCP server was a design contract while it was answering requests.
 *
 * So each entry says for itself. The REST and MCP samples are commands that
 * run against the deployment as written, with no key, and were run before
 * being pasted here. The TypeScript one is a package that does not exist.
 */
export interface DevSample {
  readonly code: string;
  /** True when the sample runs against the deployment exactly as written. */
  readonly shipped: boolean;
  readonly note: string;
}

const TYPESCRIPT = [
  'import { Lacuna } from "@lacuna/sdk";',
  '',
  'const lacuna = new Lacuna({ workspace: "acme" });',
  '',
  'const r = await lacuna.query("Where does session state live now?");',
  '// r.answer     "Postgres"',
  '// r.evidence   PR #184 · runbook',
  '// r.revisions  README (historical)',
  '',
  '// contract: remember · query · timeline',
  '// evidence · contextPack · health · handoff',
].join('\n');

const REST = [
  'curl -s https://lacuna-five.vercel.app/api/explore/query \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"question":"who is the runbook owner for billing-gate?"}\'',
  '',
  '// the reading it used, then the answer through the same resolver',
  '{ reading: { subject, predicate, via, matched },',
  '  unread, knownSubjects[], available[], ms,',
  '  answer: { status, answer, evidence[], revisions[],',
  '            conflicts[], abstain_reason,',
  '            context_pack_id, trace_id, source_state } }',
  '',
  '// or name them directly, when you already know the vocabulary',
  '// POST /api/explore/ask   {"subject","predicate","via"}',
].join('\n');

const MCP = [
  '// endpoint:  https://lacuna-five.vercel.app/mcp',
  '// transport: streamable HTTP, and stdio locally',
  '',
  'tools:',
  '  lacuna_read_question   ask in a sentence, returns its reading',
  '  lacuna_ask             subject and predicate, with evidence',
  '  lacuna_explain         the same read, plus why it decided',
  '  lacuna_timeline        every claim for that predicate, in order',
  '  lacuna_health          which node answered, and at what epoch',
  '',
  'curl -s https://lacuna-five.vercel.app/mcp \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Accept: application/json, text/event-stream" \\',
  '  -d \'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\'',
].join('\n');

/**
 * The three developer surfaces, and which of them exist.
 *
 * Two of these are real and one is not, and they used to carry a single NOT
 * SHIPPED banner across all three. That understated the two that work as badly
 * as it would have overstated the one that does not: a reader was told the MCP
 * server was a design contract while it was answering requests.
 *
 * So each entry says for itself. The REST and MCP samples are commands that run
 * against the deployment exactly as written, with no key and no account, and
 * both were run before being pasted here. The TypeScript one is a package that
 * does not exist, and says so.
 */
export const DEVCODE: readonly DevSample[] = [
  {
    shipped: false,
    note: 'NOT SHIPPED · DESIGN CONTRACT, NOT A PUBLISHED PACKAGE',
    code: TYPESCRIPT,
  },
  {
    shipped: true,
    note: 'LIVE · RUNS AS WRITTEN, NO KEY, NO ACCOUNT',
    code: REST,
  },
  {
    shipped: true,
    note: 'LIVE · STREAMABLE HTTP AT /mcp',
    code: MCP,
  },
];

export interface Revision {
  readonly date: string;
  readonly cur: boolean;
  readonly pro: boolean;
  readonly src: string;
  readonly obs: string;
  readonly valid: string;
  readonly rep: string;
}

export const REVS: readonly Revision[] = [
  { date: 'Redis', cur: false, pro: false, src: 'README · GitHub', obs: '12 Jan', valid: 'Historical since 5 Mar', rep: 'Postgres' },
  { date: 'Move to Postgres?', cur: false, pro: true, src: 'Slack thread', obs: '8 Feb', valid: 'Proposal · never became state', rep: '—' },
  { date: 'Postgres', cur: true, pro: false, src: 'PR #184 + runbook', obs: '5 Mar', valid: 'Current since 5 Mar', rep: '—' }
];
