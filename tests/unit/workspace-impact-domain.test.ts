import { describe, expect, it, vi } from 'vitest';

import type {
  HydraImpactChunk,
  HydraImpactQuery,
  HydraImpactReadControl,
  HydraImpactRelationOccurrence,
} from '../../src/hydra/impact-read.js';
import type { Read } from '../../src/hydra/source.js';
import type {
  ClaimRecord,
  Mention,
  SubjectView,
} from '../../src/retrieval/types.js';
import type { TargetStanding } from '../../src/retrieval/resolve.js';

type Origin = 'query' | 'inventory';

interface RawOccurrence {
  readonly relation: HydraImpactRelationOccurrence;
  readonly origin: Origin;
  readonly groupOrdinal: number;
  readonly rowOrdinal: number;
}

interface ClassifiedCandidate extends RawOccurrence {
  readonly identity: string;
  readonly relationshipShapeDigest: string;
  readonly normalizedPredicate: string | null;
  readonly sourceClass: { readonly kind: string; readonly key?: string; readonly display?: string };
  readonly targetClass: { readonly kind: string; readonly key?: string; readonly display?: string };
  readonly predicateClass: { readonly kind: string; readonly internalPredicate?: string };
  readonly direction: 'forward' | 'inverse' | 'unmapped';
  readonly effectiveSource: { readonly kind: string; readonly key?: string };
  readonly effectiveTarget: { readonly kind: string; readonly key?: string };
  readonly reason: string | null;
  readonly rejection: 'malformed_candidate' | 'not_structural' | null;
  readonly sortKey: Uint8Array;
}

interface ChunkTable {
  readonly byId: ReadonlyMap<string, {
    readonly digest: string;
    readonly sourceIds: readonly string[];
  }>;
}

interface DiagnosticRejection extends ClassifiedCandidate {
  readonly depth: 0;
  readonly outcome: 'malformed_candidate' | 'not_structural';
  readonly reason: string;
}

interface DiagnosticPhase {
  readonly reached: number;
  readonly accepted: readonly never[];
  readonly rejected: readonly DiagnosticRejection[];
  readonly duplicates: number;
  readonly structural: readonly ClassifiedCandidate[];
}

interface ImpactReadPort {
  queryForImpact(text: string, control: HydraImpactReadControl): Promise<HydraImpactQuery>;
  relationsForImpact(control: HydraImpactReadControl): Promise<readonly HydraImpactRelationOccurrence[]>;
  subjectForImpact(name: string, control: HydraImpactReadControl): Promise<Read<SubjectView>>;
}

interface WorkspaceRunControl {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
}

interface ImpactResultEdge {
  readonly outcome: string;
  readonly reason: string | null;
  readonly depth: number;
  readonly identity: string;
  readonly relationshipId: string | null;
  readonly origin: Origin;
  readonly source: { readonly raw: string | null; readonly display: string | null; readonly key: string | null };
  readonly target: { readonly raw: string | null; readonly display: string | null; readonly key: string | null };
  readonly rawPredicate: string | null;
  readonly predicate: string | null;
  readonly direction: 'forward' | 'inverse' | 'unmapped';
  readonly chunkId: string | null;
  readonly context: string | null;
  readonly provenanceJoin:
    | 'matched_query_chunk'
    | 'query_chunk_null'
    | 'query_chunk_unmatched'
    | 'inventory_unattributed';
  readonly sourceIds: readonly string[];
  readonly claimId: number | null;
  readonly mention: Mention | null;
}

interface WorkspaceImpactResult {
  readonly subject: { readonly display: string; readonly key: string };
  readonly reached: number;
  readonly accepted: readonly ImpactResultEdge[];
  readonly rejected: readonly ImpactResultEdge[];
  readonly duplicates: number;
  readonly affected: readonly { readonly display: string; readonly key: string }[];
  readonly depth: number;
}

interface DomainExports {
  readonly WorkspaceImpactDataError: new (...args: never[]) => Error;
  readonly WORKSPACE_IMPACT_LIMITS: Readonly<Record<string, number>>;
  assertWorkspaceImpactLimit(name: string, value: number): number;
  stableImpactSourceIds(
    sourceId: string | null,
    sourceIds: readonly string[],
  ): readonly string[];
  encodeImpactChunkRecord(chunk: HydraImpactChunk): Uint8Array;
  digestImpactChunkRecord(chunk: HydraImpactChunk): string;
  createImpactChunkTable(chunks: readonly HydraImpactChunk[]): ChunkTable;
  joinImpactChunk(
    table: ChunkTable,
    relation: HydraImpactRelationOccurrence,
    origin: Origin,
  ): {
    readonly state:
      | 'matched_query_chunk'
      | 'query_chunk_null'
      | 'query_chunk_unmatched'
      | 'inventory_unattributed';
    readonly sourceIds: readonly string[];
  };
  normalizeImpactPredicate(value: string | null): string | null;
  encodeImpactOccurrence(input: RawOccurrence): Uint8Array;
  classifyImpactOccurrence(input: RawOccurrence): ClassifiedCandidate;
  prepareImpactCandidates(inputs: readonly RawOccurrence[]): readonly ClassifiedCandidate[];
  runImpactDiagnosticPhase(inputs: readonly RawOccurrence[]): DiagnosticPhase;
  assertImpactReturnedEntries(accepted: number, rejected: number): number;
  assertWorkspaceImpactOutput(value: unknown): number;
  impactStandingOutcome(standing: TargetStanding): {
    readonly accepted: boolean;
    readonly outcome: string;
    readonly claimId: number | null;
    readonly mention: Mention | null;
  };
  runWorkspaceImpact(
    subject: string,
    port: ImpactReadPort,
    control: WorkspaceRunControl,
  ): Promise<WorkspaceImpactResult>;
  compareImpactBytes(left: Uint8Array, right: Uint8Array): number;
}

async function domain(): Promise<DomainExports> {
  let loaded: DomainExports | null = null;
  try {
    loaded = await import('../../src/api/workspace-impact.js') as DomainExports;
  } catch {
    // RED begins with the domain module absent.
  }
  expect(loaded).not.toBeNull();
  if (loaded === null) throw new Error('workspace impact domain module is missing');
  return loaded;
}

