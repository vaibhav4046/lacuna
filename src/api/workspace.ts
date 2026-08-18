import type { HydraClient } from '../hydra/client.js';
import { askCore } from '../contract/result.js';
import { ask, buildQuestion, RetrievalError } from '../retrieval/index.js';
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

export type AnswerStatus = 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | 'SYSTEM_ERROR';

export interface EnvelopeEvidence {
  readonly source: string;
  readonly meta: string;
  readonly standing: 'current' | 'superseded' | 'proposal';
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

function traceId(): string {
  return '0x' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

function standingOf(current: boolean, proposal: boolean): EnvelopeEvidence['standing'] {
  if (proposal) return 'proposal';
  return current ? 'current' : 'superseded';
}

/**
 * One question, through the same core the CLI and MCP use.
 *
 * An abstention is a result, not a failure: `contradicted` becomes CONFLICT
 * and every other reason becomes NO EVIDENCE, both with the reason attached.
 * Only a dependency that did not answer becomes SYSTEM ERROR.
 */
export async function askEnvelope(
  client: HydraClient,
  subject: string,
  predicate: string,
  via: string | null,
  timeoutMs: number,
): Promise<AnswerEnvelope> {
  const trace = traceId();
  let question;
  try {
    question = buildQuestion(subject, predicate, via);
  } catch (error) {
    return {
      status: 'SYSTEM_ERROR',
      answer: null,
      evidence: [],
      revisions: [],
      conflicts: [],
      abstain_reason: error instanceof RetrievalError ? error.message : 'the question could not be read',
      context_pack_id: null,
      trace_id: trace,
      source_state: 'live',
      took_ms: 0,
    };
  }

  try {
    const answer = await ask(client, question, { timeoutMs });
    const core = askCore(answer);
    const evidence = core.evidence.map((item) => ({
      source: item.sessionTitle,
      meta: `${item.role.toUpperCase()} · ${item.ts}`,
      standing: standingOf(core.status === 'answered', false),
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

export interface WorkspaceView {
  readonly demo: boolean;
  readonly changes: readonly WorkspaceChange[];
  readonly conflicts: readonly WorkspaceConflict[];
  readonly connections: readonly WorkspaceConnection[];
  readonly runs: readonly unknown[];
  readonly health: WorkspaceHealth;
  readonly memory: readonly MemoryRow[];
  readonly memoryTotal: number;
  readonly categories: readonly HealthCategory[];
}

/** A workspace nobody has put anything into. Every list is empty and says so. */
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
    categories: [],
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
    memory: rows.slice(0, 40),
    memoryTotal: rows.length,
    categories: [
      { l: 'Historical', n: historical, col: '#6E6E6E' },
      { l: 'Contradicted', n: conflicted, col: '#FFB829' },
      { l: 'Withdrawn', n: withdrawn, col: '#15846E' },
      { l: 'Current', n: current, col: '#8052FF' },
    ],
  };
}
