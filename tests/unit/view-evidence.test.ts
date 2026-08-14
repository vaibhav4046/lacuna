import { describe, expect, it } from 'vitest';

import { ABSTENTION_REASONS, explainAbstention } from '../../src/model/abstention.js';
import { lacuna, tiedWithLacuna } from '../../src/report/bench.js';
import { loadArtifacts } from '../../src/report/load.js';
import { shortCommit } from '../../src/report/provenance.js';
import {
  claimsAbout,
  contradictionPartners,
  entityByName,
  evidenceForClaim,
  mentionsFrom,
  supersededByClaim,
} from '../../src/retrieval/queries.js';
import { arenaPage } from '../../src/view/arena.js';
import { roundMs } from '../../src/view/format.js';
import { escape } from '../../src/view/html.js';
import { hydradbPage } from '../../src/view/hydradb.js';
import { integrationPage, type ServiceLimits } from '../../src/view/integration.js';
import { META_CONTENT_SECURITY_POLICY } from '../../src/view/layout.js';
import type { Notice } from '../../src/view/notice.js';
import type { NodeIdentity } from '../../src/view/proof.js';
import { markedPages } from '../support/markup.js';

/**
 * The three evidence pages, rendered from the files that actually ship.
 *
 * These pages exist to be checked, so a test that rendered them from fixtures
 * would be testing the wrong thing. `loadArtifacts()` reads the committed
 * `artifacts/` tree, which is the same call the server makes at start up, and
 * every assertion below is either a property of the run or a claim the prose
 * makes about the run. The point is that a re-measured artifact cannot quietly
 * turn a sentence on one of these pages into a lie: it has to fail here first.
 *
 * Three of the assertions are load bearing in that specific sense. The
 * benchmark page says Lacuna is "the slowest here" and that the tie is broken
 * on context size, and both of those are checked against the numbers rather
 * than taken on trust. The database page prints Cypher by calling the same
 * functions the retriever calls, so the check is that the printed text matches
 * what those functions return today. And the interface page prints limits it
 * was handed, so it is rendered here with limits no server uses, which is the
 * only way to tell a printed argument apart from a printed constant.
 */

const ARTIFACTS = loadArtifacts();
const REPORT = ARTIFACTS.bench;

const NODE: NodeIdentity = {
  namespace: 'tenant-a',
  graph: 'default',
  cell: 'cell-0',
};

/**
 * Deliberately not the limits any server configures.
 *
 * If the page printed its own constants instead of these arguments, every
 * number below would still look plausible on screen and the test would still
 * pass with the real values substituted. Odd values are what make the
 * substitution visible.
 */
const LIMITS: ServiceLimits = {
  termChars: 217,
  urlChars: 1_303,
  queryTimeoutMs: 7_919,
  rateLimit: 43,
  rateWindowMs: 11_000,
};

/** Codes and titles no route emits, for the same reason as the limits above. */
const NOTICES: readonly Notice[] = [
  {
    code: 451,
    title: 'Withheld',
    heading: 'A heading that exists only in this test',
    lines: ['One line.'],
  },
  {
    code: 418,
    title: 'Teapot',
    heading: 'A second heading that exists only in this test',
    lines: ['Another line.'],
  },
];

const ARENA = arenaPage(REPORT);
const DATABASE = hydradbPage(ARTIFACTS.hydra, NODE);
const INTERFACE = integrationPage(LIMITS, NOTICES);

/** Each page, and the route the bar should be marking while you read it. */
const PAGES: readonly (readonly [string, string, string])[] = [
  ['the benchmark page', ARENA, '/bench'],
  ['the database page', DATABASE, '/hydradb'],
  ['the interface page', INTERFACE, '/interface'],
];

const QUERIES = [
  entityByName('Meridian'),
  claimsAbout(1),
  mentionsFrom(1),
  evidenceForClaim(2),
  contradictionPartners(2),
  supersededByClaim(2),
] as const;

