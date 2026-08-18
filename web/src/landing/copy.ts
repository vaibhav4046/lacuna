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

export const DEVCODE: readonly string[] = [
  'import { Lacuna } from "@lacuna/sdk";\n\nconst lacuna = new Lacuna({ workspace: "acme" });\n\nconst r = await lacuna.query("Where does session state live now?");\n// r.answer     "Postgres"\n// r.evidence   PR #184 · runbook\n// r.revisions  README (historical)\n\n// contract: remember · query · timeline\n// evidence · contextPack · health · handoff',
  'POST /v1/query\n{ "workspace": "acme",\n  "query": "Where does session state live now?",\n  "mode": "fast" }\n\n// response envelope\n{ status, answer, evidence[], revisions[],\n  conflicts[], abstain_reason,\n  context_pack_id, trace_id, source_state }',
  '// MCP server: lacuna-context\ntools:\n  query          answer with evidence, or abstain\n  remember       store context with source + scope\n  timeline       what changed, in order\n  evidence       why the answer holds\n  context.pack   compile for one task\n  handoff        smaller pack for a subagent\n\nresources:\n  context://acme/backend/current\n  context://acme/backend/conflicts'
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
