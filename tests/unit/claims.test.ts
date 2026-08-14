import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_STATES,
  DATA_STATES,
  type CapabilityState,
  type DataState,
} from '../../src/model/capability';

/**
 * The ledger checks itself.
 *
 * docs/CLAIMS.json is the one place this project says what it can do and what
 * proves it, which makes it the one place a stale sentence does the most damage.
 * A claim that points at a file nobody kept, a state invented for one entry, or
 * two entries sharing an id are all failures a reader would have to catch by
 * hand. They are cheap to catch here instead.
 *
 * The two vocabularies are imported rather than repeated, so the ledger and the
 * interface pages cannot drift apart: a sixth capability state has to be added
 * to src/model/capability.ts before it can appear in the file, and once it is
 * there the header list has to name it too.
 */

const ROOT = new URL('../../', import.meta.url);

interface Claim {
  readonly id: string;
  readonly claim: string;
  readonly capability: string;
  readonly data: string | null;
  readonly why_no_data?: string;
  readonly measured?: unknown;
  readonly evidence: readonly string[];
  readonly reproduce: string;
  readonly caveat: string;
}

interface Ledger {
  readonly about: string;
  readonly generated_at: string;
  readonly states_from: string;
  readonly capability_states: readonly string[];
  readonly data_states: readonly string[];
  readonly null_data_means: string;
  readonly claims: readonly Claim[];
}

const ledger = JSON.parse(
  readFileSync(new URL('docs/CLAIMS.json', ROOT), 'utf8'),
) as Ledger;

/** A repo relative path as the file writes them, resolved against the root. */
function onDisk(relative: string): string {
  return fileURLToPath(new URL(relative, ROOT));
}

describe('docs/CLAIMS.json, the header', () => {
  it('names the same capability states the code knows, in the same order', () => {
    expect(ledger.capability_states).toEqual([...CAPABILITY_STATES]);
  });

  it('names the same data states the code knows, in the same order', () => {
    expect(ledger.data_states).toEqual([...DATA_STATES]);
  });

  it('points at a file that exists for where the states came from', () => {
    expect(existsSync(onDisk(ledger.states_from))).toBe(true);
  });

  it('points at this test, which is the file it says checks it', () => {
    expect(ledger.about).toContain('tests/unit/claims.test.ts');
    expect(existsSync(onDisk('tests/unit/claims.test.ts'))).toBe(true);
  });

  it('carries a date and a reason for the null data state', () => {
    expect(ledger.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ledger.null_data_means.length).toBeGreaterThan(0);
  });
});

describe('docs/CLAIMS.json, the entries', () => {
  it('has claims at all', () => {
    expect(ledger.claims.length).toBeGreaterThan(0);
  });

  it('gives every claim a distinct id', () => {
    const ids = ledger.claims.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes every id the same way, so one can be searched for', () => {
    for (const entry of ledger.claims) {
      expect(entry.id, entry.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('uses only capability states the code knows', () => {
    const known = new Set<string>(CAPABILITY_STATES);
    for (const entry of ledger.claims) {
      expect(known.has(entry.capability), `${entry.id}: ${entry.capability}`).toBe(true);
    }
  });

  it('uses only data states the code knows, or null', () => {
    const known = new Set<string>(DATA_STATES);
    for (const entry of ledger.claims) {
      if (entry.data === null) {
        continue;
      }
      expect(known.has(entry.data), `${entry.id}: ${entry.data}`).toBe(true);
    }
  });

  it('explains every null data state and does not explain the others', () => {
    for (const entry of ledger.claims) {
      if (entry.data === null) {
        expect(entry.why_no_data, entry.id).toBeTypeOf('string');
        expect((entry.why_no_data ?? '').length, entry.id).toBeGreaterThan(0);
      } else {
        expect(entry.why_no_data, entry.id).toBeUndefined();
      }
    }
  });

  it('says what is claimed, how to repeat it, and what it does not cover', () => {
    for (const entry of ledger.claims) {
      expect(entry.claim.length, entry.id).toBeGreaterThan(0);
      expect(entry.reproduce.length, entry.id).toBeGreaterThan(0);
      expect(entry.caveat.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('points every claim at evidence that is on disk', () => {
    for (const entry of ledger.claims) {
      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
      for (const path of entry.evidence) {
        expect(existsSync(onDisk(path)), `${entry.id}: ${path}`).toBe(true);
      }
    }
  });

  it('keeps evidence paths repo relative, because that is what a reader can open', () => {
    for (const entry of ledger.claims) {
      for (const path of entry.evidence) {
        expect(path.startsWith('/'), `${entry.id}: ${path}`).toBe(false);
        expect(path.includes('\\'), `${entry.id}: ${path}`).toBe(false);
        expect(path.includes('..'), `${entry.id}: ${path}`).toBe(false);
      }
    }
  });
});

describe('docs/CLAIMS.json, the states it actually uses', () => {
  it('does not claim VERIFIED without evidence to open', () => {
    const verified = ledger.claims.filter(
      (entry) => (entry.capability as CapabilityState) === 'VERIFIED',
    );
    expect(verified.length).toBeGreaterThan(0);
    for (const entry of verified) {
      expect(entry.evidence.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('keeps the unbuilt things unbuilt rather than quietly LIVE', () => {
    const unstarted = ledger.claims.filter(
      (entry) => (entry.capability as CapabilityState) === 'NOT_STARTED',
    );
    for (const entry of unstarted) {
      expect(entry.data as DataState | null, entry.id).toBe('UNAVAILABLE');
    }
  });
});
