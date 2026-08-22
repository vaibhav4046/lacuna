export type McpServerStatus = 'checking' | 'live' | 'unavailable';

export type McpProbeResult<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure' }
  | { readonly kind: 'superseded' };

interface ActiveProbe {
  readonly control: AbortController;
  timeout: ReturnType<typeof globalThis.setTimeout> | null;
  supersede(): void;
}

/** Own one current MCP probe and prevent an older completion from winning. */
export class McpProbeCoordinator {
  readonly #timeoutMs: number;
  #active: ActiveProbe | null = null;

  constructor(timeoutMs = 10_000) {
    this.#timeoutMs = timeoutMs;
  }

  async run<T>(probe: (signal: AbortSignal) => Promise<T>): Promise<McpProbeResult<T>> {
    this.#cancelActive();
    const control = new AbortController();
    let supersede: () => void = () => undefined;
    const superseded = new Promise<McpProbeResult<T>>((resolve) => {
      supersede = () => resolve({ kind: 'superseded' });
    });
    const active: ActiveProbe = { control, timeout: null, supersede };
    this.#active = active;

    const deadline = new Promise<McpProbeResult<T>>((resolve) => {
      active.timeout = globalThis.setTimeout(() => {
        control.abort();
        resolve({ kind: 'failure' });
      }, this.#timeoutMs);
    });
    const operation: Promise<McpProbeResult<T>> = Promise.resolve()
      .then(() => probe(control.signal))
      .then(
        (value): McpProbeResult<T> => ({ kind: 'success', value }),
        (): McpProbeResult<T> => ({ kind: 'failure' }),
      );
    const result = await Promise.race([operation, deadline, superseded]);

    if (this.#active !== active) return { kind: 'superseded' };
    if (active.timeout !== null) globalThis.clearTimeout(active.timeout);
    this.#active = null;
    return result;
  }

  dispose(): void {
    this.#cancelActive();
  }

  #cancelActive(): void {
    if (this.#active === null) return;
    this.#active.control.abort();
    if (this.#active.timeout !== null) globalThis.clearTimeout(this.#active.timeout);
    this.#active.supersede();
    this.#active = null;
  }
}

export function mcpServerStatus(tools: readonly string[] | null): McpServerStatus {
  if (tools === null) return 'checking';
  return tools.length > 0 ? 'live' : 'unavailable';
}