describe('the benchmark page', () => {
  it('reads a run that records Lacuna, or the rest of this file means nothing', () => {
    expect(lacuna(REPORT)).toBeDefined();
  });

  it('states the tie and names every configuration that matched', () => {
    const tied = tiedWithLacuna(REPORT);
    expect(tied.length).toBeGreaterThan(0);

    expect(ARENA).toContain('Correctness is a tie');
    for (const system of tied) {
      expect(ARENA).toContain(escape(system.label));
    }
  });

  it('is entitled to call itself the slowest system in the run', () => {
    const ours = lacuna(REPORT)!;
    const slowest = Math.max(...REPORT.systems.map((system) => system.p50Ms));

    // The tally caption reads "median, and the slowest here". It is the one
    // line on the page that admits the cost, so it is also the one line worth
    // failing a build over if a future run makes it flattering by accident.
    expect(ours.p50Ms).toBe(slowest);
    expect(ARENA).toContain('median, and the slowest here');
  });

  it('is entitled to the headline it puts on the tie', () => {
    const ours = lacuna(REPORT)!;

    // "Same answers, less text" is only true if the systems that matched the
    // answers all carried more text.
    for (const system of tiedWithLacuna(REPORT)) {
      expect(system.meanEstimatedTokens).toBeGreaterThan(ours.meanEstimatedTokens);
    }
    expect(ARENA).toContain('Same answers, less text');
  });

  it('computes the context ratio rather than printing a remembered one', () => {
    const ours = lacuna(REPORT)!;

    for (const system of tiedWithLacuna(REPORT)) {
      const ratio = roundMs(system.meanEstimatedTokens / ours.meanEstimatedTokens);
      expect(ARENA).toContain(`${ratio}x`);
    }
  });

  it('carries every configuration in the run into the full table', () => {
    for (const system of REPORT.systems) {
      expect(ARENA).toContain(escape(system.label));
    }
  });

  it('keeps the two counts spelled out in its prose true of the run', () => {
    const ours = lacuna(REPORT)!;

    // The opening paragraph writes both of these as words, and words do not
    // interpolate. Nothing else stands between a re-run with a different sweep
    // and a page that is wrong in its first sentence.
    expect(ARENA).toContain('Sixty questions');
    expect(ours.total).toBe(60);
    expect(ARENA).toContain('fifty one');
    expect(REPORT.systems.length).toBe(51);
  });

  it('prints the seed and the run time it was built from', () => {
    expect(ARENA).toContain(escape(REPORT.seed));
    expect(ARENA).toContain(escape(REPORT.runAt));
  });
});

