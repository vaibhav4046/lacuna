import { describe, expect, it } from 'vitest';

import {
  VOICE_OPERATION_KINDS,
  VOICE_ROUTES,
  VOICE_SUMMARY_KINDS,
  formatVoicePreview,
  formatVoiceResultSummary,
  isVoiceOperation,
  voiceOperationAvailability,
  voiceOperationEffect,
  voiceOperationRequiresConfirmation,
  type VoiceOperation,
} from '../../src/voice/operations.js';

const OPERATIONS = [
  { version: 1, kind: 'navigate', route: 'dash' },
  { version: 1, kind: 'ask', question: 'Who owns Atlas?' },
  { version: 1, kind: 'summarize', resource: 'summary' },
  { version: 1, kind: 'open_connector_setup' },
  { version: 1, kind: 'open_file_setup' },
  { version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' },
  { version: 1, kind: 'start_researcher', task: 'Prepare an evidence brief for Atlas.' },
  { version: 1, kind: 'cancel_selected_run' },
  { version: 1, kind: 'retry_selected_run' },
  { version: 1, kind: 'run_selected_schedule' },
  { version: 1, kind: 'confirm' },
  { version: 1, kind: 'cancel' },
] as const satisfies readonly VoiceOperation[];

describe('closed voice operation registry', () => {
  it('enumerates every operation kind without arbitrary tool or security operations', () => {
    expect(VOICE_OPERATION_KINDS).toEqual([
      'navigate',
      'ask',
      'summarize',
      'open_connector_setup',
      'open_file_setup',
      'remember',
      'start_researcher',
      'cancel_selected_run',
      'retry_selected_run',
      'run_selected_schedule',
      'confirm',
      'cancel',
    ]);
    expect(VOICE_OPERATION_KINDS).not.toContain('execute_tool');
    expect(VOICE_OPERATION_KINDS).not.toContain('delete');
    expect(OPERATIONS.every(isVoiceOperation)).toBe(true);
  });

  it('enumerates all visible routes and observed summary resources', () => {
    expect(VOICE_ROUTES).toEqual([
      'dash', 'ask', 'memory', 'timeline', 'graph', 'health', 'work', 'agents', 'tools',
      'voice', 'models', 'mcp', 'sdk', 'cli', 'conn', 'evals', 'hydra', 'settings',
    ]);
    expect(VOICE_SUMMARY_KINDS).toEqual([
      'summary', 'memory', 'changes', 'conflicts', 'health', 'graph', 'runs', 'agents',
      'tools', 'schedules', 'models', 'evaluations', 'connectors',
    ]);
  });

  it('maps every operation to its fixed navigation, read, or write effect', () => {
    expect(OPERATIONS.map((operation) => [operation.kind, voiceOperationEffect(operation)])).toEqual([
      ['navigate', 'navigation'],
      ['ask', 'read'],
      ['summarize', 'read'],
      ['open_connector_setup', 'navigation'],
      ['open_file_setup', 'navigation'],
      ['remember', 'write'],
      ['start_researcher', 'write'],
      ['cancel_selected_run', 'write'],
      ['retry_selected_run', 'write'],
      ['run_selected_schedule', 'write'],
      ['confirm', 'read'],
      ['cancel', 'read'],
    ]);
  });

  it('requires confirmation only for operations that can mutate workspace state', () => {
    expect(OPERATIONS.map((operation) => voiceOperationRequiresConfirmation(operation))).toEqual([
      false, false, false, false, false, true, true, true, true, true, false, false,
    ]);
  });

  it('keeps connector catalogue and setup operations available now that their API exists', () => {
    expect(voiceOperationAvailability({ version: 1, kind: 'summarize', resource: 'connectors' }))
      .toEqual({ available: true, reason: null });
    expect(voiceOperationAvailability({ version: 1, kind: 'open_connector_setup' }))
      .toEqual({ available: true, reason: null });
    expect(voiceOperationAvailability({ version: 1, kind: 'open_file_setup' }))
      .toEqual({ available: true, reason: null });
    expect(voiceOperationAvailability({ version: 1, kind: 'summarize', resource: 'memory' }))
      .toEqual({ available: true, reason: null });
  });

  it('strictly validates the versioned union and rejects extra authority-bearing fields', () => {
    expect(isVoiceOperation({ version: 2, kind: 'cancel' })).toBe(false);
    expect(isVoiceOperation({ version: 1, kind: 'navigate', route: 'https://evil.example' })).toBe(false);
    expect(isVoiceOperation({ version: 1, kind: 'ask', question: '' })).toBe(false);
    expect(isVoiceOperation({ version: 1, kind: 'cancel', method: 'DELETE' })).toBe(false);
    expect(isVoiceOperation({ version: 1, kind: 'start_researcher', task: 'x', tool: 'shell' })).toBe(false);
  });

  it('formats mutation previews from only bounded operation fields', () => {
    expect(formatVoicePreview({ version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' }))
      .toBe('Remember this text: “Atlas is owned by Priya.”');
    expect(formatVoicePreview({ version: 1, kind: 'start_researcher', task: 'Check Atlas evidence.' }))
      .toBe('Start Researcher work: “Check Atlas evidence.”');
    expect(formatVoicePreview({ version: 1, kind: 'cancel_selected_run' }))
      .toBe('Cancel the one eligible active run.');
    expect(() => formatVoicePreview({ version: 1, kind: 'remember', text: 'x'.repeat(1_001) }))
      .toThrow(/operation/u);
  });

  it('formats observed summaries with validated counts and no invented detail', () => {
    expect(formatVoiceResultSummary({ version: 1, kind: 'ask', question: 'Who owns Atlas?' }, 2))
      .toBe('Answer ready with 2 evidence items.');
    expect(formatVoiceResultSummary({ version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' }, 1))
      .toBe('Stored 1 claim.');
    expect(() => formatVoiceResultSummary({ version: 1, kind: 'remember', text: 'x' }, -1))
      .toThrow(/count/u);
  });

  it('describes connector setup as opened after the route became executable', () => {
    expect(formatVoiceResultSummary({ version: 1, kind: 'open_connector_setup' }))
      .toBe('Opened connector setup.');
    expect(formatVoiceResultSummary({ version: 1, kind: 'open_file_setup' }))
      .toBe('Opened file connector setup.');
  });
});
