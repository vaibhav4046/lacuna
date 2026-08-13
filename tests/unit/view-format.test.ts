import { describe, expect, it } from 'vitest';

import { count, grouped, ms, sentence, shortDate, shortStamp, words } from '../../src/view/format';

/**
 * The small conversions a page reads out loud.
 *
 * Each of these is a line or two, and each of them is on every screen of the
 * product. The reason they are tested is the same reason they were written by
 * hand rather than delegated to `toLocaleString`: a figure on an evidence page
 * has to be the stored value, printed the same way on every machine that opens
 * it.
 */

describe('shortDate', () => {
  it('keeps the day and drops the rest', () => {
    expect(shortDate('2025-03-23T09:18:00.000Z')).toBe('2025-03-23');
    expect(shortDate('2025-03-23')).toBe('2025-03-23');
  });

  it('passes anything that is not a date through unchanged', () => {
    // A stored value that is not a timestamp is a fact about the graph, and
    // this page prints facts about the graph.
    expect(shortDate('sometime in March')).toBe('sometime in March');
    expect(shortDate('')).toBe('');
  });
});

describe('shortStamp', () => {
  it('goes to the minute and no further', () => {
    expect(shortStamp('2025-03-23T09:18:42.500Z')).toBe('2025-03-23 09:18');
  });

  it('leaves a value it cannot read alone', () => {
    expect(shortStamp('2025-03-23')).toBe('2025-03-23');
  });
});

describe('words', () => {
  it('reads an identifier as prose without renaming it', () => {
    expect(words('launch_date')).toBe('launch date');
    expect(words('beta_partner')).toBe('beta partner');
    expect(words('contact')).toBe('contact');
  });
});

describe('sentence', () => {
  it('raises a clause into a sentence', () => {
    expect(sentence('never stated')).toBe('Never stated.');
  });

  it('leaves an empty clause empty rather than printing a lone full stop', () => {
    expect(sentence('')).toBe('');
  });

  it('changes only the first character', () => {
    expect(sentence('the sessions disagree')).toBe('The sessions disagree.');
  });
});

describe('grouped', () => {
  it('separates thousands', () => {
    expect(grouped(5_268)).toBe('5,268');
    expect(grouped(117_395)).toBe('117,395');
    expect(grouped(1_000_000)).toBe('1,000,000');
  });

  it('leaves anything under a thousand alone', () => {
    expect(grouped(0)).toBe('0');
    expect(grouped(72)).toBe('72');
    expect(grouped(999)).toBe('999');
  });

  it('does not put a separator after the sign', () => {
    expect(grouped(-1_234)).toBe('-1,234');
  });
});

describe('ms', () => {
  it('prints the number it was measured to and adds no precision', () => {
    expect(ms(55)).toBe('55 ms');
    expect(ms(25.5)).toBe('25.5 ms');
    expect(ms(0)).toBe('0 ms');
  });
});

describe('count', () => {
  it('agrees with its noun', () => {
    expect(count(1, 'claim')).toBe('1 claim');
    expect(count(2, 'claim')).toBe('2 claims');
    expect(count(0, 'claim')).toBe('0 claims');
  });

  it('takes an irregular plural when one is given', () => {
    expect(count(1, 'entity', 'entities')).toBe('1 entity');
    expect(count(3, 'entity', 'entities')).toBe('3 entities');
  });
});
