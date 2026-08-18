/**
 * One adapter for every OpenAI-compatible endpoint.
 *
 * Groq, DeepSeek, Ollama, vLLM and anything else that speaks the same wire
 * format share this file. Writing an adapter per vendor would be four copies
 * of the same fetch with a different base URL, and the differences that
 * actually matter — which models exist, whether the endpoint answers, how long
 * it takes — are all discovered at runtime rather than declared here.
 *
 * Nothing in this file decides that a model is connected. It asks, measures,
 * and reports what came back. A provider whose endpoint does not answer is
 * FAILED, and a provider with no key is NOT CONFIGURED, and neither of those
 * is a model the product will claim to have.
 */

export type ProviderState = 'CONNECTED' | 'FAILED' | 'NOT CONFIGURED';

export interface ProviderModel {
  readonly id: string;
  readonly owned_by?: string;
}

export interface ProviderHealth {
  readonly state: ProviderState;
  /** Milliseconds for the round trip, measured. Null when nothing was sent. */
  readonly latencyMs: number | null;
  readonly models: readonly ProviderModel[];
  /** Plain sentence when the state is FAILED. Never a stack, never a key. */
  readonly detail: string;
}

export interface ProviderConfig {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  /** Where the work happens, as the design's Models table words it. */
  readonly where: 'cloud' | 'local';
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * Lists the models the endpoint says it has, and times the request.
 *
 * A local endpoint with no key is still a real endpoint, so a missing key only
 * means NOT CONFIGURED for a provider that needs one. The distinction matters:
 * an Ollama on this machine answers without a key and should not be reported
 * as unconfigured because a cloud provider's rule was applied to it.
 */
export async function probe(
  config: ProviderConfig,
  options: { readonly timeoutMs?: number; readonly fetch?: FetchLike } = {},
): Promise<ProviderHealth> {
  const needsKey = config.where === 'cloud';
  if (needsKey && (config.apiKey === undefined || config.apiKey === '')) {
    return { state: 'NOT CONFIGURED', latencyMs: null, models: [], detail: 'no API key is configured' };
  }

  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const started = performance.now();

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.apiKey !== undefined && config.apiKey !== '') headers['Authorization'] = `Bearer ${config.apiKey}`;

    const response = await send(`${config.baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (!response.ok) {
      return {
        state: 'FAILED',
        latencyMs,
        models: [],
        // The status, never the body: an error body from a provider can carry
        // an echoed key or a request id nobody wants in a screenshot.
        detail: `the endpoint answered ${response.status}`,
      };
    }

    const body: unknown = await response.json();
    const models = readModels(body);
    return { state: 'CONNECTED', latencyMs, models, detail: `${models.length} models` };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      state: 'FAILED',
      latencyMs,
      models: [],
      detail: aborted ? 'the endpoint did not answer in time' : 'the endpoint could not be reached',
    };
  } finally {
    clearTimeout(timer);
  }
}

function readModels(body: unknown): readonly ProviderModel[] {
  if (typeof body !== 'object' || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: ProviderModel[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') continue;
    const ownedBy = (entry as { owned_by?: unknown }).owned_by;
    out.push(typeof ownedBy === 'string' ? { id, owned_by: ownedBy } : { id });
  }
  return out;
}
