import { FixedWindow, type RateLimitVerdict } from '../server/ratelimit.js';

const ELEVENLABS_ORIGIN = 'https://api.elevenlabs.io';
const TOKEN_PATH = '/v1/single-use-token/realtime_scribe';
const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const MAX_SPOKEN_CHARS = 5_000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export const VOICE_TOKEN_LIMIT = Object.freeze({ limit: 8, windowMs: 60_000, maxKeys: 8_192 });
export const VOICE_TTS_LIMIT = Object.freeze({ limit: 20, windowMs: 60_000, maxKeys: 8_192 });

export interface ElevenLabsVoiceConfig {
  /** Permanent secret. This type is server-only and must never be serialized. */
  readonly apiKey: string;
  readonly voiceId: string;
  readonly modelId: string;
  readonly outputFormat: 'mp3_44100_128';
}

export interface ProviderRequest {
  readonly url: string;
  readonly init: RequestInit;
}

export type VoiceProviderFailure = 'rate_limited' | 'provider_unavailable' | 'interrupted';

export type TokenProviderResult =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly failure: VoiceProviderFailure };

export type SpeechProviderResult =
  | { readonly ok: true; readonly response: Response; readonly contentType: string }
  | { readonly ok: false; readonly failure: VoiceProviderFailure };

function boundedSecret(value: string | undefined, max: number): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max || /[\r\n\0]/u.test(trimmed)) return null;
  return trimmed;
}

/** Configuration is complete or absent. There is no guessed default voice. */
export function elevenLabsVoiceConfig(env: NodeJS.ProcessEnv): ElevenLabsVoiceConfig | null {
  const apiKey = boundedSecret(env['ELEVENLABS_API_KEY'], 512);
  const voiceId = boundedSecret(env['ELEVENLABS_VOICE_ID'], 128);
  const modelId = boundedSecret(env['ELEVENLABS_TTS_MODEL_ID'], 128) ?? DEFAULT_TTS_MODEL;
  if (apiKey === null || voiceId === null || !/^[A-Za-z0-9_-]+$/u.test(voiceId)) return null;
  if (!/^[A-Za-z0-9_.-]+$/u.test(modelId)) return null;
  return { apiKey, voiceId, modelId, outputFormat: DEFAULT_OUTPUT_FORMAT };
}

export function singleUseTokenRequest(config: ElevenLabsVoiceConfig): ProviderRequest {
  return {
    url: `${ELEVENLABS_ORIGIN}${TOKEN_PATH}`,
    init: {
      method: 'POST',
      headers: { Accept: 'application/json', 'xi-api-key': config.apiKey },
      cache: 'no-store',
    },
  };
}

export function streamingSpeechRequest(
  config: ElevenLabsVoiceConfig,
  spokenAnswer: string,
): ProviderRequest | null {
  const text = spokenAnswer.trim();
  if (text.length === 0 || text.length > MAX_SPOKEN_CHARS) return null;
  return {
    url: `${ELEVENLABS_ORIGIN}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=${config.outputFormat}`,
    init: {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': config.apiKey,
      },
      body: JSON.stringify({ text, model_id: config.modelId }),
      cache: 'no-store',
    },
  };
}

/** A provider token is opaque, bounded, single line text. */
export function readSingleUseToken(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const token = (value as Readonly<Record<string, unknown>>)['token'];
  if (typeof token !== 'string' || token.length < 8 || token.length > 2_048) return null;
  if (!/^[A-Za-z0-9._~-]+$/u.test(token)) return null;
  return token;
}

export function validStreamingAudio(response: Response): string | null {
  if (!response.ok || response.body === null) return null;
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'audio/mpeg') return null;
  const statedLength = response.headers.get('content-length');
  if (statedLength !== null) {
    const bytes = Number(statedLength);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_AUDIO_BYTES) return null;
  }
  return contentType;
}

export class ElevenLabsVoiceProvider {
  readonly #config: ElevenLabsVoiceConfig;
  readonly #fetch: typeof fetch;

  constructor(config: ElevenLabsVoiceConfig, request: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = request;
  }

  async token(signal?: AbortSignal): Promise<TokenProviderResult> {
    const request = singleUseTokenRequest(this.#config);
    try {
      const response = await this.#fetch(request.url, {
        ...request.init,
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 429) return { ok: false, failure: 'rate_limited' };
      if (!response.ok) return { ok: false, failure: 'provider_unavailable' };
      if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        !== 'application/json') return { ok: false, failure: 'provider_unavailable' };
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        return { ok: false, failure: 'provider_unavailable' };
      }
      const token = readSingleUseToken(parsed);
      return token === null
        ? { ok: false, failure: 'provider_unavailable' }
        : { ok: true, token };
    } catch (error) {
      return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
        ? { ok: false, failure: 'interrupted' }
        : { ok: false, failure: 'provider_unavailable' };
    }
  }

  async speech(spokenAnswer: string, signal?: AbortSignal): Promise<SpeechProviderResult> {
    const request = streamingSpeechRequest(this.#config, spokenAnswer);
    if (request === null) return { ok: false, failure: 'provider_unavailable' };
    try {
      const response = await this.#fetch(request.url, {
        ...request.init,
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 429) return { ok: false, failure: 'rate_limited' };
      const contentType = validStreamingAudio(response);
      return contentType === null
        ? { ok: false, failure: 'provider_unavailable' }
        : { ok: true, response, contentType };
    } catch (error) {
      return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
        ? { ok: false, failure: 'interrupted' }
        : { ok: false, failure: 'provider_unavailable' };
    }
  }
}

