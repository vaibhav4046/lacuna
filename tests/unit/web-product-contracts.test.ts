import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COMMANDS } from '../../src/cli/args.js';
import * as browserContracts from '../../web/src/app/product-contracts.js';
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

  it('sends transcript writers to sign in instead of the read-only public memory', () => {
    const judge = readFileSync(new URL('../../web/src/pages/Judge.tsx', import.meta.url), 'utf8');
    expect(judge).toContain('<Link to="/signin" style={{ ...label, color: \'#9A9A9A\', textDecoration: \'none\' }}>SIGN IN TO PASTE A TRANSCRIPT</Link>');
    expect(judge).not.toContain('<Link to="/explore/memory" style={{ ...label, color: \'#9A9A9A\', textDecoration: \'none\' }}>\n             PASTE YOUR OWN TRANSCRIPT');
  });

  it('does not claim onboarding ingests a source before the Memory form is open', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain("b: 'After setup, paste a note or transcript in Memory. More connectors are planned.'");
    expect(onboarding).not.toContain("b: 'Paste a note or transcript now. More connectors are planned.'");
  });

  it('does not promise that a timed-out ingest cannot duplicate every stored relation', () => {
    const ingest = readFileSync(new URL('../../web/src/app/routes/ingest.tsx', import.meta.url), 'utf8');
    expect(ingest).toContain('The server may still finish. Check Memory before trying again.');
    expect(ingest).not.toContain('will not be duplicated');
  });

  it('does not present a local-only model picker as saved workspace configuration', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain('MODEL SWITCHING · PLANNED');
    expect(onboarding).not.toContain('setModel(');
    expect(onboarding).not.toContain('MODELS.map');
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

  it('opens one accessible voice dialog from every shell route without navigating or simulating activity', () => {
    const shell = readFileSync(new URL('../../web/src/app/Shell.tsx', import.meta.url), 'utf8');
    const dock = readFileSync(new URL('../../web/src/app/VoiceDock.tsx', import.meta.url), 'utf8');

    expect(shell).toContain('<VoiceDock />');
    expect(shell).not.toContain("onClick={() => go(`${scope.prefix}/voice`)}");
    expect(dock).toContain('role="dialog"');
    expect(dock).toContain('aria-modal="true"');
    expect(dock).toContain('aria-label="Open voice assistant"');
    expect(dock).toContain('onClick={dockOpen ? closeDock : openDock}');
    expect(dock).toContain('START LISTENING');
    expect(dock).toContain('onClick={() => void startListening()}');
    expect(dock.match(/void startListening\(\)/gu)).toHaveLength(1);
    expect(dock).toContain('pendingPreview');
    expect(dock).toContain('CONFIRM');
    expect(dock).toContain('CANCEL');
    expect(dock).toContain('EXPAND VOICE');
    expect(shell).not.toContain('animation:');
    expect(dock).not.toContain('animation:');
  });

  it('offers truthful recovery when browser playback is blocked or unmetered', () => {
    const voice = readFileSync(new URL('../../web/src/app/VoiceDock.tsx', import.meta.url), 'utf8');
    expect(voice).toContain("playback_blocked: 'Your browser blocked sound'");
    expect(voice).toContain("'ENABLE SOUND'");
    expect(voice).toContain("speech.playbackAnalysis === 'unavailable'");
    expect(voice).toContain('AUDIO PLAYING · METER UNAVAILABLE');
  });

  it('keeps dock keyboard handling collapse-only on Escape and wraps focus on Tab', () => {
    const dock = readFileSync(new URL('../../web/src/app/VoiceDock.tsx', import.meta.url), 'utf8');
    const keyboardAction = Reflect.get(browserContracts, 'voiceDockKeyboardAction');
    expect(keyboardAction).toBeTypeOf('function');
    if (typeof keyboardAction !== 'function') return;

    expect(keyboardAction('Escape', false, 1, 3)).toEqual({ kind: 'collapse' });
    expect(keyboardAction('Tab', false, 2, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(keyboardAction('Tab', true, 0, 3)).toEqual({ kind: 'focus', index: 2 });
    expect(keyboardAction('Enter', false, 1, 3)).toEqual({ kind: 'none' });

    const handler = dock.slice(dock.indexOf('function handleDialogKey'), dock.indexOf('\n\n  return (', dock.indexOf('function handleDialogKey')));
    expect(handler).toContain('closeDock()');
    expect(handler).not.toContain('cancelPending');
    expect(handler).not.toContain('confirm()');
    expect(dock).toContain('else if (wasOpen.current) bubbleRef.current?.focus()');
  });

  it('bounds answer copy and counts before the compact dock renders them', () => {
    const dockText = Reflect.get(browserContracts, 'voiceDockText');
    const dockCount = Reflect.get(browserContracts, 'voiceDockCount');
    expect(dockText).toBeTypeOf('function');
    expect(dockCount).toBeTypeOf('function');
    if (typeof dockText !== 'function' || typeof dockCount !== 'function') return;

    expect(dockText('  observed answer  ')).toBe('observed answer');
    expect(dockText('x'.repeat(700))).toBe(`${'x'.repeat(639)}…`);
    expect(dockCount(7)).toBe('7');
    expect(dockCount(12_000)).toBe('9,999+');
  });

  it('shares the shell controller with the expanded route and Ask voice action', () => {
    const voiceRoute = readFileSync(new URL('../../web/src/app/routes/voice.tsx', import.meta.url), 'utf8');
    const ask = readFileSync(new URL('../../web/src/app/routes/Ask.tsx', import.meta.url), 'utf8');

    expect(voiceRoute).toContain('useVoiceAssistant()');
    expect(voiceRoute).not.toContain('new BrowserVoiceRuntime');
    expect(voiceRoute).not.toContain('new VoiceController');
    expect(ask).toContain('const { openDock } = useVoiceAssistant()');
    expect(ask).toContain('onClick={openDock}');
    expect(ask).toContain('postFor<Planned>(`${base}/query`');
  });

  it('labels Explore voice as read-only and leaves its questions on the direct public query path', () => {
    const dock = readFileSync(new URL('../../web/src/app/VoiceDock.tsx', import.meta.url), 'utf8');
    const assistant = readFileSync(new URL('../../web/src/voice/assistant-controller.ts', import.meta.url), 'utf8');

    expect(dock).toContain('EXPLORE · READ ONLY');
    expect(assistant).toContain("if (this.#context.scope === 'public')");
    expect(assistant).toContain('const response = await directAsk()');
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
