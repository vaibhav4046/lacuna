import { describe, expect, it } from 'vitest';

import { loadHydraConfig, queryEndpoint } from '../../src/hydra/config';
import { HydraConfigError } from '../../src/hydra/errors';

const COMPLETE = {
  HYDRA_HTTP_URL: 'http://127.0.0.1:18443',
  HYDRA_NAMESPACE: 'local',
  HYDRA_GRAPH: 'default',
  HYDRA_CELL: 'cell-0',
  HYDRA_TOKEN: 'not-the-real-token',
};

describe('loadHydraConfig', () => {
  it('reads a complete environment', () => {
    const config = loadHydraConfig(COMPLETE);
    expect(config.baseUrl).toBe('http://127.0.0.1:18443');
    expect(config.namespace).toBe('local');
    expect(config.cell).toBe('cell-0');
  });

  it('strips a trailing slash so the endpoint never doubles up', () => {
    const config = loadHydraConfig({ ...COMPLETE, HYDRA_HTTP_URL: 'http://127.0.0.1:18443//' });
    expect(queryEndpoint(config)).toBe('http://127.0.0.1:18443/v1/graphs/default/query');
  });

  it('names the missing variable and nothing else', () => {
    for (const name of Object.keys(COMPLETE)) {
      const env: Record<string, string | undefined> = { ...COMPLETE };
      delete env[name];
      expect(() => loadHydraConfig(env), name).toThrowError(new RegExp(`${name} is not set`));
    }
  });

  it('treats a blank value as missing', () => {
    expect(() => loadHydraConfig({ ...COMPLETE, HYDRA_TOKEN: '   ' }))
      .toThrowError(/HYDRA_TOKEN is not set/);
  });

  it('never puts the token in an error message', () => {
    const token = 'zzz-secret-value-zzz';
    try {
      loadHydraConfig({ ...COMPLETE, HYDRA_TOKEN: token, HYDRA_CELL: '' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(token);
      expect(String((error as Error).stack)).not.toContain(token);
    }
  });

  it('refuses to send a bearer token in cleartext to a remote host', () => {
    expect(() => loadHydraConfig({ ...COMPLETE, HYDRA_HTTP_URL: 'http://hydra.example.com' }))
      .toThrowError(HydraConfigError);
    expect(() => loadHydraConfig({ ...COMPLETE, HYDRA_HTTP_URL: 'http://hydra.example.com' }))
      .toThrowError(/refusing to send a bearer token over plain http/);
  });

  it('allows the same remote host over https', () => {
    const config = loadHydraConfig({ ...COMPLETE, HYDRA_HTTP_URL: 'https://hydra.example.com' });
    expect(config.baseUrl).toBe('https://hydra.example.com');
  });

  it('allows plaintext remote only when the operator says so explicitly', () => {
    const config = loadHydraConfig({
      ...COMPLETE,
      HYDRA_HTTP_URL: 'http://hydra.example.com',
      HYDRA_ALLOW_PLAINTEXT_REMOTE: 'true',
    });
    expect(config.baseUrl).toBe('http://hydra.example.com');
  });

  it('rejects a non-http scheme and a malformed URL', () => {
    expect(() => loadHydraConfig({ ...COMPLETE, HYDRA_HTTP_URL: 'bolt://127.0.0.1:17687' }))
      .toThrowError(/must be http or https/);
    expect(() => loadHydraConfig({ ...COMPLETE, HYDRA_HTTP_URL: 'not a url' }))
      .toThrowError(/not a valid URL/);
  });
});

describe('queryEndpoint', () => {
  it('percent-encodes the graph name', () => {
    const config = loadHydraConfig({ ...COMPLETE, HYDRA_GRAPH: 'a graph/../..' });
    expect(queryEndpoint(config)).toBe(
      'http://127.0.0.1:18443/v1/graphs/a%20graph%2F..%2F../query',
    );
  });
});
