import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateCorpus } from '../../src/corpus';
import type { ClaimAnnotation, Corpus, Message } from '../../src/corpus';
import { buildPlan, spanKey } from '../../src/ingest/plan';
import type { EdgeType, IngestPlan, NodeLabel, VertexRow } from '../../src/ingest/plan';
import { KEY_SEPARATOR, MAX_ID, canonicalKey } from '../../src/model/ids';

/**
 * The plan is where the graph is decided, so these tests recompute what the
 * graph should contain straight from the corpus and compare. Nothing here reads
 * a count off the plan and asserts it equals itself.
 *
 * The load-bearing case is contradiction detection. ADR 0002 makes it an ingest
 * step, which means a bug there does not surface as a failed query, it surfaces
 * as Lacuna confidently answering a question it was supposed to flag.
 */

const corpus = generateCorpus();
const plan = buildPlan(corpus);

function allMessages(source: Corpus): readonly Message[] {
  return source.sessions.flatMap((session) => session.messages);
}

function allClaims(source: Corpus): readonly ClaimAnnotation[] {
  return allMessages(source).flatMap((message) => message.claims);
}

function rowsFor(label: NodeLabel): readonly VertexRow[] {
  return plan.batches.filter((batch) => batch.label === label).flatMap((batch) => batch.rows);
}

function edgesOf(type: EdgeType): readonly { readonly src: number; readonly dst: number }[] {
  return plan.edges.filter((edge) => edge.type === type);
}

function canonicalOf(plan_: IngestPlan, id: number): string {
  const canonical = plan_.keys.get(id);
  if (canonical === undefined) {
    throw new Error(`no canonical key for id ${id}`);
  }
  return canonical;
}

/** Node id back to the key it was derived from, with the label prefix stripped. */
function keyOf(id: number): string {
  const canonical = canonicalOf(plan, id);
  return canonical.slice(canonical.indexOf(KEY_SEPARATOR) + 1);
}

function labelOf(id: number): string {
  const canonical = canonicalOf(plan, id);
  return canonical.slice(0, canonical.indexOf(KEY_SEPARATOR));
}

const claimsByKey = new Map(allClaims(corpus).map((claim) => [claim.key, claim] as const));

describe('determinism', () => {
  it('produces the same plan from the same corpus', () => {
    const again = buildPlan(generateCorpus());
    expect(JSON.stringify(again.batches)).toBe(JSON.stringify(plan.batches));
    expect(JSON.stringify(again.edges)).toBe(JSON.stringify(plan.edges));
    expect([...again.keys.entries()]).toEqual([...plan.keys.entries()]);
  });
});

describe('vertices', () => {
  it('emits one node per corpus object and nothing else', () => {
    expect(plan.counts.vertices.Session).toBe(corpus.sessions.length);
    expect(plan.counts.vertices.Message).toBe(corpus.stats.messages);
    expect(plan.counts.vertices.Claim).toBe(corpus.stats.claims);
    expect(plan.counts.vertices.Entity).toBe(corpus.entities.length);
    expect(plan.counts.vertices.EvidenceSpan).toBe(
      allMessages(corpus).reduce((total, message) => total + message.spans.length, 0),
    );

    const total = Object.values(plan.counts.vertices).reduce((a, b) => a + b, 0);
    expect(plan.keys.size).toBe(total);
  });

  it('gives every node a distinct id inside the safe range', () => {
    const ids = new Set<number>();
    for (const row of plan.batches.flatMap((batch) => batch.rows)) {
      expect(ids.has(row.id), `duplicate id ${row.id}`).toBe(false);
      ids.add(row.id);
      expect(Number.isSafeInteger(row.id)).toBe(true);
      expect(row.id).toBeGreaterThanOrEqual(0);
      expect(row.id).toBeLessThanOrEqual(MAX_ID);
    }
    expect(ids.size).toBe(plan.keys.size);
  });

  it('stores the full canonical key on every node, which is the collision check', () => {
    for (const batch of plan.batches) {
      for (const row of batch.rows) {
        expect(row['key']).toBe(plan.keys.get(row.id));
        expect(String(row['key']).startsWith(`${batch.label}${KEY_SEPARATOR}`)).toBe(true);
      }
    }
  });

  it('writes every declared property on every row', () => {
    for (const batch of plan.batches) {
      expect(batch.properties).not.toContain('id');
      for (const property of batch.properties) {
        for (const row of batch.rows) {
          expect(row[property], `${batch.label}.${property}`).toBeDefined();
        }
      }
    }
  });

  it('keeps batches inside the limits the transport enforces', () => {
    for (const batch of plan.batches) {
      expect(batch.rows.length).toBeGreaterThan(0);
      expect(batch.rows.length).toBeLessThanOrEqual(500);
      expect(Buffer.byteLength(JSON.stringify(batch.rows), 'utf8')).toBeLessThan(1_048_576);
    }
  });
});

