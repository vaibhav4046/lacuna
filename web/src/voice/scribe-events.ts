import type { RuntimeFailure } from './controller';

export type ScribeEvent =
  | { readonly kind: 'started' }
  | { readonly kind: 'partial'; readonly text: string }
  | { readonly kind: 'committed'; readonly text: string }
  | { readonly kind: 'failure'; readonly failure: RuntimeFailure };

/** Provider messages are data, never UI copy. Unknown and malformed shapes fail closed. */
export function readScribeEvent(raw: unknown): ScribeEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const message = raw as Readonly<Record<string, unknown>>;
  const type = message['message_type'];
  if (type === 'session_started') return { kind: 'started' };
  if ((type === 'partial_transcript' || type === 'committed_transcript')
    && typeof message['text'] === 'string') {
    const text = message['text'].trim();
    if (text === '' || text.length > 10_000) return null;
    return { kind: type === 'partial_transcript' ? 'partial' : 'committed', text };
  }
  if (type === 'rate_limited') return { kind: 'failure', failure: 'rate_limited' };
  if (type === 'error' || type === 'auth_error') {
    return { kind: 'failure', failure: 'provider_unavailable' };
  }
  // final_transcript is intentionally ignored. Only committed_transcript may query memory.
  if (type === 'final_transcript' || type === 'committed_transcript_with_timestamps') return null;
  return null;
}
