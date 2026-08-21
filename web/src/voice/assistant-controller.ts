import {
  VoiceController,
  VoiceRuntimeError,
  type VoiceCommittedTextResult,
  type VoiceDirectAsk,
  type VoiceSnapshot,
} from './controller';
import type { VoiceOperationPlan, VoiceOperationResult } from './operations';

export const VOICE_OPERATION_PHASES = [
  'idle',
  'interpreting',
  'awaiting_confirmation',
  'executing',
  'succeeded',
  'refused',
  'unavailable',
] as const;

export type VoiceOperationPhase = (typeof VOICE_OPERATION_PHASES)[number];

export const VOICE_CONFIRMATION_WINDOW_MS = 30_000;

export interface VoiceAssistantContext {
  readonly currentRoute: string;
  readonly scope: 'private' | 'public';
  /** Opaque identity used only to invalidate work when the authenticated session changes. */
  readonly sessionKey: string | null;
  /** Opaque identity used only to bind a pending mutation to one workspace. */
  readonly workspaceKey: string | null;
}

export interface VoiceAssistantExecutor {
  plan(transcript: string, currentRoute: string): Promise<VoiceOperationPlan>;
  execute(plan: unknown): Promise<VoiceOperationResult>;
}

export interface VoiceAssistantSnapshot {
  /** Media capture, transcript and playback state. It never represents operation authority. */
  readonly speech: VoiceSnapshot;
  readonly operationPhase: VoiceOperationPhase;
  readonly pendingPreview: string | null;
  readonly pendingExpiresAt: number | null;
  /** Redacted, bounded result observed from the operation executor. */
  readonly result: VoiceOperationResult | null;
}

type Listener = (snapshot: VoiceAssistantSnapshot) => void;

interface PendingOperation {
  /** The exact trusted object returned by plan(). It must never be copied. */
  readonly plan: VoiceOperationPlan;
  readonly expiresAt: number;
  readonly sessionKey: string | null;
  readonly workspaceKey: string | null;
  readonly scope: VoiceAssistantContext['scope'];
}

function fixedResult(
  status: VoiceOperationResult['status'],
  failure: VoiceOperationResult['failure'],
  summary: string,
  operationKind: VoiceOperationResult['operationKind'] = null,
): VoiceOperationResult {
  return {
    requestId: null,
    operationKind,
    status,
    failure,
    summary,
    observedCount: 0,
    answer: null,
    answerStatus: null,
  };
}

function responseFor(result: VoiceOperationResult): VoiceCommittedTextResult {
  return {
    event: result.status === 'succeeded' ? 'answer' : 'abstain',
    spoken: result.summary,
    planned: null,
  };
}

function confirmationResponse(): VoiceCommittedTextResult {
  return { event: 'answer', spoken: 'Confirmation required.', planned: null };
}

function sameBinding(left: VoiceAssistantContext, right: VoiceAssistantContext): boolean {
  return left.scope === right.scope
    && left.sessionKey === right.sessionKey
    && left.workspaceKey === right.workspaceKey;
}

/**
 * Coordinates allowlisted operations without adding operation authority to the
 * microphone/playback machine. A pending mutation retains the exact trusted
 * plan privately and exposes only its validated preview.
 */
