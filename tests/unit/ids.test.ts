import { describe, expect, it } from 'vitest';

import {
  canonicalKey,
  deriveId,
  ID_BITS,
  IdCollisionError,
  IdError,
  IdRegistry,
  KEY_SEPARATOR,
  MAX_ID,
} from '../../src/model/ids.js';

describe('canonicalKey', () => {
  it('joins the label to the key with the unit separator', () => {
    expect(canonicalKey('Claim', 'Meridian::owner::1')).toBe(
      `Claim${KEY_SEPARATOR}Meridian::owner::1`,
    );
  });

  it('rejects an empty half', () => {
    expect(() => canonicalKey('', 'x')).toThrow(IdError);
    expect(() => canonicalKey('Claim', '')).toThrow(IdError);
  });

  it('rejects a separator inside either half, which is what stops ambiguity', () => {
    expect(() => canonicalKey(`Claim${KEY_SEPARATOR}a`, 'b')).toThrow(IdError);
    expect(() => canonicalKey('Claim', `a${KEY_SEPARATOR}b`)).toThrow(IdError);
  });
});

describe('deriveId', () => {
  it('is stable across calls', () => {
    expect(deriveId('Session', 'session-01')).toBe(deriveId('Session', 'session-01'));
  });

  it('stays inside the safe integer range', () => {
    expect(MAX_ID).toBe(2 ** ID_BITS - 1);
    expect(Number.isSafeInteger(MAX_ID)).toBe(true);

    for (let i = 0; i < 2000; i += 1) {
      const id = deriveId('Message', `session-01-m${String(i).padStart(3, '0')}`);
      expect(Number.isSafeInteger(id), String(id)).toBe(true);
      expect(id >= 0 && id <= MAX_ID, String(id)).toBe(true);
    }
  });

  it('separates the label from the key', () => {
    expect(deriveId('Claim', 'a')).not.toBe(deriveId('Entity', 'a'));
  });

  it('does not collide across a corpus sized population', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 20000; i += 1) {
      seen.add(deriveId('EvidenceSpan', `session-${i % 48}-m${i}-span`));
    }
    expect(seen.size).toBe(20000);
  });
});

describe('IdRegistry', () => {
  it('interns the same key to the same id once', () => {
    const registry = new IdRegistry();
    const first = registry.intern('Claim', 'Meridian::owner::1');
    const second = registry.intern('Claim', 'Meridian::owner::1');

    expect(second).toBe(first);
    expect(registry.size).toBe(1);
    expect(registry.keyFor(first)).toBe(canonicalKey('Claim', 'Meridian::owner::1'));
  });

  it('keeps distinct keys distinct', () => {
    const registry = new IdRegistry();
    registry.intern('Claim', 'Meridian::owner::1');
    registry.intern('Claim', 'Meridian::owner::2');

    expect(registry.size).toBe(2);
  });

  it('reports an unknown id as undefined rather than guessing', () => {
    expect(new IdRegistry().keyFor(1)).toBeUndefined();
  });
});

describe('IdCollisionError', () => {
  it('names both keys, because the point is to be diagnosable', () => {
    const existing = canonicalKey('Claim', 'a');
    const incoming = canonicalKey('Claim', 'b');
    const error = new IdCollisionError(42, existing, incoming);

    expect(error).toBeInstanceOf(IdError);
    expect(error.name).toBe('IdCollisionError');
    expect(error.id).toBe(42);
    expect(error.existingKey).toBe(existing);
    expect(error.incomingKey).toBe(incoming);
    expect(error.message).toContain(JSON.stringify(existing));
    expect(error.message).toContain(JSON.stringify(incoming));
  });
});
