import { describe, expect, it } from 'vitest';

import { canonicalName } from '../../src/hydra/canonical.js';

/**
 * The rule behind a fix for a false refusal.
 *
 * `Foxglove` answered with a partner and a citation. `foxglove` abstained with
 * the reason `out_of_scope`, which asserts the subject never appears in the
 * sessions. It does. The refusal was the product's own thesis turned into a
 * wrong answer by a capital letter.
 *
 * These tests pin the narrow shape of the fallback, and most of them are about
 * what it must NOT do. Widening this into a similarity search would turn a
 * product that refuses honestly into one that guesses, and every case below
 * that returns null is guarding that line.
 */

const STORED = ['Foxglove', 'Bellwether', 'notify-relay', 'Meridian'];

describe('the stored spelling of a name', () => {
  it('is found when only the case differs', () => {
    expect(canonicalName(STORED, 'foxglove')).toBe('Foxglove');
    expect(canonicalName(STORED, 'FOXGLOVE')).toBe('Foxglove');
    expect(canonicalName(STORED, 'FoXgLoVe')).toBe('Foxglove');
  });

  it('is null when the name is already stored exactly, so a caller need not compare back', () => {
    expect(canonicalName(STORED, 'Foxglove')).toBeNull();
    expect(canonicalName(STORED, 'notify-relay')).toBeNull();
  });

  it('is null for a name the corpus does not hold in any case', () => {
    expect(canonicalName(STORED, 'Redshank')).toBeNull();
    expect(canonicalName(STORED, 'redshank')).toBeNull();
  });

  it('is null when two stored names differ only by case, rather than picking one', () => {
    expect(canonicalName(['Mercury', 'mercury'], 'MERCURY')).toBeNull();
  });

  it('does not trim, so a name with stray whitespace is still a genuine absence', () => {
    expect(canonicalName(STORED, ' foxglove')).toBeNull();
    expect(canonicalName(STORED, 'foxglove ')).toBeNull();
  });

  it('does not match on a prefix, a suffix or a near miss', () => {
    expect(canonicalName(STORED, 'fox')).toBeNull();
    expect(canonicalName(STORED, 'foxgloves')).toBeNull();
    expect(canonicalName(STORED, 'foxglov')).toBeNull();
    expect(canonicalName(STORED, 'notifyrelay')).toBeNull();
  });

  it('does not fold punctuation or separators', () => {
    expect(canonicalName(STORED, 'notify_relay')).toBeNull();
    expect(canonicalName(STORED, 'notify relay')).toBeNull();
  });

  it('handles an empty corpus and an empty name without throwing', () => {
    expect(canonicalName([], 'Foxglove')).toBeNull();
    expect(canonicalName(STORED, '')).toBeNull();
  });
});
