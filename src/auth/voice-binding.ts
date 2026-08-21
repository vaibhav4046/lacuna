import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * A browser-readable, non-secret identifier for one opaque login session.
 *
 * It is deliberately derived from the token hash rather than the account: two
 * tabs signed in as the same person still receive different bindings. The
 * domain separator prevents this digest from being confused with the stored
 * token hash or reused by another protocol.
 */
const VOICE_BINDING_DOMAIN = 'lacuna:voice-binding:v1\0';
const VOICE_BINDING_SHAPE = /^[0-9a-f]{64}$/u;

export const VOICE_BINDING_HEADER = 'x-lacuna-voice-binding';

export type VoiceBindingVerdict = 'absent' | 'matching' | 'invalid';

export function voiceSessionBinding(tokenHash: string): string {
  return createHash('sha256')
    .update(VOICE_BINDING_DOMAIN, 'utf8')
    .update(tokenHash, 'ascii')
    .digest('hex');
}

/**
 * Validate a supplied binding against the current request cookie's token hash.
 * Both compared values have a fixed grammar and length before the constant-time
 * comparison. No raw token or token hash crosses this boundary.
 */
export function voiceBindingVerdict(
  header: string | readonly string[] | undefined,
  currentTokenHash: string | null,
): VoiceBindingVerdict {
  if (header === undefined) return 'absent';
  if (typeof header !== 'string' || !VOICE_BINDING_SHAPE.test(header) || currentTokenHash === null) {
    return 'invalid';
  }
  const expected = voiceSessionBinding(currentTokenHash);
  return timingSafeEqual(Buffer.from(header, 'ascii'), Buffer.from(expected, 'ascii'))
    ? 'matching'
    : 'invalid';
}
