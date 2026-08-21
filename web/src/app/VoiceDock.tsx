import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useScope } from '../api/scope';
import { MONO, Mark } from '../design/mark';
import { useVoiceAssistant } from '../voice/assistant-context';
import { voiceCaptureControls, type RuntimeFailure } from '../voice/controller';
import type { VoiceOperationFailure } from '../voice/operations';
import { VOICE_STATE_COPY } from '../voice/states';
import {
  containVoiceModalBackground,
  voiceDockCount,
  voiceDockKeyboardAction,
  voiceDockText,
} from './product-contracts';

const FAILURE_COPY: Readonly<Record<RuntimeFailure, string>> = {
  permission_denied: 'Microphone permission was not granted. Type the command below or select Start listening to try again.',
  rate_limited: 'Voice is temporarily rate limited. The typed command path remains available.',
  provider_unavailable: 'The speech provider is unavailable. No audio or transcript is being simulated.',
  playback_blocked: 'Your browser blocked sound' + '. Select Enable sound to retry this observed result.',
  interrupted: 'The voice run was interrupted. Partial speech was not executed.',
  error: 'The browser or context request did not complete. No result was assumed.',
};

const OPERATION_FAILURE_COPY: Readonly<Record<VoiceOperationFailure, string>> = {
  session_required: 'The authenticated session is no longer available. Sign in again before retrying.',
  request_failed: 'The authenticated operation service did not answer. Nothing was assumed or executed.',
  invalid_plan: 'The operation plan failed validation. Nothing was executed.',
  operation_refused: 'The allowlist refused this operation. Nothing was executed.',
  operation_unavailable: 'This operation is not available in the current workspace.',
  control_operation: 'No workspace operation ran.',
  target_not_unique: 'The workspace did not contain exactly one eligible target. Nothing was executed.',
  invalid_response: 'The operation returned an invalid response. No result was inferred.',
};

const label = {
  fontFamily: MONO,
  fontSize: '9.5px',
  letterSpacing: '0.18em',
  color: '#7A7A7A',
  textTransform: 'uppercase',
} as const;

const actionButton = {
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: MONO,
  fontSize: '9.5px',
  letterSpacing: '0.15em',
  padding: '9px 12px',
} as const;

const secondaryButton = {
  ...actionButton,
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.16)',
  color: '#BDBDBD',
} as const;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function operationColour(phase: string): string {
  if (phase === 'awaiting_confirmation') return '#FFB829';
  if (phase === 'succeeded') return '#8052FF';
  if (phase === 'refused' || phase === 'unavailable') return '#BDBDBD';
  return '#7A7A7A';
}

function compactEvidenceCount(count: number): string {
  return `${voiceDockCount(count)} EVIDENCE ${count === 1 ? 'ITEM' : 'ITEMS'}`;
}

