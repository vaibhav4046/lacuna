import type { FetchLike } from '../provider/openai.js';
import type { ContextPack, ReviewVerdict } from './types.js';

/**
 * An optional second check on the Reviewer, made by a local cross-encoder.
 *
 * The sidecar scores (claim, passage) pairs with P(passage supports claim). A
 * draft sentence counts as supported when its best score against any evidence
 * line clears the threshold. The result can only make a review stricter: a
 * sentence the reranker rejects is added to `unsupported` and the draft is no
 * longer approved, but nothing the Reviewer rejected is ever approved here.
 *
 * Off unless LACUNA_RERANKER_URL is set. A sidecar that is down, slow or
 * returns something unreadable leaves the Reviewer's verdict exactly as it was.
 *
 * Known limit: each sentence is scored against one evidence line at a time, so
 * a superseded value restated as current can still match its own superseded
 * line. The Reviewer prompt, which sees standings, remains the check for that.
 */

export const RERANKER_MAX_PAIRS = 256;
export const DEFAULT_RERANKER_THRESHOLD = 0.5;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface RerankerConfig {
  readonly url: string;
  readonly threshold: number;
}

export interface ClaimPair {
  readonly claim: string;
  readonly passage: string;
}

export interface SentenceJudgement {
  readonly supported: readonly string[];
  readonly unsupported: readonly string[];
}

export type VerifierOutcome =
  | { readonly status: 'ok'; readonly judgement: SentenceJudgement; readonly pairs: number }
  | { readonly status: 'skipped' | 'unavailable'; readonly detail: string };

/** null when the flag is unset; a skip reason when it is set to something unusable. */
export function rerankerConfig(
  env: Readonly<Record<string, string | undefined>>,
): RerankerConfig | { readonly invalid: string } | null {
  const raw = env.LACUNA_RERANKER_URL?.trim();
  if (raw === undefined || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { invalid: 'LACUNA_RERANKER_URL is not a URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { invalid: 'LACUNA_RERANKER_URL must be http or https' };
  }
  const rawThreshold = env.LACUNA_RERANKER_THRESHOLD?.trim();
  const threshold = rawThreshold === undefined || rawThreshold === ''
    ? DEFAULT_RERANKER_THRESHOLD
    : Number(rawThreshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return { invalid: 'LACUNA_RERANKER_THRESHOLD must be a number from 0 to 1' };
  }
  return { url: url.href.replace(/\/+$/, ''), threshold };
}

/**
 * Splits prose into sentences. Fragments that are only a citation marker, such
 * as "[1]" or "(source: standup)", or that carry no word at all, are dropped.
 */
export function splitSentences(draft: string): readonly string[] {
  return draft
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((part) => /[\p{L}\p{N}]{2,}/u.test(part.replace(/\[[^\]]*\]|\((?:source|see|cite)[^)]*\)/gi, '')));
}

/** One passage per packed claim: the quote when there is one, else the rendered line. */
export function evidencePassages(pack: ContextPack): readonly string[] {
  return pack.claims.map((claim) => claim.quote
    ?? `${claim.subject} ${claim.predicate} = ${claim.value} [${claim.standing.toUpperCase()}]`);
}

/** `scores[i * passages.length + j]` is sentence i against passage j. */
export function judgeSentences(
  sentences: readonly string[],
  passageCount: number,
  scores: readonly number[],
  threshold: number,
): SentenceJudgement {
  const supported: string[] = [];
  const unsupported: string[] = [];
  sentences.forEach((sentence, i) => {
    const row = scores.slice(i * passageCount, (i + 1) * passageCount);
    (row.length > 0 && Math.max(...row) >= threshold ? supported : unsupported).push(sentence);
  });
  return { supported, unsupported };
}

/** Stricter only. Never turns a rejection into an approval. */
export function mergeVerdict(verdict: ReviewVerdict, judgement: SentenceJudgement): ReviewVerdict {
  const added = judgement.unsupported.filter((sentence) => !verdict.unsupported.includes(sentence));
  if (added.length === 0) return verdict;
  const note = `Claim verifier found no supporting evidence line for ${added.length} sentence(s).`;
  return {
    approved: false,
    supported: verdict.supported,
    unsupported: [...verdict.unsupported, ...added],
    note: verdict.note === '' ? note : `${verdict.note} ${note}`,
  };
}

/** Scores pairs in batches of at most 256. Throws on any transport or shape failure. */
export async function scorePairs(
  config: RerankerConfig,
  pairs: readonly ClaimPair[],
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): Promise<readonly number[]> {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const scores: number[] = [];
  for (let at = 0; at < pairs.length; at += RERANKER_MAX_PAIRS) {
    const batch = pairs.slice(at, at + RERANKER_MAX_PAIRS);
    const response = await send(`${config.url}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairs: batch }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`reranker answered HTTP ${response.status}`);
    const body = await response.json() as { scores?: unknown };
    const got = body.scores;
    if (!Array.isArray(got) || got.length !== batch.length
      || !got.every((score) => typeof score === 'number' && Number.isFinite(score))) {
      throw new Error('reranker returned scores that do not match the request');
    }
    scores.push(...(got as number[]));
  }
  return scores;
}

/** Never throws. A failure is reported as an outcome and changes nothing. */
export async function verifyDraft(
  config: RerankerConfig,
  draft: string,
  passages: readonly string[],
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): Promise<VerifierOutcome> {
  const sentences = splitSentences(draft);
  if (sentences.length === 0 || passages.length === 0) {
    return { status: 'skipped', detail: 'no sentence or no evidence line to score' };
  }
  const pairs = sentences.flatMap((claim) => passages.map((passage) => ({ claim, passage })));
  try {
    const scores = await scorePairs(config, pairs, options);
    return { status: 'ok', judgement: judgeSentences(sentences, passages.length, scores, config.threshold), pairs: pairs.length };
  } catch (error) {
    return { status: 'unavailable', detail: error instanceof Error ? error.message : 'reranker failed' };
  }
}
