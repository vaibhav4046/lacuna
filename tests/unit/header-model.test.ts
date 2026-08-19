import { describe, expect, it } from 'vitest';

import { headerModel } from '../../src/provider/registry.js';
import type { ModelRow } from '../../src/provider/registry.js';

/**
 * The header names a worker, the same one every time.
 *
 * A provider returns its catalogue in whatever order it likes, and that order
 * changes between calls. Taking the first connected row meant the application
 * header named a different model on every load, and on one of them it read
 * ORPHEUS-ARABIC-SAUDI, a text to speech voice, which is a true fact about the
 * account and a false answer to the question the header is asking.
 */

const row = (name: string, state: ModelRow['state'] = 'CONNECTED'): ModelRow => ({
  name,
  prov: 'groq',
  where: 'cloud',
  state,
  dot: '#15846E',
  lat: '74 ms',
});

describe('the model named in the header', () => {
  it('says so plainly when no endpoint answered', () => {
    expect(headerModel([])).toBe('NOT CONFIGURED');
    expect(headerModel([row('llama-3', 'UNREACHABLE')])).toBe('NOT CONFIGURED');
  });

  it('is the same whatever order the provider listed its catalogue in', () => {
    const names = ['qwen/qwen3.6-27b', 'allam-2-7b', 'whisper-large-v3'];
    const forward = headerModel(names.map((name) => row(name)));
    const backward = headerModel([...names].reverse().map((name) => row(name)));
    expect(forward).toBe(backward);
  });

  it('skips a speech recogniser, a voice and a classifier', () => {
    const picked = headerModel([
      row('whisper-large-v3'),
      row('canopylabs/orpheus-arabic-saudi'),
      row('meta-llama/llama-prompt-guard-2-86m'),
      row('qwen/qwen3.6-27b'),
    ]);
    expect(picked).toBe('QWEN/QWEN3.6-27B · CLOUD');
  });

  it('names one of them rather than nothing when they are all a provider offers', () => {
    expect(headerModel([row('whisper-large-v3')])).toBe('WHISPER-LARGE-V3 · CLOUD');
  });

  it('ignores a model an endpoint did not report as connected', () => {
    const picked = headerModel([row('aaa-unreachable', 'UNREACHABLE'), row('zzz-live')]);
    expect(picked).toBe('ZZZ-LIVE · CLOUD');
  });
});
