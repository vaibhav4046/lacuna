import { describe, expect, it } from 'vitest';

import { HydraClient } from '../../src/hydra/client';
import type { HydraConfig } from '../../src/hydra/config';
import { ask } from '../../src/retrieval/fetch';
import { resolve } from '../../src/retrieval/resolve';
import type {
  ClaimRecord,
  Resolution,
  SubgraphView,
  SubjectView,
} from '../../src/retrieval/types';
import { askPage } from '../../src/view/ask';
import type { NodeIdentity } from '../../src/view/proof';
import { FORBIDDEN_IN_MARKUP, INJECTIONS } from '../support/injection';

/**
 * T1 from docs/THREAT_MODEL.md: an instruction stored as if it were a fact.
 *
 * The threat model claims two mitigations, and they fail differently, so they
 * are tested separately.
 *
 * The first is that stored content is never treated as an instruction, because
 * nothing in the retrieval path is a model deciding what to do next. The test
 * for that is invariance rather than a list of forbidden outputs: take a
 * subgraph, resolve it, then append a payload to every free-text field in it and
 * resolve again. Strip the payload back out of the second result and the two
 * must be identical, down to the trace. Appending is the right perturbation
 * because it is injective, so every `Set` the resolver builds keeps exactly the
 * cardinality it had, and any change in the verdict is the resolver reacting to
 * what the text says rather than to the shape of the graph.
 *
 * Free text means `name`, `kind`, `objectText` and `entityName`. Predicates and
 * ids are deliberately left alone: predicates are matched for equality and
 * perturbing them tests string comparison rather than injection, and the hop
 * asserts the view's bridge id against the one it selected, so moving an id
 * raises `RetrievalConsistencyError` instead of an answer.
 *
 * The second mitigation is that evidence renders as text and never as markup.
 * That is exercised end to end, from a wire response through decode, resolve
 * and render, over a real `HydraClient` given a fake `fetch`. Faking at the
 * transport rather than at the client keeps the decoder and its guards in the
 * path; the HTTP layer above it already has its own suite in
 * server-routes.test.ts and is not duplicated here.
 */

// --- invariance of the decision --------------------------------------------

function claim(
  id: number,
  predicate: string,
  objectText: string,
  extra: {
    polarity?: ClaimRecord['polarity'];
    validFrom?: string;
    supersededBy?: readonly number[];
  } = {},
): ClaimRecord {
  return {
    id,
    predicate,
    objectText,
    polarity: extra.polarity ?? 'positive',
    validFrom: extra.validFrom ?? '2026-03-01',
    txTime: `2026-03-01T09:00:0${id % 10}Z`,
    supersededBy: extra.supersededBy ?? [],
  };
}

/**
 * Twelve subgraphs, one per branch the resolver can take.
 *
 * Built by a function rather than held as constants so each case resolves a
 * fresh object and no test can be affected by an earlier one.
 */
