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

  const perplexity = env['PERPLEXITY_API_KEY'];
  if (perplexity !== undefined && perplexity !== '') {
    // Perplexity exposes the same bounded chat-completions wire shape. It is
    // optional: deployments without a key remain explicitly unconfigured.
    out.push({ name: 'perplexity', baseUrl: 'https://api.perplexity.ai', apiKey: perplexity, where: 'cloud' });
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

/**
 * Providers that do not answer `/models` in the OpenAI shape.
 *
 * Probing these through this adapter reports FAILED for a key that is
 * perfectly good, which is worse than saying nothing: it tells the owner their
 * credential is broken when the endpoint simply is not there. Reporting them
 * as connected would be a state nobody checked. So they are carried through as
 * configured with nothing measured.
 *
 * Checked on 2026-08-25: `api.perplexity.ai/models` answers 404 while
 * `api.perplexity.ai/chat/completions` answers 401, so the key is not the
 * thing failing. Perplexity publishes no free catalogue read, and the only
 * endpoint that would answer bills per call, so probing it on every Models
 * load would spend the owner's credit to learn what a 401 already says.
 */
const NOT_OPENAI_ON_MODELS = new Set(['anthropic', 'perplexity']);

/** One row per model an endpoint really reported, capped so the table stays a table. */
const MAX_MODELS_PER_PROVIDER = 6;

export async function modelRows(
  env: Record<string, string | undefined>,
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): Promise<readonly ModelRow[]> {
  const providers = configured(env);
  if (providers.length === 0) return [];

  const probes = await Promise.all(providers.map(async (config): Promise<readonly [ProviderConfig, ProviderHealth]> => {
    if (NOT_OPENAI_ON_MODELS.has(config.name)) {
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
    // Sorted before it is cut. A provider returns its catalogue in whatever
    // order it likes and that order changes between calls, so slicing first
    // took a different handful of models on every request: the Models screen
    // listed a different six each load and the header named a different one.
    // Sorting first makes both the table and the header the same twice running.
    const catalogue = [...health.models].sort((a, b) => a.id.localeCompare(b.id));
    for (const model of catalogue.slice(0, MAX_MODELS_PER_PROVIDER)) {
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
 * Models a provider lists that are not general purpose workers.
 *
 * A speech recogniser, a text to speech voice and a prompt classifier are all
 * real models and none of them is the answer to "what is this workspace
 * running". They are skipped for the header line only, and still appear in the
 * table on the Models screen, because the table is an inventory and the header
 * is a summary.
 */
const NOT_A_WORKER = /whisper|prompt-guard|orpheus|tts|embed|guard|moderation|rerank/i;

/**
 * The one line the application header shows. A model is named only when an
 * endpoint answered and said it has that model.
 *
 * Sorted before it is picked. A provider returns its catalogue in whatever
 * order it likes and that order changes between calls, so taking the first row
 * meant the header named a different model on every load: on one request it
 * read ORPHEUS-ARABIC-SAUDI, which is a text to speech voice and tells a reader
 * nothing true about what answers their questions. Sorting makes the line
 * stable, and skipping the non-workers makes it sensible.
 */
export function headerModel(rows: readonly ModelRow[]): string {
  const live = rows
    .filter((row) => row.state === 'CONNECTED')
    .sort((a, b) => a.name.localeCompare(b.name));
  if (live.length === 0) return 'NOT CONFIGURED';

  const worker = live.find((row) => !NOT_A_WORKER.test(row.name)) ?? live[0]!;
  return `${worker.name.toUpperCase()} · ${worker.where.toUpperCase()}`;
}
