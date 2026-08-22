import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The boundaries that make "one context, any agent" a structure rather than a
 * habit.
 *
 * `npm run continuity` proves the three clients agree today. It cannot stop
 * someone making them disagree tomorrow, because the ways they drift are all
 * additions rather than failures: a new surface that opens its own store, a
 * client that decides for itself which claim is current, a screen that reaches
 * past the API into the resolver. Each of those passes every existing test and
 * quietly ends the claim.
 *
 * So this file reads the source and asserts the shape. It is deliberately not
 * clever. It greps, and the thing it greps for is narrow enough that a real
 * violation trips it and a comment about a violation does not.
 *
 * `ground-truth-isolation.test.ts` guards the other structural claim, that the
 * runtime cannot see the answers it is scored against. These two are the pair.
 */

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function walk(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

const read = (path: string): string => readFileSync(path, 'utf8');
const rel = (path: string): string => relative(ROOT, path).replace(/\\/g, '/');

/** Lines with the comment stripped, so prose about a rule cannot break it. */
function codeLines(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  source.split('\n').forEach((raw, index) => {
    let text = raw;
    if (inBlock) {
      const close = text.indexOf('*/');
      if (close === -1) return;
      text = text.slice(close + 2);
      inBlock = false;
    }
    const open = text.indexOf('/*');
    if (open !== -1) {
      const close = text.indexOf('*/', open);
      if (close === -1) {
        text = text.slice(0, open);
        inBlock = true;
      } else {
        text = text.slice(0, open) + text.slice(close + 2);
      }
    }
    const lineComment = text.indexOf('//');
    if (lineComment !== -1) text = text.slice(0, lineComment);
    if (text.trim() !== '') out.push({ line: index + 1, text });
  });
  return out;
}

describe('the web talks to the product over HTTP and no other way', () => {
  it('never imports the server source tree', () => {
    const offenders: string[] = [];
    for (const path of walk(join(ROOT, 'web', 'src'), ['.ts', '.tsx'])) {
      // Anchored to a real import or export statement. The landing page holds
      // illustrative SDK snippets inside string literals, and a rule that reads
      // those as imports is a rule that fires on the page describing the API.
      for (const { line, text } of codeLines(read(path))) {
        if (/^\s*(import|export)\b[^'"]*from\s+['"][^'"]*\.\.\/\.\.\/src\//.test(text)) {
          offenders.push(`${rel(path)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never imports the resolver, so it cannot answer a question itself', () => {
    const offenders: string[] = [];
    for (const path of walk(join(ROOT, 'web', 'src'), ['.ts', '.tsx'])) {
      for (const { line, text } of codeLines(read(path))) {
        if (/^\s*(import|export)\b[^'"]*from\s+['"][^'"]*retrieval[^'"]*['"]/.test(text)) {
          offenders.push(`${rel(path)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Surfaces that open a store without asking `openSource` which one to use.
 *
 * Each entry below is pinned to one store on purpose, and the reason matters
 * more than the list. The deployed function is pinned to the cloud because a
 * production deployment silently answering from a node on somebody's laptop is
 * the worst failure this project has. The benchmark and the evaluator are
 * pinned to the node because they compare systems and a network hop would be
 * measured as part of the retrieval. The parity script opens both by
 * definition: comparing the two stores is what it is for, and the snapshot
 * verifier opens two for the same reason, one live and one replaying recorded
 * wire responses through a transport that never opens a socket.
 *
 * Anything not on this list has to go through the seam.
 */
const PINNED = new Set([
  'api/index.ts',
  'src/hydra/open.ts',
  // The impact port factory is a pinned Hydra seam: it binds one scoped cloud
  // client to its private CloudSource and exposes no collection choice to the
  // browser/router.
  'src/hydra/impact-read.ts',
  'src/bench/systems.ts',
  'src/server/server.ts',
  'scripts/ask.ts',
  'scripts/cloud-parity.ts',
  'scripts/evaluate.ts',
  'scripts/serve.ts',
  'scripts/verify-snapshot.ts',
]);

describe('one seam decides which store a client reads', () => {
  it('is the only place a source is constructed, outside the pinned surfaces', () => {
    const offenders: string[] = [];
    for (const dir of ['src', 'scripts', 'api']) {
      for (const path of walk(join(ROOT, dir), ['.ts'])) {
        if (PINNED.has(rel(path))) continue;
        for (const { line, text } of codeLines(read(path))) {
          if (/new\s+(Node|Cloud)Source\s*\(/.test(text)) {
            offenders.push(`${rel(path)}:${line} constructs a source directly`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * This assertion used to read `toContain('openSource')` across three files
   * and passed on the router for the wrong reason: the router has a local
   * variable of that name at the point it uses its injected factory, and never
   * imports the seam at all. A test that passes on a coincidence of naming is
   * worse than no test, because it reports a property nobody is holding.
   *
   * The router's real property is the stronger one. It cannot pick a store
   * because it is handed one, so it is checked for that instead: a type only
   * import of the interface, and an injected factory.
   */
  it('is imported by the two clients that choose a store for themselves', () => {
    for (const path of ['src/cli/question.ts', 'scripts/mcp.ts']) {
      const imports = codeLines(read(join(ROOT, path)))
        .some(({ text }) => /^\s*import\b[^'"]*\bopenSource\b[^'"]*from\s+['"][^'"]*hydra\/open/.test(text));
      expect(imports, `${path} should import openSource from the seam`).toBe(true);
    }
  });

  it('is not needed by the router, which is handed a source rather than choosing one', () => {
    const source = read(join(ROOT, 'src/api/router.ts'));
    const lines = codeLines(source);

    // Type only. A value import of the interface would mean the router had
    // reason to touch an implementation.
    expect(lines.some(({ text }) => /^\s*import\s+type\b[^'"]*HydraSource[^'"]*from/.test(text))).toBe(true);

    // And the store arrives as a factory on the options object. The factory
    // takes a collection now, because a signed-in reader reads their own
    // workspace and a signed-out one reads the corpus that ships here, but the
    // router still receives a source rather than constructing one.
    expect(source).toContain('readonly #source: ((collection?: string) => HydraSource) | undefined');

    // It must not reach the seam directly, which would let it override the
    // store its caller chose.
    expect(lines.some(({ text }) => /from\s+['"][^'"]*hydra\/open/.test(text))).toBe(false);
  });

  it('still lists every pinned surface, so the list cannot rot into a rubber stamp', () => {
    const stale = [...PINNED].filter((path) => {
      const source = read(join(ROOT, path));
      return !/new\s+(Node|Cloud)Source\s*\(/.test(source) && !/openSource/.test(source);
    });
    expect(stale).toEqual([]);
  });
});

describe('temporal and contradiction semantics live in one place', () => {
  /**
   * The decision "which of these claims is the current one" is the product.
   * A second implementation of it in a client is how two surfaces start
   * answering the same question differently, and it will not look like a bug
   * in either of them.
   */
  it('is not re-decided in a client', () => {
    const offenders: string[] = [];
    const clients = [
      ...walk(join(ROOT, 'src', 'cli'), ['.ts']),
      ...walk(join(ROOT, 'src', 'mcp'), ['.ts']),
      ...walk(join(ROOT, 'web', 'src'), ['.ts', '.tsx']),
    ];

    for (const path of clients) {
      for (const { line, text } of codeLines(read(path))) {
        // Deciding looks like choosing, so the rule fires on a claim field read
        // inside a filter, a find or a sort. Reading the same field to pick a
        // word to print is not deciding anything: by then the resolver has
        // already said which claim won, and the client is labelling it.
        const chooses = /\.(filter|find|findLast|some|every|sort|reduce)\s*\(/.test(text);
        const temporal = /\b(supersededBy|polarity|validFrom|validTo)\b/.test(text);
        if (chooses && temporal) {
          offenders.push(`${rel(path)}:${line} selects claims on temporal state`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no surface hardcodes an answer', () => {
  it('does not name a gold answer anywhere on the serving path', () => {
    // Values the corpus generator produces for questions the release asks.
    // A route that ever returns one of these without going through the graph
    // has been taught the answer instead of finding it.
    const answers = ['Halverd', '25 July 2026', 'Farah Haddad'];
    const offenders: string[] = [];

    for (const dir of ['src/api', 'src/cli', 'src/mcp', 'src/retrieval']) {
      for (const path of walk(join(ROOT, dir), ['.ts'])) {
        for (const { line, text } of codeLines(read(path))) {
          for (const answer of answers) {
            if (text.includes(`'${answer}'`) || text.includes(`"${answer}"`)) {
              offenders.push(`${rel(path)}:${line} names ${answer}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