const SCENARIOS: ReadonlyArray<{ name: string; view: () => SubgraphView }> = [
  {
    name: 'one claim, answered',
    view: () => ({
      question: { subject: 'Junco', predicate: 'launch_date', via: null },
      subject: {
        name: 'Junco',
        id: 100,
        kind: 'project',
        claims: [claim(1, 'launch_date', '12 June 2026')],
        mentions: [],
      },
      bridge: null,
    }),
  },
  {
    name: 'answered from the claim that superseded another',
    view: () => ({
      question: { subject: 'Junco', predicate: 'launch_date', via: null },
      subject: {
        name: 'Junco',
        id: 100,
        kind: 'project',
        claims: [
          claim(1, 'launch_date', '12 June 2026', { supersededBy: [2] }),
          claim(2, 'launch_date', '25 July 2026', { validFrom: '2026-05-01' }),
        ],
        mentions: [],
      },
      bridge: null,
    }),
  },
  {
    name: 'the entity exists but never states this predicate',
    view: () => ({
      question: { subject: 'Junco', predicate: 'launch_date', via: null },
      subject: {
        name: 'Junco',
        id: 100,
        kind: 'project',
        claims: [claim(1, 'owner', 'Priya')],
        mentions: [],
      },
      bridge: null,
    }),
  },
  {
    name: 'no such entity',
    view: () => ({
      question: { subject: 'Nonesuch', predicate: 'launch_date', via: null },
      subject: { name: 'Nonesuch', id: null, kind: null, claims: [], mentions: [] },
      bridge: null,
    }),
  },
  {
    name: 'the current claim withdraws the value',
    view: () => ({
      question: { subject: 'Junco', predicate: 'launch_date', via: null },
      subject: {
        name: 'Junco',
        id: 100,
        kind: 'project',
        claims: [
          claim(1, 'launch_date', '12 June 2026', { supersededBy: [2] }),
          claim(2, 'launch_date', '12 June 2026', {
            polarity: 'negative',
            validFrom: '2026-05-01',
          }),
        ],
        mentions: [],
      },
      bridge: null,
    }),
  },
  {
    name: 'every claim superseded, nothing left standing',
    view: () => ({
      question: { subject: 'Junco', predicate: 'launch_date', via: null },
      subject: {
        name: 'Junco',
        id: 100,
        kind: 'project',
        claims: [claim(1, 'launch_date', '12 June 2026', { supersededBy: [9] })],
        mentions: [],
      },
      bridge: null,
    }),
  },
  {
    name: 'two current claims disagree',
    view: () => ({
      question: { subject: 'Junco', predicate: 'launch_date', via: null },
      subject: {
        name: 'Junco',
        id: 100,
        kind: 'project',
        claims: [
          claim(1, 'launch_date', '12 June 2026'),
          claim(2, 'launch_date', '25 July 2026', { validFrom: '2026-05-01' }),
        ],
        mentions: [],
      },
      bridge: null,
    }),
  },
  {
    name: 'answered across a hop',
    view: () => ({
      question: { subject: 'replay-queue', predicate: 'contact', via: 'vendor' },
      subject: {
        name: 'replay-queue',
        id: 100,
        kind: 'service',
        claims: [claim(1, 'vendor', 'Northwind')],
        mentions: [{ claimId: 1, predicate: 'vendor', entityId: 200, entityName: 'Northwind' }],
      },
      bridge: {
        name: 'Northwind',
        id: 200,
        kind: 'vendor',
        claims: [claim(5, 'contact', 'Dana Okafor')],
        mentions: [],
      },
    }),
  },
  {
    name: 'the hop lands, and the far entity never states the predicate',
    view: () => ({
      question: { subject: 'replay-queue', predicate: 'contact', via: 'vendor' },
      subject: {
        name: 'replay-queue',
        id: 100,
        kind: 'service',
        claims: [claim(1, 'vendor', 'Northwind')],
        mentions: [{ claimId: 1, predicate: 'vendor', entityId: 200, entityName: 'Northwind' }],
      },
      bridge: {
        name: 'Northwind',
        id: 200,
        kind: 'vendor',
        claims: [claim(5, 'address', '12 Mill Lane')],
        mentions: [],
      },
    }),
  },
  {
    name: 'the hop is ambiguous',
    view: () => ({
      question: { subject: 'replay-queue', predicate: 'contact', via: 'vendor' },
      subject: {
        name: 'replay-queue',
        id: 100,
        kind: 'service',
        claims: [
          claim(1, 'vendor', 'Northwind'),
          claim(2, 'vendor', 'Halcyon', { validFrom: '2026-04-01' }),
        ],
        mentions: [
          { claimId: 1, predicate: 'vendor', entityId: 200, entityName: 'Northwind' },
          { claimId: 2, predicate: 'vendor', entityId: 300, entityName: 'Halcyon' },
        ],
      },
      bridge: null,
    }),
  },
  {
    name: 'the hop was withdrawn',
    view: () => ({
      question: { subject: 'replay-queue', predicate: 'contact', via: 'vendor' },
      subject: {
        name: 'replay-queue',
        id: 100,
        kind: 'service',
        claims: [claim(1, 'vendor', 'Northwind', { supersededBy: [9] })],
        mentions: [{ claimId: 1, predicate: 'vendor', entityId: 200, entityName: 'Northwind' }],
      },
      bridge: null,
    }),
  },
  {
    name: 'nothing states the hop predicate at all',
    view: () => ({
      question: { subject: 'replay-queue', predicate: 'contact', via: 'vendor' },
      subject: {
        name: 'replay-queue',
        id: 100,
        kind: 'service',
        claims: [claim(1, 'owner', 'Priya')],
        mentions: [],
      },
      bridge: null,
    }),
  },
];

/** Appends the payload to every free-text field, and to nothing else. */
function injectSubject(view: SubjectView, payload: string): SubjectView {
  return {
    name: view.name + payload,
    id: view.id,
    kind: view.kind === null ? null : view.kind + payload,
    claims: view.claims.map((c) => ({ ...c, objectText: c.objectText + payload })),
    mentions: view.mentions.map((m) => ({ ...m, entityName: m.entityName + payload })),
  };
}