export interface VoiceAccessRequest {
  /** Browser Origin header. Mutating voice endpoints refuse an absent origin. */
  readonly origin: string | undefined;
  readonly expectedOrigin: string;
  readonly scope: 'public' | 'private';
  /** Workspace derived from the route, never trusted from a request body. */
  readonly workspace: string;
  /** Workspace derived from the authenticated account, or null. */
  readonly sessionWorkspace: string | null;
  readonly sourceKey: string;
}

export type VoiceAccessFailure = 'origin' | 'session' | 'workspace';

export function validateVoiceAccess(request: VoiceAccessRequest): VoiceAccessFailure | null {
  let given: URL;
  let expected: URL;
  try {
    if (request.origin === undefined) return 'origin';
    given = new URL(request.origin);
    expected = new URL(request.expectedOrigin);
  } catch {
    return 'origin';
  }
  if (given.username !== '' || given.password !== '' || given.origin !== expected.origin) return 'origin';
  if (request.scope === 'public') return request.workspace === 'public' ? null : 'workspace';
  if (request.sessionWorkspace === null) return 'session';
  return request.workspace === request.sessionWorkspace ? null : 'workspace';
}

/** Only an exact `{ text }` body can cross the TTS boundary. */
export function readSpokenAnswer(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).length !== 1 || typeof record['text'] !== 'string') return null;
  const text = record['text'].trim();
  return text.length > 0 && text.length <= MAX_SPOKEN_CHARS ? text : null;
}

export type VoiceBoundaryResult =
  | { readonly status: number; readonly kind: 'json'; readonly body: Readonly<Record<string, unknown>>; readonly retryAfterSeconds?: number }
  | { readonly status: 200; readonly kind: 'audio'; readonly response: Response; readonly contentType: string };

function refused(failure: VoiceAccessFailure): VoiceBoundaryResult {
  return {
    status: failure === 'session' ? 401 : 403,
    kind: 'json',
    body: { error: failure === 'session' ? 'session' : 'permission' },
  };
}

function limited(verdict: RateLimitVerdict): VoiceBoundaryResult {
  return {
    status: 429, kind: 'json', body: { error: 'rate' },
    retryAfterSeconds: verdict.retryAfterSeconds,
  };
}

function providerFailure(failure: VoiceProviderFailure): VoiceBoundaryResult {
  if (failure === 'rate_limited') return { status: 429, kind: 'json', body: { error: 'rate' } };
  if (failure === 'interrupted') return { status: 499, kind: 'json', body: { error: 'interrupted' } };
  return { status: 503, kind: 'json', body: { error: 'speech_unavailable' } };
}

/**
 * Framework-neutral endpoint logic. ApiRouter supplies account/workspace facts
 * and pipes successful response.body to the browser without buffering it.
 */
export class VoiceBoundary {
  readonly #provider: ElevenLabsVoiceProvider | null;
  readonly #tokens = new FixedWindow(VOICE_TOKEN_LIMIT);
  readonly #speech = new FixedWindow(VOICE_TTS_LIMIT);
  readonly #now: () => number;

  constructor(provider: ElevenLabsVoiceProvider | null, now: () => number = Date.now) {
    this.#provider = provider;
    this.#now = now;
  }

  async token(access: VoiceAccessRequest, signal?: AbortSignal): Promise<VoiceBoundaryResult> {
    const denied = validateVoiceAccess(access);
    if (denied !== null) return refused(denied);
    const verdict = this.#tokens.check(`${access.scope}:${access.workspace}:${access.sourceKey}`, this.#now());
    if (!verdict.allowed) return limited(verdict);
    if (this.#provider === null) return { status: 503, kind: 'json', body: { error: 'speech_unavailable' } };
    const result = await this.#provider.token(signal);
    return result.ok
      ? { status: 200, kind: 'json', body: { token: result.token } }
      : providerFailure(result.failure);
  }

  async speech(
    access: VoiceAccessRequest,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<VoiceBoundaryResult> {
    const denied = validateVoiceAccess(access);
    if (denied !== null) return refused(denied);
    const text = readSpokenAnswer(body);
    if (text === null) return { status: 422, kind: 'json', body: { error: 'spoken_answer' } };
    const verdict = this.#speech.check(`${access.scope}:${access.workspace}:${access.sourceKey}`, this.#now());
    if (!verdict.allowed) return limited(verdict);
    if (this.#provider === null) return { status: 503, kind: 'json', body: { error: 'speech_unavailable' } };
    const result = await this.#provider.speech(text, signal);
    return result.ok
      ? { status: 200, kind: 'audio', response: result.response, contentType: result.contentType }
      : providerFailure(result.failure);
  }
}
