import { describe, expect, it } from 'vitest';

import { DEFAULT_SEED, generateCorpus } from '../../src/corpus/index.js';
import type {
  ClaimAnnotation,
  Corpus,
  EntityKind,
  GoldQuestion,
  Message,
} from '../../src/corpus/index.js';
import { ABSTENTION_REASONS } from '../../src/model/abstention.js';
import { OUT_OF_SCOPE_SUBJECTS } from '../../src/corpus/vocab.js';
import { parseBlast } from '../../src/retrieval/question.js';

/**
 * The corpus is the yardstick every later number is measured against, so these
 * tests check the properties the evaluation depends on rather than a snapshot
 * of the text. If a claim could be answered from a message the question is
 * supposed to have no answer in, the whole benchmark quietly becomes a lexical
 * one, and that is the failure this file exists to catch.
 */

const corpus = generateCorpus();

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to exist`);
  }
  return value;
}

interface Located {
  readonly claim: ClaimAnnotation;
  readonly message: Message;
  /** Position in reading order across the whole corpus. */
  readonly position: number;
}

function locate(source: Corpus): Map<string, Located> {
  const located = new Map<string, Located>();
  let position = 0;
  for (const session of source.sessions) {
    for (const message of session.messages) {
      for (const claim of message.claims) {
        located.set(claim.key, { claim, message, position });
      }
      position += 1;
    }
  }
  return located;
}

const claimsByKey = locate(corpus);

function allClaims(source: Corpus): readonly ClaimAnnotation[] {
  return source.sessions.flatMap((session) =>
    session.messages.flatMap((message) => message.claims),
  );
}

function allMessages(source: Corpus): readonly Message[] {
  return source.sessions.flatMap((session) => session.messages);
}

function claimsFor(subject: string, predicate: string): readonly ClaimAnnotation[] {
  return allClaims(corpus).filter(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  );
}

function questionsOfKind(kind: GoldQuestion['kind']): readonly GoldQuestion[] {
  return corpus.questions.filter((question) => question.kind === kind);
}

describe('determinism', () => {
  it('produces identical bytes for the same seed', () => {
    expect(JSON.stringify(generateCorpus(DEFAULT_SEED))).toBe(
      JSON.stringify(generateCorpus(DEFAULT_SEED)),
    );
  });

  it('produces a different corpus for a different seed', () => {
    expect(JSON.stringify(generateCorpus('lacuna-demo-v1-alt'))).not.toBe(
      JSON.stringify(generateCorpus(DEFAULT_SEED)),
    );
  });

  it('records the seed it was generated from', () => {
    expect(corpus.seed).toBe(DEFAULT_SEED);
    expect(generateCorpus('other').seed).toBe('other');
  });
});

describe('scale', () => {
  it('reports measured size, not a target', () => {
    // Printed so the numbers in the docs come from a run rather than an estimate.
    // eslint-disable-next-line no-console
    console.log(`corpus stats: ${JSON.stringify(corpus.stats)}`);

    expect(corpus.stats.sessions).toBe(corpus.sessions.length);
    expect(corpus.stats.messages).toBe(allMessages(corpus).length);
    expect(corpus.stats.claims).toBe(allClaims(corpus).length);
    expect(corpus.stats.characters).toBe(
      allMessages(corpus).reduce((total, message) => total + message.text.length, 0),
    );
    expect(corpus.stats.estimatedTokens).toBe(Math.round(corpus.stats.characters / 4));
    // A floor, not a target. The measured run is 5268 messages and roughly
    // 117k estimated tokens; this guards the property that matters, which is
    // that the history cannot be pasted into one model context.
    expect(corpus.stats.messages).toBeGreaterThan(4000);
    expect(corpus.stats.estimatedTokens).toBeGreaterThan(100_000);
  });
});

describe('structure', () => {
  it('alternates user and assistant turns', () => {
    for (const message of allMessages(corpus)) {
      expect(message.speaker, message.key).toBe(message.index % 2 === 0 ? 'user' : 'assistant');
    }
  });

  it('puts claims only in user turns, one per message', () => {
    for (const message of allMessages(corpus)) {
      if (message.claims.length === 0) {
        continue;
      }
      expect(message.speaker, message.key).toBe('user');
      expect(message.claims.length, message.key).toBe(1);
    }
  });

  it('gives every message a unique key that names its session', () => {
    const keys = new Set<string>();
    for (const session of corpus.sessions) {
      for (const message of session.messages) {
        expect(keys.has(message.key), message.key).toBe(false);
        keys.add(message.key);
        expect(message.sessionKey).toBe(session.key);
      }
    }
    expect(keys.size).toBe(corpus.stats.messages);
  });

  it('gives every claim a unique key', () => {
    const claims = allClaims(corpus);
    expect(claimsByKey.size).toBe(claims.length);
  });

  it('runs sessions and messages forward in time', () => {
    let previous = 0;
    for (const session of corpus.sessions) {
      for (const message of session.messages) {
        const at = Date.parse(message.timestamp);
        expect(Number.isNaN(at), message.key).toBe(false);
        expect(at, message.key).toBeGreaterThan(previous);
        previous = at;
      }
    }
  });
});

describe('evidence spans', () => {
  it('slices back to the exact quote', () => {
    for (const message of allMessages(corpus)) {
      for (const span of message.spans) {
        expect(message.text.slice(span.start, span.end), message.key).toBe(span.quote);
        expect(span.end, message.key).toBeGreaterThan(span.start);
      }
    }
  });

  it('supports every claim with exactly one span', () => {
    for (const message of allMessages(corpus)) {
      expect(message.spans.length, message.key).toBe(message.claims.length);
      for (const claim of message.claims) {
        const span = must(
          message.spans.find((candidate) => candidate.claimKey === claim.key),
          `a span for ${claim.key}`,
        );
        expect(message.text).toContain(span.quote);
      }
    }
  });

  it('quotes text that names the subject it is about', () => {
    for (const message of allMessages(corpus)) {
      for (const claim of message.claims) {
        const span = must(
          message.spans.find((candidate) => candidate.claimKey === claim.key),
          `a span for ${claim.key}`,
        );
        expect(span.quote, claim.key).toContain(claim.subject);
      }
    }
  });
});

describe('ordering', () => {
  it('never places a correction before the thing it corrects', () => {
    let chains = 0;
    for (const claim of allClaims(corpus)) {
      if (claim.supersedes === null) {
        continue;
      }
      const child = must(claimsByKey.get(claim.key), `claim ${claim.key}`);
      const parent = must(claimsByKey.get(claim.supersedes), `superseded claim ${claim.supersedes}`);
      expect(child.position, claim.key).toBeGreaterThan(parent.position);
      expect(Date.parse(child.claim.validFrom)).toBeGreaterThan(Date.parse(parent.claim.validFrom));
      expect(parent.claim.subject).toBe(claim.subject);
      expect(parent.claim.predicate).toBe(claim.predicate);
      chains += 1;
    }
    expect(chains).toBeGreaterThan(0);
  });

  it('revises at least one fact twice, so a superseded claim is itself superseded', () => {
    const twice = allClaims(corpus).filter((claim) => {
      if (claim.supersedes === null) {
        return false;
      }
      const parent = claimsByKey.get(claim.supersedes);
      return parent !== undefined && parent.claim.supersedes !== null;
    });
    expect(twice.length).toBeGreaterThanOrEqual(2);
  });
});

describe('gold questions', () => {
  it('has a unique id per question', () => {
    const ids = new Set(corpus.questions.map((question) => question.id));
    expect(ids.size).toBe(corpus.questions.length);
  });

  it('covers all five abstention reasons', () => {
    const reasons = new Set(
      corpus.questions
        .map((question) => (question.expected.type === 'abstain' ? question.expected.reason : null))
        .filter((reason): reason is NonNullable<typeof reason> => reason !== null),
    );
    expect([...reasons].sort()).toEqual([...ABSTENTION_REASONS].sort());
  });

  it('points every answer at a live claim that is actually in the transcript', () => {
    const superseded = new Set(
      allClaims(corpus)
        .map((claim) => claim.supersedes)
        .filter((key): key is string => key !== null),
    );

    for (const question of corpus.questions) {
      if (question.expected.type !== 'answer') {
        continue;
      }
      const located = must(
        claimsByKey.get(question.expected.claimKey),
        `claim ${question.expected.claimKey} for ${question.id}`,
      );
      expect(located.claim.objectText, question.id).toBe(question.expected.text);
      expect(question.expected.text.length, question.id).toBeGreaterThan(0);
      expect(superseded.has(located.claim.key), question.id).toBe(false);
      expect(located.claim.kind, question.id).not.toBe('retract');
    }
  });

  it('names the subject in the question text', () => {
    for (const question of corpus.questions) {
      expect(question.text, question.id).toContain(question.subject);
    }
  });
});

describe('never_stated', () => {
  it('has no claim at all for the pair it asks about', () => {
    const questions = questionsOfKind('never_stated');
    expect(questions.length).toBeGreaterThan(0);

    for (const question of questions) {
      expect(claimsFor(question.subject, question.predicate), question.id).toHaveLength(0);
    }
  });

  it('asks about a subject the corpus talks about and a predicate it uses elsewhere', () => {
    for (const question of questionsOfKind('never_stated')) {
      const aboutSubject = allClaims(corpus).filter((claim) => claim.subject === question.subject);
      const usesPredicate = allClaims(corpus).filter(
        (claim) => claim.predicate === question.predicate,
      );
      // Both non-empty is the whole trap: high lexical and vector overlap, no
      // answer. If either were empty this would be an easier question wearing
      // the wrong label.
      expect(aboutSubject.length, question.id).toBeGreaterThan(0);
      expect(usesPredicate.length, question.id).toBeGreaterThan(0);
    }
  });
});

describe('out_of_scope', () => {
  it('never mentions an out of scope subject in any message', () => {
    for (const message of allMessages(corpus)) {
      for (const name of OUT_OF_SCOPE_SUBJECTS) {
        expect(message.text.includes(name), `${message.key} mentions ${name}`).toBe(false);
      }
    }
  });

  it('never claims about an out of scope subject', () => {
    for (const question of questionsOfKind('out_of_scope')) {
      const touched = allClaims(corpus).filter(
        (claim) => claim.subject === question.subject || claim.objectEntity === question.subject,
      );
      expect(touched, question.id).toHaveLength(0);
    }
  });
});

describe('retracted', () => {
  it('ends the pair with a withdrawal that carries no value', () => {
    const questions = questionsOfKind('retracted');
    expect(questions.length).toBeGreaterThan(0);

    for (const question of questions) {
      const claims = claimsFor(question.subject, question.predicate);
      const last = must(claims[claims.length - 1], `a final claim for ${question.id}`);
      expect(last.kind, question.id).toBe('retract');
      expect(last.objectText, question.id).toBe('');
      expect(last.objectEntity, question.id).toBeNull();
      expect(last.supersedes, question.id).not.toBeNull();
    }
  });
});

describe('contradicted', () => {
  it('leaves two live assertions that disagree and nothing resolving them', () => {
    const questions = questionsOfKind('contradicted');
    expect(questions.length).toBeGreaterThan(0);

    for (const question of questions) {
      const claims = claimsFor(question.subject, question.predicate);
      const live = claims.filter((claim) => claim.kind === 'assert' && claim.supersedes === null);
      expect(live.length, question.id).toBeGreaterThanOrEqual(2);
      expect(new Set(live.map((claim) => claim.objectText)).size, question.id).toBeGreaterThanOrEqual(2);

      const superseding = claims.filter((claim) => claim.supersedes !== null);
      expect(superseding, question.id).toHaveLength(0);
    }
  });
});

describe('multi_hop', () => {
  it('holds the answer on a second subject the question never names', () => {
    const questions = questionsOfKind('multi_hop');
    expect(questions.length).toBeGreaterThan(0);

    for (const question of questions) {
      const hop = claimsFor(question.subject, 'vendor');
      expect(hop, question.id).toHaveLength(1);
      const vendor = must(must(hop[0], `a vendor claim for ${question.id}`).objectEntity, 'a vendor');

      const contacts = claimsFor(vendor, 'contact');
      expect(contacts, question.id).toHaveLength(1);
      const contact = must(contacts[0], `a contact for ${vendor}`);

      expect(question.expected.type).toBe('answer');
      if (question.expected.type === 'answer') {
        expect(question.expected.claimKey, question.id).toBe(contact.key);
      }

      // The message carrying the answer must not mention the service, otherwise
      // a keyword retriever could find it without ever walking the edge.
      const located = must(claimsByKey.get(contact.key), `the located contact for ${question.id}`);
      expect(located.message.text.includes(question.subject), question.id).toBe(false);

      // And the first hop must be findable from the question text.
      const hopClaim = must(hop[0], `a vendor claim for ${question.id}`);
      const hopMessage = must(claimsByKey.get(hopClaim.key), `the located vendor claim`);
      expect(hopMessage.message.text, question.id).toContain(question.subject);
    }
  });
});

describe('unconnected', () => {
  it('asks the same shape of question as multi_hop and stops at a real vendor', () => {
    const questions = questionsOfKind('unconnected');
    expect(questions.length).toBeGreaterThan(0);

    for (const question of questions) {
      const hop = claimsFor(question.subject, 'vendor');
      expect(hop, question.id).toHaveLength(1);
      const vendor = must(must(hop[0], `a vendor claim for ${question.id}`).objectEntity, 'a vendor');

      // The vendor exists and is named in the transcript. What is missing is the
      // second edge, not the second node.
      expect(allClaims(corpus).some((claim) => claim.objectEntity === vendor)).toBe(true);
      expect(claimsFor(vendor, 'contact'), question.id).toHaveLength(0);
    }
  });

  it('is indistinguishable from multi_hop by question text alone', () => {
    const shape = (question: GoldQuestion): string =>
      question.text.replace(question.subject, '<subject>');

    const hops = new Set(questionsOfKind('multi_hop').map(shape));
    const gaps = new Set(questionsOfKind('unconnected').map(shape));

    expect(hops.size).toBe(1);
    expect([...gaps]).toEqual([...hops]);
  });
});

/**
 * The dependency graph, rebuilt here from the emitted claims and nothing else.
 *
 * The generator validates the same properties on its own way out, which is
 * where a broken corpus should fail: at generation, loudly, before anything is
 * ingested. These are the second opinion. They read the corpus the way a
 * consumer reads it, through the public shape, so a validation that quietly
 * stopped checking something would still be caught here.
 */

interface Edge {
  readonly from: string;
  readonly to: string;
}

function kindsOf(source: Corpus): ReadonlyMap<string, EntityKind> {
  return new Map(source.entities.map((entity) => [entity.name, entity.kind]));
}

/** Every claim that a later claim replaced, and so no longer speaks for the record. */
function supersededKeys(source: Corpus): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const claim of allClaims(source)) {
    if (claim.supersedes !== null) {
      keys.add(claim.supersedes);
    }
  }
  return keys;
}

function liveDependencies(source: Corpus): readonly Edge[] {
  const superseded = supersededKeys(source);
  const edges: Edge[] = [];
  for (const claim of allClaims(source)) {
    if (claim.predicate !== 'depends_on' || claim.kind === 'retract') {
      continue;
    }
    if (superseded.has(claim.key) || claim.objectEntity === null) {
      continue;
    }
    edges.push({ from: claim.subject, to: claim.objectEntity });
  }
  return edges;
}

/**
 * The services a change to `pkg` reaches, walked against the direction of the
 * edges. Written out here rather than imported so that agreement with the
 * stored answer means two independent walks agree, which is the only version
 * of that check worth running.
 */
function affectedBy(
  edges: readonly Edge[],
  pkg: string,
  kinds: ReadonlyMap<string, EntityKind>,
): readonly string[] {
  const affected = new Set<string>();
  const seen = new Set<string>([pkg]);
  const frontier = [pkg];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    for (const edge of edges) {
      if (edge.to !== current) {
        continue;
      }
      if (kinds.get(edge.from) === 'service') {
        affected.add(edge.from);
      } else if (!seen.has(edge.from)) {
        seen.add(edge.from);
        frontier.push(edge.from);
      }
    }
  }
  return [...affected].sort();
}

describe('dependency topology', () => {
  const kinds = kindsOf(corpus);
  const edges = liveDependencies(corpus);

  it('hangs every dependency off a service or a package, and onto a package', () => {
    expect(edges.length).toBeGreaterThan(50);
    for (const edge of edges) {
      expect(kinds.get(edge.to), `${edge.from} -> ${edge.to}`).toBe('package');
      expect(['service', 'package'], `${edge.from} -> ${edge.to}`).toContain(kinds.get(edge.from));
    }
  });

  it('spreads across enough of the package pool to make a reach non-trivial', () => {
    // Counted over the packages the edges touch, in either position: a package
    // nothing depends on and that depends on nothing is not part of the graph.
    const touched = new Set<string>();
    for (const edge of edges) {
      touched.add(edge.to);
      if (kinds.get(edge.from) === 'package') {
        touched.add(edge.from);
      }
    }
    expect(touched.size).toBeGreaterThanOrEqual(15);
  });

  it('has a package chain a service reaches only transitively', () => {
    // The property the whole blast radius scenario rests on. A service that
    // depends on a package that depends on another package is affected by a
    // change it has no direct edge to, and only a walk can find that.
    const packageEdges = edges.filter((edge) => kinds.get(edge.from) === 'package');
    const chain = packageEdges.find((edge) =>
      packageEdges.some((next) => next.from === edge.to),
    );
    expect(chain, 'a package that depends on a package with dependencies').toBeDefined();

    const root = must(chain, 'the chain').to;
    const indirect = affectedBy(edges, root, kinds).filter(
      (service) => !edges.some((edge) => edge.from === service && edge.to === root),
    );
    expect(indirect.length).toBeGreaterThan(0);
  });

  it('shares at least one package between two services', () => {
    const dependents = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (kinds.get(edge.from) !== 'service') {
        continue;
      }
      const set = dependents.get(edge.to) ?? new Set<string>();
      set.add(edge.from);
      dependents.set(edge.to, set);
    }
    const shared = [...dependents.values()].filter((set) => set.size >= 2);
    expect(shared.length).toBeGreaterThan(0);
  });

  it('revises a dependency without retracting it', () => {
    // A service that swapped one package for another. The old edge is gone
    // from the live set and the new one is in it, which is the temporal case
    // the graph has to get right or the reach comes back stale.
    const revisions = allClaims(corpus).filter(
      (claim) => claim.predicate === 'depends_on' && claim.kind === 'revise',
    );
    expect(revisions.length).toBeGreaterThan(0);

    for (const revision of revisions) {
      const replaced = must(revision.supersedes, `what ${revision.key} supersedes`);
      const old = must(claimsByKey.get(replaced), `the replaced claim ${replaced}`).claim;
      expect(old.subject).toBe(revision.subject);
      expect(old.objectEntity).not.toBe(revision.objectEntity);

      expect(edges).toContainEqual({ from: revision.subject, to: revision.objectEntity });
      expect(edges).not.toContainEqual({ from: old.subject, to: old.objectEntity });
    }
  });

  it('leaves no cycle among the packages', () => {
    // Not a stylistic preference. A cycle would make the reach depend on where
    // the walk started, and a blast radius that depends on the walk order is
    // not an answer.
    const packageEdges = edges.filter((edge) => kinds.get(edge.from) === 'package');
    for (const start of new Set(packageEdges.map((edge) => edge.from))) {
      const seen = new Set<string>();
      const frontier = [start];
      while (frontier.length > 0) {
        const current = frontier.pop()!;
        for (const edge of packageEdges) {
          if (edge.from !== current) {
            continue;
          }
          expect(edge.to, `cycle through ${start}`).not.toBe(start);
          if (!seen.has(edge.to)) {
            seen.add(edge.to);
            frontier.push(edge.to);
          }
        }
      }
    }
  });
});

describe('blast radius questions', () => {
  const kinds = kindsOf(corpus);
  const edges = liveDependencies(corpus);
  const questions = corpus.questions.filter((question) => question.expected.type === 'affected');

  it('asks about several packages', () => {
    expect(questions.length).toBeGreaterThanOrEqual(4);
    expect(new Set(questions.map((question) => question.subject)).size).toBe(questions.length);
    for (const question of questions) {
      expect(kinds.get(question.subject), question.id).toBe('package');
    }
  });

  it('names the package in the sentence, where the parser can read it', () => {
    // The evaluation dispatches on the sentence rather than on the thread kind,
    // so a question whose subject cannot be recovered from its own text would
    // silently fall through to the wrong query path.
    for (const question of questions) {
      expect(parseBlast(question.text), question.id).toBe(question.subject);
    }
  });

  it('expects a sorted, unique set of real services', () => {
    for (const question of questions) {
      if (question.expected.type !== 'affected') {
        continue;
      }
      const services = question.expected.services;
      expect(services.length, question.id).toBeGreaterThan(0);
      expect(new Set(services).size, question.id).toBe(services.length);
      expect([...services], question.id).toEqual([...services].sort());
      for (const service of services) {
        expect(kinds.get(service), `${question.id} names ${service}`).toBe('service');
      }
    }
  });

  it('agrees with a walk recomputed from the claims alone', () => {
    // The one case that would catch a stored answer drifting from the corpus it
    // is supposed to describe. Nothing here reads the planner's own index.
    for (const question of questions) {
      if (question.expected.type !== 'affected') {
        continue;
      }
      expect(affectedBy(edges, question.subject, kinds), question.id).toEqual([
        ...question.expected.services,
      ]);
    }
  });

  it('reaches at least one service that has no direct edge to the package', () => {
    // Without this the questions are answerable by a single lookup, and the
    // graph traversal is decoration.
    const transitive = questions.filter((question) => {
      if (question.expected.type !== 'affected') {
        return false;
      }
      return question.expected.services.some(
        (service) => !edges.some((edge) => edge.from === service && edge.to === question.subject),
      );
    });
    expect(transitive.length).toBeGreaterThan(0);
  });
});

describe('a different seed', () => {
  // Determinism is checked above. This checks the other half: that the seed
  // moves the shape without moving the properties. A generator that only ever
  // produces one usable dataset is a fixture with extra steps.
  const other = generateCorpus('lacuna-demo-v1-alt');
  const kinds = kindsOf(other);
  const edges = liveDependencies(other);

  it('produces a different dataset', () => {
    expect(other.seed).not.toBe(corpus.seed);
    const asked = new Set(corpus.questions.map((question) => question.text));
    const moved = other.questions.filter((question) => !asked.has(question.text));
    expect(moved.length).toBeGreaterThan(0);
  });

  it('keeps every claim key unique and every supersession pointing at a real claim', () => {
    const keys = new Set<string>();
    for (const claim of allClaims(other)) {
      expect(keys.has(claim.key), claim.key).toBe(false);
      keys.add(claim.key);
    }
    for (const claim of allClaims(other)) {
      if (claim.supersedes !== null) {
        expect(keys.has(claim.supersedes), `${claim.key} supersedes ${claim.supersedes}`).toBe(true);
      }
    }
  });

  it('still points every answered question at a claim that is in the transcript', () => {
    const located = locate(other);
    for (const question of other.questions) {
      if (question.expected.type !== 'answer') {
        continue;
      }
      // Not asserted against `question.subject`: a hop question is answered by
      // a claim about the entity at the far end of the edge, which is the
      // reason that question shape exists.
      const found = must(located.get(question.expected.claimKey), `${question.id}'s claim`);
      expect(found.claim.objectText, question.id).toBe(question.expected.text);
      expect(found.message.text, question.id).toContain(question.expected.text);
    }
  });

  it('still covers every abstention reason', () => {
    const reasons = new Set(
      other.questions
        .filter((question) => question.expected.type === 'abstain')
        .map((question) => (question.expected.type === 'abstain' ? question.expected.reason : '')),
    );
    expect([...reasons].sort()).toEqual([...ABSTENTION_REASONS].sort());
  });

  it('still builds a dependency graph the blast questions can be recomputed from', () => {
    const questions = other.questions.filter((question) => question.expected.type === 'affected');
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      if (question.expected.type !== 'affected') {
        continue;
      }
      expect(question.expected.services.length, question.id).toBeGreaterThan(0);
      expect(affectedBy(edges, question.subject, kinds), question.id).toEqual([
        ...question.expected.services,
      ]);
    }
  });
});
