import type { AudioSignal, VoiceState } from './states';

export interface VoiceOrbFrame {
  readonly active: boolean;
  readonly measured: number;
}

function canMove(state: VoiceState, signal: AudioSignal): boolean {
  if ((state === 'LISTENING' || state === 'PARTIAL_TRANSCRIPT') && signal === 'microphone') return true;
  return state === 'SPEAKING' && signal === 'playback';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/** Pure gate used by the renderer and tests: only real analyser states can move. */
export function voiceOrbFrame(
  state: VoiceState,
  signal: AudioSignal,
  rms: number,
  reducedMotion: boolean,
): VoiceOrbFrame {
  const active = canMove(state, signal) && !reducedMotion;
  return { active, measured: active ? clamp(rms * 12) : 0 };
}
