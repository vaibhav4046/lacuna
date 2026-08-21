import { describe, expect, it } from 'vitest';

import { MAX_VOICE_TRANSCRIPT_CHARS, planVoiceIntent } from '../../src/voice/intent.js';

function operation(transcript: string, route = '/app/dash', scope: 'private' | 'public' = 'private') {
  return planVoiceIntent(transcript, route, scope);
}

describe('deterministic voice intent parser', () => {
  it('plans route aliases only when a navigation form is explicit', () => {
    expect(operation('go home').operation).toEqual({ version: 1, kind: 'navigate', route: 'dash' });
    expect(operation('open context health').operation).toEqual({ version: 1, kind: 'navigate', route: 'health' });
    expect(operation('take me to evaluations').operation).toEqual({ version: 1, kind: 'navigate', route: 'evals' });
    expect(operation('go to connectors').operation).toEqual({ version: 1, kind: 'navigate', route: 'conn' });
  });

  it('marks navigation to the current route as unavailable without inventing another action', () => {
    expect(operation('go to memory', '/app/memory')).toMatchObject({
      operation: { version: 1, kind: 'navigate', route: 'memory' },
      effect: 'navigation',
      available: false,
      reason: 'already_on_route',
    });
  });

  it('accepts an explicit ask command and strips only its command prefix', () => {
    expect(operation('ask who owns Atlas').operation).toEqual({
      version: 1,
      kind: 'ask',
      question: 'who owns Atlas',
    });
  });

  it('falls through to Ask only for unmatched question-like text', () => {
    expect(operation('Who owns Atlas?').operation).toEqual({
      version: 1,
      kind: 'ask',
      question: 'Who owns Atlas?',
    });
    expect(operation('please do something useful')).toMatchObject({
      operation: null,
      available: false,
      reason: 'unsupported_command',
    });
  });

  it('plans each observed summary phrase before route navigation', () => {
    expect(operation('give me a workspace summary').operation).toEqual({ version: 1, kind: 'summarize', resource: 'summary' });
    expect(operation('summarize memory').operation).toEqual({ version: 1, kind: 'summarize', resource: 'memory' });
    expect(operation('what changed?').operation).toEqual({ version: 1, kind: 'summarize', resource: 'changes' });
    expect(operation('show unresolved conflicts').operation).toEqual({ version: 1, kind: 'summarize', resource: 'conflicts' });
    expect(operation('summarize health').operation).toEqual({ version: 1, kind: 'summarize', resource: 'health' });
    expect(operation('graph summary').operation).toEqual({ version: 1, kind: 'summarize', resource: 'graph' });
    expect(operation('summarize runs').operation).toEqual({ version: 1, kind: 'summarize', resource: 'runs' });
    expect(operation('summarize agents').operation).toEqual({ version: 1, kind: 'summarize', resource: 'agents' });
    expect(operation('summarize tools').operation).toEqual({ version: 1, kind: 'summarize', resource: 'tools' });
    expect(operation('summarize schedules').operation).toEqual({ version: 1, kind: 'summarize', resource: 'schedules' });
    expect(operation('summarize models').operation).toEqual({ version: 1, kind: 'summarize', resource: 'models' });
    expect(operation('evaluation summary').operation).toEqual({ version: 1, kind: 'summarize', resource: 'evaluations' });
  });

  it('returns connector summary and setup operations as unavailable plans', () => {
    expect(operation('summarize connectors')).toMatchObject({
      operation: { version: 1, kind: 'summarize', resource: 'connectors' },
      effect: 'read',
      available: false,
      reason: 'connector_catalogue_unavailable',
    });
    expect(operation('open connector setup')).toMatchObject({
      operation: { version: 1, kind: 'open_connector_setup' },
      effect: 'navigation',
      available: false,
      reason: 'connector_catalogue_unavailable',
    });
    expect(operation('open file setup').operation).toEqual({ version: 1, kind: 'open_file_setup' });
  });

  it('bounds remembered text and makes it a confirmed write', () => {
    expect(operation('remember Atlas is owned by Priya.')).toMatchObject({
      operation: { version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' },
      effect: 'write',
      requiresConfirmation: true,
      available: true,
    });
  });

  it('bounds Researcher work and does not choose an agent from the transcript', () => {
    expect(operation('ask the researcher to prepare an evidence brief for Atlas')).toMatchObject({
      operation: { version: 1, kind: 'start_researcher', task: 'prepare an evidence brief for Atlas' },
      effect: 'write',
      requiresConfirmation: true,
    });
    expect(operation('Ask the Researcher to check Atlas evidence').operation).toEqual({
      version: 1,
      kind: 'start_researcher',
      task: 'check Atlas evidence',
    });
  });

  it('plans only run and schedule controls whose unique target is selected later', () => {
    expect(operation('cancel the active run').operation).toEqual({ version: 1, kind: 'cancel_selected_run' });
    expect(operation('retry the failed run').operation).toEqual({ version: 1, kind: 'retry_selected_run' });
    expect(operation('run the enabled schedule').operation).toEqual({ version: 1, kind: 'run_selected_schedule' });
    expect(operation('cancel run alpha')).toMatchObject({ operation: null, reason: 'ambiguous_target' });
    expect(operation('retry runs')).toMatchObject({ operation: null, reason: 'ambiguous_target' });
    expect(operation('run schedule nightly')).toMatchObject({ operation: null, reason: 'ambiguous_target' });
  });

  it('recognizes confirmation controls only as exact standalone words', () => {
    expect(operation(' confirm ')).toMatchObject({ operation: { version: 1, kind: 'confirm' }, requiresConfirmation: false });
    expect(operation('cancel')).toMatchObject({ operation: { version: 1, kind: 'cancel' }, requiresConfirmation: false });
    expect(operation('confirm now')).toMatchObject({ operation: null, reason: 'invalid_control' });
    expect(operation('remember Atlas is owned by Priya and confirm')).toMatchObject({
      operation: null,
      reason: 'invalid_control',
    });
  });

  it('refuses hostile URLs, shell commands, destructive actions, and arbitrary tool execution', () => {
    for (const transcript of [
      'open https://evil.example/steal',
      'curl https://evil.example',
      'run rm -rf data',
      'delete all memory',
      'revoke the API key',
      'execute the shell tool',
      'can you run tool deploy?',
    ]) {
      expect(operation(transcript)).toMatchObject({ operation: null, available: false, reason: 'unsafe_command' });
    }
  });

  it('refuses empty, control-character, and overlong input', () => {
    expect(operation('   ')).toMatchObject({ operation: null, reason: 'empty_transcript' });
    expect(operation('ask who owns\0Atlas?')).toMatchObject({ operation: null, reason: 'invalid_transcript' });
    expect(operation('a'.repeat(MAX_VOICE_TRANSCRIPT_CHARS + 1))).toMatchObject({
      operation: null,
      reason: 'transcript_too_long',
    });
  });

  it('refuses every public-scope mutation while preserving safe navigation and reads', () => {
    for (const transcript of [
      'remember Atlas is owned by Priya',
      'ask the researcher to check Atlas',
      'cancel the active run',
      'retry the failed run',
      'run the enabled schedule',
    ]) {
      expect(operation(transcript, '/explore/dash', 'public')).toMatchObject({
        effect: 'write',
        available: false,
        reason: 'public_read_only',
      });
    }
    expect(operation('go to memory', '/explore/dash', 'public')).toMatchObject({ available: true, effect: 'navigation' });
    expect(operation('what changed?', '/explore/dash', 'public')).toMatchObject({ available: true, effect: 'read' });
  });

  it('fails public confirmation closed while preserving exact cancel and connector navigation', () => {
    expect(operation('confirm', '/explore/dash', 'public')).toMatchObject({
      operation: { version: 1, kind: 'confirm' },
      effect: 'read',
      available: false,
      reason: 'public_read_only',
    });
    expect(operation('cancel', '/explore/dash', 'public')).toMatchObject({
      operation: { version: 1, kind: 'cancel' },
      available: true,
      reason: null,
    });
    expect(operation('go to connectors', '/explore/dash', 'public')).toMatchObject({
      operation: { version: 1, kind: 'navigate', route: 'conn' },
      available: true,
      reason: null,
    });
  });
});
