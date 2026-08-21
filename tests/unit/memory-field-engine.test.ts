import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryFieldEngine } from '../../web/src/canvas/engine.js';

function scene(name: string, connected = true) {
  return {
    isConnected: connected,
    getAttribute: (attribute: string) => attribute === 'data-scene' ? name : null,
    getBoundingClientRect: () => ({
      top: -500,
      bottom: 1_500,
      left: 0,
      right: 1_000,
      width: 1_000,
      height: 2_000,
      x: 0,
      y: -500,
      toJSON: () => ({}),
    }),
  };
}

describe('MemoryFieldEngine scene discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refreshes an empty scene cache after the lazy landing route resolves', () => {
    const real = scene('real');
    const querySelectorAll = vi.fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([real]);
    vi.stubGlobal('innerHeight', 1_000);
    vi.stubGlobal('document', { querySelectorAll });

    const engine = new MemoryFieldEngine({ current: null });

    expect(engine.detectScene()).toEqual(['hero', 0.3]);
    expect(engine.detectScene()[0]).toBe('real');
    expect(querySelectorAll).toHaveBeenCalledTimes(2);
  });

  it('replaces cached scene elements after a route unmount', () => {
    const live = scene('gap');
    const querySelectorAll = vi.fn().mockReturnValue([live]);
    vi.stubGlobal('innerHeight', 1_000);
    vi.stubGlobal('document', { querySelectorAll });

    const engine = new MemoryFieldEngine({ current: null });
    (engine as unknown as { _scenes: unknown[] })._scenes = [scene('real', false)];

    expect(engine.detectScene()[0]).toBe('gap');
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
  });
});
