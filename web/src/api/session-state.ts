export interface Session {
  readonly email: string;
  /** Opaque, non-secret identifier for this exact login session. */
  readonly binding: string;
  /** Null until a workspace exists. Never a placeholder name. */
  readonly workspace: string | null;
  readonly onboarded: boolean;
}

export type SessionState = { readonly signedIn: false } | { readonly signedIn: true; readonly session: Session };

export const SESSION_EPOCH_CHANNEL = 'lacuna-session-epoch-v1' as const;
export const SESSION_EPOCH_STORAGE_KEY = 'lacuna_session_epoch_v1' as const;

const BINDING = /^[0-9a-f]{64}$/u;
const NONCE = /^[0-9a-f]{32}$/u;
const MAX_SEEN_NONCES = 256;

export interface SessionEpochMessage {
  readonly version: 1;
  readonly nonce: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function parseSessionEpochMessage(value: unknown): SessionEpochMessage | null {
  if (!record(value) || !exactKeys(value, ['version', 'nonce'])
    || value['version'] !== 1 || typeof value['nonce'] !== 'string'
    || !NONCE.test(value['nonce'])) return null;
  return { version: 1, nonce: value['nonce'] };
}

export function createSessionEpochMessage(
  randomValues: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes),
): SessionEpochMessage {
  const bytes = randomValues(new Uint8Array(16));
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
    throw new Error('session epoch entropy unavailable');
  }
  return {
    version: 1,
    nonce: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

export function decodeSessionState(value: unknown): SessionState | null {
  if (!record(value) || typeof value['signedIn'] !== 'boolean') return null;
  if (value['signedIn'] === false) {
    return exactKeys(value, ['signedIn']) ? { signedIn: false } : null;
  }
  if (!exactKeys(value, ['signedIn', 'session']) || !record(value['session'])) return null;
  const session = value['session'];
  if (!exactKeys(session, ['email', 'binding', 'workspace', 'onboarded'])
    || typeof session['email'] !== 'string' || session['email'].length < 3 || session['email'].length > 320
    || typeof session['binding'] !== 'string' || !BINDING.test(session['binding'])
    || (session['workspace'] !== null && (typeof session['workspace'] !== 'string'
      || session['workspace'].length < 1 || session['workspace'].length > 200))
    || typeof session['onboarded'] !== 'boolean') return null;
  return {
    signedIn: true,
    session: {
      email: session['email'],
      binding: session['binding'],
      workspace: session['workspace'] as string | null,
      onboarded: session['onboarded'],
    },
  };
}

export function sessionIdentity(value: SessionState): string {
  return value.signedIn ? `${value.session.binding}\0${value.session.workspace ?? ''}` : 'signed-out';
}

type EpochEvent = {
  readonly data?: unknown;
  readonly key?: string | null;
  readonly newValue?: string | null;
};

type EpochListener = (event: EpochEvent) => void;

export interface SessionEpochBusOptions {
  readonly channel: {
    postMessage(value: unknown): void;
    addEventListener(type: 'message', listener: EpochListener): void;
    removeEventListener(type: 'message', listener: EpochListener): void;
    close(): void;
  };
  readonly storage: { setItem(key: string, value: string): void };
  readonly addStorageListener: (listener: EpochListener) => void;
  readonly removeStorageListener: (listener: EpochListener) => void;
  readonly randomValues?: (bytes: Uint8Array) => Uint8Array;
}

/** Non-sensitive, nonce-only cross-tab invalidation with dual-transport deduplication. */
export class SessionEpochBus {
  readonly #options: SessionEpochBusOptions;
  readonly #onRemote: () => void;
  readonly #seen = new Set<string>();
  readonly #channelListener: EpochListener;
  readonly #storageListener: EpochListener;
  #disposed = false;

  constructor(options: SessionEpochBusOptions, onRemote: () => void) {
    this.#options = options;
    this.#onRemote = onRemote;
    this.#channelListener = (event) => this.#accept(event.data);
    this.#storageListener = (event) => {
      if (event.key !== SESSION_EPOCH_STORAGE_KEY || typeof event.newValue !== 'string') return;
      try {
        this.#accept(JSON.parse(event.newValue) as unknown);
      } catch {
        // A malformed storage value cannot initiate a session read.
      }
    };
    options.channel.addEventListener('message', this.#channelListener);
    options.addStorageListener(this.#storageListener);
  }

  #remember(nonce: string): boolean {
    if (this.#seen.has(nonce)) return false;
    this.#seen.add(nonce);
    if (this.#seen.size > MAX_SEEN_NONCES) {
      const oldest = this.#seen.values().next().value as string | undefined;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    return true;
  }

  #accept(value: unknown): void {
    if (this.#disposed) return;
    const message = parseSessionEpochMessage(value);
    if (message === null || !this.#remember(message.nonce)) return;
    this.#onRemote();
  }

  publish(): SessionEpochMessage {
    if (this.#disposed) throw new Error('session epoch bus disposed');
    const message = createSessionEpochMessage(this.#options.randomValues);
    this.#remember(message.nonce);
    let failure: unknown;
    try { this.#options.channel.postMessage(message); } catch (error) { failure = error; }
    try { this.#options.storage.setItem(SESSION_EPOCH_STORAGE_KEY, JSON.stringify(message)); } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) throw failure;
    return message;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#options.channel.removeEventListener('message', this.#channelListener);
    this.#options.removeStorageListener(this.#storageListener);
    this.#options.channel.close();
    this.#seen.clear();
  }
}

export type SessionReadCause = 'initial' | 'refresh' | 'remote' | 'focus' | 'pageshow' | 'mutation';

export interface SessionReadCoordinatorOptions {
  readonly read: (signal: AbortSignal) => Promise<SessionState>;
  readonly onLoading: (cause: SessionReadCause) => void;
  readonly onReady: (value: SessionState) => void;
  readonly onFailed: () => void;
  readonly onValidatedTransition: (identity: string) => void;
}

/** Commit the loading boundary before any revalidation is allowed to start network work. */
export function synchronousSessionTeardown(
  commit: () => void,
  flush: (commit: () => void) => void,
): void {
  flush(commit);
}

/** Latest-started session reads own context; superseded callers await the newest read. */
export class SessionReadCoordinator {
  readonly #options: SessionReadCoordinatorOptions;
  readonly #waiters: { readonly generation: number; readonly resolve: () => void }[] = [];
  #generation = 0;
  #active: AbortController | null = null;
  #lastValidated: string | undefined;
  #disposed = false;

  constructor(options: SessionReadCoordinatorOptions) {
    this.#options = options;
  }

  refresh(cause: SessionReadCause): Promise<void> {
    return this.#start(cause);
  }

  /** Teardown, publish one nonce, then begin the sole post-mutation validation read. */
  refreshAfterMutation(publish: () => void): Promise<void> {
    return this.#start('mutation', publish);
  }

  #start(cause: SessionReadCause, beforeRead?: () => void): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const generation = this.#generation + 1;
    this.#generation = generation;
    this.#active?.abort();
    const control = new AbortController();
    this.#active = control;
    this.#options.onLoading(cause);
    if (beforeRead !== undefined) {
      try { beforeRead(); } catch { /* local teardown remains authoritative; validation still runs */ }
    }
    const caller = new Promise<void>((resolve) => this.#waiters.push({ generation, resolve }));
    void this.#run(generation, cause, control);
    return caller;
  }

  async #run(generation: number, cause: SessionReadCause, control: AbortController): Promise<void> {
    try {
      const value = await this.#options.read(control.signal);
      if (this.#disposed || generation !== this.#generation || control.signal.aborted) return;
      const identity = sessionIdentity(value);
      const changed = identity !== this.#lastValidated;
      this.#lastValidated = identity;
      this.#options.onReady(value);
      if (changed && cause !== 'remote' && cause !== 'mutation') this.#options.onValidatedTransition(identity);
    } catch {
      if (!this.#disposed && generation === this.#generation && !control.signal.aborted) {
        this.#options.onFailed();
      }
    } finally {
      if (!this.#disposed && generation === this.#generation) {
        this.#active = null;
        const settled = this.#waiters.splice(0);
        settled.forEach(({ resolve }) => resolve());
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#active?.abort();
    this.#active = null;
    this.#waiters.splice(0).forEach(({ resolve }) => resolve());
  }
}
