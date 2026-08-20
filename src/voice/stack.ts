import type { CapabilityState } from '../model/capability.js';

export interface Component {
  readonly role: string;
  readonly choice: string;
  readonly licence: string;
  readonly state: CapabilityState;
  readonly because: string;
}

/** Local alternatives remain explicit and are not installed by the hosted path. */
export const LOCAL_STACK: readonly Component[] = Object.freeze([
  {
    role: 'Speech detection', choice: 'Silero VAD', licence: 'MIT', state: 'NOT_STARTED',
    because: 'No local VAD weights are present. Scribe realtime VAD commits the hosted path.',
  },
  {
    role: 'Speech to text', choice: 'whisper.cpp', licence: 'MIT', state: 'NOT_STARTED',
    because: 'No local recogniser binary or model is installed.',
  },
  {
    role: 'Text to speech', choice: 'Kokoro-82M', licence: 'Apache 2.0', state: 'NOT_STARTED',
    because: 'No local speech model is installed.',
  },
]);

/**
 * The implemented hosted boundary. VERIFIED means its requests, response
 * guards, state machine and browser lifecycle pass tests. A deployment still
 * needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID before provider calls run.
 */
export const METERED_STACK: readonly Component[] = Object.freeze([
  {
    role: 'Speech to text', choice: 'ElevenLabs Scribe v2 Realtime',
    licence: 'Metered service', state: 'VERIFIED',
    because: 'The browser streams microphone PCM over a single-use-token websocket and commits only provider-final text.',
  },
  {
    role: 'Text to speech', choice: 'ElevenLabs streaming TTS',
    licence: 'Metered service', state: 'VERIFIED',
    because: 'The server streams only the spoken answer; the permanent provider key never enters the browser.',
  },
]);

export const VOICE_STACK: readonly Component[] = Object.freeze([...LOCAL_STACK, ...METERED_STACK]);
export const TEXT_PATH_STATE: CapabilityState = 'VERIFIED';