const LIMITS: Readonly<Record<string, number>> = {
  routeDeadlineMs: 30_000,
  queryMaxResults: 6,
  decodedChunks: 6,
  relationsRequestLimit: 128,
  decodedRelationRows: 128,
  queryPaths: 32,
  tripletsPerPath: 8,
  queryTriplets: 128,
  relationContainers: 64,
  nestedRelationRows: 8,
  queryBodyBytes: 1_048_576,
  relationsBodyBytes: 1_048_576,
  subjectBodyBytes: 524_288,
  aggregateResponseBytes: 6_291_456,
  candidateOccurrences: 256,
  subjectReads: 40,
  canonicalEntities: 40,
  claimsPerSubject: 128,
  mentionsPerSubject: 128,
  aggregateSubjectRows: 1_024,
  queryRelationConcurrency: 2,
  subjectReadConcurrency: 4,
  walkDepth: 3,
  returnedEntries: 256,
  successJsonBytes: 262_144,
  entityScalars: 160,
  entityBytes: 512,
  sourceIdsPerChunk: 8,
  idBytes: 256,
  chunkTextBytes: 2_048,
  contextBytes: 2_048,
  endpointBytes: 512,
  rawPredicateBytes: 64,
  derivedPredicateBytes: 192,
};

function chunk(overrides: Partial<HydraImpactChunk> = {}): HydraImpactChunk {
  return {
    chunkId: 'chunk-1',
    text: 'Root uses Redis.',
    score: 0.75,
    sourceIds: ['source-1'],
    sourceTitle: 'Imported note',
    sourceType: 'custom',
    observedAt: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

function relation(
  overrides: Partial<HydraImpactRelationOccurrence> = {},
): HydraImpactRelationOccurrence {
  return {
    relationshipId: 'rel-1',
    source: 'Root',
    target: 'Redis',
    predicate: 'uses',
    chunkId: 'chunk-1',
    context: 'Root uses Redis.',
    ...overrides,
  };
}

function occurrence(
  overrides: Partial<RawOccurrence> & {
    readonly relation?: HydraImpactRelationOccurrence;
  } = {},
): RawOccurrence {
  return {
    relation: overrides.relation ?? relation(),
    origin: overrides.origin ?? 'query',
    groupOrdinal: overrides.groupOrdinal ?? 0,
    rowOrdinal: overrides.rowOrdinal ?? 0,
  };
}

const NOW = '2026-08-21T10:00:00.000Z';

function claim(
  id: number,
  objectText: string,
  overrides: Partial<ClaimRecord> = {},
): ClaimRecord {
  return {
    id,
    predicate: 'depends_on',
    objectText,
    polarity: 'positive',
    validFrom: NOW,
    txTime: NOW,
    supersededBy: [],
    ...overrides,
  };
}

function mention(
  claimId: number,
  entityName: string,
  overrides: Partial<Mention> = {},
): Mention {
  return {
    claimId,
    predicate: 'depends_on',
    entityId: claimId + 1_000,
    entityName,
    ...overrides,
  };
}

function view(
  name: string,
  claims: readonly ClaimRecord[] = [],
  mentions: readonly Mention[] = [],
): SubjectView {
  return { name, id: 1, kind: 'service', claims, mentions };
}

function supports(
  name: string,
  targets: readonly string[],
  firstId = 1,
): SubjectView {
  const claims = targets.map((target, index) => claim(firstId + index, target));
  return view(name, claims, claims.map((entry) => mention(entry.id, entry.objectText)));
}

function read(value: SubjectView): Read<SubjectView> {
  return { value, traces: [] };
}

function queryResult(
  relations: readonly HydraImpactRelationOccurrence[] = [],
  chunks: readonly HydraImpactChunk[] = [],
): HydraImpactQuery {
  return { chunks, relations };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makePort(options: {
  readonly query?: HydraImpactQuery;
  readonly inventory?: readonly HydraImpactRelationOccurrence[];
  readonly subjects?: Readonly<Record<string, SubjectView>>;
  readonly queryForImpact?: ImpactReadPort['queryForImpact'];
  readonly relationsForImpact?: ImpactReadPort['relationsForImpact'];
  readonly subjectForImpact?: ImpactReadPort['subjectForImpact'];
} = {}): ImpactReadPort {
  return {
    queryForImpact: options.queryForImpact ?? (async () => options.query ?? queryResult()),
    relationsForImpact: options.relationsForImpact ?? (async () => options.inventory ?? []),
    subjectForImpact: options.subjectForImpact ?? (async (name) => {
      const key = name.normalize('NFC').replace(/\p{White_Space}+/gu, ' ').trim().toLowerCase();
      return read(options.subjects?.[key] ?? view(name, [], []));
    }),
  };
}

function runControl(signal: AbortSignal = new AbortController().signal): WorkspaceRunControl {
  return { signal, deadlineMs: Date.now() + 30_000 };
}

function edge(
  source: string,
  target: string,
  overrides: Partial<HydraImpactRelationOccurrence> = {},
): HydraImpactRelationOccurrence {
  return relation({
    relationshipId: `${source}->${target}`,
    source,
    target,
    predicate: 'uses',
    chunkId: null,
    context: `${source} uses ${target}.`,
    ...overrides,
  });
}

describe('workspace impact fixed budgets', () => {
  it('owns every exact limit and accepts the inclusive boundary only', async () => {
    const api = await domain();
    expect(api.WORKSPACE_IMPACT_LIMITS).toEqual(LIMITS);
    for (const [name, cap] of Object.entries(LIMITS)) {
      expect(api.assertWorkspaceImpactLimit(name, cap)).toBe(cap);
      expect(() => api.assertWorkspaceImpactLimit(name, cap + 1)).toThrow();
    }
  });

  it('rejects negative, fractional, and unknown counters instead of comparing them loosely', async () => {
    const api = await domain();
    for (const [name, value] of [
      ['decodedChunks', -1],
      ['decodedChunks', 1.5],
      ['notARealLimit', 0],
    ] as const) {
      expect(() => api.assertWorkspaceImpactLimit(name, value)).toThrow();
    }
  });
});

describe('query chunk identity and provenance joins', () => {
  it('forms a stable singular-then-array source-id union with exact cap ownership', async () => {
    const api = await domain();
    expect(api.stableImpactSourceIds('source-b', ['source-a', 'source-b', 'source-c']))
      .toEqual(['source-b', 'source-a', 'source-c']);
    expect(api.stableImpactSourceIds(null, [])).toEqual([]);
    expect(api.stableImpactSourceIds('source-0', Array.from({ length: 8 }, (_, i) =>
      i === 7 ? 'source-0' : `source-${i + 1}`))).toHaveLength(8);
    expect(() => api.stableImpactSourceIds(
      'source-0',
      Array.from({ length: 8 }, (_, i) => `source-${i + 1}`),
    )).toThrow();
  });

  it('encodes all seven chunk fields with exact tagged binary framing', async () => {
    const api = await domain();
    const fixture = chunk({
      chunkId: 'c',
      text: 'T',
      score: 1.5,
      sourceIds: ['s1', 's2'],
      sourceTitle: null,
      sourceType: 'x',
      observedAt: '',
    });
    expect(Buffer.from(api.encodeImpactChunkRecord(fixture)).toString('hex')).toBe(
      '6c6163756e612d696d706163742d6368756e6b2d763100'
      + '01010000000163'
      + '02010000000154'
      + '0301000000083ff8000000000000'
      + '04010000000d02000000027331000000027332'
      + '050000000000'
      + '06010000000178'
      + '070100000000',
    );
    expect(api.digestImpactChunkRecord(fixture))
      .toBe('16a248a7e8cd5649d907f7efc9637f2be664370db105c101b8e8424d07be2910');
  });

  it('permits byte-identical repeated chunk ids and rejects every conflicting reuse', async () => {
    const api = await domain();
    const first = chunk({ chunkId: 'same', sourceIds: ['s1', 's2'] });
    const table = api.createImpactChunkTable([first, { ...first }]);
    expect(table.byId.get('same')?.sourceIds).toEqual(['s1', 's2']);

    for (const conflicting of [
      { ...first, text: 'different' },
      { ...first, score: -0 },
      { ...first, sourceIds: ['s2', 's1'] },
      { ...first, observedAt: null },
    ]) {
      expect(() => api.createImpactChunkTable([first, conflicting])).toThrow();
    }
  });

  it('distinguishes all four provenance joins without substituting chunk identity', async () => {
    const api = await domain();
    const table = api.createImpactChunkTable([
      chunk({ chunkId: 'known', sourceIds: ['source-b', 'source-a'] }),
    ]);
    expect(api.joinImpactChunk(table, relation({ chunkId: 'known' }), 'query')).toEqual({
      state: 'matched_query_chunk', sourceIds: ['source-b', 'source-a'],
    });
    expect(api.joinImpactChunk(table, relation({ chunkId: null }), 'query')).toEqual({
      state: 'query_chunk_null', sourceIds: [],
    });
    expect(api.joinImpactChunk(table, relation({ chunkId: 'missing' }), 'query')).toEqual({
      state: 'query_chunk_unmatched', sourceIds: [],
    });
    expect(api.joinImpactChunk(table, relation({ chunkId: 'known' }), 'inventory')).toEqual({
      state: 'inventory_unattributed', sourceIds: [],
    });
  });
});

describe('raw occurrence framing and provider-id consistency', () => {
  it('frames null and present-empty separately and hashes the exact normalized predicate', async () => {
    const api = await domain();
    const input = occurrence({
      relation: relation({
        relationshipId: 'r',
        source: null,
        target: '',
        predicate: '  USES\t',
        chunkId: null,
        context: '',
      }),
    });
    expect(Buffer.from(api.encodeImpactOccurrence(input)).toString('hex')).toBe(
      '6c6163756e612d696d706163742d6f6363757272656e63652d763100'
      + '010000000000'
      + '020100000000'
      + '03010000000475736573'
      + '04010000000172'
      + '050000000000'
      + '060100000000',
    );
    const classified = api.classifyImpactOccurrence(input);
    expect(classified.identity)
      .toBe('f1c470642b684367b7696c46f2ff945196b1d5f738fe2005445c81717762d3ce');
    expect(classified.relationshipShapeDigest)
      .toBe('7294cff92f5ec49bc038e4b363db74ecdcc9181591067f2aebcd89f4382e275b');
  });

  it('keeps null, empty, id-present, and id-absent occurrences distinct', async () => {
    const api = await domain();
    const inputs = [
      occurrence({ relation: relation({ source: null }) }),
      occurrence({ relation: relation({ source: '' }) }),
      occurrence({ relation: relation({ relationshipId: null }) }),
      occurrence({ relation: relation({ relationshipId: 'rel-1' }) }),
    ];
    expect(new Set(inputs.map((input) => api.classifyImpactOccurrence(input).identity)).size).toBe(4);
  });

  it('allows normalized-equivalent reuse of one real id but fails changed framed fields', async () => {
    const api = await domain();
    const first = occurrence({ relation: relation({ relationshipId: 'stable', predicate: ' USES ' }) });
    const equivalent = occurrence({
      relation: relation({ relationshipId: 'stable', predicate: 'uses' }),
      origin: 'inventory',
      groupOrdinal: 9,
      rowOrdinal: 7,
    });
    expect(api.prepareImpactCandidates([first, equivalent])).toHaveLength(2);

    for (const changed of [
      relation({ relationshipId: 'stable', source: 'Other' }),
      relation({ relationshipId: 'stable', target: 'Other' }),
      relation({ relationshipId: 'stable', predicate: 'calls' }),
      relation({ relationshipId: 'stable', chunkId: null }),
      relation({ relationshipId: 'stable', context: '' }),
    ]) {
      expect(() => api.prepareImpactCandidates([first, occurrence({ relation: changed })])).toThrow();
    }
  });
});

describe('total endpoint and predicate classification', () => {
  it.each([
    ['source_null', relation({ source: null, target: null, predicate: null }), 'malformed_candidate'],
    ['source_empty', relation({ source: '', target: null, predicate: null }), 'malformed_candidate'],
    ['source_invalid', relation({ source: '\u0000', target: null, predicate: null }), 'malformed_candidate'],
    ['target_null', relation({ source: 'Root', target: null, predicate: null }), 'malformed_candidate'],
    ['target_empty', relation({ source: 'Root', target: '', predicate: null }), 'malformed_candidate'],
    ['target_invalid', relation({ source: 'Root', target: '\u202e', predicate: null }), 'malformed_candidate'],
    ['predicate_null', relation({ source: 'Root', target: 'Redis', predicate: null }), 'malformed_candidate'],
    ['predicate_empty', relation({ source: 'Root', target: 'Redis', predicate: ' \t\r\n ' }), 'malformed_candidate'],
    ['predicate_invalid', relation({ source: 'Root', target: 'Redis', predicate: '\u0130'.repeat(22) }), 'malformed_candidate'],
    ['predicate_unknown', relation({ source: 'Root', target: 'Redis', predicate: 'observes' }), 'not_structural'],
  ] as const)('uses fixed reason precedence for %s', async (reason, raw, rejection) => {
    const api = await domain();
    const candidate = api.classifyImpactOccurrence(occurrence({ relation: raw }));
    expect(candidate.reason).toBe(reason);
    expect(candidate.rejection).toBe(rejection);
  });

  it('does not let a later malformed field outrank an earlier source failure', async () => {
    const api = await domain();
    const candidate = api.classifyImpactOccurrence(occurrence({
      relation: relation({ source: '', target: null, predicate: null }),
    }));
    expect(candidate).toMatchObject({
      sourceClass: { kind: 'empty' },
      targetClass: { kind: 'null' },
      predicateClass: { kind: 'null' },
      reason: 'source_empty',
      rejection: 'malformed_candidate',
    });
  });

  it('normalizes only ASCII transport whitespace and enforces the derived ceiling', async () => {
    const api = await domain();
    expect(api.normalizeImpactPredicate(null)).toBeNull();
    expect(api.normalizeImpactPredicate('  DePENDS\t\r\n ON  ')).toBe('depends on');
    expect(api.normalizeImpactPredicate('USES\u00a0')).toBe('uses\u00a0');
    expect(api.normalizeImpactPredicate('\u0130'.repeat(22)))
      .toBe('i\u0307'.repeat(22));
    expect(() => api.normalizeImpactPredicate('\u0130'.repeat(65))).toThrow();
  });

  it.each([
    ['depends_on', 'forward'],
    ['depends on', 'forward'],
    ['depended on', 'forward'],
    ['requires', 'forward'],
    ['uses', 'forward'],
    ['calls', 'forward'],
    ['required by', 'inverse'],
    ['used by', 'inverse'],
    ['called by', 'inverse'],
  ] as const)('maps %s to one closed depends_on direction', async (predicate, direction) => {
    const api = await domain();
    const candidate = api.classifyImpactOccurrence(occurrence({
      relation: relation({ source: 'Source', target: 'Target', predicate }),
    }));
    expect(candidate.predicateClass).toEqual({
      kind: 'mapped', internalPredicate: 'depends_on',
    });
    expect(candidate.direction).toBe(direction);
    expect(candidate.effectiveSource.key).toBe(direction === 'forward' ? 'source' : 'target');
    expect(candidate.effectiveTarget.key).toBe(direction === 'forward' ? 'target' : 'source');
    expect(candidate.reason).toBeNull();
  });

  it('preserves canonical display separately from the locale-independent key', async () => {
    const api = await domain();
    const candidate = api.classifyImpactOccurrence(occurrence({
      relation: relation({ source: '  R\u00f6\u00dflER\u2003Service ', target: 'REDIS' }),
    }));
    expect(candidate.sourceClass).toEqual({
      kind: 'valid', display: 'R\u00f6\u00dflER Service', key: 'r\u00f6\u00dfler service',
    });
    expect(candidate.targetClass).toEqual({ kind: 'valid', display: 'REDIS', key: 'redis' });
  });
});

describe('canonical unsigned-byte candidate ordering', () => {
  it('compares bytes unsigned instead of through signed integers or locale text', async () => {
    const api = await domain();
    expect(api.compareImpactBytes(Uint8Array.of(0x7f), Uint8Array.of(0x80))).toBeLessThan(0);
    expect(api.compareImpactBytes(Uint8Array.of(0xff), Uint8Array.of(0x00))).toBeGreaterThan(0);
    expect(api.compareImpactBytes(Uint8Array.of(1), Uint8Array.of(1, 0))).toBeLessThan(0);
    expect(api.compareImpactBytes(Uint8Array.of(1, 0), Uint8Array.of(1))).toBeGreaterThan(0);
  });

  it('sorts by classification ranks, effective endpoints, predicate, and direction', async () => {
    const api = await domain();
    const inputs = [
      occurrence({ relation: relation({ relationshipId: 'f', source: 'Z', target: 'A', predicate: 'required by' }) }),
      occurrence({ relation: relation({ relationshipId: 'e', source: 'A', target: 'B', predicate: 'uses' }) }),
      occurrence({ relation: relation({ relationshipId: 'd', source: 'A', target: 'B', predicate: 'observes' }) }),
      occurrence({ relation: relation({ relationshipId: 'c', source: '\u0000' }) }),
      occurrence({ relation: relation({ relationshipId: 'b', source: '' }) }),
      occurrence({ relation: relation({ relationshipId: 'a', source: null }) }),
    ];
    expect(api.prepareImpactCandidates(inputs).map((entry) => entry.relation.relationshipId))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('is invariant to shuffled arrival order while retaining every occurrence', async () => {
    const api = await domain();
    const inputs = [
      occurrence({ relation: relation({ relationshipId: null, source: null }), groupOrdinal: 3, rowOrdinal: 2 }),
      occurrence({ relation: relation({ relationshipId: 'two', source: 'B', target: 'C', predicate: 'calls' }), groupOrdinal: 1, rowOrdinal: 4 }),
      occurrence({ relation: relation({ relationshipId: 'one', source: 'A', target: 'B', predicate: 'uses' }), origin: 'inventory', groupOrdinal: 2, rowOrdinal: 1 }),
      occurrence({ relation: relation({ relationshipId: null, source: '', context: '' }), origin: 'inventory', groupOrdinal: 5, rowOrdinal: 0 }),
    ];
    const expected = api.prepareImpactCandidates(inputs).map((entry) => entry.identity);
    expect(api.prepareImpactCandidates([inputs[2]!, inputs[0]!, inputs[3]!, inputs[1]!])
      .map((entry) => entry.identity)).toEqual(expected);
    expect(expected).toHaveLength(4);
  });
});

describe('depth-zero diagnostic accounting', () => {
  it('makes every bounded malformed and unknown row visible before structural reachability', async () => {
    const api = await domain();
    const diagnostic = [
      relation({ relationshipId: 'source-null', source: null, target: null, predicate: null }),
      relation({ relationshipId: 'source-empty', source: '', target: null, predicate: null }),
      relation({ relationshipId: 'source-invalid', source: '\u0000', target: null, predicate: null }),
      relation({ relationshipId: 'target-null', source: 'Root', target: null, predicate: null }),
      relation({ relationshipId: 'target-empty', source: 'Root', target: '', predicate: null }),
      relation({ relationshipId: 'target-invalid', source: 'Root', target: '\u202e', predicate: null }),
      relation({ relationshipId: 'predicate-null', source: 'Root', target: 'Redis', predicate: null }),
      relation({ relationshipId: 'predicate-empty', source: 'Root', target: 'Redis', predicate: '\t ' }),
      relation({ relationshipId: 'predicate-invalid', source: 'Root', target: 'Redis', predicate: '\u0130'.repeat(22) }),
      relation({ relationshipId: 'predicate-unknown', source: 'Root', target: 'Redis', predicate: 'observes' }),
    ].map((raw, rowOrdinal) => occurrence({ relation: raw, rowOrdinal }));
    const unreachableStructural = occurrence({
      relation: relation({
        relationshipId: 'structural-unreachable',
        source: 'Never Reached',
        target: 'Still Hidden',
        predicate: 'uses',
      }),
      rowOrdinal: 10,
    });

    const result = api.runImpactDiagnosticPhase([...diagnostic, unreachableStructural]);

    expect(result.rejected.map((entry) => entry.reason).sort()).toEqual([
      'predicate_empty',
      'predicate_invalid',
      'predicate_null',
      'predicate_unknown',
      'source_empty',
      'source_invalid',
      'source_null',
      'target_empty',
      'target_invalid',
      'target_null',
    ]);
    expect(result.rejected.every((entry) => entry.depth === 0)).toBe(true);
    expect(result.structural.map((entry) => entry.relation.relationshipId))
      .toEqual(['structural-unreachable']);
    expect(result).toMatchObject({ reached: 10, accepted: [], duplicates: 0 });
  });

  it('applies duplicate before repeating the first malformed rejection', async () => {
    const api = await domain();
    const raw = relation({
      relationshipId: 'same-malformed',
      source: null,
      target: 'Redis',
      predicate: 'uses',
    });
    const first = occurrence({ relation: raw, origin: 'query', groupOrdinal: 0, rowOrdinal: 0 });
    const repeated = occurrence({
      relation: { ...raw },
      origin: 'inventory',
      groupOrdinal: 9,
      rowOrdinal: 7,
    });

    const result = api.runImpactDiagnosticPhase([repeated, first]);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      origin: 'query',
      outcome: 'malformed_candidate',
      reason: 'source_null',
      depth: 0,
    });
    expect(result.duplicates).toBe(1);
    expect(result.reached).toBe(2);
  });

  it('balances reached exactly across rejected and duplicates while structural rows remain unreached', async () => {
    const api = await domain();
    const malformed = occurrence({
      relation: relation({ relationshipId: null, source: '', context: 'same malformed' }),
      origin: 'query',
    });
    const malformedDuplicate = occurrence({
      relation: { ...malformed.relation },
      origin: 'inventory',
      groupOrdinal: 1,
      rowOrdinal: 1,
    });
    const unknown = occurrence({
      relation: relation({ relationshipId: null, predicate: 'merely observes' }),
      rowOrdinal: 2,
    });
    const structural = occurrence({
      relation: relation({ relationshipId: 'not-reached-yet', source: 'Elsewhere', predicate: 'calls' }),
      rowOrdinal: 3,
    });

    const result = api.runImpactDiagnosticPhase([
      structural,
      malformedDuplicate,
      unknown,
      malformed,
    ]);

    expect(result.reached).toBe(3);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(result.duplicates).toBe(1);
    expect(result.reached).toBe(
      result.accepted.length + result.rejected.length + result.duplicates,
    );
    expect(result.structural).toHaveLength(1);
  });

  it('fails the whole diagnostic phase before returning partial rows when a real id conflicts', async () => {
    const api = await domain();
    const first = occurrence({
      relation: relation({ relationshipId: 'provider-real-id', source: null }),
    });
    const conflicting = occurrence({
      relation: relation({ relationshipId: 'provider-real-id', source: '' }),
      rowOrdinal: 1,
    });
    expect(() => api.runImpactDiagnosticPhase([first, conflicting]))
      .toThrow(api.WorkspaceImpactDataError);
  });

  it('accepts exactly 256 returned diagnostic entries and refuses candidate or output cap+1', async () => {
    const api = await domain();
    const exact = Array.from({ length: 256 }, (_, index) => occurrence({
      relation: relation({
        relationshipId: `malformed-${index.toString().padStart(3, '0')}`,
        source: null,
      }),
      groupOrdinal: Math.floor(index / 8),
      rowOrdinal: index % 8,
    }));
    const result = api.runImpactDiagnosticPhase(exact);
    expect(result.rejected).toHaveLength(256);
    expect(result.reached).toBe(256);
    expect(api.assertImpactReturnedEntries(128, 128)).toBe(256);
    expect(() => api.assertImpactReturnedEntries(128, 129)).toThrow();
    expect(() => api.runImpactDiagnosticPhase([
      ...exact,
      occurrence({
        relation: relation({ relationshipId: 'malformed-over', source: null }),
        groupOrdinal: 32,
      }),
    ])).toThrow();
  });
});

describe('canonical source-backed impact walk', () => {
  it('starts query and inventory as siblings and drains the surviving peer after first failure', async () => {
    const api = await domain();
    const bothStarted = deferred<void>();
    const releaseQuery = deferred<void>();
    let starts = 0;
    let queryAborted = false;
    let settled = false;
    const port = makePort({
      queryForImpact: async (_text, control) => {
        starts += 1;
        if (starts === 2) bothStarted.resolve();
        control.signal.addEventListener('abort', () => { queryAborted = true; }, { once: true });
        await releaseQuery.promise;
        if (control.signal.aborted) throw new Error('query cancelled');
        return queryResult();
      },
      relationsForImpact: async () => {
        starts += 1;
        if (starts === 2) bothStarted.resolve();
        await bothStarted.promise;
        throw new Error('inventory failed');
      },
    });

    const outcome = api.runWorkspaceImpact('Root', port, runControl())
      .then(() => 'resolved', () => 'rejected')
      .finally(() => { settled = true; });
    await bothStarted.promise;
    await vi.waitFor(() => expect(queryAborted).toBe(true));
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseQuery.resolve();
    await expect(outcome).resolves.toBe('rejected');
    expect(starts).toBe(2);
  });

  it('canonicalizes the root and proves earliest query and inventory edges with exact provenance', async () => {
    const api = await domain();
    const old = edge('Root', 'Superseded', {
      relationshipId: 'rel-old', chunkId: 'old', context: 'old context',
    });
    const current = edge('ROOT', 'Current', {
      relationshipId: 'rel-current', chunkId: 'live', context: 'live context',
    });
    const second = edge('current', 'Second Hop', {
      relationshipId: 'rel-second', chunkId: 'live', context: 'inventory context',
    });
    const root = view('Root', [
      claim(1, 'Superseded', { supersededBy: [2] }),
      claim(2, 'Current'),
    ], [mention(1, 'Superseded'), mention(2, 'Current')]);
    const port = makePort({
      query: queryResult([old, current], [
        chunk({ chunkId: 'old', text: 'old context', sourceIds: ['source-old'] }),
        chunk({ chunkId: 'live', text: 'live context', sourceIds: ['source-b', 'source-a'] }),
      ]),
      inventory: [second],
      subjects: {
        root,
        current: supports('Current', ['Second Hop'], 10),
        'second hop': view('Second Hop'),
      },
    });

    const result = await api.runWorkspaceImpact('\u00a0ROOT\u2003', port, runControl());

    expect(result.subject).toEqual({ display: 'ROOT', key: 'root' });
    expect(result).toMatchObject({ reached: 3, duplicates: 0, depth: 2 });
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected.map((entry) => entry.outcome)).toEqual(['historical']);
    expect(result.affected).toEqual([
      { display: 'Current', key: 'current' },
      { display: 'Second Hop', key: 'second hop' },
    ]);
    expect(result.accepted[0]).toMatchObject({
      outcome: 'accepted', depth: 1, relationshipId: 'rel-current',
      chunkId: 'live', context: 'live context',
      provenanceJoin: 'matched_query_chunk', sourceIds: ['source-b', 'source-a'],
      claimId: 2,
      mention: { claimId: 2, predicate: 'depends_on', entityName: 'Current' },
      source: { raw: 'ROOT', display: 'ROOT', key: 'root' },
      target: { raw: 'Current', display: 'Current', key: 'current' },
      rawPredicate: 'uses', predicate: 'depends_on', direction: 'forward',
    });
    expect(result.accepted[1]).toMatchObject({
      outcome: 'accepted', depth: 2, relationshipId: 'rel-second',
      provenanceJoin: 'inventory_unattributed', sourceIds: [],
      claimId: 10,
    });
    expect(result.reached).toBe(
      result.accepted.length + result.rejected.length + result.duplicates,
    );
  });

  it.each([
    ['missing_mention', view('Root', [claim(1, 'Target')]), 'missing_mention'],
    ['historical', view('Root', [
      claim(1, 'Target', { supersededBy: [2] }), claim(2, 'Replacement'),
    ]), 'historical'],
    ['retracted', view('Root', [claim(1, 'Target', { polarity: 'negative' })]), 'retracted'],
    ['unstated', view('Root'), 'unstated'],
  ] as const)('uses exact target standing for %s and never enqueues a rejected target', async (
    _caseName,
    root,
    expected,
  ) => {
    const api = await domain();
    const subjectNames: string[] = [];
    const port = makePort({
      query: queryResult([edge('Root', 'Target')]),
      inventory: [edge('Target', 'Downstream')],
      subjectForImpact: async (name) => {
        subjectNames.push(name);
        return read(name.toLowerCase() === 'root' ? root : supports(name, ['Downstream']));
      },
    });
    const result = await api.runWorkspaceImpact('Root', port, runControl());
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ outcome: expected, depth: 1 });
    expect(subjectNames).toEqual(['Root']);
    expect(result).toMatchObject({ reached: 1, duplicates: 0, affected: [], depth: 0 });
  });

  it('preserves contradicted as a generic evaluator outcome without fabricating a BFS predicate', async () => {
    const api = await domain();
    expect(api.impactStandingOutcome({ state: 'contradicted' })).toEqual({
      accepted: false,
      outcome: 'contradicted',
      claimId: null,
      mention: null,
    });

    // Every closed structural wire spelling maps to the multi-valued
    // `depends_on` predicate. Contradiction is therefore intentionally
    // unreachable through today's BFS, though the shared evaluator outcome is
    // kept total for future closed single-valued predicates.
    const result = await api.runWorkspaceImpact('Root', makePort({
      query: queryResult([edge('Root', 'A'), edge('Root', 'B')]),
      subjects: { root: supports('Root', ['A', 'B']), a: view('A'), b: view('B') },
    }), runControl());
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected.some((entry) => entry.outcome === 'contradicted')).toBe(false);
  });

  it('walks accepted edges through depth three and counts depth four as budget excluded', async () => {
    const api = await domain();
    const relations = [
      edge('Root', 'A'), edge('A', 'B'), edge('B', 'C'), edge('C', 'D'),
      edge('Never Reached', 'Hidden'),
    ];
    const result = await api.runWorkspaceImpact('Root', makePort({
      query: queryResult(relations),
      subjects: {
        root: supports('Root', ['A']),
        a: supports('A', ['B']),
        b: supports('B', ['C']),
        c: supports('C', ['D']),
      },
    }), runControl());
    expect(result.accepted.map((entry) => [entry.target.key, entry.depth]))
      .toEqual([['a', 1], ['b', 2], ['c', 3]]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      outcome: 'budget_excluded', reason: 'depth_limit', depth: 4,
    });
    expect(result).toMatchObject({ reached: 4, duplicates: 0, depth: 3 });
    expect(result.affected.map((entry) => entry.key)).toEqual(['a', 'b', 'c']);
  });

  it('uses four workers within a frontier and never overlaps the next frontier', async () => {
    const api = await domain();
    const targets = Array.from({ length: 6 }, (_, index) => `Target ${index}`);
    const children = targets.map((_, index) => `Child ${index}`);
    const targetGate = deferred<void>();
    let activeTargets = 0;
    let maxActiveTargets = 0;
    let completedTargets = 0;
    const startedTargets: string[] = [];
    const subjectForImpact: ImpactReadPort['subjectForImpact'] = async (name) => {
      if (name === 'Root') return read(supports(name, targets));
      if (name.startsWith('Target ')) {
        startedTargets.push(name);
        activeTargets += 1;
        maxActiveTargets = Math.max(maxActiveTargets, activeTargets);
        await targetGate.promise;
        activeTargets -= 1;
        completedTargets += 1;
        return read(supports(name, [`Child ${name.slice(7)}`], 100 + Number(name.slice(7))));
      }
      expect(activeTargets).toBe(0);
      expect(completedTargets).toBe(6);
      return read(view(name));
    };
    const run = api.runWorkspaceImpact('Root', makePort({
      query: queryResult(targets.map((target) => edge('Root', target))),
      inventory: targets.map((target, index) => edge(target, children[index]!)),
      subjectForImpact,
    }), runControl());
    await vi.waitFor(() => expect(startedTargets).toHaveLength(4));
    expect(maxActiveTargets).toBe(4);
    targetGate.resolve();
    const result = await run;
    expect(maxActiveTargets).toBe(4);
    expect(result.accepted).toHaveLength(12);
    expect(result.depth).toBe(2);
  });

  it('caches canonical subjects, breaks cycles, and excludes the root from affected', async () => {
    const api = await domain();
    const calls: string[] = [];
    const result = await api.runWorkspaceImpact(' Root ', makePort({
      query: queryResult([edge('Root', 'A'), edge('A', 'ROOT')]),
      subjectForImpact: async (name) => {
        calls.push(name);
        return read(name.toLowerCase() === 'root'
          ? supports('Root', ['A'])
          : supports('A', ['ROOT']));
      },
    }), runControl());
    expect(calls).toEqual(['Root', 'A']);
    expect(result.accepted).toHaveLength(2);
    expect(result.affected).toEqual([{ display: 'A', key: 'a' }]);
    expect(result.depth).toBe(2);
  });

  it('turns canonical entity 41 into one rejection without a 41st subject read', async () => {
    const api = await domain();
    const targets = Array.from({ length: 40 }, (_, index) => `Node ${index.toString().padStart(2, '0')}`);
    const calls: string[] = [];
    const result = await api.runWorkspaceImpact('Root', makePort({
      query: queryResult(targets.map((target) => edge('Root', target))),
      subjectForImpact: async (name) => {
        calls.push(name);
        return read(name === 'Root' ? supports(name, targets) : view(name));
      },
    }), runControl());
    // Only sources with structural outgoing rows are read. The 39 accepted
    // targets have no outgoing candidate and therefore do not trigger 39
    // speculative subject reads.
    expect(calls).toHaveLength(1);
    expect(result.accepted).toHaveLength(39);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      outcome: 'budget_excluded', reason: 'entity_limit', depth: 1,
    });
    expect(result.reached).toBe(40);
  });

  it('owns aggregate bytes, candidate count, row count, and exact serialized output boundaries', async () => {
    const api = await domain();
    const bytePort = (bytes: number) => makePort({
      queryForImpact: async (_text, control) => {
        control.byteBudget.consume(bytes);
        return queryResult();
      },
    });
    await expect(api.runWorkspaceImpact('Root', bytePort(6_291_456), runControl()))
      .resolves.toMatchObject({ reached: 0 });
    await expect(api.runWorkspaceImpact('Root', bytePort(6_291_457), runControl()))
      .rejects.toThrow(api.WorkspaceImpactDataError);

    const tooMany = Array.from({ length: 257 }, (_, index) => edge('Root', `Node ${index}`, {
      relationshipId: `candidate-${index}`,
    }));
    await expect(api.runWorkspaceImpact('Root', makePort({
      query: queryResult(tooMany.slice(0, 128)), inventory: tooMany.slice(128),
    }), runControl())).rejects.toThrow(api.WorkspaceImpactDataError);

    const rootTargets = Array.from({ length: 8 }, (_, index) => `Target ${index}`);
    const aggregateRowsPort = (lastRows: number) => makePort({
      query: queryResult(rootTargets.map((target) => edge('Root', target))),
      inventory: rootTargets.map((target) => edge(target, `${target} child`)),
      subjectForImpact: async (name) => {
        if (name === 'Root') return read(supports(name, rootTargets));
        const index = Number(name.slice(7));
        const count = index === 7 ? lastRows : 126;
        return read(view(name, Array.from({ length: count }, (_, row) => claim(
          10_000 + index * 200 + row,
          `Irrelevant ${row}`,
          { predicate: 'notes' },
        ))));
      },
    });
    // Root contributes 16 rows; 7*126+126 = 1008, total 1024.
    await expect(api.runWorkspaceImpact('Root', aggregateRowsPort(126), runControl()))
      .resolves.toMatchObject({ accepted: { length: 8 } });
    await expect(api.runWorkspaceImpact('Root', aggregateRowsPort(127), runControl()))
      .rejects.toThrow(api.WorkspaceImpactDataError);

    expect(api.assertWorkspaceImpactOutput({ x: 'x'.repeat(262_136) })).toBe(262_144);
    expect(() => api.assertWorkspaceImpactOutput({ x: 'x'.repeat(262_137) }))
      .toThrow(api.WorkspaceImpactDataError);
  });

  it.each([
    ['claims', view('Root', Array.from({ length: 129 }, (_, index) => claim(index + 1, 'Target')))],
    ['mentions', view('Root', [], Array.from({ length: 129 }, (_, index) => mention(index + 1, 'Target')))],
  ] as const)('fails atomically when one subject has 129 %s', async (_kind, root) => {
    const api = await domain();
    await expect(api.runWorkspaceImpact('Root', makePort({
      query: queryResult([edge('Root', 'Target')]),
      subjects: { root },
    }), runControl())).rejects.toThrow(api.WorkspaceImpactDataError);
  });

  it('deduplicates exact query/inventory repeats and is shuffle-invariant', async () => {
    const api = await domain();
    const a = edge('Root', 'A', { relationshipId: null, chunkId: null });
    const b = edge('Root', 'B', { relationshipId: 'b' });
    const root = supports('Root', ['A', 'B']);
    const execute = async (
      queryRelations: readonly HydraImpactRelationOccurrence[],
      inventory: readonly HydraImpactRelationOccurrence[],
      shuffledRoot: SubjectView,
    ) => api.runWorkspaceImpact('Root', makePort({
      query: queryResult(queryRelations), inventory,
      subjects: { root: shuffledRoot, a: view('A'), b: view('B') },
    }), runControl());
    const baseline = await execute([a, b], [a], root);
    const shuffled = await execute([b, a], [a], view(
      root.name,
      [...root.claims].reverse(),
      [...root.mentions].reverse(),
    ));
    expect(baseline).toEqual(shuffled);
    expect(baseline).toMatchObject({ reached: 3, duplicates: 1, depth: 1 });
    expect(baseline.accepted).toHaveLength(2);
  });

  it('aborts a subject frontier, starts no queued read, and waits for every started peer', async () => {
    const api = await domain();
    const caller = new AbortController();
    const released = deferred<void>();
    const targets = Array.from({ length: 5 }, (_, index) => `Target ${index}`);
    let starts = 0;
    let aborted = 0;
    let settled = false;
    const run = api.runWorkspaceImpact('Root', makePort({
      query: queryResult(targets.map((target) => edge('Root', target))),
      inventory: targets.map((target) => edge(target, `${target} child`)),
      subjectForImpact: async (name, control) => {
        if (name === 'Root') return read(supports(name, targets));
        starts += 1;
        control.signal.addEventListener('abort', () => { aborted += 1; }, { once: true });
        await released.promise;
        if (control.signal.aborted) throw new Error('subject cancelled');
        return read(view(name));
      },
    }), runControl(caller.signal)).finally(() => { settled = true; });
    const outcome = run.then(() => 'resolved', () => 'rejected');
    await vi.waitFor(() => expect(starts).toBe(4));
    caller.abort();
    await vi.waitFor(() => expect(aborted).toBe(4));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(starts).toBe(4);
    released.resolve();
    await expect(outcome).resolves.toBe('rejected');
    expect(starts).toBe(4);
  });

  it('cleans its deadline timer after sibling cancellation settles', async () => {
    vi.useFakeTimers();
    try {
      const api = await domain();
      let starts = 0;
      const pending = async (control: HydraImpactReadControl): Promise<never> => {
        starts += 1;
        return new Promise((_resolve, reject) => {
          control.signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true });
        });
      };
      const port = makePort({
        queryForImpact: async (_text, control) => pending(control),
        relationsForImpact: async (control) => pending(control),
      });
      const outcome = api.runWorkspaceImpact('Root', port, {
        signal: new AbortController().signal,
        deadlineMs: Date.now() + 50,
      }).then(() => 'resolved', () => 'rejected');
      await Promise.resolve();
      await Promise.resolve();
      expect(starts).toBe(2);
      await vi.advanceTimersByTimeAsync(50);
      await expect(outcome).resolves.toBe('rejected');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes subject rows before standing evaluation and drops provider metadata', async () => {
    const api = await domain();
    const root = supports('Root', ['Target']) as SubjectView & { readonly providerMeta?: unknown };
    (root as { providerMeta?: unknown }).providerMeta = { secret: 'must not escape' };
    const claim = root.claims[0] as ClaimRecord & { readonly providerMeta?: unknown };
    (claim as { providerMeta?: unknown }).providerMeta = { raw: 'ignored' };
    const result = await api.runWorkspaceImpact('Root', makePort({
      query: queryResult([edge('Root', 'Target')]),
      subjects: { root },
    }), runControl());
    expect(result.accepted[0]?.mention).toEqual({
      claimId: 1, predicate: 'depends_on', entityId: 1001, entityName: 'Target',
    });
    expect(JSON.stringify(result)).not.toContain('providerMeta');
  });

  it('does not read a subject for diagnostics-only or empty structural work', async () => {
    const api = await domain();
    let reads = 0;
    const port = makePort({
      query: queryResult([edge('', 'Target', { predicate: null })]),
      subjectForImpact: async (name) => {
        reads += 1;
        return read(view(name));
      },
    });
    await expect(api.runWorkspaceImpact('Root', port, runControl())).resolves.toMatchObject({
      reached: 1, accepted: [], rejected: [{ outcome: 'malformed_candidate' }],
    });
    expect(reads).toBe(0);
  });
});
