import type { IncomingMessage } from 'node:http';

/**
 * A few serverless adapters preserve the IncomingMessage shape without
 * exposing Node's full Socket instance. Keep request lifecycle cleanup
 * optional so a valid body cannot become a 500 at the first socket hook.
 */
interface RequestSocketLike {
  readonly destroyed?: boolean;
  readonly remoteAddress?: string;
  once?: (event: 'close', listener: () => void) => unknown;
  off?: (event: 'close', listener: () => void) => unknown;
}

function socketOf(request: IncomingMessage): RequestSocketLike | undefined {
  const candidate = (request as IncomingMessage & { readonly socket?: unknown }).socket;
  return typeof candidate === 'object' && candidate !== null
    ? candidate as RequestSocketLike
    : undefined;
}

export function requestRemoteAddress(request: IncomingMessage): string | undefined {
  return socketOf(request)?.remoteAddress;
}

export function requestSocketDestroyed(request: IncomingMessage): boolean {
  return socketOf(request)?.destroyed === true;
}

/** Attach a best-effort close listener and return its safe cleanup function. */
export function onRequestSocketClose(request: IncomingMessage, listener: () => void): () => void {
  const socket = socketOf(request);
  if (typeof socket?.once === 'function') socket.once('close', listener);
  return () => {
    if (typeof socket?.off === 'function') socket.off('close', listener);
  };
}
