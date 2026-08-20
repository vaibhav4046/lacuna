import { createHash, randomUUID } from 'node:crypto';

import type { HydraSource } from '../hydra/source.js';
import type { FetchLike, ProviderConfig } from '../provider/openai.js';
import { CompletionFailed, complete } from '../provider/openai.js';
import { ask, buildQuestion } from '../retrieval/index.js';
import { askCore } from '../contract/result.js';
import {
  AGENTS,
  type AgentRun,
  type CapabilityManifest,
  type ContextHandoff,
  type ContextPack,
  type PackedClaim,
  type ReviewVerdict,
  type RunEvent,
  type RunStatus,
} from './types.js';

/**
 * One agent run, from a task to a verified answer.
 *
 * The order matters and it is the whole design: retrieval and resolution happen
 * **before** the model is called, so what the model receives is claims the
 * resolver already decided, each carrying its standing. A model given raw
 * transcript would have to work out what is current, and working that out is
 * the part this project does deterministically and can show its evidence for.
 *
 * Then the model drafts, and a second model call checks the draft against the
 * same evidence and refuses the parts nothing supports. That second call is not
 * politeness. A model handed real evidence still writes plausible sentences the
 * evidence does not contain, and the only cheap defence is to ask a fresh
 * context to find them.
 *
 * Nothing here writes to memory. A run records itself and stops.
 */

/** Bounded so a run cannot become an unbounded spend or an unbounded wait. */
const MAX_MODEL_CALLS = 2;
const MAX_CONTEXT_CLAIMS = 40;
const MAX_WALL_MS = 60_000;
const MODEL_TIMEOUT_MS = 25_000;

const RESEARCHER_SYSTEM = [
  'You are the Researcher in a memory system that keeps evidence for every claim.',
  '',
  'You are given claims that have already been resolved. Each one carries a standing:',
  '  CURRENT means nothing has replaced it.',
  '  SUPERSEDED means a later claim replaced it. It is history, not the answer.',
  '  CURRENT_CONFLICTING means two live claims disagree and neither won.',
  '  PROPOSAL means somebody suggested it and it was never adopted.',
  '',
  'Rules you must not break:',
  '  Use only the claims given. Do not add facts from your own knowledge.',
  '  Never present a SUPERSEDED value as current. You may mention it as history.',
  '  Never resolve a CURRENT_CONFLICTING pair. Report that both are live.',
  '  Never treat a PROPOSAL as something that happened.',
  '  If the claims do not answer part of the task, say which part and stop there.',
  '',
  'Answer in short plain prose. No preamble, no headings, no bullet symbols.',
  'Do not explain your reasoning. State what the evidence supports.',
].join('\n');

const REVIEWER_SYSTEM = [
  'You are the Reviewer. You are given evidence and a draft written from it.',
  '',
  'Check every factual assertion in the draft against the evidence.',
  'A claim is supported only if the evidence states it. Plausible is not supported.',
  'A claim that presents a SUPERSEDED value as current is unsupported.',
  'A claim that picks a winner between two CURRENT_CONFLICTING values is unsupported.',
  '',
  'Reply as strict JSON and nothing else:',
  '{"approved": boolean, "supported": string[], "unsupported": string[], "note": string}',
  '',
  '"supported" and "unsupported" hold short quotations of the draft.',
  'Set approved to false if "unsupported" is not empty.',
  '"note" is one sentence for a person reading the run.',
].join('\n');

/** Subjects the task names that this workspace actually holds. */
function subjectsIn(task: string, known: readonly string[]): readonly string[] {
  const lower = task.toLowerCase();
  return known.filter((name) => lower.includes(name.toLowerCase())).slice(0, 8);
}

function renderPack(pack: ContextPack): string {
  const lines = pack.claims.map((claim) => {
    const quote = claim.quote === null ? '' : `  quote: "${claim.quote}"`;
    const source = claim.source === null ? '' : `  source: ${claim.source}`;
    return `- ${claim.subject} ${claim.predicate} = ${claim.value} [${claim.standing.toUpperCase()}]${quote}${source}`;
  });
  if (pack.conflicts.length > 0) lines.push(`- unresolved disagreements: ${pack.conflicts.join('; ')}`);
  if (pack.missing.length > 0) lines.push(`- nothing stated for: ${pack.missing.join('; ')}`);
  return lines.join('\n');
}

