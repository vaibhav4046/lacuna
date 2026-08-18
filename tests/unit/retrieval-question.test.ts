import { describe, expect, it } from 'vitest';

import { RetrievalError } from '../../src/retrieval/errors.js';
import {
  buildPackageName,
  buildQuestion,
  MAX_TERM_CHARS,
  parseBlast,
  parseVia,
} from '../../src/retrieval/question.js';

/**
 * The parser reads the question and nothing else.
 *
 * That constraint is what makes the evaluation mean anything, so the case that
 * matters most here is the one asserting two questions with different expected
 * outcomes parse identically. If this layer could see the answer, the graph
 * would not have to be able to tell them apart.
 */

describe('parseVia', () => {
  it('reads the relation out of a hop question', () => {
    expect(parseVia('Who is our contact for the vendor behind replay-queue?')).toBe('vendor');
  });

  it('returns null for a direct question', () => {
    expect(parseVia('When does Meridian launch?')).toBeNull();
  });

  it('produces the same relation for the answerable and the unanswerable hop', () => {
    // These two differ only in the subject. One resolves to a contact and one
    // does not, and nothing in the sentence says which. That is the point.
    const answerable = parseVia('Who is our contact for the vendor behind replay-queue?');
    const unanswerable = parseVia('Who is our contact for the vendor behind Meridian?');

    expect(answerable).toBe(unanswerable);
    expect(answerable).toBe('vendor');
  });

  it('lowercases the relation so it matches the stored predicate', () => {
    expect(parseVia('Who is our contact for the Vendor behind X?')).toBe('vendor');
  });

  it('ignores "behind" without the "for the" opener', () => {
    expect(parseVia('What is behind the vendor?')).toBeNull();
  });
});

describe('buildQuestion', () => {
  it('trims and keeps the terms as written', () => {
    expect(buildQuestion('  Meridian ', ' launch_date ')).toEqual({
      subject: 'Meridian',
      predicate: 'launch_date',
      via: null,
    });
  });

  it('defaults via to null', () => {
    expect(buildQuestion('Meridian', 'launch_date').via).toBeNull();
  });

  it('rejects an empty term', () => {
    expect(() => buildQuestion('   ', 'launch_date')).toThrow(RetrievalError);
    expect(() => buildQuestion('Meridian', '')).toThrow(RetrievalError);
  });

  it('rejects a term over the character cap', () => {
    expect(() => buildQuestion('x'.repeat(MAX_TERM_CHARS + 1), 'p')).toThrow(/over the 200/);
  });

  it('accepts a term exactly at the cap', () => {
    const atCap = 'x'.repeat(MAX_TERM_CHARS);
    expect(buildQuestion(atCap, 'p').subject).toBe(atCap);
  });

  it('rejects control characters, including ones a trim would not remove', () => {
    // Built from code points so the test file itself stays reviewable.
    for (const code of [0x00, 0x07, 0x1b, 0x7f, 0x9f]) {
      const payload = `Meri${String.fromCodePoint(code)}dian`;
      expect(() => buildQuestion(payload, 'launch_date')).toThrow(/control character/);
    }
  });

  it('accepts non-ascii names', () => {
    // A name is a name. The guard is against unprintables, not against people.
    expect(buildQuestion('Mei Lin Chow', 'contact').subject).toBe('Mei Lin Chow');
    expect(buildQuestion('Tomás Herrera', 'contact').subject).toBe('Tomás Herrera');
  });

  it('validates via on the same terms as the rest', () => {
    expect(() => buildQuestion('Meridian', 'contact', '')).toThrow(RetrievalError);
    expect(() => buildQuestion('Meridian', 'contact', 'x'.repeat(201))).toThrow(RetrievalError);
  });
});

describe('parseBlast', () => {
  it('reads the package out of a blast radius question', () => {
    expect(parseBlast('If pact-check changes, which services are affected?')).toBe('pact-check');
  });

  it('returns null for a question about the same package that is not a blast radius', () => {
    expect(parseBlast('Which packages does pact-check depend on?')).toBeNull();
  });

  it('returns null for a sentence that merely mentions a change', () => {
    // The pattern is anchored at both ends precisely so this does not match. A
    // question that talks about a change is not a request for a closure.
    expect(parseBlast('When pact-check changes, which services are affected, roughly?')).toBeNull();
    expect(parseBlast('Ask me: if pact-check changes, which services are affected?')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseBlast('  If wire-format changes, which services are affected?\n')).toBe(
      'wire-format',
    );
  });

  it('does not care about the case of the sentence, only of the name', () => {
    // The name is captured as written, because it is a package identifier and
    // the graph holds it exactly. The wrapper words are prose.
    expect(parseBlast('IF Wire-Format CHANGES, WHICH SERVICES ARE AFFECTED?')).toBe('Wire-Format');
  });

  it('produces a name the package guard accepts unchanged', () => {
    // The parse feeds straight into buildPackageName in scripts/evaluate.ts, so
    // a name that parses and then fails the guard would be a break between two
    // layers that never see each other.
    const name = parseBlast('If cursor-walk changes, which services are affected?');
    expect(name).not.toBeNull();
    expect(buildPackageName(name!)).toBe('cursor-walk');
  });

  it('returns null when the sentence names nothing', () => {
    // The capture needs at least one character, so a question with the name
    // missing is not a blast radius question with an empty name. It is prose.
    expect(parseBlast('If  changes, which services are affected?')).toBeNull();
  });

  it('leaves a blank name to the guard when one does get through', () => {
    // Whitespace clears the capture and fails the guard, which is where a bad
    // name is supposed to fail: as a rejected input, not as a graph error.
    expect(parseBlast('If   changes, which services are affected?')).toBe(' ');
    expect(() => buildPackageName(' ')).toThrow(RetrievalError);
  });
});
