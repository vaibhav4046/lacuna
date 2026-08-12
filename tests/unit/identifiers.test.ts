import { describe, expect, it } from 'vitest';

import { HydraGuardError } from '../../src/hydra/errors';
import {
  assertIdentifier,
  isIdentifier,
  MAX_IDENTIFIER_LENGTH,
} from '../../src/hydra/identifiers';

describe('isIdentifier', () => {
  it('accepts the shapes Lacuna actually uses', () => {
    for (const name of ['Claim', 'EvidenceSpan', 'SUPERSEDES', 'valid_from', 'a1']) {
      expect(isIdentifier(name), name).toBe(true);
    }
  });

  it('rejects anything that could end a token and start another', () => {
    const attacks = [
      'Claim`',
      'Claim ',
      'Claim)',
      'Claim}',
      'Claim, n.admin = true',
      'Claim`) SET n.owner = "attacker" //',
      'Claim\nSET n.x = 1',
      'Claim-Evidence',
      'Claim.predicate',
      '',
      '1Claim',
      '_Claim',
      'Cláim',
    ];
    for (const attack of attacks) {
      expect(isIdentifier(attack), JSON.stringify(attack)).toBe(false);
    }
  });

  it('rejects a name past the length cap', () => {
    expect(isIdentifier('A'.repeat(MAX_IDENTIFIER_LENGTH))).toBe(true);
    expect(isIdentifier('A'.repeat(MAX_IDENTIFIER_LENGTH + 1))).toBe(false);
  });
});

describe('assertIdentifier', () => {
  it('returns the input unchanged when it is safe', () => {
    expect(assertIdentifier('Claim', 'vertex label')).toBe('Claim');
  });

  it('throws a guard error naming the role, and does not repair the input', () => {
    expect(() => assertIdentifier('Claim`) //', 'vertex label'))
      .toThrowError(HydraGuardError);
    expect(() => assertIdentifier('Claim`) //', 'vertex label'))
      .toThrowError(/vertex label is not a safe Cypher identifier/);
  });
});
