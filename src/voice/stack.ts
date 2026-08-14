/**
 * What a working voice path would need, and which parts of it exist.
 *
 * The two stages in the middle of the pipeline are this product and they run.
 * The two on the ends are audio and they are not installed here. That is an
 * uncomfortable table to publish during a hackathon and it is the only one
 * worth publishing, because the alternative is a page that animates a sphere
 * to microphone level with nothing behind it, which looks exactly like a
 * working voice product and is not one.
 *
 * Every component is named with its licence and its actual state. A reader who
 * wants to finish this has the shopping list; a reader who wants to check the
 * claim has the reason it is not finished.
 */

import type { CapabilityState } from '../model/capability.js';

export interface Component {
  readonly role: string;
  readonly choice: string;
  readonly licence: string;
  readonly state: CapabilityState;
  /** Why it is in that state, in one sentence, with no hedging. */
  readonly because: string;
}

/**
 * The local path, which is the one this project would ship.
 *
 * Local models keep the constraint that makes the rest of this product
 * defensible: a spoken question should not become somebody else's log line.
 * Nothing here has been installed on the machine that built this repository,
 * so nothing here is above NOT_STARTED.
 */
export const LOCAL_STACK: readonly Component[] = Object.freeze([
  {
    role: 'Speech detection',
    choice: 'Silero VAD',
    licence: 'MIT',
    state: 'NOT_STARTED',
    because: 'Decides when an utterance starts and stops so the recogniser is '
      + 'not fed silence. No weights are present in this checkout.',
  },
  {
    role: 'Speech to text',
    choice: 'whisper.cpp, small.en, quantised',
    licence: 'MIT',
    state: 'NOT_STARTED',
    because: 'Runs on the CPU with no network. The binary is not built here and '
      + 'the model file is not committed, so there is nothing to call.',
  },
  {
    role: 'Text to speech',
    choice: 'Kokoro-82M',
    licence: 'Apache 2.0',
    state: 'NOT_STARTED',
    because: 'Small enough to run beside the server. Not installed, so the '
      + 'speech stage of the pipeline reports no timing at all.',
  },
  {
    role: 'Optional reasoning',
    choice: 'Qwen 3.5 4B through Ollama',
    licence: 'Apache 2.0',
    state: 'NOT_STARTED',
    because: 'Optional on purpose. The verdict is decided by the resolver from '
      + 'graph edges, so a model that disagreed with it would be a bug, not a '
      + 'second opinion.',
  },
]);

/**
 * The metered path, listed because leaving it out would be dishonest.
 *
 * These are the services that would make voice work today. Each one is a
 * request that leaves the machine and a quota that runs out, which is the
 * trade the local stack exists to avoid. They are named as metered rather
 * than as a fallback that just works.
 */
export const METERED_STACK: readonly Component[] = Object.freeze([
  {
    role: 'Speech to text',
    choice: 'AssemblyAI',
    licence: 'Metered service',
    state: 'BLOCKED',
    because: 'No credential is configured for it in this environment, so it '
      + 'cannot be called and has never been called.',
  },
  {
    role: 'Text to speech',
    choice: 'ElevenLabs',
    licence: 'Metered service',
    state: 'NOT_STARTED',
    because: 'A credential exists outside the repository. No code calls it, and '
      + 'audio of a stored conversation leaving the machine is the thing the '
      + 'local stack is chosen to prevent.',
  },
  {
    role: 'Optional reasoning',
    choice: 'Groq',
    licence: 'Metered service',
    state: 'NOT_STARTED',
    because: 'Same objection as the local model and one more: a hosted model in '
      + 'the answer path would put a quota between a question and its evidence.',
  },
]);

/** Everything that would have to exist, in one list. */
export const VOICE_STACK: readonly Component[] = Object.freeze([
  ...LOCAL_STACK,
  ...METERED_STACK,
]);

/**
 * The one part of the voice surface that does work today.
 *
 * A question typed into the form on the front page goes through exactly the
 * pipeline a spoken one would, minus the two audio stages. That is not a
 * consolation prize: it is the whole claim of this product, which is about
 * what the graph knows rather than how the question arrived.
 */
export const TEXT_PATH_STATE: CapabilityState = 'VERIFIED';
