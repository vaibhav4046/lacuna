import type { AbstentionReason } from '../model/abstention.js';

/**
 * Shapes for the synthetic corpus.
 *
 * The corpus layer emits transcripts and per-message claim annotations. It
 * emits no node ids and no edges: deriving those is ingestion's job, and
 * keeping the split means ingestion is exercised for real rather than handed a
 * finished graph.
 */

export type PredicateName =
  | 'launch_date'
  | 'owner'
  | 'vendor'
  | 'contact'
  | 'status'
  | 'budget_code'
  | 'region'
  | 'migration_window'
  | 'beta_partner'
  | 'on_call_length'
  | 'runbook_owner'
  | 'data_region_policy';

export const PREDICATE_NAMES: readonly PredicateName[] = [
  'launch_date',
  'owner',
  'vendor',
  'contact',
  'status',
  'budget_code',
  'region',
  'migration_window',
  'beta_partner',
  'on_call_length',
  'runbook_owner',
  'data_region_policy',
];

export type ThreadKind =
  | 'stable'
  | 'revised'
  | 'retracted'
  | 'contradicted'
  | 'multi_hop'
  | 'unconnected'
  | 'never_stated'
  | 'out_of_scope'
  | 'background';

/**
 * `revise` and `retract` both carry explicit language in the message text and
 * both point at the claim they replace, so both produce a SUPERSEDES edge. What
 * separates them is what is left standing: a revision puts a new value in place,
 * a retraction puts nothing there.
 *
 * `assert` never supersedes anything, which is what leaves a genuine
 * contradiction unresolved instead of quietly ordering it by timestamp.
 */
export type ClaimKind = 'assert' | 'revise' | 'retract';

export interface ClaimAnnotation {
  readonly key: string;
  readonly subject: string;
  readonly predicate: PredicateName;
  readonly kind: ClaimKind;
  /** Empty for a retraction, which is the point of a retraction. */
  readonly objectText: string;
  /** Set when the object is itself an entity worth a node, null otherwise. */
  readonly objectEntity: string | null;
  readonly supersedes: string | null;
  readonly validFrom: string;
}

/** Character offsets into the message text. Half open, `[start, end)`. */
export interface EvidenceSpan {
  readonly claimKey: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

export interface Message {
  readonly key: string;
  readonly sessionKey: string;
  readonly index: number;
  readonly speaker: 'user' | 'assistant';
  readonly timestamp: string;
  readonly text: string;
  readonly claims: readonly ClaimAnnotation[];
  readonly spans: readonly EvidenceSpan[];
}

export interface Session {
  readonly key: string;
  readonly title: string;
  readonly startedAt: string;
  readonly messages: readonly Message[];
}

export type ExpectedAnswer =
  | { readonly type: 'answer'; readonly text: string; readonly claimKey: string }
  | { readonly type: 'abstain'; readonly reason: AbstentionReason };

export interface GoldQuestion {
  readonly id: string;
  readonly kind: ThreadKind;
  readonly text: string;
  /** The entity the question names, which for a multi hop question is not the entity holding the answer. */
  readonly subject: string;
  readonly predicate: PredicateName;
  readonly expected: ExpectedAnswer;
}

/**
 * What sort of thing an entity is. This is an annotation, of the same kind as
 * the claim annotations: the corpus knows, because it drew the name from a
 * pool, and ingestion would otherwise have to guess from sentence position.
 */
export type EntityKind = 'project' | 'service' | 'vendor' | 'person';

export interface CorpusEntity {
  readonly name: string;
  readonly kind: EntityKind;
}

export interface CorpusStats {
  readonly sessions: number;
  readonly messages: number;
  readonly claims: number;
  readonly characters: number;
  /**
   * Characters divided by four. An estimate, and labelled one everywhere it is
   * shown, because no tokenizer was run over this text.
   */
  readonly estimatedTokens: number;
}

export interface Corpus {
  readonly seed: string;
  readonly sessions: readonly Session[];
  readonly questions: readonly GoldQuestion[];
  /** Every entity the claims touch, and nothing the claims do not touch. */
  readonly entities: readonly CorpusEntity[];
  readonly stats: CorpusStats;
}
