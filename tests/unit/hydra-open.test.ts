import { describe, expect, it } from 'vitest';

import { HydraConfigError } from '../../src/hydra/errors.js';
import { openSource, readProfile } from '../../src/hydra/open.js';

/**
 * Which store a client reads.
 *
 * This is the rule behind "One context. Any agent.", and it is the kind of
 * rule that is easy to get subtly wrong: a machine configured for both stores
 * that silently picks the wrong one produces answers that are correct for a
 * workspace nobody asked about. So the decision is a pure function of the
 * environment, and this is the table of what it decides.
 */

const NODE = {
  HYDRA_HTTP_URL: 'http://127.0.0.1:18443',
  HYDRA_NAMESPACE: 'local',
  HYDRA_GRAPH: 'default',
  HYDRA_CELL: 'cell-0',
  HYDRA_TOKEN: 'node-token',
};

const CLOUD = {
  HYDRA_CLOUD_URL: 'https://api.hydradb.com',
  HYDRA_CLOUD_TOKEN: 'cloud-token',
  HYDRA_DATABASE: 'lacuna',
  HYDRA_COLLECTION: 'backend',
};

describe('reading the named profile', () => {
  it('takes the name when one is given', () => {
    expect(readProfile({ LACUNA_PROFILE: 'cloud' })).toBe('cloud');
    expect(readProfile({ LACUNA_PROFILE: ' NODE ' })).toBe('node');
  });

  it('is unset rather than defaulted when nobody named one', () => {
    expect(readProfile({})).toBeNull();
    expect(readProfile({ LACUNA_PROFILE: '' })).toBeNull();
  });

  it('refuses a name that is not a profile rather than guessing', () => {
    expect(() => readProfile({ LACUNA_PROFILE: 'prod' })).toThrow(HydraConfigError);
  });
});

describe('opening the store', () => {
  it('reads the cloud when the environment names it', () => {
    const opened = openSource({ ...NODE, ...CLOUD, LACUNA_PROFILE: 'cloud' });
    expect(opened.profile).toBe('cloud');
    expect(opened.source.kind).toBe('cloud');
    expect(opened.describe).toContain('database lacuna');
  });

  it('reads the node when the environment names it, even with a cloud configured', () => {
    const opened = openSource({ ...NODE, ...CLOUD, LACUNA_PROFILE: 'node' });
    expect(opened.profile).toBe('node');
    expect(opened.source.kind).toBe('node');
  });

  it('prefers a configured cloud when nobody named a profile', () => {
    // A machine given a cloud database has been told which store it belongs
    // to. The node is the local development store, not the default.
    expect(openSource({ ...NODE, ...CLOUD }).profile).toBe('cloud');
  });

  it('falls back to the node when no cloud is configured', () => {
    expect(openSource({ ...NODE }).profile).toBe('node');
  });

  it('refuses rather than falling back when the named profile is not configured', () => {
    // Answering from the other store would be answering a question about a
    // workspace the caller did not ask about.
    expect(() => openSource({ ...NODE, LACUNA_PROFILE: 'cloud' })).toThrow(HydraConfigError);
    expect(() => openSource({ ...CLOUD, LACUNA_PROFILE: 'node' })).toThrow();
  });

  it('never puts an address or a token in the line it prints', () => {
    for (const env of [{ ...NODE }, { ...CLOUD }]) {
      const opened = openSource(env);
      expect(opened.describe).not.toContain('127.0.0.1');
      expect(opened.describe).not.toContain('api.hydradb.com');
      expect(opened.describe).not.toContain('token');
    }
  });

  it('hands back a fresh source each time, so no memo outlives a question', () => {
    const first = openSource({ ...CLOUD });
    const second = openSource({ ...CLOUD });
    expect(first.source).not.toBe(second.source);
  });
});
