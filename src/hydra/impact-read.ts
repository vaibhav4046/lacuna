import { CloudSource } from './cloud-source.js';
import type { FetchLike } from './client.js';
import type { HydraCloud } from './cloud.js';
import {
  HydraDecodeError,
  HydraGuardError,
  HydraTransportError,
} from './errors.js';
import type { Read } from './source.js';
import type { SubjectView } from '../retrieval/types.js';

export const IMPACT_QUERY_BODY_CAP = 1_048_576;
export const IMPACT_RELATIONS_BODY_CAP = 1_048_576;
export const IMPACT_SUBJECT_BODY_CAP = 524_288;

export interface HydraImpactReadControl {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
  readonly byteBudget: {
    consume(chunkBytes: number): void;
  };
}

export interface HydraImpactSubjectSource {
  readonly kind: 'node' | 'cloud';
  subjectForImpact(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<Read<SubjectView>>;
}

export interface HydraImpactChunk {
  readonly chunkId: string | null;
  readonly text: string;
  readonly score: number | null;
  readonly sourceIds: readonly string[];
  readonly sourceTitle: string | null;
  readonly sourceType: string | null;
  readonly observedAt: string | null;
}

export interface HydraImpactRelationOccurrence {
  readonly relationshipId: string | null;
  readonly source: string | null;
  readonly target: string | null;
  readonly predicate: string | null;
  readonly chunkId: string | null;
  readonly context: string | null;
}

export interface HydraImpactQuery {
  readonly chunks: readonly HydraImpactChunk[];
  readonly relations: readonly HydraImpactRelationOccurrence[];
}

export interface HydraImpactReadPort {
  queryForImpact(
    text: string,
    control: HydraImpactReadControl,
  ): Promise<HydraImpactQuery>;
  relationsForImpact(
    control: HydraImpactReadControl,
  ): Promise<readonly HydraImpactRelationOccurrence[]>;
  subjectForImpact(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<Read<SubjectView>>;
}

export interface ImpactJsonResponse {
  readonly body: unknown;
  readonly status: number;
  readonly ok: boolean;
  readonly latencyMs: number;
}

function signalLike(value: unknown): value is AbortSignal {
  return typeof value === 'object'
    && value !== null
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
    && typeof (value as AbortSignal).removeEventListener === 'function';
}

export function assertImpactControl(
  value: unknown,
): asserts value is HydraImpactReadControl {
  if (typeof value !== 'object' || value === null) {
    throw new HydraGuardError('impact read control is required');
  }
  const control = value as Partial<HydraImpactReadControl>;
  if (!signalLike(control.signal)
    || typeof control.deadlineMs !== 'number'
    || !Number.isFinite(control.deadlineMs)
    || typeof control.byteBudget !== 'object'
    || control.byteBudget === null
    || typeof control.byteBudget.consume !== 'function') {
    throw new HydraGuardError('impact read control is invalid');
  }
}

export function assertImpactActive(control: HydraImpactReadControl): void {
  assertImpactControl(control);
  if (control.signal.aborted) {
    throw new HydraTransportError('impact read was cancelled');
  }
  if (control.deadlineMs <= Date.now()) {
    throw new HydraTransportError('impact read exceeded its deadline');
  }
}

/**
 * The impact path is deliberately stricter than the legacy clients. JSON.parse
 * silently keeps the last duplicate key, which turns an ambiguous provider
 * response into a plausible one. This grammar pass rejects duplicates by the
 * decoded key while also validating the complete JSON token stream.
 */
export function parseImpactJson(text: string): unknown {
  try {
    new StrictJsonScanner(text).scan();
    return JSON.parse(text) as unknown;
  } catch (cause) {
    if (cause instanceof HydraDecodeError) throw cause;
    throw new HydraDecodeError('impact response body is not strict JSON', { cause });
  }
}

function isScalarJsonString(value: string): boolean {
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(at + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      at += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

class StrictJsonScanner {
  readonly #text: string;
  #at = 0;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): void {
    this.#space();
    this.#value();
    this.#space();
    if (this.#at !== this.#text.length) this.#fail();
  }

  #space(): void {
    while (this.#at < this.#text.length
      && (this.#text[this.#at] === ' '
        || this.#text[this.#at] === '\n'
        || this.#text[this.#at] === '\r'
        || this.#text[this.#at] === '\t')) this.#at += 1;
  }

  #value(): void {
    const token = this.#text[this.#at];
    if (token === '{') this.#object();
    else if (token === '[') this.#array();
    else if (token === '"') void this.#string();
    else if (token === 't') this.#literal('true');
    else if (token === 'f') this.#literal('false');
    else if (token === 'n') this.#literal('null');
    else this.#number();
  }

  #object(): void {
    this.#at += 1;
    this.#space();
    if (this.#text[this.#at] === '}') {
      this.#at += 1;
      return;
    }
    const keys = new Set<string>();
    for (;;) {
      if (this.#text[this.#at] !== '"') this.#fail();
      const key = this.#string();
      if (keys.has(key)) {
        throw new HydraDecodeError('impact response contains a duplicate object key');
      }
      keys.add(key);
      this.#space();
      if (this.#text[this.#at] !== ':') this.#fail();
      this.#at += 1;
      this.#space();
      this.#value();
      this.#space();
      const next = this.#text[this.#at];
      if (next === '}') {
        this.#at += 1;
        return;
      }
      if (next !== ',') this.#fail();
      this.#at += 1;
      this.#space();
    }
  }

  #array(): void {
    this.#at += 1;
    this.#space();
    if (this.#text[this.#at] === ']') {
      this.#at += 1;
      return;
    }
    for (;;) {
      this.#value();
      this.#space();
      const next = this.#text[this.#at];
      if (next === ']') {
        this.#at += 1;
        return;
      }
      if (next !== ',') this.#fail();
      this.#at += 1;
      this.#space();
    }
  }

  #string(): string {
    const start = this.#at;
    this.#at += 1;
    while (this.#at < this.#text.length) {
      const code = this.#text.charCodeAt(this.#at);
      if (code === 0x22) {
        this.#at += 1;
        const decoded = JSON.parse(this.#text.slice(start, this.#at)) as string;
        if (!isScalarJsonString(decoded)) {
          throw new HydraDecodeError('impact response contains a non-scalar string');
        }
        return decoded;
      }
      if (code < 0x20) this.#fail();
      if (code === 0x5c) {
        this.#at += 1;
        const escaped = this.#text[this.#at];
        if (escaped === 'u') {
          const hex = this.#text.slice(this.#at + 1, this.#at + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.#fail();
          this.#at += 5;
          continue;
        }
        if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) this.#fail();
      }
      this.#at += 1;
    }
    this.#fail();
  }

  #literal(value: string): void {
    if (this.#text.slice(this.#at, this.#at + value.length) !== value) this.#fail();
    this.#at += value.length;
  }

  #number(): void {
    const rest = this.#text.slice(this.#at);
    const found = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (found === null) this.#fail();
    this.#at += found[0].length;
  }

  #fail(): never {
    throw new HydraDecodeError('impact response body is not strict JSON');
  }
}

async function readImpactBody(
  response: Response,
  cap: number,
  control: HydraImpactReadControl,
  requestSignal: AbortSignal,
): Promise<string> {
  if (response.body === null) {
    assertImpactExchangeActive(control, requestSignal);
    return '';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortReject!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { abortReject = reject; });
  const onAbort = () => {
    // Reject the read race immediately. A hostile or broken stream is allowed
    // to leave `reader.cancel()` pending; cancellation cleanup must never hold
    // the request open past its caller/deadline abort.
    abortReject(new HydraTransportError('impact response was cancelled'));
    void reader.cancel().catch(() => undefined);
  };
  requestSignal.addEventListener('abort', onAbort, { once: true });
  try {
    if (requestSignal.aborted || control.signal.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new HydraTransportError('impact response was cancelled');
    }
    for (;;) {
      const entry = await Promise.race([reader.read(), aborted]);
      if (entry.done) break;
      const chunk = entry.value;
      if (chunk === undefined) continue;
      if (total + chunk.byteLength > cap) {
        await reader.cancel().catch(() => undefined);
        throw new HydraTransportError(`impact response exceeded its ${cap} byte cap`);
      }
      try {
        control.byteBudget.consume(chunk.byteLength);
      } catch (cause) {
        await reader.cancel().catch(() => undefined);
        if (cause instanceof HydraTransportError) throw cause;
        throw new HydraTransportError('impact aggregate byte budget was exceeded', { cause });
      }
      total += chunk.byteLength;
      chunks.push(chunk);
    }
    if (requestSignal.aborted || control.signal.aborted) {
      throw new HydraTransportError('impact response was cancelled');
    }
  } catch (cause) {
    if (cause instanceof HydraTransportError) throw cause;
    if (requestSignal.aborted || control.signal.aborted) {
      throw new HydraTransportError('impact response was cancelled', { cause });
    }
    throw new HydraTransportError('impact response stream failed', { cause });
  } finally {
    requestSignal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch (cause) {
    throw new HydraDecodeError('impact response is not valid UTF-8', { cause });
  }
}

function assertImpactExchangeActive(
  control: HydraImpactReadControl,
  requestSignal: AbortSignal,
): void {
  if (requestSignal.aborted || control.signal.aborted) {
    throw new HydraTransportError('impact response was cancelled');
  }
  assertImpactActive(control);
}

export async function sendImpactJson(
  fetcher: FetchLike,
  input: string,
  init: RequestInit,
  control: HydraImpactReadControl,
  cap: number,
): Promise<ImpactJsonResponse> {
  assertImpactActive(control);
  if (!Number.isSafeInteger(cap) || cap <= 0) {
    throw new HydraGuardError('impact response cap is invalid');
  }

  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  control.signal.addEventListener('abort', relayAbort, { once: true });
  const remaining = control.deadlineMs - Date.now();
  const timer = setTimeout(() => controller.abort(), remaining);
  const started = performance.now();
  try {
    let response: Response;
    try {
      response = await fetcher(input, { ...init, signal: controller.signal });
    } catch (cause) {
      throw new HydraTransportError(
        controller.signal.aborted
          ? 'impact request was cancelled or exceeded its deadline'
          : 'impact request failed before a response arrived',
        { cause },
      );
    }
    const text = await readImpactBody(response, cap, control, controller.signal);
    let body: unknown = null;
    if (text.trim() !== '') body = parseImpactJson(text);
    assertImpactExchangeActive(control, controller.signal);
    return {
      body,
      status: response.status,
      ok: response.ok,
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
    control.signal.removeEventListener('abort', relayAbort);
  }
}

export function createCloudImpactReadPort(
  scopedCloud: HydraCloud,
): HydraImpactReadPort {
  const source = new CloudSource(scopedCloud);
  return {
    queryForImpact: (text, control) => scopedCloud.queryForImpact(text, control),
    relationsForImpact: (control) => scopedCloud.relationsForImpact(control),
    subjectForImpact: (name, control) => source.subjectForImpact(name, control),
  };
}
