import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HydraClient } from '../hydra/client';
import { HydraError } from '../hydra/errors';
import type { Artifacts } from '../report/load';
import { ask, buildQuestion, MAX_TERM_CHARS, RetrievalError } from '../retrieval/index';
import { arenaPage } from '../view/arena';
import { askPage } from '../view/ask';
import { homePage, type CorpusFacts, type Example } from '../view/home';
import { hydradbPage } from '../view/hydradb';
import { integrationPage, type ServiceLimits } from '../view/integration';
import { CONTENT_SECURITY_POLICY, FAVICON } from '../view/layout';
import { noticePage, type Notice } from '../view/notice';
import type { NodeIdentity } from '../view/proof';
import { STYLESHEET } from '../view/style';
import { voicePage } from '../view/voice';
import { readState, RUNNING_STATE, VOICE_STATES, type VoiceState } from '../voice/states';
import { FixedWindow } from './ratelimit';

/**
 * The whole product surface: six pages, one stylesheet, one icon.
 *
 * Everything is a GET. There is no POST endpoint, no JSON body parser and no
 * upload path, so the entire input surface of this server is a URL, and the
 * only two fields in it are already length-capped, control-character-checked
 * and passed to the graph as bound parameters rather than as text. The reason
 * that is worth saying out loud is that the alternative shape for this product,
 * a chat box that posts free text to a model, would have had an input surface
 * nobody could describe in a sentence.
 *
 * Every page but the answer is rendered once at construction. Each is a pure
 * function of a seeded corpus, of a committed artifact file, of the limits this
 * server itself enforces, or of a transition table, and none of those can
 * change while the process runs. The voice page is rendered fourteen times for
 * the same reason, once per state, so a request for one of them is a lookup
 * rather than a render. Only the answer page depends on the request.
 */

/**
 * Well under the node's own ceiling, because a browser waiting on a page has
 * less patience than a script waiting on a benchmark. See DECISIONS.md D-024.
 */
export const QUERY_TIMEOUT_MS = 10_000;

/** A question that fits in this is longer than any name the corpus contains. */
export const MAX_URL_CHARS = 1_024;

