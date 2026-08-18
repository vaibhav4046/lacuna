import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateCorpus } from '../../src/corpus/index.js';
import type { Corpus } from '../../src/corpus/types.js';
import { buildPlan } from '../../src/ingest/plan.js';
import { buildDemo } from '../../src/server/examples.js';

/**
 * The corpus holds both the transcripts and the answers they were built to
 * have. Only the first of those may reach the product.
 *
 * That separation is the whole reason a score means anything here. A system
 * that can see the expected answer can be made to score perfectly in an
 * afternoon and will tell you nothing about whether the graph works, so this
 * file asserts the separation structurally rather than trusting that nobody
 * took the shortcut: the query path cannot reach the gold answers through
 * imports, does not name them in source, and produces byte-identical output
 * when the answers are replaced with rubbish.
 */

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SRC = join(ROOT, 'src');

/** The two entry points that make up the runtime path: write, then read. */
const ENTRY_POINTS = ['src/ingest/plan.ts', 'src/retrieval/index.ts'] as const;

/**
 * Corpus modules the runtime is allowed to see: the claim and predicate shapes
 * ingestion writes against, the name pools those are drawn from, and the seeded
 * generator behind them. Vocabulary and structure, in other words. The answers
 * are assembled in threads.ts and handed out by index.ts, and neither of those
 * may appear on this path.
 */
const ALLOWED_CORPUS_MODULES = new Set([
  'src/corpus/types.ts',
  'src/corpus/predicates.ts',
  'src/corpus/vocab.ts',
  'src/corpus/rng.ts',
]);

const IMPORT_PATTERN = /from\s+'(\.[^']*)'/g;

function repoPath(absolute: string): string {
  return relative(ROOT, absolute).split('\\').join('/');
}

/** Every module reachable from `entry` by following relative imports. */
function importClosure(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const frontier = [resolve(ROOT, entry)];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    const key = repoPath(current);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const source = readFileSync(current, 'utf8');
    for (const found of source.matchAll(IMPORT_PATTERN)) {
      // Written as '.js' in source, because that is what the runtime resolves.
      const target = resolve(dirname(current), found[1]!.replace(/\.js$/, '.ts'));
      frontier.push(target);
    }
  }
  return seen;
}

/** Every .ts file under src, other than the two trees that are allowed to know. */
function productionSources(): readonly string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, item.name);
      if (item.isDirectory()) {
        if (item.name !== 'corpus' && item.name !== 'bench') {
          walk(full);
        }
        continue;
      }
      if (item.name.endsWith('.ts')) {
        files.push(full);
      }
    }
  };
  walk(SRC);
  return files;
}

/** The same corpus with every stored answer replaced by rubbish. */
function withJunkAnswers(source: Corpus): Corpus {
  return {
    ...source,
    questions: source.questions.map((question) => ({
      ...question,
      expected:
        question.expected.type === 'answer'
          ? { type: 'answer' as const, text: 'JUNK', claimKey: 'JUNK' }
          : question.expected.type === 'affected'
            ? { type: 'affected' as const, services: ['JUNK'] }
            : { type: 'abstain' as const, reason: 'out_of_scope' as const },
    })),
  };
}

describe('the query path cannot reach the gold answers', () => {
  for (const entry of ENTRY_POINTS) {
    it(`${entry} imports nothing from the benchmark`, () => {
      const reached = [...importClosure(entry)].filter((path) => path.startsWith('src/bench/'));
      expect(reached).toEqual([]);
    });

    it(`${entry} reaches only the shape of the corpus, never its content`, () => {
      const reached = [...importClosure(entry)]
        .filter((path) => path.startsWith('src/corpus/'))
        .filter((path) => !ALLOWED_CORPUS_MODULES.has(path));
      expect(reached).toEqual([]);
    });
  }

  it('names no gold answer anywhere in the product source', () => {
    // The import walk covers what runs. This covers what is written, including
    // the pages, the server and the CLI, none of which sit on that path but
    // any of which could grow a shortcut.
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        if (/\.expected\b|\bGoldQuestion\b|\bExpectedAnswer\b/.test(line)) {
          offenders.push(`${repoPath(file)}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('ingestion is blind to the answers', () => {
  it('plans the identical graph when every expected answer is replaced', () => {
    // The strongest form of the claim: not that ingestion does not read the
    // answers, but that it could not have, because rubbish in that field
    // changes nothing about what gets written.
    const corpus = generateCorpus();
    expect(buildPlan(withJunkAnswers(corpus))).toEqual(buildPlan(corpus));
  });

  it('writes no node or edge carrying an answer', () => {
    const corpus = generateCorpus();
    const plan = buildPlan(corpus);
    const answers = new Set(
      corpus.questions
        .map((question) => (question.expected.type === 'answer' ? question.expected.claimKey : null))
        .filter((key): key is string => key !== null),
    );

    // Claim keys do appear, because the claims themselves are ingested. What
    // must not appear is a node saying which of them is the answer.
    const serialised = JSON.stringify(plan);
    expect(serialised).not.toContain('expected');
    expect(serialised).not.toContain('"gold"');
    expect(answers.size).toBeGreaterThan(0);
  });
});

describe('the pages are built from questions, not from answers', () => {
  it('carries no expected field onto the home page', () => {
    for (const example of buildDemo().examples) {
      expect(Object.keys(example).sort()).toEqual(['kind', 'predicate', 'subject', 'text', 'via']);
    }
  });

  it('shows a question from every thread kind, including the ones with no answer', () => {
    const kinds = new Set(buildDemo().examples.map((example) => example.kind));
    for (const kind of ['never_stated', 'out_of_scope', 'retracted', 'blast_radius']) {
      expect(kinds, kind).toContain(kind);
    }
  });
});
