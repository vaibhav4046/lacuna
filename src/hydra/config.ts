import { HydraConfigError } from './errors.js';

export interface HydraConfig {
  /** Base URL of the query API, with no trailing slash. */
  readonly baseUrl: string;
  readonly namespace: string;
  readonly graph: string;
  readonly cell: string;
  /** Bearer token. Server-side only. Never log this, never serialise it. */
  readonly token: string;
}

export interface HydraLimits {
  /** Sent to the server as timeout_ms. The engine honours it: see SECURITY.md. */
  readonly defaultTimeoutMs: number;
  /** Extra time the client waits before aborting itself, on top of the above. */
  readonly abortSlackMs: number;
  readonly maxQueryChars: number;
  readonly maxParameterBytes: number;
  readonly maxResponseBytes: number;
  readonly maxRowsPerQuery: number;
  /** Cap on cursor follows in one logical read, so paging cannot loop forever. */
  readonly maxPages: number;
}

export const DEFAULT_LIMITS: HydraLimits = Object.freeze({
  defaultTimeoutMs: 5_000,
  abortSlackMs: 2_000,
  maxQueryChars: 8_192,
  maxParameterBytes: 1_048_576,
  maxResponseBytes: 8_388_608,
  maxRowsPerQuery: 5_000,
  maxPages: 64,
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    // Names only. The value of the one that matters is a secret.
    throw new HydraConfigError(`${name} is not set`);
  }
  return value.trim();
}

/**
 * Reads configuration from the environment and validates it before anything
 * tries to use it.
 *
 * The loopback check is a deliberate refusal rather than a warning. Sending a
 * bearer token in cleartext to a host that is not this machine is a mistake
 * that is easy to make with a copied .env and expensive to notice.
 */
export function loadHydraConfig(
  env: Record<string, string | undefined> = process.env,
): HydraConfig {
  const rawUrl = required(env, 'HYDRA_HTTP_URL');

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new HydraConfigError('HYDRA_HTTP_URL is not a valid URL', { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HydraConfigError(
      `HYDRA_HTTP_URL must be http or https, got "${url.protocol}"`,
    );
  }

  const allowPlaintextRemote = env['HYDRA_ALLOW_PLAINTEXT_REMOTE'] === 'true';
  if (url.protocol === 'http:'
    && !LOOPBACK_HOSTS.has(url.hostname)
    && !allowPlaintextRemote) {
    throw new HydraConfigError(
      `refusing to send a bearer token over plain http to "${url.hostname}". `
      + 'Use https, or set HYDRA_ALLOW_PLAINTEXT_REMOTE=true if the network is '
      + 'genuinely trusted',
    );
  }

  return Object.freeze({
    baseUrl: rawUrl.replace(/\/+$/, ''),
    namespace: required(env, 'HYDRA_NAMESPACE'),
    graph: required(env, 'HYDRA_GRAPH'),
    cell: required(env, 'HYDRA_CELL'),
    token: required(env, 'HYDRA_TOKEN'),
  });
}

/** The one endpoint this client uses. */
export function queryEndpoint(config: HydraConfig): string {
  return `${config.baseUrl}/v1/graphs/${encodeURIComponent(config.graph)}/query`;
}