export interface ServerOptions {
  readonly client: HydraClient;
  /** Namespace, graph and cell. Never the base URL and never the token. */
  readonly node: NodeIdentity;
  readonly examples: readonly Example[];
  readonly facts: CorpusFacts;
  /** The committed benchmark run and HydraDB capture, already parsed. */
  readonly artifacts: Artifacts;
  readonly limiter: FixedWindow;
  /** Injected so a test can drive the limiter without touching the clock. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const HTML = 'text/html; charset=utf-8';

/**
 * The same policy the pages carry in a meta element, plus the headers a meta
 * element cannot express. `frame-ancestors` already covers framing for anything
 * current; `x-frame-options` is here for the browsers where it does not.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

const CSS_BODY = Buffer.from(STYLESHEET, 'utf8');
const ICON_BODY = Buffer.from(FAVICON, 'utf8');

const NOTICES = {
  notFound: {
    code: 404,
    title: 'Not found',
    heading: 'There is no page here',
    lines: [
      'This server has six pages: the question form, the answer to one question, '
      + 'the benchmark, the database evidence, the interface and the voice surface. '
      + 'Anything else is a typed URL or a stale link.',
    ],
  },
  methodNotAllowed: {
    code: 405,
    title: 'Method not allowed',
    heading: 'This server only reads',
    lines: [
      'Every route here answers GET and HEAD and nothing else. Asking a question '
      + 'does not write to the graph, so nothing on this site needs a method that '
      + 'implies it might.',
    ],
  },
  uriTooLong: {
    code: 414,
    title: 'Request too long',
    heading: 'That URL is longer than any question',
    lines: [
      `The limit is ${MAX_URL_CHARS} characters. A subject and a predicate are capped `
      + 'at 200 characters each, so a request over the limit is not a question that '
      + 'was going to be answered anyway.',
    ],
  },
  missingTerms: {
    code: 400,
    title: 'Incomplete question',
    heading: 'A question needs a subject and a predicate',
    lines: [
      'Ask for a named thing and a property of it: subject "Meridian", predicate '
      + '"vendor". Add a via to follow one relation first, as in predicate "contact" '
      + 'via "vendor".',
    ],
  },
  badTerms: {
    code: 400,
    title: 'Question rejected',
    heading: 'That subject or predicate was not usable',
    lines: [
      'Each term has to be between 1 and 200 characters and contain no control '
      + 'characters. The submitted values are not repeated here, because a page that '
      + 'exists to quote a graph should not also quote whatever was typed at it.',
    ],
  },
  tooManyRequests: {
    code: 429,
    title: 'Too many requests',
    heading: 'Slow down',
    lines: [
      'This demo runs against a single graph node, so it is rate limited per source '
      + 'address. Wait a moment and ask again.',
    ],
  },
  upstream: {
    code: 502,
    title: 'Graph unreachable',
    heading: 'The graph did not answer',
    lines: [
      'The query never completed, so there is nothing to show. This page will not '
      + 'invent a result to fill the gap, which is the same rule the answer pages '
      + 'follow when the graph answers and the answer is nothing.',
      'If you are running this locally, the node is probably not up. '
      + 'See docs/HYDRADB_SETUP.md.',
    ],
  },
  internal: {
    code: 500,
    title: 'Server error',
    heading: 'Something here broke',
    lines: [
      'The failure is in this server rather than in the graph or in the request. '
      + 'The details are on the server console, not on this page.',
    ],
  },
} as const satisfies Record<string, Notice>;

type NoticeName = keyof typeof NOTICES;

/**
 * True for the errors `buildQuestion` raises about the submitted terms.
 *
 * The subclasses rename themselves, and they mean something different: a decode
 * or consistency failure is this server being wrong about the graph, and its
 * message can carry stored values. Those are 500s, not 400s.
 */
function isInputError(error: unknown): boolean {
  return error instanceof RetrievalError && error.name === 'RetrievalError';
}

/** A GET form submits an empty optional field as `via=`, which means no via. */
function optional(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value;
}

export function createHandler(options: ServerOptions): Handler {
  const { client, node, limiter } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const home = Buffer.from(
    homePage(options.examples, options.facts, options.artifacts.bench),
    'utf8',
  );
  const bench = Buffer.from(arenaPage(options.artifacts.bench), 'utf8');
  const database = Buffer.from(hydradbPage(options.artifacts.hydra, node), 'utf8');

  /**
   * The bounds the interface page prints, taken from the objects that apply
   * them rather than retyped, so the documented limit and the enforced one
   * cannot drift apart.
   */
  const limits: ServiceLimits = {
    termChars: MAX_TERM_CHARS,
    urlChars: MAX_URL_CHARS,
    queryTimeoutMs: QUERY_TIMEOUT_MS,
    rateLimit: limiter.limit,
    rateWindowMs: limiter.windowMs,
  };
  // Sorted by status, because the table is a list of codes rather than a record
  // of the order the routes happen to check them in.
  const statuses = Object.values(NOTICES).sort((left, right) => left.code - right.code);
  const contract = Buffer.from(integrationPage(limits, statuses), 'utf8');

  /*
   * Fourteen renders, once, because a state is not a request parameter so much
   * as a page of its own that happens to share a path. Rendering them here also
   * means the query string cannot reach a renderer: it is narrowed to one of
   * these keys or it is ignored.
   */
  const voices = new Map<VoiceState, Buffer>();
  for (const state of VOICE_STATES) {
    voices.set(state, Buffer.from(voicePage(state), 'utf8'));
  }

  const notices = new Map<NoticeName, Buffer>();
  for (const [name, notice] of Object.entries(NOTICES)) {
    notices.set(name as NoticeName, Buffer.from(noticePage(notice), 'utf8'));
  }

  function send(
    request: IncomingMessage,
    response: ServerResponse,
    status: number,
    type: string,
    body: Buffer,
    extra: Readonly<Record<string, string>> = {},
  ): void {
    response.writeHead(status, {
      ...SECURITY_HEADERS,
      'content-type': type,
      'content-length': body.byteLength,
      ...extra,
    });
    // A HEAD response carries the headers of the GET and none of its bytes.
    response.end(request.method === 'HEAD' ? undefined : body);
  }

  function notice(
    request: IncomingMessage,
    response: ServerResponse,
    name: NoticeName,
    extra: Readonly<Record<string, string>> = {},
  ): void {
    const page = notices.get(name)!;
    send(request, response, NOTICES[name].code, HTML, page, {
      'cache-control': 'no-store',
      ...extra,
    });
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (url.pathname === '/lacuna.css') {
      send(request, response, 200, 'text/css; charset=utf-8', CSS_BODY, {
        'cache-control': 'public, max-age=300',
      });
      return;
    }
    if (url.pathname === '/favicon.svg') {
      send(request, response, 200, 'image/svg+xml', ICON_BODY, {
        'cache-control': 'public, max-age=300',
      });
      return;
    }
    if (url.pathname === '/') {
      send(request, response, 200, HTML, home, { 'cache-control': 'no-store' });
      return;
    }
    if (url.pathname === '/bench') {
      send(request, response, 200, HTML, bench, { 'cache-control': 'no-store' });
      return;
    }
    if (url.pathname === '/hydradb') {
      send(request, response, 200, HTML, database, { 'cache-control': 'no-store' });
      return;
    }
    if (url.pathname === '/interface') {
      send(request, response, 200, HTML, contract, { 'cache-control': 'no-store' });
      return;
    }
    if (url.pathname === '/voice') {
      // An unrecognised state is the state this build is really in, rather than
      // an error page. Nothing from the query string is printed either way.
      const asked = readState(url.searchParams.get('state')) ?? RUNNING_STATE;
      send(request, response, 200, HTML, voices.get(asked)!, {
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname !== '/ask') {
      notice(request, response, 'notFound');
      return;
    }

    const subject = url.searchParams.get('subject');
    const predicate = url.searchParams.get('predicate');
    if (subject === null || predicate === null) {
      notice(request, response, 'missingTerms');
      return;
    }

    let question;
    try {
      question = buildQuestion(subject, predicate, optional(url.searchParams.get('via')));
    } catch (error) {
      if (!isInputError(error)) throw error;
      notice(request, response, 'badTerms');
      return;
    }

    const answer = await ask(client, question, { timeoutMs: QUERY_TIMEOUT_MS });
    send(request, response, 200, HTML, Buffer.from(askPage(answer, node), 'utf8'), {
      'cache-control': 'no-store',
    });
  }

  return (request: IncomingMessage, response: ServerResponse): void => {
    const started = now();
    // The source address as the socket reports it. A forwarded-for header is a
    // string the client chose, so it is not an identity and is not read here.
    const source = request.socket.remoteAddress ?? 'unknown';
    const target = request.url ?? '/';

    const done = (status: number, path: string): void => {
      // Method, path and timing. Not the query string: the two fields in it are
      // whatever was typed, and this console is going to be on screen.
      log(`${request.method ?? '-'} ${path} ${status} ${now() - started}ms`);
    };
    response.on('finish', () => {
      done(response.statusCode, safePath(target));
    });

    void (async (): Promise<void> => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          notice(request, response, 'methodNotAllowed', { allow: 'GET, HEAD' });
          return;
        }
        if (target.length > MAX_URL_CHARS) {
          notice(request, response, 'uriTooLong');
          return;
        }

        const verdict = limiter.check(source, now());
        if (!verdict.allowed) {
          notice(request, response, 'tooManyRequests', {
            'retry-after': String(verdict.retryAfterSeconds),
          });
          return;
        }

        await route(request, response, new URL(target, 'http://lacuna.invalid'));
      } catch (error) {
        const upstream = error instanceof HydraError;
        process.stderr.write(`request failed: ${describe(error)}\n`);
        if (response.headersSent) {
          response.end();
          return;
        }
        notice(request, response, upstream ? 'upstream' : 'internal');
      }
    })();
  };
}

/**
 * The path alone, printable, bounded.
 *
 * A log line is written to a terminal, and a terminal interprets escape
 * sequences, so a request target reaches this console with everything outside
 * printable ASCII replaced rather than passed through.
 */
function safePath(target: string): string {
  const cut = target.indexOf('?');
  const path = (cut === -1 ? target : target.slice(0, cut)).replace(/[^\x20-\x7e]/g, '?');
  return path.length > 120 ? `${path.slice(0, 119)}…` : path;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` <- ${error.cause.message}` : '';
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}
