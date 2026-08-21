import { VoiceAssistantSurface } from '../VoiceDock';
import { MONO } from '../../design/mark';
import { useVoiceAssistant } from '../../voice/assistant-context';

/**
 * Expanded inspection of the shell-owned assistant. This route never creates
 * media or operation authority; navigation here leaves the transcript and the
 * last observed result on the same provider used by the dock.
 */
export function VoiceRoute() {
  const { snapshot } = useVoiceAssistant();

  return (
    <div style={{ maxWidth: '940px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <header style={{ display: 'grid', gap: '9px', paddingBottom: '18px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.2em', color: '#8052FF' }}>GLOBAL ASSISTANT · EXPANDED</span>
        <h1 style={{ margin: 0, color: '#FFFFFF', fontSize: 'clamp(34px, 5vw, 62px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.035em' }}>One voice session. Every route.</h1>
        <p style={{ margin: 0, maxWidth: '62ch', color: '#9A9A9A', fontSize: '15px', lineHeight: 1.7 }}>
          Speech and workspace operations report independently. A result stays visible when sound is blocked. Navigation clears an unconfirmed action without discarding the transcript or the last completed result.
        </p>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' }}>
          CURRENT · {snapshot.speech.state.replaceAll('_', ' ')} · {snapshot.operationPhase.replaceAll('_', ' ')}
        </span>
      </header>

      <VoiceAssistantSurface expanded />
    </div>
  );
}
