import { describe, expect, it } from 'vitest';

import { storeWorkspace } from '../../src/api/workspace.js';
import type { HydraSource } from '../../src/hydra/source.js';

function source(claims: readonly { readonly predicate: string; readonly value: string }[]): HydraSource {
  return {
    kind: 'cloud',
    subjects: async () => ({ value: ['Gateway'], traces: [] }),
    entity: async () => ({ value: { id: 1, kind: 'service' }, traces: [] }),
    subject: async () => ({
      value: {
        name: 'Gateway', id: 1, kind: 'service', mentions: [],
        claims: claims.map((claim, index) => ({
          id: index + 1,
          predicate: claim.predicate,
          objectText: claim.value,
          polarity: 'positive' as const,
          validFrom: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          txTime: '2026-08-01T00:00:00.000Z',
          supersededBy: [],
        })),
      },
      traces: [],
    }),
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
  };
}

describe('signed-in memory standings', () => {
  it('keeps different current predicates current', async () => {
    const view = await storeWorkspace(source([
      { predicate: 'owner', value: 'Priya Raman' },
      { predicate: 'region', value: 'eu-central-1' },
    ]), 1_000);

    expect(view.memory.map((row) => row.st)).toEqual(['CUR', 'CUR']);
    expect(view.health).toEqual({ current: 2, historical: 0, conflicts: 0 });
  });

  it('marks divergent live values on the same predicate as conflict', async () => {
    const view = await storeWorkspace(source([
      { predicate: 'owner', value: 'Priya Raman' },
      { predicate: 'owner', value: 'Rasmus Berg' },
      { predicate: 'region', value: 'eu-central-1' },
    ]), 1_000);

    expect(view.memory.map((row) => row.st)).toEqual(['CON', 'CON', 'CUR']);
    expect(view.health).toEqual({ current: 1, historical: 0, conflicts: 2 });
  });
});
