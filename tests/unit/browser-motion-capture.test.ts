import { describe, expect, it } from 'vitest';

import {
  actionForMetadata,
  frameMetrics,
  markerForMetadata,
  parseBrowserMotionSpec,
  sanitizedSourceUrl,
  type SourceFrame,
} from '../../scripts/lib/browser-motion.js';

const VALID = {
  version: 1,
  name: 'landing-real-pixels',
  url: 'http://127.0.0.1:4174/?theme=dark#top',
  output: 'artifacts/video/landing-real-pixels.mp4',
  viewport: { width: 1_920, height: 1_080, deviceScaleFactor: 1 },
  fps: 30,
  ready: [{ selector: '#top', state: 'visible', timeoutMs: 5_000 }],
  actions: [
    { type: 'scroll', selector: '[data-scene="real"]', durationMs: 900, easing: 'smoothstep' },
    { type: 'click', selector: 'button[data-open]', settleMs: 100 },
    { type: 'type', selector: 'textarea', text: 'public demo input', clear: true, delayMs: 10 },
  ],
  success: [{ selector: '[data-state="ready"]', state: 'attached', attribute: { name: 'data-state', equals: 'ready' } }],
  maskSelectors: ['[data-customer-email]'],
  expectedApiStatuses: [{ path: '/api/explore/voice/speech', status: 503 }],
  settleMs: 200,
} as const;

describe('browser motion capture spec', () => {
  it('accepts an exact 1920x1080/30fps declarative shot', () => {
    const parsed = parseBrowserMotionSpec(VALID);
    expect(parsed.viewport).toEqual({ width: 1_920, height: 1_080, deviceScaleFactor: 1 });
    expect(parsed.fps).toBe(30);
    expect(parsed.actions.map((action) => action.type)).toEqual(['scroll', 'click', 'type']);
    expect(parsed.expectedApiStatuses).toEqual([{ path: '/api/explore/voice/speech', status: 503 }]);
  });

  it('rejects dimensions, missing gates, URL credentials, and secret query keys', () => {
    expect(() => parseBrowserMotionSpec({ ...VALID, viewport: { ...VALID.viewport, width: 1_280 } }))
      .toThrow('must be 1920x1080');
    expect(() => parseBrowserMotionSpec({ ...VALID, ready: [] })).toThrow('at least one exact marker');
    expect(() => parseBrowserMotionSpec({ ...VALID, url: 'https://user:password@example.com/' }))
      .toThrow('cannot contain credentials');
    expect(() => parseBrowserMotionSpec({ ...VALID, url: 'https://example.com/?access_token=private' }))
      .toThrow('sensitive query parameter');
    expect(() => parseBrowserMotionSpec({ ...VALID, expectedApiStatuses: [{ path: '/signin', status: 401 }] }))
      .toThrow('must be /api/* or /mcp');
  });

  it('redacts typed content and exact marker values in metadata', () => {
    const parsed = parseBrowserMotionSpec(VALID);
    const typed = parsed.actions.find((action) => action.type === 'type');
    expect(typed).toBeDefined();
    const actionMetadata = actionForMetadata(typed!);
    expect(JSON.stringify(actionMetadata)).not.toContain('public demo input');
    expect(actionMetadata['value']).toBe('[REDACTED]');

    const markerMetadata = markerForMetadata(parsed.success[0]!);
    expect(JSON.stringify(markerMetadata)).not.toContain('ready"');
    expect(markerMetadata['attributePredicate']).toBe('data-state=[REDACTED]');
    expect(sanitizedSourceUrl(parsed.url)).toBe('http://127.0.0.1:4174/');
  });
});

describe('browser motion frame accounting', () => {
  it('reports protocol gaps, target duplicates, and source gaps independently', () => {
    const frames: SourceFrame[] = [0, 0.033, 0.100].map((timestampSeconds, index) => ({
      sequence: index + 1,
      protocolSessionId: [10, 11, 13][index]!,
      timestampSeconds,
      receivedAtMs: 1_000 + index * 33,
      file: `frame-${index}.jpg`,
      width: 1_920,
      height: 1_080,
    }));
    const metrics = frameMetrics(5, frames, 5, 0, [10, 11, 13, 14, 15], 0.2);
    expect(metrics.protocolSequenceGaps).toBe(1);
    expect(metrics.receivedFrames).toBe(5);
    expect(metrics.savedFrames).toBe(3);
    expect(metrics.targetFrames).toBe(6);
    expect(metrics.duplicatedTargetFrames).toBeGreaterThan(0);
    expect(metrics.longestSourceGapMs).toBeCloseTo(67, 3);
  });
});
