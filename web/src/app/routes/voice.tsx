import { useEffect, useMemo, useState } from 'react';
import { useScope } from '../../api/scope';
import { VoiceOrb } from '../../canvas/VoiceOrb';
import { MONO } from '../../design/mark';
import { BrowserVoiceRuntime } from '../../voice/browser';
import { VoiceController, voiceCaptureControls, type VoiceSnapshot } from '../../voice/controller';
import { VOICE_STATE_COPY } from '../../voice/states';

const FAILURE_COPY = {
  permission_denied: 'Microphone permission was not granted. Type the question below or retry permission.',
  rate_limited: 'Voice is temporarily rate limited. The typed question path is still available.',
  provider_unavailable: 'The speech provider is unavailable. No audio is being simulated.',
  interrupted: 'The voice run was interrupted. Partial speech was not sent to memory.',
  error: 'Voice did not complete. The typed question path is still available.',
} as const;

const label = {
  fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#7A7A7A',
} as const;

const button = {
  borderRadius: '7px', cursor: 'pointer', fontFamily: MONO, fontSize: '10px',
  letterSpacing: '0.15em', padding: '9px 14px',
} as const;

export function VoiceRoute() {
  const { base } = useScope();
  const controller = useMemo(() => new VoiceController(new BrowserVoiceRuntime(base)), [base]);
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>(controller.snapshot);
  const [typed, setTyped] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(true);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const answer = snapshot.planned?.answer ?? null;
  const listening = snapshot.state === 'LISTENING' || snapshot.state === 'PARTIAL_TRANSCRIPT';
  const asking = snapshot.state === 'REQUESTING_PERMISSION' || snapshot.state === 'COMMITTED'
    || snapshot.state === 'CHECKING_CONTEXT';
  const controls = voiceCaptureControls(snapshot.failure);
  const canReplay = controls.replay && snapshot.canReplay && snapshot.state !== 'SPEAKING' && !asking && !listening;

  return (
    <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 'clamp(24px, 5vw, 64px)', alignItems: 'center' }}>
        <VoiceOrb state={snapshot.state} signal={snapshot.signal} rms={snapshot.rms} waveform={snapshot.waveform} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '9px', padding: '13px 15px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: snapshot.signal === null ? '#7A7A7A' : snapshot.signal === 'microphone' ? '#15846E' : '#FFB829' }} />
            <span style={{ ...label, color: '#BDBDBD' }}>VOICE · {snapshot.state.replaceAll('_', ' ')}</span>
            <span style={label}>ELEVENLABS · SINGLE-USE STT TOKEN · SERVER-SIDE TTS</span>
          </div>

          <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            <span style={label}>{VOICE_STATE_COPY[snapshot.state].status.toUpperCase()}</span>
            <span style={{ fontSize: '15px', color: '#BDBDBD', lineHeight: 1.65 }}>{VOICE_STATE_COPY[snapshot.state].detail}</span>
            {snapshot.failure === null ? null : (
              <span role="alert" style={{ fontSize: '13.5px', color: '#FFB829', lineHeight: 1.6 }}>
                {FAILURE_COPY[snapshot.failure]}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {snapshot.state === 'SPEAKING' ? (
              <>
                <button className="hv-violet" onClick={() => void controller.bargeIn()} style={{ ...button, background: '#8052FF', color: '#FFFFFF', border: 'none' }}>BARGE IN</button>
                <button className="hv-edge35" onClick={() => controller.cancel()} style={{ ...button, background: 'none', color: '#BDBDBD', border: '1px solid rgba(255,255,255,0.16)' }}>STOP AUDIO</button>
              </>
            ) : listening ? (
              <>
                <button className="hv-violet" onClick={() => controller.stop()} style={{ ...button, background: '#8052FF', color: '#FFFFFF', border: 'none' }}>COMMIT QUESTION</button>
                <button className="hv-edge35" onClick={() => controller.cancel()} style={{ ...button, background: 'none', color: '#BDBDBD', border: '1px solid rgba(255,255,255,0.16)' }}>CANCEL</button>
              </>
            ) : asking ? (
              <>
                <button disabled style={{ ...button, background: 'rgba(128,82,255,0.24)', color: '#9A9A9A', border: 'none', cursor: 'default' }}>WORKING</button>
                <button className="hv-edge35" onClick={() => controller.cancel()} style={{ ...button, background: 'none', color: '#BDBDBD', border: '1px solid rgba(255,255,255,0.16)' }}>CANCEL</button>
              </>
            ) : (
              <>
                {controls.startListening ? <button className="hv-violet" onClick={() => void controller.start()} style={{ ...button, background: '#8052FF', color: '#FFFFFF', border: 'none' }}>START LISTENING</button> : null}
                {snapshot.failure !== null && controls.retry ? (
                  <button className="hv-edge35" onClick={() => void controller.retry()} style={{ ...button, background: 'none', color: '#BDBDBD', border: '1px solid rgba(255,255,255,0.16)' }}>RETRY</button>
                ) : null}
                {canReplay ? (
                  <button className="hv-edge35" onClick={() => void controller.replay()} style={{ ...button, background: 'none', color: '#BDBDBD', border: '1px solid rgba(255,255,255,0.16)' }}>PLAY ANSWER</button>
                ) : null}
              </>
            )}
          </div>

          {snapshot.failure === 'provider_unavailable' ? (
            <span style={{ ...label, color: '#FFB829', letterSpacing: '0.11em' }}>SPEECH SERVICE UNAVAILABLE · RETRY, OR TYPE A QUESTION BELOW</span>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px' }}>
            <span style={label}>LEVEL</span><span style={{ ...label, color: '#BDBDBD' }}>{snapshot.signal === null ? '—' : snapshot.rms.toFixed(3)}</span>
            <span style={label}>SIGNAL</span><span style={{ ...label, color: '#BDBDBD' }}>{snapshot.signal?.toUpperCase() ?? 'NONE'}</span>
          </div>
        </div>
      </div>

      <section aria-label="Transcript" style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
        <span style={label}>TRANSCRIPT</span>
        {snapshot.partialTranscript !== '' ? (
          <span style={{ fontSize: '20px', color: '#9A9A9A', borderBottom: '1px dashed rgba(255,255,255,0.22)', paddingBottom: '8px' }}>{snapshot.partialTranscript}</span>
        ) : snapshot.transcript !== '' ? (
          <span style={{ fontSize: '20px', color: '#FFFFFF' }}>{snapshot.transcript}</span>
        ) : (
          <span style={{ fontSize: '14px', color: '#7A7A7A' }}>Nothing committed.</span>
        )}
      </section>

      <form
        onSubmit={(event) => { event.preventDefault(); void controller.submitTyped(typed); }}
        style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '9px', padding: '13px 15px' }}
      >
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Type the same question without a microphone"
          aria-label="Typed question fallback"
          maxLength={300}
          style={{ flex: 1, minWidth: '220px', background: 'transparent', border: 'none', outline: 'none', color: '#FFFFFF', fontSize: '14px' }}
        />
        <button className="hv-edge35" type="submit" style={{ ...button, background: 'none', color: '#BDBDBD', border: '1px solid rgba(255,255,255,0.16)' }}>ASK AS TEXT</button>
      </form>

      {snapshot.planned === null ? null : (
        <section aria-label="Voice answer" style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '22px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <span style={{ ...label, color: answer?.status === 'ANSWERED' || answer?.status === 'PARTIAL' ? '#8052FF' : '#FFB829' }}>
            {answer?.status.replaceAll('_', ' ') ?? 'QUESTION NOT UNDERSTOOD'}
          </span>
          {snapshot.planned.reading === null ? (
            <span style={{ fontSize: '16px', color: '#BDBDBD' }}>That question could not be matched to this workspace.</span>
          ) : (
            <span style={label}>READ AS · {snapshot.planned.reading.subject} · {snapshot.planned.reading.predicate}</span>
          )}
          {answer?.answer === null || answer?.answer === undefined ? null : (
            <div style={{ fontSize: 'clamp(34px, 5vw, 64px)', color: '#FFFFFF', lineHeight: 1.04, letterSpacing: '-0.035em' }}>{answer.answer}</div>
          )}
          {answer?.status === 'NO_EVIDENCE' ? (
            <span style={{ fontSize: '15px', color: '#BDBDBD' }}>{answer.abstain_reason ?? 'The workspace did not support an answer.'}</span>
          ) : null}
          {answer?.status === 'CONFLICT' ? (
            <span style={{ fontSize: '15px', color: '#BDBDBD' }}>{answer.conflicts.length} conflicting claim{answer.conflicts.length === 1 ? '' : 's'} preserved.</span>
          ) : null}
          {answer === null ? null : (
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setEvidenceOpen((open) => !open)} style={{ background: 'none', border: 'none', padding: '0 0 3px', borderBottom: '1px solid #8052FF', color: '#FFFFFF', cursor: 'pointer' }}>Evidence</button>
              <span style={label}>{answer.evidence.length} SOURCE{answer.evidence.length === 1 ? '' : 'S'} · {answer.revisions.length} HISTORICAL REVISION{answer.revisions.length === 1 ? '' : 'S'} · TRACE {answer.trace_id.toUpperCase()}</span>
            </div>
          )}
          {answer !== null && evidenceOpen ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              {answer.evidence.length === 0 ? <span style={{ color: '#7A7A7A', fontSize: '13px' }}>No supporting evidence.</span>
                : answer.evidence.map((item, index) => (
                  <div key={`${item.source}-${index}`} style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: '7px', padding: '10px 12px', display: 'grid', gap: '5px' }}>
                    <span style={{ fontSize: '14px', color: '#FFFFFF' }}>{item.source}</span>
                    <span style={label}>{item.standing.toUpperCase()} · {item.meta}</span>
                  </div>
                ))}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
