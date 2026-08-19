import { randomUUID } from 'node:crypto';

import type { HydraSource } from '../hydra/source.js';
import { askCore } from '../contract/result.js';
import type { EvidenceStanding } from '../contract/result.js';
import { ask, buildQuestion } from '../retrieval/index.js';
import type { Inventory } from '../report/inventory.js';

/**
 * Everything the signed-in application reads, and the one rule it follows.
 *
 * A workspace that has ingested nothing returns empty lists, because that is
 * what it has. The design draws these screens full, with the demo corpus in
 * them, and those values are a layout reference rather than seed data: a
 * person who signed up ten seconds ago has no revisions, no conflicts and no
 * connectors. The demo corpus is available, deliberately, under one name.
 *
 * Nothing here invents a number. Where the product cannot measure something
 * the field is absent and the screen renders an em dash.
 */

/** The one workspace whose contents are the design's own sample values. */
export const DEMO_WORKSPACE = 'acme / backend';

/**
 * `INVALID_REQUEST` exists because a malformed question is not an outage.
 *
 * An empty subject used to reach the resolver, fail, and come back as
 * SYSTEM_ERROR, which on the screen reads as "the context store did not
 * answer". That tells a person their memory is broken when what happened is
 * that they submitted an empty box, and it makes every real HydraDB failure
 * less believable.
 */
export type AnswerStatus =
  | 'ANSWERED'
  | 'PARTIAL'
  | 'CONFLICT'
  | 'NO_EVIDENCE'
  | 'INVALID_REQUEST'
  | 'SYSTEM_ERROR';

/** What was wrong with the request, when the request was what was wrong. */
export type InvalidReason =
  | 'subject_required'
  | 'predicate_required'
  | 'input_too_long'
  | 'question_unreadable';

/** A subject or predicate longer than this is not a name, it is a payload. */
export const MAX_QUESTION_CHARS = 200;

/**
 * How many claims one read of the memory list returns.
 *
 * Bounded because the corpus is 174 claims today and a real workspace is not,
 * and the page has to stay honest about the bound rather than pretending the
 * search box reaches past it.
 */
export const MEMORY_PAGE = 40;

export interface EnvelopeEvidence {
  readonly source: string;
  readonly meta: string;
  /**
   * The identity of the claim this evidence supports, so a reader can tell two
   * sources of one claim from two claims that disagree.
   */
  readonly claim_id: number;
  readonly quote: string;
  readonly observed_at: string;
  /** Decided per claim in the shared core, never from the request's outcome. */
  readonly standing: EvidenceStanding;
}

/**
 * The canonical answer envelope, one shape for every surface.
 *
 * PARTIAL is in the type because the product's vocabulary has five states, and
 * it is never produced today: the resolver answers or abstains, and an
 * abstention carries a reason. A status the core cannot reach is not written
 * into the mapping to make a screen look complete.
 */
export interface AnswerEnvelope {
  readonly status: AnswerStatus;
  readonly answer: string | null;
  readonly evidence: readonly EnvelopeEvidence[];
  readonly revisions: readonly number[];
  readonly conflicts: readonly string[];
  readonly abstain_reason: string | null;
  readonly context_pack_id: string | null;
  readonly trace_id: string;
  readonly source_state: string;
  /** Measured, in milliseconds. Never estimated. */
  readonly took_ms: number;
}

/**
 * 128 bits from the platform CSPRNG, not 32 from `Math.random`.
 *
 * A trace id is quoted in support and pasted into logs, so two requests
 * colliding is a real cost, and 32 bits collide at around 77,000 requests.
 */
function traceId(): string {
  return randomUUID();
}

/** The envelope for a request that was never going to be answerable. */
export function invalidRequest(reason: InvalidReason): AnswerEnvelope {
  return {
    status: 'INVALID_REQUEST',
    answer: null,
    evidence: [],
    revisions: [],
    conflicts: [],
    abstain_reason: reason,
    context_pack_id: null,
    trace_id: traceId(),
    source_state: 'live',
    took_ms: 0,
  };
}