export class VoiceAssistantController {
  readonly voice: VoiceController;
  readonly #executor: VoiceAssistantExecutor;
  readonly #listeners = new Set<Listener>();
  readonly #unsubscribeVoice: () => void;
  #context: VoiceAssistantContext;
  #speech: VoiceSnapshot;
  #operationPhase: VoiceOperationPhase = 'idle';
  #pending: PendingOperation | null = null;
  #result: VoiceOperationResult | null = null;
  #generation = 0;
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(
    voice: VoiceController,
    executor: VoiceAssistantExecutor,
    context: VoiceAssistantContext,
  ) {
    this.voice = voice;
    this.#executor = executor;
    this.#context = context;
    this.#speech = voice.snapshot;
    voice.setCommittedTextDelegate((text, signal, directAsk) => (
      this.#handleCommittedText(text, signal, directAsk)
    ));
    this.#unsubscribeVoice = voice.subscribe((speech) => {
      this.#speech = speech;
      if (speech.state === 'INTERRUPTED' && this.#pending !== null) {
        this.#generation += 1;
        this.#clearPending();
        this.#operationPhase = 'refused';
        this.#result = fixedResult('refused', 'control_operation', 'Pending action discarded.');
      }
      this.#emit();
    });
  }

  get snapshot(): VoiceAssistantSnapshot {
    return {
      speech: this.#speech,
      operationPhase: this.#operationPhase,
      pendingPreview: this.#pending?.plan.display ?? null,
      pendingExpiresAt: this.#pending?.expiresAt ?? null,
      result: this.#result,
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  setContext(context: VoiceAssistantContext): void {
    if (this.#disposed) return;
    const bindingChanged = !sameBinding(this.#context, context);
    const routeChanged = this.#context.currentRoute !== context.currentRoute;
    this.#context = context;
    if (bindingChanged) {
      this.#generation += 1;
      this.#clearPending();
      this.#operationPhase = 'idle';
      this.#result = null;
      this.#emit();
      return;
    }
    if (routeChanged && (this.#pending !== null || this.#operationPhase === 'interpreting')) {
      this.#generation += 1;
      this.#clearPending();
      this.#operationPhase = 'idle';
      this.#result = null;
      this.#emit();
    }
  }

  /** Visible confirmation follows the same committed-text path as exact speech. */
  async confirm(): Promise<void> {
    if (this.#disposed) return;
    await this.voice.submitTyped('confirm');
  }

  /** Visible cancellation discards authority synchronously and does not start playback. */
  cancelPending(): void {
    if (this.#disposed) return;
    this.#discardPending('Pending action discarded.');
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#clearPending();
    this.#operationPhase = 'idle';
    this.#result = null;
    this.voice.setCommittedTextDelegate(null);
    this.#unsubscribeVoice();
    this.#emit();
    this.#listeners.clear();
  }

  async #handleCommittedText(
    text: string,
    signal: AbortSignal,
    directAsk: VoiceDirectAsk,
  ): Promise<VoiceCommittedTextResult> {
    this.#assertCurrentSignal(signal);
    const control = text.toLocaleLowerCase('en-US');
    if (control === 'confirm') return this.#confirmPending(signal);
    if (control === 'cancel') return this.#cancelByCommand(signal);
    if (this.#context.scope === 'public') return directAsk();

    this.#generation += 1;
    const generation = this.#generation;
    this.#clearPending();
    this.#operationPhase = 'interpreting';
    this.#result = null;
    this.#emit();

    let planned: VoiceOperationPlan;
    try {
      planned = await this.#executor.plan(text, this.#context.currentRoute);
    } catch {
      this.#assertCurrent(generation, signal);
      const result = fixedResult('unavailable', 'request_failed', 'The operation could not be completed.');
      this.#operationPhase = 'unavailable';
      this.#result = result;
      this.#emit();
      return responseFor(result);
    }
    this.#assertCurrent(generation, signal);

    if (planned.available && planned.requiresConfirmation) {
      if (this.#context.scope !== 'private'
        || this.#context.sessionKey === null
        || this.#context.sessionKey === ''
        || this.#context.workspaceKey === null
        || this.#context.workspaceKey === '') {
        const result = fixedResult(
          'unavailable', 'session_required', 'The operation could not be completed.',
          planned.operation?.kind ?? null,
        );
        this.#operationPhase = 'unavailable';
        this.#result = result;
        this.#emit();
        return responseFor(result);
      }
      const expiresAt = Date.now() + VOICE_CONFIRMATION_WINDOW_MS;
      this.#pending = {
        plan: planned,
        expiresAt,
        sessionKey: this.#context.sessionKey,
        workspaceKey: this.#context.workspaceKey,
        scope: this.#context.scope,
      };
      this.#operationPhase = 'awaiting_confirmation';
      this.#result = null;
      this.#scheduleExpiry(this.#pending);
      this.#emit();
      return confirmationResponse();
    }

    return this.#execute(planned, generation, signal);
  }

  async #confirmPending(signal: AbortSignal): Promise<VoiceCommittedTextResult> {
    this.#assertCurrentSignal(signal);
    const pending = this.#pending;
    if (pending === null) {
      const result = fixedResult(
        'refused', 'control_operation', 'There is no pending action to confirm.', 'confirm',
      );
      this.#operationPhase = 'refused';
      this.#result = result;
      this.#emit();
      return responseFor(result);
    }
    if (Date.now() >= pending.expiresAt || !this.#pendingMatchesContext(pending)) {
      this.#generation += 1;
      this.#clearPending();
      const result = fixedResult('refused', 'control_operation', 'Confirmation expired.', 'confirm');
      this.#operationPhase = 'refused';
      this.#result = result;
      this.#emit();
      return responseFor(result);
    }

    this.#generation += 1;
    const generation = this.#generation;
    this.#clearPending();
    return this.#execute(pending.plan, generation, signal);
  }

  #cancelByCommand(signal: AbortSignal): VoiceCommittedTextResult {
    this.#assertCurrentSignal(signal);
    const summary = this.#pending === null
      ? 'There is no pending action to cancel.'
      : 'Pending action discarded.';
    return responseFor(this.#discardPending(summary));
  }

  #discardPending(summary: string): VoiceOperationResult {
    this.#generation += 1;
    this.#clearPending();
    const result = fixedResult('refused', 'control_operation', summary, 'cancel');
    this.#operationPhase = 'refused';
    this.#result = result;
    this.#emit();
    return result;
  }

  async #execute(
    planned: VoiceOperationPlan,
    generation: number,
    signal: AbortSignal,
  ): Promise<VoiceCommittedTextResult> {
    this.#operationPhase = 'executing';
    this.#result = null;
    this.#emit();
    let result: VoiceOperationResult;
    try {
      // Do not copy or reconstruct `planned`: executor identity is authority.
      result = await this.#executor.execute(planned);
    } catch {
      result = fixedResult('unavailable', 'request_failed', 'The operation could not be completed.');
    }
    this.#assertCurrent(generation, signal);
    this.#operationPhase = result.status === 'succeeded'
      ? 'succeeded'
      : result.status === 'refused'
        ? 'refused'
        : 'unavailable';
    this.#result = result;
    this.#emit();
    return responseFor(result);
  }

  #scheduleExpiry(pending: PendingOperation): void {
    this.#clearExpiryTimer();
    const expire = (): void => {
      if (this.#pending !== pending || this.#disposed) return;
      const remaining = pending.expiresAt - Date.now();
      if (remaining > 0) {
        this.#expiryTimer = setTimeout(expire, remaining);
        return;
      }
      this.#expiryTimer = null;
      this.#generation += 1;
      this.#pending = null;
      this.#operationPhase = 'refused';
      this.#result = fixedResult('refused', 'control_operation', 'Confirmation expired.');
      this.#emit();
    };
    this.#expiryTimer = setTimeout(expire, VOICE_CONFIRMATION_WINDOW_MS);
  }

  #pendingMatchesContext(pending: PendingOperation): boolean {
    return pending.scope === this.#context.scope
      && pending.sessionKey === this.#context.sessionKey
      && pending.workspaceKey === this.#context.workspaceKey;
  }

  #clearPending(): void {
    this.#clearExpiryTimer();
    this.#pending = null;
  }

  #clearExpiryTimer(): void {
    if (this.#expiryTimer === null) return;
    clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
  }

  #assertCurrent(generation: number, signal: AbortSignal): void {
    this.#assertCurrentSignal(signal);
    if (generation !== this.#generation) throw new VoiceRuntimeError('interrupted');
  }

  #assertCurrentSignal(signal: AbortSignal): void {
    if (this.#disposed || signal.aborted) throw new VoiceRuntimeError('interrupted');
  }

  #emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
