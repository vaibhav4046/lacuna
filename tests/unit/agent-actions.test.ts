import { describe, expect, it } from 'vitest';

import { guardedAction } from '../../web/src/app/agent-actions.js';

describe('agent action guard', () => {
  it('returns a bounded message when an action throws', async () => {
    await expect(guardedAction(async () => { throw new Error('network down'); }, 'did not complete'))
      .resolves.toEqual({ value: null, message: 'Connection failed.' });
  });

  it('preserves a successful value and maps an empty response separately', async () => {
    await expect(guardedAction(async () => ({ id: 'run-1' }), 'did not complete'))
      .resolves.toEqual({ value: { id: 'run-1' }, message: null });
    await expect(guardedAction(async () => null, 'did not complete'))
      .resolves.toEqual({ value: null, message: 'did not complete' });
  });
});