/**
 * Whether a question is well formed, before any store is asked.
 *
 * Returns the reason rather than throwing, because the caller has to turn it
 * into a status code and a body, and an exception carrying a string would make
 * that a parse.
 */
export function validateQuestion(subject: unknown, predicate: unknown): InvalidReason | null {
  if (typeof subject !== 'string' || subject.trim() === '') return 'subject_required';
  if (typeof predicate !== 'string' || predicate.trim() === '') return 'predicate_required';
  if (subject.length > MAX_QUESTION_CHARS || predicate.length > MAX_QUESTION_CHARS) {
    return 'input_too_long';
  }
  return null;
}

/**
 * One question, through the same core the CLI and MCP use.
 *
 * An abstention is a result, not a failure: `contradicted` becomes CONFLICT
 * and every other reason becomes NO EVIDENCE, both with the reason attached.
 * Only a dependency that did not answer becomes SYSTEM ERROR.
 */
export async function askEnvelope(
  source: HydraSource,
  subject: string,
  predicate: string,
  via: string | null,
  timeoutMs: number,
): Promise<AnswerEnvelope> {
  const trace = traceId();
  let question;
  try {
    question = buildQuestion(subject, predicate, via);
  } catch {
    // The question could not be read. That is the caller's input, not the
    // store's health, and saying SYSTEM_ERROR here was blaming HydraDB for it.
    return invalidRequest('question_unreadable');
  }

  try {
    const answer = await ask(source, question, { timeoutMs });
    const core = askCore(answer);
    // Standing comes from the core, which read it off the claim graph. It used
    // to be derived from `core.status === 'answered'`, which labelled every
    // source of an unresolved contradiction `superseded`, saying that each of
    // the two had replaced the other.
    const evidence: EnvelopeEvidence[] = core.evidence.map((item) => ({
      source: item.sessionTitle,
      meta: `${item.role.toUpperCase()} · ${item.ts}`,
      claim_id: item.claimId,
      quote: item.quote,
      observed_at: item.ts,
      standing: item.standing,
    }));

    if (core.status === 'answered') {
      return {
        status: 'ANSWERED',
        answer: core.answer,
        evidence,
        revisions: core.supersededClaims,
        conflicts: [],
        abstain_reason: null,
        context_pack_id: core.claimId === null ? null : `pack-${core.claimId}`,
        trace_id: trace,
        source_state: core.sourceState,
        took_ms: Math.round(core.timingMs),
      };
    }

    const contradicted = core.reasonCode === 'contradicted';
    return {
      status: contradicted ? 'CONFLICT' : 'NO_EVIDENCE',
      answer: null,
      evidence,
      revisions: core.supersededClaims,
      conflicts: contradicted ? ['the sources disagree and nothing has resolved it'] : [],
      abstain_reason: core.reasonCode,
      context_pack_id: null,
      trace_id: trace,
      source_state: core.sourceState,
      took_ms: Math.round(core.timingMs),
    };
  } catch (error) {
    return {
      status: 'SYSTEM_ERROR',
      answer: null,
      evidence: [],
      revisions: [],
      conflicts: [],
      abstain_reason: error instanceof Error ? error.message : 'the context store did not answer',
      context_pack_id: null,
      trace_id: trace,
      source_state: 'unavailable',
      took_ms: 0,
    };
  }
}

export interface WorkspaceChange { readonly t: string; readonly d: string }
export interface WorkspaceConflict { readonly t: string; readonly state: string }
export interface WorkspaceConnection { readonly n: string; readonly st: string }
export interface WorkspaceHealth {
  readonly current: number;
  readonly historical: number;
  readonly conflicts: number;
}
export interface MemoryRow {
  readonly claim: string;
  readonly entity: string;
  readonly src: string;
  readonly obs: string;
  readonly st: 'CUR' | 'SUP' | 'PRO' | 'CON' | 'UN';
}
export interface HealthCategory { readonly l: string; readonly n: number; readonly col: string }