/**
 * Compiles the Context Pack by asking the resolver, not by reading transcript.
 *
 * Every claim in the pack came back through `ask`, which means it carries the
 * standing the resolver decided and the quotation that supports it. A pack
 * built any other way would be the agent forming its own opinion about what is
 * current, which is the thing this design exists to prevent.
 */
async function compilePack(
  source: HydraSource,
  workspace: string,
  subjects: readonly string[],
  predicates: readonly string[],
  timeoutMs: number,
): Promise<ContextPack> {
  const claims: PackedClaim[] = [];
  const conflicts: string[] = [];
  const missing: string[] = [];

  for (const subject of subjects) {
    for (const predicate of predicates) {
      if (claims.length >= MAX_CONTEXT_CLAIMS) break;
      try {
        const answer = await ask(source, buildQuestion(subject, predicate, null), { timeoutMs });
        const core = askCore(answer);
        for (const claim of core.history) {
          claims.push({
            subject,
            predicate: claim.predicate,
            value: claim.objectText,
            standing: claim.standing,
            quote: core.evidence.find((item) => item.claimId === claim.id)?.quote ?? null,
            source: core.evidence.find((item) => item.claimId === claim.id)?.sessionTitle ?? null,
            observedAt: claim.validFrom,
          });
        }
        if (core.status === 'abstained' && core.reasonCode === 'contradicted') {
          conflicts.push(`${subject} ${predicate}`);
        } else if (core.status === 'abstained' && core.history.length === 0) {
          missing.push(`${subject} ${predicate}`);
        }
      } catch {
        // A store that did not answer is not an absence, so it is not recorded
        // as one. The run reports fewer claims rather than a false gap.
      }
    }
  }

  const text = claims.map((claim) => `${claim.value}${claim.quote ?? ''}`).join('');
  return {
    id: `pack-${createHash('sha256').update(`${workspace}:${subjects.join(',')}`).digest('hex').slice(0, 16)}`,
    workspace,
    claims,
    conflicts,
    missing,
    estimatedTokens: Math.round(text.length / 4),
  };
}

function parseVerdict(text: string): ReviewVerdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { approved: false, supported: [], unsupported: [], note: 'the reviewer did not return a verdict' };
  }
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<ReviewVerdict>;
    const supported = Array.isArray(raw.supported) ? raw.supported.map(String) : [];
    const unsupported = Array.isArray(raw.unsupported) ? raw.unsupported.map(String) : [];
    return {
      // Approval is derived rather than trusted: a reviewer that says approved
      // while listing unsupported claims has contradicted itself.
      approved: raw.approved === true && unsupported.length === 0,
      supported,
      unsupported,
      note: typeof raw.note === 'string' ? raw.note : '',
    };
  } catch {
    return { approved: false, supported: [], unsupported: [], note: 'the reviewer returned unreadable JSON' };
  }
}