function inject(view: SubgraphView, payload: string): SubgraphView {
  return {
    question: { ...view.question, subject: view.question.subject + payload },
    subject: injectSubject(view.subject, payload),
    bridge: view.bridge === null ? null : injectSubject(view.bridge, payload),
  };
}

/**
 * Removes every occurrence of the payload from every string in a structure.
 *
 * A JSON round trip would be shorter and wrong: two of the payloads contain a
 * double quote, which `JSON.stringify` escapes, so the raw payload would no
 * longer match its own stringified form. Splitting on the literal avoids that
 * and avoids regex escaping at the same time.
 */
function stripDeep<T>(value: T, payload: string): T {
  if (typeof value === 'string') return value.split(payload).join('') as T;
  if (Array.isArray(value)) return value.map((v) => stripDeep(v, payload)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripDeep(v, payload)]),
    ) as T;
  }
  return value;
}

function containsDeep(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (Array.isArray(value)) return value.some((v) => containsDeep(v, needle));
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((v) => containsDeep(v, needle));
  }
  return false;
}

function sameOutcome(dirty: Resolution, clean: Resolution): void {
  expect(dirty.outcome.type).toBe(clean.outcome.type);
  if (clean.outcome.type === 'abstain' && dirty.outcome.type === 'abstain') {
    expect(dirty.outcome.reason).toBe(clean.outcome.reason);
  }
  if (clean.outcome.type === 'answer' && dirty.outcome.type === 'answer') {
    expect(dirty.outcome.claimId).toBe(clean.outcome.claimId);
  }
}

describe('an instruction stored as a fact changes no decision', () => {
  for (const scenario of SCENARIOS) {
    for (const injection of INJECTIONS) {
      it(`${scenario.name}, given ${injection.name}`, () => {
        const clean = resolve(scenario.view());
        const dirty = resolve(inject(scenario.view(), injection.payload));

        // Stripping only means something if the payload was not already part of
        // the clean result, and the injection only means something if it
        // reached the output at all. Both hold, so the comparison below is
        // between a perturbed result and its own unperturbed twin.
        expect(containsDeep(clean, injection.payload)).toBe(false);
        expect(dirty).not.toEqual(clean);

        sameOutcome(dirty, clean);
        expect(stripDeep(dirty, injection.payload)).toEqual(clean);
      });
    }
  }

  it('and those scenarios reach every abstention the resolver can give', () => {
    const reasons = new Set<string>();
    let answered = 0;
    for (const scenario of SCENARIOS) {
      const outcome = resolve(scenario.view()).outcome;
      if (outcome.type === 'abstain') reasons.add(outcome.reason);
      else answered += 1;
    }

    // Asserted rather than assumed. Without this, a fixture that quietly took a
    // different branch than intended would still pass every test above, and the
    // suite would be claiming coverage it does not have.
    expect([...reasons].sort()).toEqual([
      'contradicted',
      'never_stated',
      'out_of_scope',
      'retracted',
      'unconnected',
    ]);
    expect(answered).toBe(3);
  });
});

// --- invariance of the page ------------------------------------------------

const CONFIG: HydraConfig = {
  baseUrl: 'http://127.0.0.1:18443',
  namespace: 'test-namespace',
  graph: 'default',
  cell: 'cell-0',
  token: 'token-that-must-never-be-rendered',
};

const NODE: NodeIdentity = {
  namespace: CONFIG.namespace,
  graph: CONFIG.graph,
  cell: CONFIG.cell,
};

const str = (value: string) => ({ type: 'string', value });
const num = (value: number) => ({ type: 'integer', value });
const vid = (value: number) => ({ type: 'vertex_id', value });
const nil = () => ({ type: 'null' });

