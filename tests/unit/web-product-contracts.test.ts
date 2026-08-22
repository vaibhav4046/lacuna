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

  it('preserves only allowlisted connector hashes across legacy aliases', () => {
    const alias = Reflect.get(browserContracts, 'connectorAliasTarget');
    expect(alias).toBeTypeOf('function');
    if (typeof alias !== 'function') return;
    expect(alias('/app/connectors', '#file')).toBe('/app/conn#file');
    expect(alias('/app/connectors', '#gitlab')).toBe('/app/conn#gitlab');
    expect(alias('/explore/connectors', '#https-api')).toBe('/explore/conn#https-api');
    expect(alias('/app/connectors', '#secret')).toBe('/app/conn');
    expect(alias('/elsewhere', '#file')).toBeNull();
  });

  it('keeps private connector workflows structurally separate from zero-write Explore', () => {
    const route = readFileSync(new URL('../../web/src/app/routes/connectors.tsx', import.meta.url), 'utf8');
    const body = readFileSync(new URL('../../web/src/app/RouteBody.tsx', import.meta.url), 'utf8');
    const developers = readFileSync(new URL('../../web/src/app/routes/developers.tsx', import.meta.url), 'utf8');

    expect(route).toContain('export function PrivateConnectors()');
    expect(route).toContain('export function ExploreConnectors()');
    const explore = route.slice(route.indexOf('export function ExploreConnectors()'));
    expect(explore).not.toContain('/api/workspace/');
    expect(body).toContain('<ConnectorsRoute />');
    expect(developers).not.toContain('export function Connectors()');
  });

  it('binds every agent/work mutation to the exact current session', () => {
    const agents = readFileSync(new URL('../../web/src/app/routes/agents.tsx', import.meta.url), 'utf8');
    const work = readFileSync(new URL('../../web/src/app/routes/work.tsx', import.meta.url), 'utf8');
    expect(agents).toContain("import { useSession } from '../../api/session';");
    expect(agents).toContain('binding');
    expect(work).toContain("import { useSession } from '../../api/session';");
    expect(work).toContain('binding');
  });

  it('keeps the landing connector scene aligned with public runtime availability', () => {
    const landing = readFileSync(new URL('../../web/src/landing/Conn.tsx', import.meta.url), 'utf8');
    expect(landing).toContain("fetch('/api/explore/connectors'");
    expect(landing).toContain("status = item.implementation === 'planned' ? 'PLANNED'");
    expect(landing).toContain("runtime.availability === 'available' ? 'AVAILABLE' : 'UNAVAILABLE'");
    expect(landing).toContain("runtime === undefined ? 'UNKNOWN'");
    expect(landing).toContain('whiteSpace: \'nowrap\'');
  });

  it('shields landing overlays from the persistent particle field', () => {
    for (const file of ['Arch.tsx', 'Route.tsx', 'Voice.tsx']) {
      const source = readFileSync(new URL(`../../web/src/landing/${file}`, import.meta.url), 'utf8');
      expect(source).toContain('data-mhide="1" data-shield');
    }
  });

  it('keeps file connector copy aligned with the implemented JSON and CSV formats', () => {
    const route = readFileSync(new URL('../../web/src/app/routes/connectors.tsx', import.meta.url), 'utf8');
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(route).toContain('Text, Markdown, JSON, CSV, PDF, or DOCX');
    expect(onboarding).toContain('TXT · MD · JSON · CSV · PDF · DOCX · AVAILABLE');
  });

  it('uses truthful recorded observations, inert planned cards, and a contained one-time secret modal', () => {
    const route = readFileSync(new URL('../../web/src/app/routes/connectors.tsx', import.meta.url), 'utf8');
    const observation = Reflect.get(browserContracts, 'REVIEWED_OBSERVATION_COPY');
    expect(observation).toMatchObject({
      importedDocuments: 'RECORDED ACCEPTED DOCUMENTS',
      lastSuccessAt: 'LAST RECORDED ACCEPTANCE',
      lastFailure: 'LAST RECORDED FAILURE',
    });
    expect(JSON.stringify(observation)).toContain('may lag');
    expect(route).not.toMatch(/CUMULATIVE|TOTAL IMPORTED|LATEST ACCEPTANCE/u);
    expect(route).toContain('aria-disabled="true"');
    expect(route).toContain('ONE-TIME SIGNING SECRET');
    expect(route).toContain('containVoiceModalBackground(regions)');
    expect(route).toContain('[data-voice-modal-backdrop],[data-voice-dialog]');
    expect(route).toContain('revealExclusiveSecret(');
    expect(route).toContain('returnTarget={webhookTrigger}');
    expect(route.match(/commitAndRestoreWebhookTrigger\(/gu)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(route).toContain("if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return; }");
    expect(route).not.toContain('href={webhook.endpoint}');
    expect(route).not.toMatch(/console\.|localStorage|sessionStorage|history\./u);
  });

  it('keeps connector controls keyboard-sized and single-column without 320px overflow', () => {
    const styles = readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('.connector-workflow-grid');
    expect(styles).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))');
    expect(styles).toContain('@media (max-width:700px)');
    expect(styles).toContain('grid-template-columns:minmax(0, 1fr)');
    expect(styles).toContain('min-height:44px');
    expect(styles).toContain('padding-bottom:130px');
    expect(styles).toContain('overflow-wrap:anywhere');
  });

  it('wires the browser-wide session epoch into the provider and exact private route key', () => {
    const provider = readFileSync(new URL('../../web/src/api/session.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../../web/src/app/Shell.tsx', import.meta.url), 'utf8');
    expect(provider).toContain("new BroadcastChannel('lacuna-session-epoch-v1')");
    expect(provider).toContain("localStorage.setItem(key, value)");
    expect(provider).toContain("window.addEventListener('focus', onFocus)");
    expect(provider).toContain("window.addEventListener('pageshow', onPageShow)");
    expect(provider).toContain("window.removeEventListener('focus', onFocus)");
    expect(provider).toContain("window.removeEventListener('pageshow', onPageShow)");
    expect(provider).toContain("coordinator.refresh('remote')");
    expect(provider).toContain('flushSync');
    expect(provider).toContain("getJson<unknown>('/api/session'");
    expect(provider).not.toContain('response.json()');
    expect(shell).toContain("key={scope.demo ? 'explore' : identity ?? 'unvalidated'}");
  });

  it('does not turn a failed private session read into a blank frozen page', () => {
    const guard = readFileSync(new URL('../../web/src/app/RequireSession.tsx', import.meta.url), 'utf8');
    expect(guard).toContain('{loaded.reason}');
    expect(guard).toContain('Try again');
    expect(guard).toContain('refresh');
    expect(guard).not.toMatch(/if \(loaded\.state === 'failed'\) return null/u);
  });

  it('gives failed data panels a recovery action instead of a dead-end error', () => {
    const state = readFileSync(new URL('../../web/src/app/state.tsx', import.meta.url), 'utf8');
    expect(state).toContain('Try again');
    expect(state).toContain('window.location.reload()');
  });

  it('invalidates every cookie-changing client mutation before its one validation read', () => {
    const provider = readFileSync(new URL('../../web/src/api/session.tsx', import.meta.url), 'utf8');
    const signIn = readFileSync(new URL('../../web/src/auth/SignIn.tsx', import.meta.url), 'utf8');
    const forgot = readFileSync(new URL('../../web/src/auth/Forgot.tsx', import.meta.url), 'utf8');
    const system = readFileSync(new URL('../../web/src/app/routes/system.tsx', import.meta.url), 'utf8');
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');

    expect(provider).toContain('readonly refreshAfterMutation: () => Promise<SessionState | null>;');
    expect(provider).toContain('coordinator.refreshAfterMutation');
    for (const client of [signIn, forgot, system, onboarding]) {
      expect(client).toContain('refreshAfterMutation');
      expect(client).not.toContain('await refresh();');
    }
    expect(system).toContain('if (!await signOut()) return;');
  });

  it('keeps password sign-in busy until the confirmed session has routed', () => {
    const signIn = readFileSync(new URL('../../web/src/auth/SignIn.tsx', import.meta.url), 'utf8');
    expect(signIn).toContain('if (busy) return;');
    expect(signIn).toContain('try {');
    expect(signIn).toContain('} finally {\n      setBusy(false);');
    expect(signIn.indexOf('await refreshAfterMutation()')).toBeLessThan(signIn.indexOf('setBusy(false)'));
  });

  it('locks connector mutations synchronously before React can repaint disabled controls', () => {
    const connectors = readFileSync(new URL('../../web/src/app/routes/connectors.tsx', import.meta.url), 'utf8');
    expect(connectors).toContain('const pendingRef = useRef<string | null>(null);');
    expect(connectors).toContain('function beginPending(value: string): boolean');
    expect(connectors).toContain('if (!beginPending(\'file-preview\')) return;');
    expect(connectors).toContain('if (!beginPending(\'file-import\')) return;');
    expect(connectors).toContain('if (!beginPending(\'github\')) return;');
    expect(connectors).toContain('if (!beginPending(\'gitlab\')) return;');
    expect(connectors).toContain('if (!beginPending(\'https\')) return;');
    expect(connectors).toContain('if (!beginPending(\'webhook\')) return;');
    expect(connectors).toMatch(/beginPending\('webhook-revoke'\)/u);
    expect(connectors).toContain('if (!beginPending(\'webhook-state\')) return;');
    expect(connectors).toContain('function finishPending(): void');
  });

  it('keeps first-run onboarding busy until the validated session has routed', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    const transitionStart = onboarding.indexOf("if (step === 4) {");
    const transitionEnd = onboarding.indexOf("    setStep(step + 1);", transitionStart);
    const transition = onboarding.slice(transitionStart, transitionEnd);
    expect(transition).toContain('try {');
    expect(transition).toContain('await refreshAfterMutation()');
    expect(transition).toContain('} finally {\n        setBusy(false);');
    expect(transition.indexOf('await refreshAfterMutation()')).toBeLessThan(transition.indexOf('setBusy(false)'));
  });

  it('releases onboarding busy state when private setup requests throw', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain('if (busy) return;');
    for (const name of ['createWorkspace', 'storeFirstMemory', 'proveAnswer']) {
      const start = onboarding.indexOf(`  async function ${name}`);
      const end = onboarding.indexOf('\n\n  async function', start + 1);
      const section = onboarding.slice(start, end === -1 ? onboarding.indexOf('\n\n  async function next', start) : end);
      expect(section, name).toContain('try {');
      expect(section, name).toContain('} finally {');
      expect(section, name).toContain('setBusy(false);');
    }
  });

  it('keeps recovery busy through session confirmation and always releases the form lock', () => {
    const forgot = readFileSync(new URL('../../web/src/auth/Forgot.tsx', import.meta.url), 'utf8');
    const submitStart = forgot.indexOf('  async function submit()');
    const submitEnd = forgot.indexOf('\n\n  if (issued !== null)', submitStart);
    const submit = forgot.slice(submitStart, submitEnd);
    expect(submit).toContain('if (busy) return;');
    expect(submit).toContain('try {');
    expect(submit).toContain('await refreshAfterMutation()');
    expect(submit).toContain('} finally {\n      setBusy(false);');
    expect(submit.indexOf('await refreshAfterMutation()')).toBeLessThan(submit.indexOf('setBusy(false)'));
  });

  it('distinguishes reviewed one-off imports from configured at-least-once webhook delivery', () => {
    const route = readFileSync(new URL('../../web/src/app/routes/connectors.tsx', import.meta.url), 'utf8');
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');

    expect(route).toContain('Files, public GitHub snapshots, and public HTTPS reads are reviewed one-off imports.');
    expect(route).toContain('Configured signed webhooks accept bounded at-least-once deliveries without per-delivery manual review.');
    expect(route).toContain('Each valid signed event is a bounded at-least-once delivery, not a manually reviewed one-off import.');
    expect(route).not.toContain('Every source is reviewed before one import.');
    expect(onboarding).toContain('After this setup, Memory also supports a one-off file, public GitHub snapshot, public HTTPS source, or signed bounded at-least-once webhook delivery.');
    expect(onboarding).not.toContain('review a file, public GitHub snapshot, public HTTPS source, or signed webhook');
  });

  it('sends transcript writers to sign in instead of the read-only public memory', () => {
    const judge = readFileSync(new URL('../../web/src/pages/Judge.tsx', import.meta.url), 'utf8');
    expect(judge).toContain('<Link to="/signin" style={{ ...label, color: \'#9A9A9A\', textDecoration: \'none\' }}>SIGN IN TO PASTE A TRANSCRIPT</Link>');
    expect(judge).not.toContain('<Link to="/explore/memory" style={{ ...label, color: \'#9A9A9A\', textDecoration: \'none\' }}>\n             PASTE YOUR OWN TRANSCRIPT');
  });

  it('does not claim onboarding ingests a source before the Memory form is open', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain("b: 'Start with one note you control. After this setup, Memory also supports a one-off file, public GitHub snapshot, public HTTPS source, or signed bounded at-least-once webhook delivery.'");
    expect(onboarding).not.toContain("b: 'Paste a note or transcript now. More connectors are planned.'");
  });

  it('does not promise that a timed-out ingest cannot duplicate every stored relation', () => {
    const ingest = readFileSync(new URL('../../web/src/app/routes/ingest.tsx', import.meta.url), 'utf8');
    expect(ingest).toContain('The server may still finish. Check Memory before trying again.');
    expect(ingest).not.toContain('will not be duplicated');
  });

  it('renders the router-safe numeric refused count without array-only access', () => {
    const ingest = readFileSync(new URL('../../web/src/app/routes/ingest.tsx', import.meta.url), 'utf8');
    expect(ingest).toContain('readonly refused: number;');
    expect(ingest).toContain('report.refused > 0');
    expect(ingest).not.toContain('report.refused.length');
  });

  it('does not present a local-only model picker as saved workspace configuration', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain('MODEL SWITCHING · PLANNED');
    expect(onboarding).not.toContain('setModel(');
    expect(onboarding).not.toContain('MODELS.map');
  });

  it('makes first-run onboarding prove a private memory before opening the shell', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain("postJson('/api/workspace/ingest'");
    expect(onboarding).toContain("postFor<OnboardingAnswer>('/api/workspace/query'");
    expect(onboarding).toContain('USE EXAMPLE');
    expect(onboarding).toContain('STORE FIRST MEMORY');
    expect(onboarding).toContain('CHECK PRIVATE ANSWER');
    expect(onboarding).toContain('sourceStored');
    expect(onboarding).toContain('answer !== null');
    expect(onboarding).not.toContain("go('/app/dash')");
  });

  it('binds every first-run private mutation to the current session epoch', () => {
    const onboarding = readFileSync(new URL('../../web/src/onboarding/Onboarding.tsx', import.meta.url), 'utf8');
    expect(onboarding).toContain('const sessionBinding = loaded.state === \'ready\' && loaded.value.signedIn');
    expect(onboarding).toContain("postJson('/api/workspace/ingest', { title: sourceTitle.trim(), text }, 15_000, sessionBinding ?? undefined)");
    expect(onboarding).toContain("postFor<OnboardingAnswer>('/api/workspace/query', { question: text }, 15_000, sessionBinding ?? undefined)");
  });

  it('keeps private Work reads bound after route hydration and dispatch refresh', () => {
    const scope = readFileSync(new URL('../../web/src/api/scope.tsx', import.meta.url), 'utf8');
    const client = readFileSync(new URL('../../web/src/api/client.ts', import.meta.url), 'utf8');
    const work = readFileSync(new URL('../../web/src/app/routes/work.tsx', import.meta.url), 'utf8');
    expect(scope).toContain('useLoaded<T>(`${scope.base}/${part}`, sessionBinding)');
    expect(client).toContain("path.startsWith('/api/workspace/') && sessionBinding === undefined");
    expect(work).toContain("getJson<readonly AgentRunRecord[]>('/api/workspace/runs', new AbortController().signal, binding)");
  });

  it('keeps Work schedule dispatch usable when randomUUID is absent', () => {
    const work = readFileSync(new URL('../../web/src/app/routes/work.tsx', import.meta.url), 'utf8');
    expect(work).toContain("import { createClientRequestId } from '../../api/request-id';");
    expect(work).toContain("createClientRequestId('ui')");
    expect(work).not.toContain('crypto.randomUUID()');
  });

  it('rejects duplicate Work mutations before their busy state renders', () => {
    const work = readFileSync(new URL('../../web/src/app/routes/work.tsx', import.meta.url), 'utf8');
    const actionStart = work.indexOf("  async function action(kind: 'cancel' | 'retry')");
    const actionEnd = work.indexOf('\n\n  return (', actionStart);
    const action = work.slice(actionStart, actionEnd);
    const runStart = work.indexOf('  async function runNow(schedule: DailyScheduleRecord)');
    const runEnd = work.indexOf('\n\n  return (', runStart);
    const runNow = work.slice(runStart, runEnd);
    expect(action).toContain('if (mutating) return;');
    expect(runNow).toContain('if (working !== null) return;');
  });

  it('releases public query and MCP busy state when requests throw', () => {
    const judge = readFileSync(new URL('../../web/src/pages/Judge.tsx', import.meta.url), 'utf8');
    const landing = readFileSync(new URL('../../web/src/landing/Try.tsx', import.meta.url), 'utf8');
    const tools = readFileSync(new URL('../../web/src/app/routes/tools.tsx', import.meta.url), 'utf8');
    const sections = [
      judge.slice(judge.indexOf('  async function go()'), judge.indexOf('\n\n  const answer', judge.indexOf('  async function go()'))),
      landing.slice(landing.indexOf('  async function ask('), landing.indexOf('\n\n  const answer', landing.indexOf('  async function ask('))),
      tools.slice(tools.indexOf('  async function issue()'), tools.indexOf('\n\n  async function copy', tools.indexOf('  async function issue()'))),
      tools.slice(tools.indexOf('  async function revoke()'), tools.indexOf('\n\n  if (scope.demo)', tools.indexOf('  async function revoke()'))),
    ];
    for (const section of sections) {
      expect(section).toContain('try {');
      expect(section).toContain('} finally {');
      expect(section).toContain('setBusy(false);');
    }
    expect(judge).toContain("if (busy || text.trim() === '') return;");
    expect(landing).toContain('if (busy) return;');
    expect(tools).toContain('if (busy) return;');
  });

  it('makes a browser agent retry idempotent after a lost response', () => {
    const agents = readFileSync(new URL('../../web/src/app/routes/agents.tsx', import.meta.url), 'utf8');
    expect(agents).toContain("import { createClientUuid } from '../../api/request-id';");
    expect(agents).toContain('const requestId = pendingRequestId.current ?? createClientUuid();');
    expect(agents).toContain('{ task, agentId: researcher.id, requestId }');
    expect(agents).toContain('response.status !== 408 && response.status !== 0');
  });

  it('does not let a recommendation replace the task while a run is pending', () => {
    const agents = readFileSync(new URL('../../web/src/app/routes/agents.tsx', import.meta.url), 'utf8');
    expect(agents).toContain('if (busy) return;');
    expect(agents).toContain('pendingRequestId.current = null;');
    expect(agents).toContain('<button className="hv-text" disabled={busy} onClick={() => useRecommendation(recommendation)}');
  });

  it('does not show a historical no-evidence health run as failed in its lifecycle', () => {
    const work = readFileSync(new URL('../../web/src/app/routes/work.tsx', import.meta.url), 'utf8');
    expect(work).toContain('Historical empty-workspace health records');
    expect(work).toContain("stage === 'FAILED'");
    expect(work).toContain("? 'COMPLETED'");
    expect(work).toContain('eventStage(run, event.stage, index)');
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
    expect(dock).toContain('onClick={openDock}');
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
    expect(voice).toContain('ANSWER READY · AUDIO UNCONFIRMED');
    expect(voice).toContain('The answer was retrieved and remains visible below. Browser playback was not confirmed.');
  });

  it('keeps dock keyboard handling collapse-only on Escape and contains zero, one, or many focus targets', () => {
    const dock = readFileSync(new URL('../../web/src/app/VoiceDock.tsx', import.meta.url), 'utf8');
    const keyboardAction = Reflect.get(browserContracts, 'voiceDockKeyboardAction');
    expect(keyboardAction).toBeTypeOf('function');
    if (typeof keyboardAction !== 'function') return;

    expect(keyboardAction('Escape', false, 1, 3)).toEqual({ kind: 'collapse' });
    expect(keyboardAction('Tab', false, -1, 0)).toEqual({ kind: 'dialog' });
    expect(keyboardAction('Tab', false, 0, 1)).toEqual({ kind: 'focus', index: 0 });
    expect(keyboardAction('Tab', true, 0, 1)).toEqual({ kind: 'focus', index: 0 });
    expect(keyboardAction('Tab', false, 2, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(keyboardAction('Tab', true, 0, 3)).toEqual({ kind: 'focus', index: 2 });
    expect(keyboardAction('Enter', false, 1, 3)).toEqual({ kind: 'none' });

    const handler = dock.slice(dock.indexOf('function handleDialogKey'), dock.indexOf('\n\n  return (', dock.indexOf('function handleDialogKey')));
    expect(handler).toContain('closeDock()');
    expect(handler).not.toContain('cancelPending');
    expect(handler).not.toContain('confirm()');
    expect(dock).toContain("action.kind === 'dialog'");
    expect(dock).toContain('dialogRef.current?.focus()');
  });

  it('makes shell background inert while the dock is open and restores its exact prior state', () => {
    const contain = Reflect.get(browserContracts, 'containVoiceModalBackground');
    expect(contain).toBeTypeOf('function');
    if (typeof contain !== 'function') return;

    function region(inert: boolean, ariaHidden: string | null) {
      let hidden = ariaHidden;
      return {
        get inert() { return inert; },
        set inert(value: boolean) { inert = value; },
        getAttribute: (name: string) => name === 'aria-hidden' ? hidden : null,
        setAttribute: (name: string, value: string) => { if (name === 'aria-hidden') hidden = value; },
        removeAttribute: (name: string) => { if (name === 'aria-hidden') hidden = null; },
        state: () => ({ inert, hidden }),
      };
    }

    const ordinary = region(false, null);
    const precontained = region(true, 'until-owner-restores');
    const restore = contain([ordinary, precontained]);
    expect(ordinary.state()).toEqual({ inert: true, hidden: 'true' });
    expect(precontained.state()).toEqual({ inert: true, hidden: 'true' });

    restore();
    restore();
    expect(ordinary.state()).toEqual({ inert: false, hidden: null });
    expect(precontained.state()).toEqual({ inert: true, hidden: 'until-owner-restores' });
  });

  it('uses a blocking backdrop, a non-interactive launcher, and programmatic dialog fallback', () => {
    const shell = readFileSync(new URL('../../web/src/app/Shell.tsx', import.meta.url), 'utf8');
    const dock = readFileSync(new URL('../../web/src/app/VoiceDock.tsx', import.meta.url), 'utf8');

    expect(shell.match(/data-voice-background="1"/gu)).toHaveLength(2);
    expect(dock).toContain('containVoiceModalBackground(background)');
    expect(dock).toContain('data-voice-modal-backdrop="1"');
    expect(dock).toContain('onPointerDown={closeDock}');
    expect(dock).toContain("position: 'fixed'");
    expect(dock).toContain('disabled={dockOpen}');
    expect(dock).toContain('aria-hidden={dockOpen ? true : undefined}');
    expect(dock).toContain("pointerEvents: dockOpen ? 'none' : 'auto'");
    expect(dock).toContain('tabIndex={-1}');
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

  it('uses corpus and extractor predicate contracts for deployed agent Context Packs', () => {
    const api = readFileSync(new URL('../../api/index.ts', import.meta.url), 'utf8');
    expect(api).toContain("import { PREDICATE_NAMES } from '../src/corpus/types.js'");
    expect(api).toContain("import { READABLE_PROPERTIES } from '../src/extract/extract.js'");
    expect(api).toContain('predicates: [...new Set([...PREDICATE_NAMES, ...READABLE_PROPERTIES])]');
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
