import { describe, expect, it } from 'vitest';

import type { HydraConfig } from '../../src/hydra/config.js';
import { lacuna, tiedWithLacuna } from '../../src/report/bench.js';
import { loadArtifacts } from '../../src/report/load.js';
import { buildDemo } from '../../src/server/examples.js';
import { grouped, ms, roundMs } from '../../src/view/format.js';
import { askHref, homePage, type CorpusFacts, type Example } from '../../src/view/home.js';
import {
  CONTENT_SECURITY_POLICY,
  META_CONTENT_SECURITY_POLICY,
  PAGES,
} from '../../src/view/layout.js';
import { noticePage } from '../../src/view/notice.js';
import { describeNode } from '../../src/view/proof.js';
import { markedPages } from '../support/markup.js';

/**
 * The pages that are built without going near the graph.
 *
 * The answer page is exercised for real in server-routes.test.ts, where a whole
 * request produces one. What is left here is the home page, the fixed notices,
 * the link shape both of them are built out of, and the one narrowing that
 * keeps a bearer token off a screen.
 */

const FACTS: CorpusFacts = {
  sessions: 72,
  messages: 5_268,
  claims: 118,
  entities: 66,
  estimatedTokens: 117_395,
  seed: 'lacuna-demo-v1',
};

/**
 * The real run, because the figures at the top of the home page are the run.
 *
 * The corpus counts above are a fixture, since the point of those assertions is
 * the formatting rather than the corpus. The benchmark band is the opposite: a
 * fixture would let the page print a number that no committed artifact
 * supports, which is the exact failure the band exists to make impossible.
 */
const REPORT = loadArtifacts().bench;

function example(over: Partial<Example> = {}): Example {
  return {
    kind: 'stable',
    text: 'What is the launch date of Meridian?',
    subject: 'Meridian',
    predicate: 'launch_date',
    via: null,
    ...over,
  };
}

describe('askHref', () => {
  it('builds the same query the form submits', () => {
    expect(askHref(example())).toBe('/ask?subject=Meridian&predicate=launch_date');
  });

  it('adds the via only when there is one', () => {
    expect(askHref(example({ via: 'vendor', predicate: 'contact' })))
      .toBe('/ask?subject=Meridian&predicate=contact&via=vendor');
  });

  it('encodes the characters that would otherwise be query syntax', () => {
    const href = askHref(example({ subject: 'a&b=c d', predicate: 'x?y' }));
    expect(href).toBe('/ask?subject=a%26b%3Dc%20d&predicate=x%3Fy');

    // The round trip matters more than the spelling: what comes back out of a
    // parsed URL has to be what went in.
    const parsed = new URL(href, 'http://lacuna.invalid');
    expect(parsed.searchParams.get('subject')).toBe('a&b=c d');
    expect(parsed.searchParams.get('predicate')).toBe('x?y');
  });
});

