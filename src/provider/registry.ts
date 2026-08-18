import { probe } from './openai.js';
import type { FetchLike, ProviderConfig, ProviderHealth } from './openai.js';

/**
 * Which model endpoints this deployment has, and what each one really is.
 *
 * Providers come from the environment, so a deployment with no keys has no
 * providers and the Models screen says so. Nothing is listed as available
 * because it exists in the world; it is listed because this process can reach
 * it, and the state next to it is the result of asking.
 */

export interface ModelRow {
  readonly name: string;
  readonly prov: string;
  readonly where: string;
  readonly state: string;
  readonly dot: string;
  /** Measured round trip, or an em dash. Never estimated. */
  readonly lat: string;
}

const DOT: Readonly<Record<string, string>> = {
  CONNECTED: '#15846E',
  FAILED: '#FFB829',
  'NOT CONFIGURED': '#5E5E5E',
};

/**
 * Reads the environment. Groq and DeepSeek are OpenAI-compatible clouds;
 * Ollama and vLLM are local endpoints that answer without a key, so they are
 * probed whenever a base URL is set rather than gated on one.
 */
export function configured(env: Record<string, string | undefined>): readonly ProviderConfig[] {
  const out: ProviderConfig[] = [];

  const groq = env['GROQ_API_KEY'];
  if (groq !== undefined && groq !== '') {
    out.push({ name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: groq, where: 'cloud' });
  }

  const anthropic = env['ANTHROPIC_API_KEY'];
  if (anthropic !== undefined && anthropic !== '') {
    // Anthropic is not OpenAI-compatible on /models, so it is declared rather
    // than probed through this adapter. Listing it without a probe would be a
    // state nobody checked, so it is reported as configured and unprobed.
    out.push({ name: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: anthropic, where: 'cloud' });
  }

  const deepseek = env['DEEPSEEK_API_KEY'];
  if (deepseek !== undefined && deepseek !== '') {
    out.push({ name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: deepseek, where: 'cloud' });
  }

  const ollama = env['OLLAMA_BASE_URL'];
  if (ollama !== undefined && ollama !== '') {
    out.push({ name: 'ollama', baseUrl: ollama, apiKey: undefined, where: 'local' });
  }

  const vllm = env['VLLM_BASE_URL'];
  if (vllm !== undefined && vllm !== '') {
    out.push({ name: 'vllm', baseUrl: vllm, apiKey: undefined, where: 'local' });
  }

  return out;
}

/** One row per model an endpoint really reported, capped so the table stays a table. */
const MAX_MODELS_PER_PROVIDER = 6;

export async function modelRows(
  env: Record<string, string | undefined>,
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): Promise<readonly ModelRow[]> {
  const providers = configured(env);
  if (providers.length === 0) return [];

  const probes = await Promise.all(providers.map(async (config): Promise<readonly [ProviderConfig, ProviderHealth]> => {
    // Anthropic does not answer /models in this shape. Reporting it as failed
    // would be wrong and reporting it as connected would be unchecked, so it
    // is carried through as configured with nothing measured.
    if (config.name === 'anthropic') {
      return [config, { state: 'NOT CONFIGURED', latencyMs: null, models: [], detail: 'not probed through this adapter' }];
    }
    return [config, await probe(config, options)];
  }));

  const rows: ModelRow[] = [];
  for (const [config, health] of probes) {
    if (health.models.length === 0) {
      rows.push({
        name: config.name,
        prov: config.name,
        where: config.where,
        state: health.state,
        dot: DOT[health.state] ?? '#5E5E5E',
        lat: health.latencyMs === null ? '—' : `${health.latencyMs} ms`,
      });
      continue;
    }
    for (const model of health.models.slice(0, MAX_MODELS_PER_PROVIDER)) {
      rows.push({
        name: model.id,
        prov: config.name,
        where: config.where,
        state: health.state,
        dot: DOT[health.state] ?? '#5E5E5E',
        lat: health.latencyMs === null ? '—' : `${health.latencyMs} ms`,
      });
    }
  }
  return rows;
}

/**
 * The one line the application header shows. A model is named only when an
 * endpoint answered and said it has that model.
 */
export function headerModel(rows: readonly ModelRow[]): string {
  const live = rows.find((row) => row.state === 'CONNECTED');
  if (live === undefined) return 'NOT CONFIGURED';
  return `${live.name.toUpperCase()} · ${live.where.toUpperCase()}`;
}
