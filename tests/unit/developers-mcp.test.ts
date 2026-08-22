import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpProbeCoordinator, mcpServerStatus } from '../../web/src/app/mcp-status.js';

afterEach(() => vi.useRealTimers());

describe('MCP developer banner', () => {
  it('is checking until tools/list proves a non-empty tool catalog', () => {
    expect(mcpServerStatus(null)).toBe('checking');
    expect(mcpServerStatus([])).toBe('unavailable');
    expect(mcpServerStatus(['lacuna_ask'])).toBe('live');
  });

  it('suppresses an older probe that completes after the current probe', async () => {
    let finishOlder!: (tools: readonly string[]) => void;
    const olderReply = new Promise<readonly string[]>((resolve) => { finishOlder = resolve; });
    const probes = new McpProbeCoordinator(1_000);

    const older = probes.run(() => olderReply);
    const current = probes.run(async () => ['lacuna_ask']);

    await expect(current).resolves.toEqual({ kind: 'success', value: ['lacuna_ask'] });
    finishOlder(['stale_tool']);
    await expect(older).resolves.toEqual({ kind: 'superseded' });
  });

  it('fails and aborts a current probe at its bounded deadline', async () => {
    vi.useFakeTimers();
    const requestSignals: AbortSignal[] = [];
    const probes = new McpProbeCoordinator(250);
    const result = probes.run((signal) => {
      requestSignals.push(signal);
      return new Promise<readonly string[]>(() => undefined);
    });

    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toEqual({ kind: 'failure' });
    expect(requestSignals[0]?.aborted).toBe(true);
  });
});