describe('the content security policy', () => {
  it('refuses everything by default and allows three narrow things', () => {
    for (const directive of [
      "default-src 'none'",
      "script-src 'none'",
      "style-src 'self'",
      "img-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
    ]) {
      expect(CONTENT_SECURITY_POLICY).toContain(directive);
      expect(META_CONTENT_SECURITY_POLICY).toContain(directive);
    }
  });

  it('keeps frame-ancestors in the header and drops it from the meta copy', () => {
    // A meta element ignores this directive and the browser logs an error
    // saying so. The header is where it is enforced, so that is where it lives.
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(META_CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors');
  });

  it('differs by that one directive and nothing else', () => {
    // Said as a difference rather than as two literals, so that adding a
    // directive to the policy cannot quietly leave the mirror behind.
    const header = CONTENT_SECURITY_POLICY.split('; ');
    const meta = META_CONTENT_SECURITY_POLICY.split('; ');

    expect(header.filter((one) => !meta.includes(one))).toEqual([
      "frame-ancestors 'none'",
    ]);
    expect(meta.filter((one) => !header.includes(one))).toEqual([]);
  });
});

describe('describeNode', () => {
  it('keeps what names the graph and drops what reaches it', () => {
    const config: HydraConfig = {
      baseUrl: 'http://127.0.0.1:18443',
      namespace: 'local',
      graph: 'default',
      cell: 'cell-0',
      token: 'deadbeef'.repeat(6),
    };

    const node = describeNode(config);

    expect(node).toEqual({ namespace: 'local', graph: 'default', cell: 'cell-0' });
    // Said as a property of the value rather than of the three fields above,
    // because the point is that no future field can carry either one through.
    const serialised = JSON.stringify(node);
    expect(serialised).not.toContain(config.token);
    expect(serialised).not.toContain(config.baseUrl);
  });
});

describe('buildDemo', () => {
  it('takes the first question of every kind the corpus produces', () => {
    const demo = buildDemo('lacuna-demo-v1');
    const kinds = demo.examples.map((one) => one.kind);

    expect(new Set(kinds).size).toBe(kinds.length);
    // The three that answer nothing are on the front page with the rest. That
    // is the product, so it is a test and not a preference.
    expect(kinds).toContain('never_stated');
    expect(kinds).toContain('out_of_scope');
    expect(kinds).toContain('unconnected');
    expect(kinds).toContain('retracted');
    expect(kinds).toContain('contradicted');
  });

  it('recovers the via from the question text rather than inventing one', () => {
    const demo = buildDemo('lacuna-demo-v1');
    const hop = demo.examples.find((one) => one.kind === 'multi_hop');

    expect(hop).toBeDefined();
    expect(hop?.via).not.toBeNull();
    expect(hop?.text).toContain(`for the ${hop?.via ?? ''} behind`);
  });

  it('is the same demo every time, because the corpus is seeded', () => {
    expect(buildDemo('lacuna-demo-v1')).toEqual(buildDemo('lacuna-demo-v1'));
  });

  it('reports the counts of the corpus it built the questions from', () => {
    const demo = buildDemo('lacuna-demo-v1');

    expect(demo.facts.seed).toBe('lacuna-demo-v1');
    expect(demo.facts.sessions).toBeGreaterThan(0);
    expect(demo.facts.claims).toBeGreaterThan(0);
    expect(demo.facts.entities).toBeGreaterThan(0);
  });
});

describe('homePage', () => {
  it('prints the counts grouped, so a judge reads them at a glance', () => {
    const rendered = homePage([example()], FACTS, REPORT);

    expect(rendered).toContain('<b>5,268</b>');
    expect(rendered).toContain('<b>117,395</b>');
    expect(rendered).toContain('lacuna-demo-v1');
  });

  it('links every example and shows its kind', () => {
    const rendered = homePage(
      [example(), example({ kind: 'multi_hop', via: 'vendor', predicate: 'contact' })],
      FACTS,
      REPORT,
    );

    expect(rendered).toContain('href="/ask?subject=Meridian&amp;predicate=launch_date"');
    expect(rendered).toContain('multi hop');
  });

  it('escapes a question, because a corpus is data and not markup', () => {
    const rendered = homePage([example({ text: '<script>alert(1)</script>' })], FACTS, REPORT);

    expect(rendered).not.toContain('<script>alert(1)</script>');
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('says so rather than showing an empty list when there are no questions', () => {
    expect(homePage([], FACTS, REPORT)).toContain('No example questions were loaded.');
  });
});

describe('the figures at the top of the home page', () => {
  const rendered = homePage([example()], FACTS, REPORT);
  const ours = lacuna(REPORT)!;

  it('states the score the run recorded rather than a rank', () => {
    // A rank would be a claim about position in a tie, which is the one thing
    // this run does not establish. The score is what it does establish.
    expect(rendered).toContain(`<b>${ours.correct}/${ours.total}</b>`);
  });

  it('takes the context ratio against the closest system that tied', () => {
    const tied = tiedWithLacuna(REPORT);
    expect(tied.length).toBeGreaterThan(0);

    const ratios = tied.map((system) => system.meanEstimatedTokens / ours.meanEstimatedTokens);
    const nearest = Math.min(...ratios);

    // Every tie carried more context, so the smallest ratio is still above one,
    // and picking the smallest is what stops the band flattering itself with
    // the worst baseline in the sweep.
    expect(nearest).toBeGreaterThan(1);
    expect(rendered).toContain(`<b>${roundMs(nearest)}x</b>`);
    expect(roundMs(nearest)).toBeLessThanOrEqual(roundMs(Math.max(...ratios)));
  });

  it('counts the configurations in the run instead of spelling the number twice', () => {
    expect(rendered).toContain(`<b>${grouped(REPORT.systems.length)}</b>`);
    // The benchmark page writes this count out as words. Writing it again here
    // as prose would be a second copy to keep in step, so the band interpolates
    // and says nothing that could go stale.
    expect(rendered).not.toContain('fifty one');
  });

  it('prints the median it loses on at the same size as the rest', () => {
    const slowest = Math.max(...REPORT.systems.map((system) => system.p50Ms));

    expect(ours.p50Ms).toBe(slowest);
    expect(rendered).toContain(`<b>${ms(ours.p50Ms)}</b>`);
    expect(rendered).toContain('the slowest in the run');
  });
});

describe('the page bar', () => {
  it('marks the home page as the page you are on, and nothing else', () => {
    const found = markedPages(homePage([example()], FACTS, REPORT));

    expect(found.length).toBeGreaterThan(0);
    expect([...new Set(found)]).toEqual(['/']);
  });

  it('marks nothing on a refusal, because a refusal is not one of the pages', () => {
    const rendered = noticePage({
      code: 429,
      title: 'Too many',
      heading: 'Too many questions at once',
      lines: ['One line.'],
    });

    expect(markedPages(rendered)).toEqual([]);
    // The links are still there. Only the claim about where you are is dropped.
    // Read out of PAGES rather than listed here, so adding a page cannot leave
    // this assertion quietly checking a shorter list than the bar renders.
    expect(PAGES.length).toBeGreaterThan(1);
    for (const entry of PAGES) {
      expect(rendered).toContain(`href="${entry.href}"`);
    }
  });

  it('offers a way past the bar for anyone arriving by keyboard', () => {
    const rendered = homePage([example()], FACTS, REPORT);

    expect(rendered).toContain('href="#start"');
    expect(rendered).toContain('id="start"');
  });
});

describe('noticePage', () => {
  it('prints the status code where a panel number goes', () => {
    const rendered = noticePage({
      code: 404,
      title: 'Not found',
      heading: 'There is no page here',
      lines: ['One line.'],
    });

    expect(rendered).toContain('404');
    expect(rendered).toContain('Not found | Lacuna');
    expect(rendered).toContain('One line.');
    expect(rendered).toContain('href="/"');
  });

  it('ships no script, the same as every other page here', () => {
    const rendered = noticePage({ code: 500, title: 'x', heading: 'y', lines: [] });

    expect(rendered).not.toContain('<script');
  });
});