describe('messages and spans', () => {
  it('carries the message text into the graph, so nothing else has to hold it', () => {
    const byKey = new Map(rowsFor('Message').map((row) => [keyOf(row.id), row] as const));
    for (const message of allMessages(corpus)) {
      const row = byKey.get(message.key);
      expect(row, message.key).toBeDefined();
      expect(row?.['text']).toBe(message.text);
      expect(row?.['role']).toBe(message.speaker);
      expect(row?.['ts']).toBe(message.timestamp);
      expect(row?.['seq']).toBe(message.index);
    }
  });

  it('hashes the exact quote it stores', () => {
    for (const row of rowsFor('EvidenceSpan')) {
      const quote = String(row['quote']);
      expect(row['text_hash']).toBe(createHash('sha256').update(quote, 'utf8').digest('hex'));
      expect(Number(row['end']) - Number(row['start'])).toBe(quote.length);
    }
  });

  it('keys a span by the message and offsets it came from', () => {
    const keys = new Set(rowsFor('EvidenceSpan').map((row) => keyOf(row.id)));
    for (const message of allMessages(corpus)) {
      for (const span of message.spans) {
        expect(keys.has(spanKey(message.key, span.start, span.end))).toBe(true);
      }
    }
  });
});

describe('edges', () => {
  it('points every edge at nodes the plan actually creates', () => {
    for (const edge of plan.edges) {
      expect(plan.keys.has(edge.src), `${edge.type} src ${edge.src}`).toBe(true);
      expect(plan.keys.has(edge.dst), `${edge.type} dst ${edge.dst}`).toBe(true);
    }
  });

  it('contains every message in exactly one session', () => {
    expect(plan.counts.edges.CONTAINS).toBe(corpus.stats.messages);
    const seen = new Set(edgesOf('CONTAINS').map((edge) => edge.dst));
    expect(seen.size).toBe(corpus.stats.messages);
    for (const edge of edgesOf('CONTAINS')) {
      expect(labelOf(edge.src)).toBe('Session');
      expect(labelOf(edge.dst)).toBe('Message');
    }
  });

  it('gives every claim a supporting span, which ADR 0002 makes an invariant', () => {
    const supported = new Set(edgesOf('SUPPORTS').map((edge) => edge.dst));
    expect(supported.size).toBe(corpus.stats.claims);
    for (const row of rowsFor('Claim')) {
      expect(supported.has(row.id), keyOf(row.id)).toBe(true);
    }
    expect(plan.counts.edges.HAS_SPAN).toBe(plan.counts.vertices.EvidenceSpan);
    expect(plan.counts.edges.SUPPORTS).toBe(plan.counts.vertices.EvidenceSpan);
  });

  it('binds every claim to its subject and only entity objects to MENTIONS', () => {
    expect(plan.counts.edges.ABOUT).toBe(corpus.stats.claims);
    expect(plan.counts.edges.MENTIONS).toBe(
      allClaims(corpus).filter((claim) => claim.objectEntity !== null).length,
    );
    for (const edge of [...edgesOf('ABOUT'), ...edgesOf('MENTIONS')]) {
      expect(labelOf(edge.src)).toBe('Claim');
      expect(labelOf(edge.dst)).toBe('Entity');
    }
  });

  it('supersedes newer to older, once per correction and retraction', () => {
    const corrections = allClaims(corpus).filter((claim) => claim.supersedes !== null);
    expect(plan.counts.edges.SUPERSEDES).toBe(corrections.length);
    expect(corrections.some((claim) => claim.kind === 'retract')).toBe(true);
    expect(corrections.some((claim) => claim.kind === 'revise')).toBe(true);

    const idByKey = new Map(rowsFor('Claim').map((row) => [keyOf(row.id), row.id] as const));
    for (const claim of corrections) {
      const older = claim.supersedes === null ? undefined : idByKey.get(claim.supersedes);
      expect(
        plan.edges.some(
          (edge) =>
            edge.type === 'SUPERSEDES' && edge.src === idByKey.get(claim.key) && edge.dst === older,
        ),
        claim.key,
      ).toBe(true);
    }
  });
});

