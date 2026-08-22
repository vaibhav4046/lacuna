import { describe, expect, it } from 'vitest';

import { retryWhilePending } from '../../web/src/onboarding/readiness.js';

describe('onboarding readiness retry', () => {
  it('retries a pending read and returns the first usable answer', async () => {
    const values = [null, { ready: false }, { ready: true }];
    const delays: number[] = [];
    const result = await retryWhilePending(
      async () => values.shift() ?? null,
      (value) => value === null || value.ready === false,
      { attempts: 4, delayMs: (retry) => retry + 1, sleep: async (ms) => { delays.push(ms); } },
    );

    expect(result).toEqual({ ready: true });
    expect(delays).toEqual([1, 2]);
  });

  it('does not retry a settled answer', async () => {
    let reads = 0;
    let sleeps = 0;
    const result = await retryWhilePending(
      async () => { reads += 1; return { ready: true }; },
      (value) => value === null || value.ready === false,
      { attempts: 4, sleep: async () => { sleeps += 1; } },
    );

    expect(result).toEqual({ ready: true });
    expect(reads).toBe(1);
    expect(sleeps).toBe(0);
  });

  it('stops at the explicit attempt budget', async () => {
    let reads = 0;
    const result = await retryWhilePending(
      async () => { reads += 1; return null; },
      () => true,
      { attempts: 3, sleep: async () => undefined },
    );

    expect(result).toBeNull();
    expect(reads).toBe(3);
  });
});
