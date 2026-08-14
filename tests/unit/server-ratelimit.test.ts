import { describe, expect, it } from 'vitest';

import { FixedWindow } from '../../src/server/ratelimit.js';

/**
 * The limiter, driven by numbers instead of by a clock.
 *
 * `check` takes the time as a parameter precisely so this file can exist. The
 * two behaviours worth testing are what happens at a window boundary and what
 * happens when the key table is full, and both are one arithmetic step off the
 * normal path, which is where a fake timer over the whole process would leave
 * them untested and plausible.
 */

const OPTIONS = { limit: 3, windowMs: 1_000, maxKeys: 4 } as const;

describe('FixedWindow', () => {
  it('allows up to the limit and refuses the request after it', () => {
    const limiter = new FixedWindow(OPTIONS);

    expect(limiter.check('a', 0)).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
    expect(limiter.check('a', 10)).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    expect(limiter.check('a', 20)).toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0 });
    expect(limiter.check('a', 30)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 1 });
  });

  it('counts each key on its own', () => {
    const limiter = new FixedWindow(OPTIONS);
    for (const at of [0, 1, 2]) limiter.check('a', at);

    expect(limiter.check('a', 3).allowed).toBe(false);
    expect(limiter.check('b', 3).allowed).toBe(true);
  });

  it('opens a new window at the boundary rather than one tick after it', () => {
    const limiter = new FixedWindow(OPTIONS);
    for (const at of [0, 1, 2]) limiter.check('a', at);

    expect(limiter.check('a', 999).allowed).toBe(false);
    // Exactly one window later. The comparison is >=, so this is the first
    // request of the next window and not the last refusal of the old one.
    expect(limiter.check('a', 1_000)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
  });

  it('rounds the retry up, so it is never a zero that invites an instant retry', () => {
    const limiter = new FixedWindow(OPTIONS);
    for (const at of [0, 1, 2]) limiter.check('a', at);

    // 1 ms left in the window still reads as a second.
    expect(limiter.check('a', 999).retryAfterSeconds).toBe(1);
    expect(limiter.check('a', 500).retryAfterSeconds).toBe(1);
    expect(limiter.check('a', 100).retryAfterSeconds).toBe(1);
  });

  it('holds the key table at its cap however many sources arrive', () => {
    const limiter = new FixedWindow(OPTIONS);
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) limiter.check(key, 0);

    expect(limiter.size).toBe(OPTIONS.maxKeys);
  });

  it('discards expired counters before live ones', () => {
    const limiter = new FixedWindow(OPTIONS);
    for (const key of ['a', 'b', 'c', 'd']) limiter.check(key, 0);

    // A window later every counter is stale, so the new key costs all four
    // rather than the one a blind eviction would have taken.
    limiter.check('e', 1_000);
    expect(limiter.size).toBe(1);
  });

  it('evicts the oldest window first when nothing has expired', () => {
    const limiter = new FixedWindow(OPTIONS);
    limiter.check('a', 0);
    for (const key of ['b', 'c', 'd']) limiter.check(key, 100);
    for (const at of [110, 120]) limiter.check('b', at);

    limiter.check('e', 200);

    expect(limiter.size).toBe(OPTIONS.maxKeys);
    // "b" is still counted: it was seen most recently, and a refused request
    // does not disturb the table.
    expect(limiter.check('b', 200)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });
    // "a" held the oldest window, so it is the one that was dropped, and it now
    // gets a full allowance again.
    expect(limiter.check('a', 200).remaining).toBe(2);
  });

  it('refuses to be built with a limit, window or table size below one', () => {
    expect(() => new FixedWindow({ ...OPTIONS, limit: 0 })).toThrow(RangeError);
    expect(() => new FixedWindow({ ...OPTIONS, windowMs: 0 })).toThrow(RangeError);
    expect(() => new FixedWindow({ ...OPTIONS, maxKeys: 0 })).toThrow(RangeError);
  });
});