export interface SuggestedQuestion {
  readonly label: string;
  readonly subject: string;
  readonly predicate: string;
}

export interface WorkspaceView {
  readonly demo: boolean;
  /**
   * Questions this workspace can actually answer, derived from the claims it
   * holds. A suggestion that returns nothing is a broken button, so every one
   * of these names a subject and predicate the graph really has.
   */
  readonly questions: readonly SuggestedQuestion[];
  readonly changes: readonly WorkspaceChange[];
  readonly conflicts: readonly WorkspaceConflict[];
  readonly connections: readonly WorkspaceConnection[];
  readonly runs: readonly unknown[];
  readonly health: WorkspaceHealth;
  readonly memory: readonly MemoryRow[];
  readonly memoryTotal: number;
  /**
   * How many rows `memory` actually holds.
   *
   * The screen filters and searches the rows it was given, so it has to be able
   * to say what it searched. Reporting a total of 174 beside a list of 40 and a
   * search box implied the search covered all of them.
   */
  readonly memoryPage: number;
  readonly categories: readonly HealthCategory[];
}

/** A workspace nobody has put anything into. Every list is empty and says so. */
/**
 * A workspace built from whatever the store actually holds.
 *
 * The signed-in view used to be `emptyWorkspace()` unconditionally, so somebody
 * who had just ingested a transcript, and could ask questions about it and get
 * cited answers, still saw "No claims yet". The list was reading a static
 * inventory while the answers were reading the store.
 *
 * Bounded on purpose. It lists subjects from the index and reads each one, so
 * the cost is one fetch per subject and the cap is what stops a large workspace
 * turning a page load into a hundred round trips. What it shows is what it
 * read, and it says how many that was.
 */
export async function storeWorkspace(
  source: HydraSource,
  timeoutMs: number,
  limit = MEMORY_PAGE,
): Promise<WorkspaceView> {
  if (source.subjects === undefined) return emptyWorkspace();

  const { value: names } = await source.subjects(timeoutMs);
  const rows: MemoryRow[] = [];
  let current = 0;
  let historical = 0;
  let conflicted = 0;

  for (const name of names.slice(0, limit)) {
    const { value: subject } = await source.subject(name, timeoutMs);
    const live = subject.claims.filter((claim) => claim.supersededBy.length === 0);
    const disagreeing = new Set(live.map((claim) => claim.objectText)).size > 1;

    for (const claim of subject.claims) {
      const superseded = claim.supersededBy.length > 0;
      const state: MemoryRow['st'] = superseded ? 'SUP' : disagreeing ? 'CON' : 'CUR';
      if (superseded) historical += 1;
      else if (disagreeing) conflicted += 1;
      else current += 1;
      rows.push({
        claim: `${name} ${claim.predicate} ${claim.objectText}`,
        entity: name,
        src: 'Ingested source',
        obs: claim.validFrom.slice(0, 10),
        st: state,
      });
    }
  }

  return {
    demo: false,
    changes: [],
    conflicts: [],
    connections: [{ n: 'HydraDB', st: 'CONNECTED' }],
    runs: [],
    health: { current, historical, conflicts: conflicted },
    memory: rows,
    memoryTotal: rows.length,
    memoryPage: rows.length,
    categories: [
      { l: 'Current', n: current, col: '#8052FF' },
      { l: 'Historical', n: historical, col: '#6E6E6E' },
      { l: 'Contradicted', n: conflicted, col: '#FFB829' },
    ],
    questions: [],
  };
}

export function emptyWorkspace(): WorkspaceView {
  return {
    demo: false,
    changes: [],
    conflicts: [],
    connections: [],
    runs: [],
    health: { current: 0, historical: 0, conflicts: 0 },
    memory: [],
    memoryTotal: 0,
    memoryPage: 0,
    categories: [],
    questions: [],
  };
}