function wire(columns: readonly string[], rows: readonly unknown[][]): Response {
  return new Response(
    JSON.stringify({
      query_id: 'injection-suite',
      columns,
      rows,
      read_epoch: 11,
      next_cursor: null,
      bookmark: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/**
 * A graph in which the payload is stored three times over.
 *
 * On a superseded claim whose text tells the reader to disregard the
 * `SUPERSEDES` edge, on the quotation that supports the live claim, and on the
 * title of the session that quotation came from. The first is the interesting
 * one: it is the only thing on the page arguing for its own answer, and it is
 * not cited, so it has to arrive through the timeline as history and lose.
 */
function upstreamFor(payload: string, unexpected: string[]) {
  return (_input: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body ?? '{}')) as {
      query: string;
      parameters?: Record<string, unknown>;
    };
    const parameters = body.parameters ?? {};

    if ('name' in parameters) {
      return Promise.resolve(wire(['id', 'kind'], [[vid(100), str('project')]]));
    }
    if ('e' in parameters) {
      if (body.query.includes('MENTIONS')) {
        return Promise.resolve(wire(['claim', 'predicate', 'other', 'other_name'], []));
      }
      return Promise.resolve(wire(
        ['id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time', 'superseded_by'],
        [
          [
            vid(1), str('launch_date'), str(`12 June 2026. ${payload}`), str('positive'),
            str('2026-03-01'), str('2026-03-01T09:00:00Z'), vid(2),
          ],
          [
            vid(2), str('launch_date'), str('25 July 2026'), str('positive'),
            str('2026-05-01'), str('2026-05-01T14:00:00Z'), nil(),
          ],
        ],
      ));
    }
    if ('c' in parameters) {
      const quote = `Moving it to 25 July 2026. ${payload}`;
      return Promise.resolve(wire(
        ['span', 'quote', 'start', 'end_offset', 'message', 'role', 'ts', 'session', 'title'],
        [[
          vid(500), str(quote), num(0), num(quote.length), vid(400), str('user'),
          str('2026-05-01T14:00:00Z'), vid(300), str(`Planning sync. ${payload}`),
        ]],
      ));
    }

    unexpected.push(body.query);
    return Promise.resolve(wire([], []));
  };
}

/**
 * The encoding this suite expects, written out rather than imported.
 *
 * `src/view/html.ts` exports an `escape` that does this, and using it here would
 * be shorter and would quietly weaken every assertion below: a test that asks
 * the code under test what to expect agrees with it by construction. Replacing
 * `escape` with the identity function was caught by three payloads and silently
 * tolerated by a fourth for exactly that reason, until this was written out.
 */
const EXPECTED_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

function expectedEncoding(text: string): string {
  return text.replace(/[&<>"']/g, (character) => EXPECTED_ESCAPES.get(character)!);
}

function assertRendersAsText(page: string, payload: string): void {
  for (const forbidden of FORBIDDEN_IN_MARKUP) {
    expect(page).not.toContain(forbidden);
  }
  expect(page).toContain(expectedEncoding(payload));

  // The forbidden list is a set of named constructs, and a payload can carry a
  // bare quote without matching any of them: the Cypher one does exactly that.
  // So also require that anything with a character worth escaping is absent in
  // its raw form. Conditional because a payload of plain prose encodes to
  // itself, and appearing on the page verbatim is then the correct behaviour
  // rather than a leak.
  if (expectedEncoding(payload) !== payload) {
    expect(page).not.toContain(payload);
  }
  expect(page).not.toContain(CONFIG.token);
}

describe('an instruction stored as a fact reaches the page as text', () => {
  for (const injection of INJECTIONS) {
    it(`renders ${injection.name} escaped, and still answers from the live claim`, async () => {
      const unexpected: string[] = [];
      const client = new HydraClient(CONFIG, { fetch: upstreamFor(injection.payload, unexpected) });
      const answer = await ask(client, {
        subject: 'Junco',
        predicate: 'launch_date',
        via: null,
      });

      expect(unexpected).toEqual([]);
      expect(answer.resolution.outcome).toEqual({
        type: 'answer',
        claimId: 2,
        text: '25 July 2026',
      });

      const page = askPage(answer, NODE);
      assertRendersAsText(page, injection.payload);
      expect(page).toContain('25 July 2026');
    });
  }

  for (const injection of INJECTIONS) {
    it(`renders ${injection.name} escaped when it is the question itself`, async () => {
      const unexpected: string[] = [];
      const client = new HydraClient(CONFIG, {
        fetch: () => Promise.resolve(wire(['id', 'kind'], [])),
      });
      const answer = await ask(client, {
        subject: `Junco ${injection.payload}`,
        predicate: 'launch_date',
        via: null,
      });

      expect(unexpected).toEqual([]);
      expect(answer.resolution.outcome).toEqual({ type: 'abstain', reason: 'out_of_scope' });

      assertRendersAsText(askPage(answer, NODE), injection.payload);
    });
  }
});
