import type { IncomingMessage } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  onRequestSocketClose,
  requestRemoteAddress,
  requestSocketDestroyed,
} from '../../src/api/request-lifecycle.js';

describe('request socket lifecycle adapter', () => {
  it('fails closed when a serverless request has no socket', () => {
    const request = {} as IncomingMessage;
    expect(requestRemoteAddress(request)).toBeUndefined();
    expect(requestSocketDestroyed(request)).toBe(false);
    expect(() => onRequestSocketClose(request, () => undefined)()).not.toThrow();
  });

  it('attaches and removes a compatible socket listener', () => {
    const socket = { once: vi.fn(), off: vi.fn(), remoteAddress: '127.0.0.1', destroyed: false };
    const request = { socket } as unknown as IncomingMessage;
    const listener = () => undefined;

    const remove = onRequestSocketClose(request, listener);
    remove();

    expect(requestRemoteAddress(request)).toBe('127.0.0.1');
    expect(requestSocketDestroyed(request)).toBe(false);
    expect(socket.once).toHaveBeenCalledWith('close', listener);
    expect(socket.off).toHaveBeenCalledWith('close', listener);
  });
});
