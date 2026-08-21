import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COMMANDS } from '../../src/cli/args.js';
import {
  CLI_COMMAND_NAMES,
  MCP_TOOLS_LIST_REQUEST,
  PUBLIC_WORKSPACE_PATH,
  askEndpoint,
  mcpToolNames,
} from '../../web/src/app/product-contracts.js';

describe('web product contracts', () => {
  it('shows every command accepted by the shipped CLI parser', () => {
    expect(CLI_COMMAND_NAMES).toEqual(COMMANDS);
  });

  it('keeps public questions on the public corpus even when a session exists', () => {
    expect(askEndpoint(true)).toBe('/api/explore/ask');
    expect(askEndpoint(false)).toBe('/api/ask');
  });

  it('opens the public read-only scope instead of mutating an account workspace', () => {
    expect(PUBLIC_WORKSPACE_PATH).toBe('/explore/dash');

    const settings = readFileSync(new URL('../../web/src/app/routes/system.tsx', import.meta.url), 'utf8');
    expect(settings).not.toContain("postJson('/api/workspace'");
    expect(settings).not.toContain('Delete workspace');
    expect(settings).not.toContain('TYPE THE NAME TO CONFIRM');
  });

  it('documents private MCP access with capabilities, never workspace names', () => {
    const developers = readFileSync(new URL('../../web/src/app/routes/developers.tsx', import.meta.url), 'utf8');
    expect(developers).toContain('Authorization: Bearer');
    expect(developers).not.toContain('x-lacuna-workspace');

    const server = readFileSync(new URL('../../src/mcp/server.ts', import.meta.url), 'utf8');
    expect(server).not.toContain('x-lacuna-workspace');

    const ingest = readFileSync(new URL('../../web/src/app/routes/ingest.tsx', import.meta.url), 'utf8');
    expect(ingest).toContain("go('/app/tools')");
    expect(ingest).not.toContain('x-lacuna-workspace');
  });

  it('derives the displayed MCP names from the live tools/list reply', () => {
    expect(MCP_TOOLS_LIST_REQUEST.method).toBe('tools/list');
    expect(mcpToolNames({
      result: {
        tools: [
          { name: 'lacuna_ask' },
          { name: 'lacuna_explain' },
          { name: 'lacuna_timeline' },
          { name: 'lacuna_read_question' },
          { name: 'search' },
          { name: 'fetch' },
          { name: 'lacuna_health' },
        ],
      },
    })).toEqual([
      'lacuna_ask',
      'lacuna_explain',
      'lacuna_timeline',
      'lacuna_read_question',
      'search',
      'fetch',
      'lacuna_health',
    ]);
  });

  it('rejects malformed and duplicate MCP tool rows', () => {
    expect(mcpToolNames({ result: { tools: [{ name: 'search' }, null, { name: '' }, { name: 'search' }] } }))
      .toEqual(['search']);
    expect(mcpToolNames({})).toEqual([]);
  });

  it('keeps the voice workspace reachable from every app route without simulating activity', () => {
    const shell = readFileSync(new URL('../../web/src/app/Shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain("go(`${scope.prefix}/voice`)");
    expect(shell).toContain("aria-label={route === 'voice' ? 'Voice workspace is open' : 'Open voice workspace'}");
    expect(shell).not.toContain('animation:');
  });

  it('uses the corpus predicate contract for deployed agent Context Packs', () => {
    const api = readFileSync(new URL('../../api/index.ts', import.meta.url), 'utf8');
    expect(api).toContain("import { PREDICATE_NAMES } from '../src/corpus/types.js'");
    expect(api).toContain('predicates: [...PREDICATE_NAMES]');
    expect(api).not.toContain('const AGENT_PREDICATES =');
  });

  it('shows reconciled production timings instead of latency placeholders', () => {
    const speed = readFileSync(new URL('../../web/src/landing/Speed.tsx', import.meta.url), 'utf8');
    expect(speed).not.toContain('— MS');
    expect(speed).toContain('artifacts/verification/2026-08-21-v10/agent-conflict-run.json');
    for (const value of ['300', '1_798', '2_017', '1_237', '5_352']) {
      expect(speed).toContain(`value: ${value}`);
    }
    expect(300 + 1_798 + 2_017 + 1_237).toBe(5_352);
  });
});