export interface RunOptions {
  readonly source: HydraSource;
  readonly provider: ProviderConfig;
  readonly model: string;
  readonly workspace: string;
  readonly collection: string;
  readonly task: string;
  /**
   * Names to fall back on when the store cannot enumerate its own.
   *
   * The workspace's index is asked first, because a run against somebody's own
   * memory has to match the subjects they ingested rather than the ones the
   * public corpus happens to hold. Getting that backwards is why the first run
   * refused a task about subjects that were sitting in the store.
   */
  readonly knownSubjects: readonly string[];
  readonly predicates: readonly string[];
  /**
   * The transport the model calls go through. Injected only by tests, so a run
   * can be exercised against a model that misbehaves on purpose without
   * spending anything or depending on a provider being up.
   */
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

export async function runAgents(options: RunOptions): Promise<AgentRun> {
  const now = options.now ?? Date.now;
  const started = now();
  const events: RunEvent[] = [];
  const id = randomUUID();

  const manifest: CapabilityManifest = {
    workspace: options.workspace,
    collection: options.collection,
    model: options.model,
    allowedTools: AGENTS.RESEARCHER.tools,
    maxModelCalls: MAX_MODEL_CALLS,
    maxContextClaims: MAX_CONTEXT_CLAIMS,
    maxWallMs: MAX_WALL_MS,
    canWrite: false,
  };

  const mark = (stage: RunStatus, detail: string, ms?: number): void => {
    events.push({ at: new Date(now()).toISOString(), stage, detail, ...(ms === undefined ? {} : { ms }) });
  };

  const finish = (
    status: RunStatus,
    extra: Partial<AgentRun>,
  ): AgentRun => ({
    id,
    task: options.task,
    workspace: options.workspace,
    status,
    manifest,
    pack: null,
    events,
    draft: null,
    handoff: null,
    verdict: null,
    writeback: 'NO_WRITE',
    error: null,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    ms: now() - started,
    ...extra,
  });

  let known = options.knownSubjects;
  if (options.source.subjects !== undefined) {
    try {
      const listed = await options.source.subjects(8_000);
      if (listed.value.length > 0) known = listed.value;
    } catch {
      // Fall back to what the caller supplied rather than failing the run.
    }
  }

  const subjects = subjectsIn(options.task, known);
  if (subjects.length === 0) {
    mark('FAILED', 'the task named nothing this workspace holds');
    return finish('FAILED', { error: 'no_known_subject' });
  }

  mark('RETRIEVING', `resolving ${subjects.length} subject(s) the task names`);
  const packStarted = now();
  const pack = await compilePack(options.source, options.workspace, subjects, options.predicates, 8_000);
  mark('COMPILING', `${pack.claims.length} resolved claims, ${pack.estimatedTokens} estimated tokens`, now() - packStarted);

  if (pack.claims.length === 0) {
    // Nothing stated is an answer here, not a breakage. A memory that reports
    // absence as a failure teaches people to distrust its absences, which is
    // the one thing this product cannot afford.
    mark('COMPLETED', 'nothing in this workspace is stated about those subjects');
    return finish('COMPLETED', {
      pack,
      draft: `Nothing in this workspace states anything about ${subjects.join(', ')} for the properties asked about.`,
      verdict: {
        approved: true,
        supported: [],
        unsupported: [],
        note: 'The workspace holds no claim on those properties, which is the answer rather than a gap in the run.',
      },
    });
  }

  const rendered = renderPack(pack);

  mark('RUNNING', `${AGENTS.RESEARCHER.name} drafting from the pack`);
  let draft: string;
  try {
    const result = await complete(
      options.provider,
      options.model,
      [
        { role: 'system', content: RESEARCHER_SYSTEM },
        { role: 'user', content: `Task:\n${options.task}\n\nResolved claims:\n${rendered}` },
      ],
      { timeoutMs: MODEL_TIMEOUT_MS, ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }) },
    );
    draft = result.text.trim();
    mark('RUNNING', `draft returned, ${draft.length} characters`, result.ms);
  } catch (error) {
    const detail = error instanceof CompletionFailed ? error.message : 'the model did not answer';
    mark('FAILED', detail);
    return finish('FAILED', { pack, error: 'model_unavailable' });
  }

  const handoff: ContextHandoff = {
    from: 'RESEARCHER',
    to: 'REVIEWER',
    goal: options.task,
    // The facts, not the reasoning. A reviewer given the researcher's thinking
    // inherits its mistakes.
    supportedFacts: pack.claims
      .filter((claim) => claim.standing === 'current')
      .map((claim) => `${claim.subject} ${claim.predicate} = ${claim.value}`),
    evidenceIds: pack.claims.filter((claim) => claim.quote !== null).map((claim) => `${claim.subject}:${claim.predicate}`),
    conflicts: pack.conflicts,
    missing: pack.missing,
    packId: pack.id,
  };

  mark('REVIEWING', `${AGENTS.REVIEWER.name} checking the draft against the evidence`);
  let verdict: ReviewVerdict;
  try {
    const result = await complete(
      options.provider,
      options.model,
      [
        { role: 'system', content: REVIEWER_SYSTEM },
        { role: 'user', content: `Evidence:\n${rendered}\n\nDraft:\n${draft}` },
      ],
      { timeoutMs: MODEL_TIMEOUT_MS, ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }) },
    );
    verdict = parseVerdict(result.text);
    mark(
      'REVIEWING',
      verdict.approved
        ? 'every claim in the draft is supported'
        : `${verdict.unsupported.length} claim(s) the evidence does not support`,
      result.ms,
    );
  } catch (error) {
    const detail = error instanceof CompletionFailed ? error.message : 'the reviewer did not answer';
    mark('FAILED', detail);
    // The draft is kept and the run still fails. An unreviewed draft is not an
    // answer here, and the surest way to make the Reviewer pointless would be
    // to present its absence as approval.
    return finish('FAILED', {
      pack,
      draft,
      handoff,
      error: detail.includes('429') ? 'rate_limited' : 'review_unavailable',
    });
  }

  mark('COMPLETED', verdict.approved ? 'approved' : 'revision required');
  return finish('COMPLETED', { pack, draft, handoff, verdict });
}