describe('the database page', () => {
  it('prints the commit that was built, in full and abbreviated', () => {
    const { provenance } = ARTIFACTS.hydra;

    expect(DATABASE).toContain(provenance.commit);
    expect(DATABASE).toContain(shortCommit(provenance));
    expect(provenance.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('prints the version and compiler the node reported', () => {
    const { provenance } = ARTIFACTS.hydra;

    expect(DATABASE).toContain(escape(provenance.describe));
    expect(DATABASE).toContain(escape(provenance.rustc));
  });

  it('prints every query the retrieval layer can issue', () => {
    for (const query of QUERIES) {
      // The renderer escapes, so a pattern containing an arrow reaches the page
      // as &gt; and a raw substring match would miss it. Escaping the
      // expectation is what makes this a check on the query and not on Cypher
      // punctuation.
      expect(DATABASE).toContain(escape(query.cypher));
    }
  });

  it('shows values arriving as bound parameters rather than as statement text', () => {
    const resolve = entityByName('Meridian');

    expect(resolve.cypher).not.toContain('Meridian');
    expect(resolve.cypher).toContain('$name');
    expect(DATABASE).toContain('$name');
    expect(DATABASE).toContain('$e');
    expect(DATABASE).toContain('$c');
  });

  it('names GraphBLAS only to say it is not claimed', () => {
    expect(DATABASE).toContain('GraphBLAS');
    expect(DATABASE).toContain('has not proven it runs on one');
  });

  it('carries no base URL, no port and no credential', () => {
    // The evidence files are node output, so this is a real risk rather than a
    // hypothetical one: a recapture that included a request line would put the
    // address of the node on a public page.
    expect(DATABASE).not.toContain('Bearer');
    expect(DATABASE).not.toContain('http://');
    expect(DATABASE).not.toContain('18443');
    expect(DATABASE).not.toContain('19091');
  });

  it('prints the node it was told about', () => {
    expect(DATABASE).toContain(NODE.namespace);
    expect(DATABASE).toContain(NODE.graph);
    expect(DATABASE).toContain(NODE.cell);
  });
});

describe('the interface page', () => {
  it('prints the limits it was handed rather than limits of its own', () => {
    expect(INTERFACE).toContain(`capped at ${LIMITS.termChars} characters`);
    expect(INTERFACE).toContain(`capped at ${LIMITS.urlChars} characters`);
    expect(INTERFACE).toContain(`${LIMITS.queryTimeoutMs} ms`);
    expect(INTERFACE).toContain(`${LIMITS.rateLimit} per`);
    expect(INTERFACE).toContain(`${LIMITS.rateWindowMs / 1_000} s per address`);
  });

  it('lists all five abstentions with the explanation the model gives', () => {
    for (const reason of ABSTENTION_REASONS) {
      expect(INTERFACE).toContain(reason);
      expect(INTERFACE).toContain(escape(explainAbstention(reason)));
    }
    expect(ABSTENTION_REASONS.length).toBe(5);
  });

  it('lists every refusal it was handed, and the answer row above them', () => {
    for (const notice of NOTICES) {
      expect(INTERFACE).toContain(String(notice.code));
      expect(INTERFACE).toContain(notice.title);
      expect(INTERFACE).toContain(notice.heading);
    }
    expect(INTERFACE).toContain('>200<');
  });

  it('states that the forwarded-for header is not read', () => {
    // The rate limiter keys on the socket address. A page that documented the
    // header as trusted would be describing a different, worse server.
    expect(INTERFACE).toContain('A forwarded-for header is a string the client chose');
  });
});

describe('every evidence page', () => {
  for (const [name, body, current] of PAGES) {
    it(`carries no script or style element, on ${name}`, () => {
      // D-041. Escaping is only correct outside raw text elements, and the
      // renderer has no way to opt out of escaping, so the site uses neither
      // element anywhere. The CSP names both, which is why this looks for a
      // tag rather than for the word.
      expect(body).not.toMatch(/<\s*(script|style)[\s/>]/i);
    });

    it(`links to all four pages, on ${name}`, () => {
      for (const href of ['/', '/bench', '/hydradb', '/interface']) {
        expect(body).toContain(`href="${href}"`);
      }
    });

    it(`marks itself and only itself in the bar, on ${name}`, () => {
      // Every copy of the bar has to agree, and it has to agree with the route
      // the server hands this page out on. A page that marks a route it is not
      // is worse than one that marks nothing, because it is a wrong answer to
      // the only question the bar exists to answer.
      const found = markedPages(body);

      expect(found.length).toBeGreaterThan(0);
      expect([...new Set(found)]).toEqual([current]);
    });

    it(`offers a skip link past the bar, on ${name}`, () => {
      expect(body).toContain('href="#start"');
      expect(body).toContain('id="start"');
    });

    it(`declares a policy that forbids script, on ${name}`, () => {
      // Escaped, because the meta element goes through the same one way out as
      // every other value: the apostrophes in the policy arrive as entities.
      expect(body).toContain(escape(META_CONTENT_SECURITY_POLICY));
      expect(META_CONTENT_SECURITY_POLICY).toContain("script-src 'none'");
    });
  }
});