/**
 * The demo workspace, computed from the ingested corpus rather than written
 * down. The counts come from the same inventory the census asserts, so a
 * number on this screen and a number in the release gate cannot disagree.
 */
/**
 * The design writes dates as "5 MAR". The corpus stores ISO timestamps, and an
 * ISO timestamp in a table column that is fourteen characters wide is a
 * different design, so they are formatted here rather than at nine call sites.
 */
function shortDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][at.getUTCMonth()] ?? '';
  return `${at.getUTCDate()} ${month}`;
}

export function demoWorkspace(inventory: Inventory): WorkspaceView {
  const count = (state: string): number =>
    inventory.states.find((entry) => entry.state === state)?.count ?? 0;
  const current = count('current');
  const historical = count('historical');
  const conflicted = count('contradicted');
  const withdrawn = count('withdrawn');

  const rows: MemoryRow[] = inventory.claims.map((claim) => ({
    claim: claim.objectText === '' ? `${claim.subject} · ${claim.predicate}` : claim.objectText,
    entity: claim.subject,
    src: claim.source ?? 'not recorded',
    obs: shortDate(claim.observed),
    st: claim.state === 'current' ? 'CUR'
      : claim.state === 'historical' ? 'SUP'
        : claim.state === 'contradicted' ? 'CON'
          : 'UN',
  }));

  // What changed is the historical claims: each one is something the graph
  // used to hold and no longer does. Newest first, because a dashboard panel
  // called WHAT CHANGED is asking about the recent past.
  const changes = rows
    .filter((row) => row.st === 'SUP')
    .slice(0, 3)
    .map((row) => ({ t: `${row.entity} · ${row.claim} moved to history`, d: row.obs }));

  const conflicts = rows
    .filter((row) => row.st === 'CON')
    .slice(0, 6)
    .map((row) => ({ t: `${row.entity} · ${row.claim}`, state: 'UNRESOLVED' }));

  return {
    demo: true,
    changes,
    conflicts,
    connections: [{ n: 'HydraDB', st: 'CONNECTED' }],
    runs: [],
    health: { current, historical, conflicts: conflicted },
    memory: rows.slice(0, MEMORY_PAGE),
    memoryTotal: rows.length,
    memoryPage: MEMORY_PAGE,
    categories: [
      { l: 'Historical', n: historical, col: '#6E6E6E' },
      { l: 'Contradicted', n: conflicted, col: '#FFB829' },
      { l: 'Withdrawn', n: withdrawn, col: '#15846E' },
      { l: 'Current', n: current, col: '#8052FF' },
    ],
    questions: suggestions(inventory),
  };
}

/**
 * One question per outcome the resolver can reach, taken from claims the graph
 * actually holds, so every suggestion returns a real computed result rather
 * than an abstention caused by a subject nobody ever mentioned.
 *
 * The last entry is deliberate: a real subject paired with a predicate no
 * source states, which is the only honest way to demonstrate an abstention.
 */
function suggestions(inventory: Inventory): readonly SuggestedQuestion[] {
  const out: SuggestedQuestion[] = [];
  const seen = new Set<string>();
  const wanted: readonly (readonly [string, string])[] = [
    ['current', 'is current'],
    ['historical', 'has been revised'],
    ['contradicted', 'has sources that disagree'],
    ['withdrawn', 'was taken back'],
  ];

  for (const [state, why] of wanted) {
    const claim = inventory.claims.find((c) => c.state === state && !seen.has(`${c.subject}/${c.predicate}`));
    if (claim === undefined) continue;
    seen.add(`${claim.subject}/${claim.predicate}`);
    out.push({
      label: `${claim.subject} · ${claim.predicate.replace(/_/g, ' ')} — ${why}`,
      subject: claim.subject,
      predicate: claim.predicate,
    });
  }

  const anySubject = inventory.claims[0]?.subject;
  if (anySubject !== undefined) {
    out.push({
      label: `${anySubject} · connection pool size — nothing states it`,
      subject: anySubject,
      predicate: 'pool_size',
    });
  }
  return out;
}