describe('contradiction detection', () => {
  const pairs = edgesOf('CONTRADICTS');

  it('is symmetric, because relationship patterns here are directed', () => {
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length % 2).toBe(0);
    for (const edge of pairs) {
      expect(
        pairs.some((other) => other.src === edge.dst && other.dst === edge.src),
        `${edge.src} -> ${edge.dst}`,
      ).toBe(true);
    }
  });

  it('finds exactly the disagreements the corpus planted, and no others', () => {
    const expected = [
      ...new Set(
        corpus.questions
          .filter((question) => question.kind === 'contradicted')
          .map((question) => `${question.subject}${KEY_SEPARATOR}${question.predicate}`),
      ),
    ].sort();
    expect(expected.length).toBeGreaterThan(0);

    const found = new Set<string>();
    for (const edge of pairs) {
      const src = claimsByKey.get(keyOf(edge.src));
      const dst = claimsByKey.get(keyOf(edge.dst));
      expect(src, `src of ${edge.src} -> ${edge.dst}`).toBeDefined();
      expect(dst, `dst of ${edge.src} -> ${edge.dst}`).toBeDefined();
      if (src === undefined || dst === undefined) {
        continue;
      }
      // Same pair, different values, neither withdrawn.
      expect(src.subject).toBe(dst.subject);
      expect(src.predicate).toBe(dst.predicate);
      expect(src.objectText).not.toBe(dst.objectText);
      expect(src.kind).not.toBe('retract');
      expect(dst.kind).not.toBe('retract');
      found.add(`${src.subject}${KEY_SEPARATOR}${src.predicate}`);
    }

    expect([...found].sort()).toEqual(expected);
  });

  it('never links a claim that something else has superseded', () => {
    const superseded = new Set(
      allClaims(corpus)
        .map((claim) => claim.supersedes)
        .filter((key): key is string => key !== null),
    );
    expect(superseded.size).toBeGreaterThan(0);
    for (const edge of pairs) {
      expect(superseded.has(keyOf(edge.src)), keyOf(edge.src)).toBe(false);
      expect(superseded.has(keyOf(edge.dst)), keyOf(edge.dst)).toBe(false);
    }
  });

  it('does not mistake a revision or a retraction for a disagreement', () => {
    const corrected = corpus.questions.filter(
      (question) => question.kind === 'revised' || question.kind === 'retracted',
    );
    expect(corrected.length).toBeGreaterThan(0);

    const touched = new Set(
      pairs.map((edge) => {
        const claim = claimsByKey.get(keyOf(edge.src));
        return claim === undefined ? '' : `${claim.subject}${KEY_SEPARATOR}${claim.predicate}`;
      }),
    );
    for (const question of corrected) {
      expect(
        touched.has(`${question.subject}${KEY_SEPARATOR}${question.predicate}`),
        `${question.id} produced a CONTRADICTS edge`,
      ).toBe(false);
    }
  });
});

describe('claims', () => {
  it('marks retractions negative and everything else positive', () => {
    for (const row of rowsFor('Claim')) {
      const claim = claimsByKey.get(keyOf(row.id));
      expect(claim, keyOf(row.id)).toBeDefined();
      expect(row['polarity']).toBe(claim?.kind === 'retract' ? 'negative' : 'positive');
      expect(row['object_text']).toBe(claim?.objectText);
      expect(row['predicate']).toBe(claim?.predicate);
    }
  });

  it('points subject_id at the Entity node the ABOUT edge reaches', () => {
    for (const row of rowsFor('Claim')) {
      const subjectId = Number(row['subject_id']);
      expect(labelOf(subjectId)).toBe('Entity');
      expect(keyOf(subjectId)).toBe(claimsByKey.get(keyOf(row.id))?.subject);
      expect(
        plan.edges.some(
          (edge) => edge.type === 'ABOUT' && edge.src === row.id && edge.dst === subjectId,
        ),
      ).toBe(true);
    }
  });

  it('carries both time axes, equal here because the corpus has one clock', () => {
    for (const row of rowsFor('Claim')) {
      expect(row['valid_from']).toBe(row['tx_time']);
      expect(Number.isNaN(Date.parse(String(row['valid_from'])))).toBe(false);
    }
  });
});

describe('entities', () => {
  it('creates one node per roster entry and keys it by name', () => {
    const rows = rowsFor('Entity');
    expect(rows.length).toBe(corpus.entities.length);
    const byName = new Map(rows.map((row) => [String(row['name']), row] as const));
    for (const entity of corpus.entities) {
      const row = byName.get(entity.name);
      expect(row, entity.name).toBeDefined();
      expect(row?.['kind']).toBe(entity.kind);
      expect(row?.['key']).toBe(canonicalKey('Entity', entity.name));
    }
  });
});
