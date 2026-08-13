import { describe, expect, it } from 'vitest';

import type { HydraConfig } from '../../src/hydra/config';
import { buildDemo } from '../../src/server/examples';
import { askHref, homePage, type CorpusFacts, type Example } from '../../src/view/home';
import {
  CONTENT_SECURITY_POLICY,
  META_CONTENT_SECURITY_POLICY,
} from '../../src/view/layout';
import { noticePage } from '../../src/view/notice';
import { describeNode } from '../../src/view/proof';

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
    const rendered = homePage([example()], FACTS);

    expect(rendered).toContain('<b>5,268</b>');
    expect(rendered).toContain('<b>117,395</b>');
    expect(rendered).toContain('lacuna-demo-v1');
  });

  it('links every example and shows its kind', () => {
    const rendered = homePage(
      [example(), example({ kind: 'multi_hop', via: 'vendor', predicate: 'contact' })],
      FACTS,
    );

    expect(rendered).toContain('href="/ask?subject=Meridian&amp;predicate=launch_date"');
    expect(rendered).toContain('multi hop');
  });

  it('escapes a question, because a corpus is data and not markup', () => {
    const rendered = homePage([example({ text: '<script>alert(1)</script>' })], FACTS);

    expect(rendered).not.toContain('<script>alert(1)</script>');
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('says so rather than showing an empty list when there are no questions', () => {
    expect(homePage([], FACTS)).toContain('No example questions were loaded.');
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