export function VoiceAssistantSurface({ expanded = false }: { readonly expanded?: boolean }) {
  const {
    snapshot,
    startListening,
    stopListening,
    cancelSpeech,
    bargeIn,
    retry,
    replay,
    submitTyped,
    confirm,
    cancelPending,
  } = useVoiceAssistant();
  const { demo } = useScope();
  const [typed, setTyped] = useState('');
  const speech = snapshot.speech;
  const answer = speech.planned?.answer ?? null;
  const listening = speech.state === 'LISTENING' || speech.state === 'PARTIAL_TRANSCRIPT';
  const asking = speech.state === 'REQUESTING_PERMISSION' || speech.state === 'COMMITTED'
    || speech.state === 'CHECKING_CONTEXT';
  const controls = voiceCaptureControls(speech.failure);
  const canReplay = controls.replay && speech.canReplay && speech.state !== 'SPEAKING'
    && !asking && !listening;
  const resultAnswer = voiceDockText(snapshot.result?.answer);
  const directAnswer = resultAnswer === null ? voiceDockText(answer?.answer) : null;
  const resultSummary = voiceDockText(snapshot.result?.summary);
  const operationProblem = snapshot.result?.failure === null || snapshot.result?.failure === undefined
    ? null
    : OPERATION_FAILURE_COPY[snapshot.result.failure];
  const committedTranscript = speech.partialTranscript !== ''
    ? speech.partialTranscript
    : speech.transcript;

  async function sendTyped(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const text = typed.trim();
    if (text === '') return;
    await submitTyped(text);
    setTyped('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: expanded ? '22px' : '15px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ ...label, color: '#FFFFFF', fontWeight: 600 }}>VOICE ASSISTANT</span>
        <span style={{ ...label, color: demo ? '#FFB829' : '#8052FF' }}>
          {demo ? 'EXPLORE · READ ONLY' : 'AUTHENTICATED · WORKSPACE BOUND'}
        </span>
      </div>

      <div style={{ borderLeft: `2px solid ${operationColour(snapshot.operationPhase)}`, paddingLeft: '13px', display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '8px 16px' }}>
        <span style={label}>SPEECH PHASE</span>
        <span style={{ ...label, color: '#BDBDBD' }}>{speech.state.replaceAll('_', ' ')}</span>
        <span style={label}>OPERATION PHASE</span>
        <span style={{ ...label, color: operationColour(snapshot.operationPhase) }}>{snapshot.operationPhase.replaceAll('_', ' ')}</span>
      </div>

      <div aria-live="polite" style={{ display: 'grid', gap: '6px' }}>
        <span style={{ ...label, color: '#9A9A9A' }}>{VOICE_STATE_COPY[speech.state].status}</span>
        <span style={{ color: '#BDBDBD', fontSize: expanded ? '15px' : '13px', lineHeight: 1.55 }}>
          {VOICE_STATE_COPY[speech.state].detail}
        </span>
        {speech.state === 'SPEAKING' && speech.playbackAnalysis === 'unavailable' ? (
          <span style={{ ...label, color: '#FFB829' }}>AUDIO PLAYING · METER UNAVAILABLE</span>
        ) : null}
        {speech.failure === null ? null : (
          <span role="alert" style={{ color: '#FFB829', fontSize: '13px', lineHeight: 1.55 }}>
            {FAILURE_COPY[speech.failure]}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {speech.state === 'SPEAKING' ? (
          <>
            <button className="hv-violet" type="button" onClick={() => void bargeIn()} style={{ ...actionButton, border: 'none', background: '#8052FF', color: '#FFFFFF' }}>BARGE IN</button>
            <button className="hv-edge35" type="button" onClick={cancelSpeech} style={secondaryButton}>STOP AUDIO</button>
          </>
        ) : listening ? (
          <>
            <button className="hv-violet" type="button" onClick={stopListening} style={{ ...actionButton, border: 'none', background: '#8052FF', color: '#FFFFFF' }}>COMMIT COMMAND</button>
            <button className="hv-edge35" type="button" onClick={cancelSpeech} style={secondaryButton}>CANCEL CAPTURE</button>
          </>
        ) : asking ? (
          <>
            <button type="button" disabled style={{ ...actionButton, border: 'none', background: 'rgba(128,82,255,0.22)', color: '#9A9A9A', cursor: 'default' }}>WORKING</button>
            <button className="hv-edge35" type="button" onClick={cancelSpeech} style={secondaryButton}>CANCEL REQUEST</button>
          </>
        ) : (
          <>
            {controls.startListening ? (
              <button className="hv-violet" type="button" onClick={() => void startListening()} style={{ ...actionButton, border: 'none', background: '#8052FF', color: '#FFFFFF' }}>START LISTENING</button>
            ) : null}
            {speech.failure !== null && controls.retry ? (
              <button className="hv-edge35" type="button" onClick={() => void retry()} style={secondaryButton}>RETRY</button>
            ) : null}
            {canReplay ? (
              <button className="hv-edge35" type="button" onClick={() => void replay()} style={secondaryButton}>
                {speech.failure === 'playback_blocked' ? 'ENABLE SOUND' : 'PLAY ANSWER'}
              </button>
            ) : null}
          </>
        )}
      </div>

      <section aria-label="Voice transcript" style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '12px', display: 'grid', gap: '6px' }}>
        <span style={label}>TRANSCRIPT</span>
        <span style={{ minHeight: '1.35em', color: speech.partialTranscript === '' ? '#FFFFFF' : '#9A9A9A', fontSize: expanded ? '20px' : '14px', lineHeight: 1.45 }}>
          {committedTranscript === '' ? 'Nothing committed.' : committedTranscript}
        </span>
      </section>

      <form onSubmit={(event) => void sendTyped(event)} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '10px', border: '1px solid rgba(128,82,255,0.38)', borderRadius: '7px' }}>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-label="Typed voice command"
          placeholder={demo ? 'Ask the public workspace' : 'Type a question or allowlisted command'}
          maxLength={1_000}
          disabled={asking || listening}
          style={{ flex: 1, minWidth: expanded ? '240px' : '180px', border: 'none', outline: 'none', background: 'transparent', color: '#FFFFFF', fontSize: '13px' }}
        />
        <button className="hv-edge35" type="submit" disabled={asking || listening || typed.trim() === ''} style={{ ...secondaryButton, cursor: asking || listening || typed.trim() === '' ? 'default' : 'pointer' }}>SEND TEXT</button>
      </form>

      {snapshot.pendingPreview === null ? null : (
        <section aria-label="Pending voice operation" style={{ border: '1px solid rgba(255,184,41,0.48)', borderRadius: '7px', padding: '13px', display: 'grid', gap: '11px', background: 'rgba(255,184,41,0.035)' }}>
          <span style={{ ...label, color: '#FFB829' }}>EXACT ACTION PREVIEW</span>
          <span style={{ color: '#FFFFFF', fontSize: expanded ? '16px' : '13.5px', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{snapshot.pendingPreview}</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="hv-violet" type="button" onClick={() => void confirm()} style={{ ...actionButton, border: '1px solid #FFB829', background: '#FFB829', color: '#000000' }}>CONFIRM</button>
            <button className="hv-edge35" type="button" onClick={cancelPending} style={secondaryButton}>CANCEL</button>
          </div>
        </section>
      )}

      {snapshot.result === null && answer === null ? null : (
        <section aria-label="Observed voice result" style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '13px', display: 'grid', gap: '8px' }}>
          <span style={{ ...label, color: snapshot.result?.status === 'succeeded' || answer?.status === 'ANSWERED' ? '#8052FF' : '#BDBDBD' }}>
            OBSERVED RESULT
          </span>
          {resultSummary === null ? null : <span style={{ color: '#FFFFFF', fontSize: expanded ? '18px' : '14px', lineHeight: 1.5 }}>{resultSummary}</span>}
          {resultAnswer === null && directAnswer === null ? null : (
            <span style={{ color: '#FFFFFF', fontSize: expanded ? 'clamp(28px, 4vw, 50px)' : '18px', lineHeight: 1.12, letterSpacing: expanded ? '-0.025em' : '-0.01em' }}>
              {resultAnswer ?? directAnswer}
            </span>
          )}
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {snapshot.result === null ? null : <span style={label}>{voiceDockCount(snapshot.result.observedCount)} OBSERVED</span>}
            {answer === null ? null : <span style={label}>{compactEvidenceCount(answer.evidence.length)}</span>}
            {answer?.trace_id === undefined ? null : <span style={label}>TRACE {voiceDockText(answer.trace_id)}</span>}
          </div>
          {operationProblem === null ? null : (
            <span role={snapshot.result?.failure === 'session_required' || snapshot.result?.failure === 'request_failed' ? 'alert' : undefined} style={{ color: '#FFB829', fontSize: '12.5px', lineHeight: 1.55 }}>
              {operationProblem}
            </span>
          )}
          {expanded && answer !== null && answer.evidence.length > 0 ? (
            <div style={{ display: 'grid', gap: '7px' }}>
              {answer.evidence.slice(0, 8).map((item, index) => (
                <div key={`${item.source}-${index}`} style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '9px 11px', display: 'grid', gap: '4px' }}>
                  <span style={{ color: '#FFFFFF', fontSize: '13px' }}>{voiceDockText(item.source)}</span>
                  <span style={label}>{voiceDockText(item.standing)} · {voiceDockText(item.meta)}</span>
                </div>
              ))}
              {answer.evidence.length > 8 ? <span style={label}>SHOWING 8 OF {voiceDockCount(answer.evidence.length)}</span> : null}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

export function VoiceDock() {
  const { prefix } = useScope();
  const { dockOpen, openDock, closeDock } = useVoiceAssistant();
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!dockOpen) return;
    const active = document.activeElement;
    originRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : bubbleRef.current;
    const shell = bubbleRef.current?.closest('[data-shellroot]');
    const background = shell === null || shell === undefined
      ? []
      : Array.from(shell.querySelectorAll<HTMLElement>('[data-voice-background]'));
    const restoreBackground = containVoiceModalBackground(background);

    const focusDialog = () => {
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialogRef.current)?.focus();
    };
    const keepFocusInside = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && dialogRef.current?.contains(target)) return;
      focusDialog();
    };
    focusDialog();
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      restoreBackground();
      const origin = originRef.current;
      const originAvailable = origin?.isConnected === true
        && (!(origin instanceof HTMLButtonElement) || !origin.disabled);
      (originAvailable ? origin : bubbleRef.current)?.focus();
      originRef.current = null;
    };
  }, [dockOpen]);

  function handleDialogKey(event: KeyboardEvent<HTMLDivElement>): void {
    const focusable = dialogRef.current === null
      ? []
      : Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const activeIndex = focusable.findIndex((element) => element === document.activeElement);
    const action = voiceDockKeyboardAction(event.key, event.shiftKey, activeIndex, focusable.length);
    if (action.kind === 'none') return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === 'collapse') {
      closeDock();
      return;
    }
    if (action.kind === 'dialog') {
      dialogRef.current?.focus();
      return;
    }
    focusable[action.index]?.focus();
  }

  return (
    <>
      <button
        ref={bubbleRef}
        data-voice-launcher="1"
        type="button"
        aria-label="Open voice assistant"
        aria-expanded={dockOpen}
        aria-controls="voice-assistant-dialog"
        aria-hidden={dockOpen ? true : undefined}
        disabled={dockOpen}
        onClick={openDock}
        style={{
          position: 'fixed',
          right: 'clamp(14px, 2vw, 28px)',
          bottom: 'clamp(14px, 2vw, 28px)',
          zIndex: 40,
          width: '58px',
          height: '58px',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          borderRadius: '50%',
          border: dockOpen ? '1px solid #8052FF' : '1px solid rgba(255,255,255,0.22)',
          background: '#050505',
          boxShadow: dockOpen ? '0 0 0 5px rgba(128,82,255,0.09), 0 14px 42px rgba(0,0,0,0.64)' : '0 14px 42px rgba(0,0,0,0.58)',
          cursor: dockOpen ? 'default' : 'pointer',
          pointerEvents: dockOpen ? 'none' : 'auto',
        }}
      >
        <Mark size={24} />
      </button>

      {dockOpen ? (
        <>
          <div
            data-voice-modal-backdrop="1"
            aria-hidden="true"
            onPointerDown={closeDock}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 38,
              background: 'rgba(0,0,0,0.66)',
            }}
          />
          <div
            id="voice-assistant-dialog"
            data-voice-dialog="1"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="voice-assistant-title"
            aria-describedby="voice-assistant-purpose"
            onKeyDown={handleDialogKey}
            style={{
              position: 'fixed',
              right: 'clamp(12px, 2vw, 28px)',
              bottom: 'clamp(84px, 9vw, 98px)',
              zIndex: 39,
              width: 'min(430px, calc(100vw - 24px))',
              maxHeight: 'min(720px, calc(100vh - 112px))',
              overflowY: 'auto',
              boxSizing: 'border-box',
              border: '1px solid rgba(128,82,255,0.62)',
              borderRadius: '10px',
              background: '#050505',
              boxShadow: '0 24px 80px rgba(0,0,0,0.78)',
              padding: '16px',
            }}
          >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '16px', marginBottom: '14px' }}>
            <div style={{ display: 'grid', gap: '5px' }}>
              <span id="voice-assistant-title" style={{ ...label, color: '#FFFFFF' }}>LACUNA VOICE</span>
              <span id="voice-assistant-purpose" style={{ color: '#7A7A7A', fontSize: '12px', lineHeight: 1.45 }}>Speak or type one bounded workspace action.</span>
            </div>
            <button ref={closeRef} className="hv-edge35" type="button" onClick={closeDock} style={{ ...secondaryButton, padding: '7px 9px' }}>COLLAPSE</button>
          </div>

          <VoiceAssistantSurface />

          <Link
            to={`${prefix}/voice`}
            onClick={closeDock}
            style={{ display: 'inline-block', marginTop: '16px', paddingBottom: '3px', borderBottom: '1px solid #8052FF', color: '#BDBDBD', textDecoration: 'none', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em' }}
          >
            EXPAND VOICE
          </Link>
          </div>
        </>
      ) : null}
    </>
  );
}
