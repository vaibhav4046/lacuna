import { describe, expect, it } from 'vitest';

import { DEFAULT_SEED, generateCorpus } from '../../src/corpus';
import type { ClaimAnnotation, Corpus, GoldQuestion, Message } from '../../src/corpus';
import { ABSTENTION_REASONS } from '../../src/model/abstention';
import { OUT_OF_SCOPE_SUBJECTS } from '../../src/corpus/vocab';

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
