import { describe, expect, it } from 'vitest';

import { configured, modelRows } from '../../src/provider/registry.js';

/**
 * Which providers this deployment has, and what the Models screen is allowed
 * to say about them.
 *
 * The rule the screen lives by is that a state word must be earned. A provider
 * appears because this process can reach it, and the word next to it is the
 * result of asking. The case worth guarding is the one where asking is not
 * possible: some providers publish no catalogue read, and calling them FAILED
 * tells the owner their key is broken when it is not.
 */

const KEY = 'k'.repeat(40);

/** A fetch that records what was asked and answers however the test wants. */
function transport(answer: (url: string) => { status: number; body: unknown }) {
  const urls: string[] = [];
  const fetchLike = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const { status, body } = answer(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { urls, fetchLike };
}

describe('configured', () => {
  it('lists nothing when the environment carries no keys', () => {
    expect(configured({})).toEqual([]);
  });

  it('ignores a key that is present but empty', () => {
    expect(configured({ GROQ_API_KEY: '', PERPLEXITY_API_KEY: '' })).toEqual([]);
  });

  it('reads Perplexity from its own variable and pins its host', () => {
    const providers = configured({ PERPLEXITY_API_KEY: KEY });
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe('perplexity');
    expect(providers[0]?.baseUrl).toBe('https://api.perplexity.ai');
    expect(providers[0]?.where).toBe('cloud');
  });

  it('carries every configured cloud and local endpoint', () => {
    const providers = configured({
      GROQ_API_KEY: KEY,
      PERPLEXITY_API_KEY: KEY,
      ANTHROPIC_API_KEY: KEY,
      DEEPSEEK_API_KEY: KEY,
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1',
      VLLM_BASE_URL: 'http://127.0.0.1:8000/v1',
    });
    expect(providers.map((provider) => provider.name)).toEqual([
      'groq', 'perplexity', 'anthropic', 'deepseek', 'ollama', 'vllm',
    ]);
    // A local endpoint answers without a key and is probed on its base URL alone.
    expect(providers.find((provider) => provider.name === 'ollama')?.apiKey).toBeUndefined();
  });
});

describe('modelRows', () => {
  it('says nothing at all when no provider is configured', async () => {
    expect(await modelRows({})).toEqual([]);
  });

  it('never calls a provider that publishes no catalogue read', async () => {
    // Perplexity answers 404 on /models and 401 on /chat/completions, so a
    // probe through this adapter would report FAILED for a good key. The
    // Models screen must not spend a request to learn that.
    const { urls, fetchLike } = transport(() => ({ status: 404, body: {} }));
    const rows = await modelRows({ PERPLEXITY_API_KEY: KEY }, { fetch: fetchLike });
    expect(urls).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prov).toBe('perplexity');
    expect(rows[0]?.state).not.toBe('FAILED');
    expect(rows[0]?.lat).toBe('—');
  });

  it('treats Anthropic the same way, for the same reason', async () => {
    const { urls, fetchLike } = transport(() => ({ status: 404, body: {} }));
    const rows = await modelRows({ ANTHROPIC_API_KEY: KEY }, { fetch: fetchLike });
    expect(urls).toEqual([]);
    expect(rows[0]?.state).not.toBe('FAILED');
  });

  it('still probes a provider that does answer, and reports what it listed', async () => {
    const { urls, fetchLike } = transport(() => ({
      status: 200,
      body: { data: [{ id: 'llama-3.3-70b' }, { id: 'allam-2-7b' }] },
    }));
    const rows = await modelRows({ GROQ_API_KEY: KEY }, { fetch: fetchLike });
    expect(urls).toEqual(['https://api.groq.com/openai/v1/models']);
    // Sorted before it is cut, so the same handful appears twice running.
    expect(rows.map((row) => row.name)).toEqual(['allam-2-7b', 'llama-3.3-70b']);
    expect(rows.every((row) => row.state === 'CONNECTED')).toBe(true);
  });

  it('reports a provider that answers badly as failed, without quoting it', async () => {
    const { fetchLike } = transport(() => ({
      status: 500,
      body: { error: 'internal detail that must not be shown' },
    }));
    const rows = await modelRows({ GROQ_API_KEY: KEY }, { fetch: fetchLike });
    expect(rows[0]?.state).toBe('FAILED');
    expect(JSON.stringify(rows)).not.toContain('internal detail');
  });

  it('keeps an unprobed provider alongside one it did measure', async () => {
    const { urls, fetchLike } = transport(() => ({ status: 200, body: { data: [{ id: 'llama-3.3-70b' }] } }));
    const rows = await modelRows({ GROQ_API_KEY: KEY, PERPLEXITY_API_KEY: KEY }, { fetch: fetchLike });
    // Only the provider that publishes a catalogue was asked.
    expect(urls).toEqual(['https://api.groq.com/openai/v1/models']);
    expect(rows.map((row) => row.prov).sort()).toEqual(['groq', 'perplexity']);
  });
});
