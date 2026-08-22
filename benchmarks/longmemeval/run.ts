import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openSource, type OpenedSource } from '../../src/hydra/open.js';
import type { HydraSource } from '../../src/hydra/source.js';
import { buildPlan, runIngest } from '../../src/ingest/index.js';

import {
  BENCHMARK_LINKS,
  datasetProvenance,
  environment,
  KNOWN_LIMITATIONS,
  lacunaCommit,
  writeRunArtifact,
  type RunArtifact,
} from './artifact.js';
import { adaptHaystack } from './adapt.js';
import { loadDataset, stripGroundTruth } from './load.js';
import { serialiseHypotheses, type Hypothesis, type IngestibleQuestion } from './schema.js';

/**
 * The runner, and the two places it refuses.
 *
 * It refuses when the dataset is absent, because the alternative is a score
 * over data this repository made up. It refuses when nothing is wired to
 * answer, because the alternative is a hypothesis file full of empty strings
 * that the official judge would happily score and report as a number.
 *
 * Both refusals throw. Neither has a fallback, a placeholder or a default. A
 * benchmark harness that degrades gracefully is a benchmark harness that
 * reports fiction.
 *
 * The path it would take, once something can answer, is the product's own:
 * `buildPlan` then `runIngest` to write, `ask` through a `HydraSource` to read.
 * The answerer is injected rather than built in so that the ingestion and the
 * answering can be swapped independently and so that neither can be handed the
 * dataset records that still carry the answers.
 */

export class LongMemEvalRunError extends Error {
  override readonly name = 'LongMemEvalRunError';
}

/**
 * Whatever turns a natural language question into a hypothesis string.
 *
 * It gets the store and the stripped question, and nothing else. It does not
 * get the record, so it cannot read the gold answer, and the type system is
 * what stops it rather than a rule in a document.
 */
export interface LongMemEvalAnswerer {
  /** Named in the artifact. "the answer model" in the provenance record. */
  readonly model: string;
  readonly answer: (question: IngestibleQuestion, source: HydraSource) => Promise<string>;
}

export interface RunOptions {
  readonly dataset: string;
  readonly outDir: string;
  readonly answerer: LongMemEvalAnswerer;
  /** How many instances to attempt. All of them when absent. */
  readonly limit?: number;
  /**
   * Opens an isolated writable node for one question. A shared graph is safe
   * for one question only: official haystack session ids repeat across
   * instances, so looping them into one graph would silently mix evidence.
   */
  readonly sourceForQuestion?: (
    question: IngestibleQuestion,
  ) => OpenedSource | Promise<OpenedSource>;
}

export function hypothesisFor(
  answerer: LongMemEvalAnswerer,
  question: IngestibleQuestion,
  source: HydraSource,
): Promise<string> {
  return answerer.answer(question, source);
}

export interface RunOutcome {
  readonly hypotheses: readonly Hypothesis[];
  readonly artifact: RunArtifact;
  readonly artifactPath: string;
  readonly hypothesisPath: string;
}

export async function runLongMemEval(options: RunOptions): Promise<RunOutcome> {
  // Throws with the download command when the file is not there.
  const records = loadDataset(options.dataset);
  const attempted = options.limit === undefined ? records : records.slice(0, options.limit);
  if (attempted.length === 0) {
    throw new LongMemEvalRunError(`--limit ${String(options.limit)} selected no instances`);
  }

  if (attempted.length > 1 && options.sourceForQuestion === undefined) {
    throw new LongMemEvalRunError(
      'LongMemEval multi-question runs require a per-question source factory for graph isolation.',
    );
  }

  const sharedOpened = options.sourceForQuestion === undefined ? openSource() : null;
  if (sharedOpened !== null && sharedOpened.client === null) {
    // Ingestion needs the node's write client, and the benchmarks in this
    // repository are pinned to the node so a network hop is not measured as
    // part of retrieval.
    throw new LongMemEvalRunError(
      `LongMemEval ingestion needs the node profile, got ${sharedOpened.profile}. Set LACUNA_PROFILE=node.`,
    );
  }

  const hypotheses: Hypothesis[] = [];
  const descriptions = new Set<string>();
  let profile: string = 'node';
  for (const record of attempted) {
    const question = stripGroundTruth(record);
    const opened = options.sourceForQuestion === undefined
      ? sharedOpened!
      : await options.sourceForQuestion(question);
    if (opened.client === null || opened.profile !== 'node') {
      throw new LongMemEvalRunError(
        `LongMemEval ingestion needs the node profile, got ${opened.profile}. Set LACUNA_PROFILE=node.`,
      );
    }
    descriptions.add(opened.describe);
    profile = options.sourceForQuestion === undefined ? opened.profile : 'node-factory';
    await runIngest(opened.client, buildPlan(adaptHaystack(question)));
    const hypothesis = await hypothesisFor(options.answerer, question, opened.source);
    hypotheses.push({ question_id: question.question_id, hypothesis });
  }

  mkdirSync(options.outDir, { recursive: true });
  const hypothesisPath = join(options.outDir, 'hypotheses.jsonl');
  writeFileSync(hypothesisPath, serialiseHypotheses(hypotheses), 'utf8');

  const artifact: RunArtifact = {
    benchmark: { ...BENCHMARK_LINKS, tier: options.dataset },
    dataset: datasetProvenance(options.dataset, records.length),
    lacunaCommit: lacunaCommit(),
    ranAt: new Date().toISOString(),
    environment: environment(),
    hydra: descriptions.size === 1 ? [...descriptions][0]! : 'per-question node source factory',
    answerModel: options.answerer.model,
    config: {
      limit: options.limit ?? null,
      profile,
      isolation: options.sourceForQuestion === undefined ? 'single-question' : 'per-question',
    },
    questionsAttempted: attempted.length,
    hypothesesWritten: hypotheses.length,
    hypothesisFile: 'hypotheses.jsonl',
    limitations: KNOWN_LIMITATIONS,
  };

  return {
    hypotheses,
    artifact,
    artifactPath: writeRunArtifact(options.outDir, artifact),
    hypothesisPath,
  };
}

export function parseArgs(argv: readonly string[]): { dataset: string | null; limit: number | undefined } {
  let dataset: string | null = null;
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--dataset') {
      if (value === undefined) throw new LongMemEvalRunError('--dataset needs a path');
      dataset = value;
      index += 1;
    } else if (flag === '--limit') {
      if (value === undefined) throw new LongMemEvalRunError('--limit needs a number');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new LongMemEvalRunError(`--limit must be a positive integer, got "${value}"`);
      }
      limit = parsed;
      index += 1;
    } else if (flag !== undefined) {
      throw new LongMemEvalRunError(`unknown argument "${flag}"`);
    }
  }
  return { dataset, limit };
}

/** Build the exact runner options represented by the CLI flags. */
export function cliRunOptions(
  argv: readonly string[],
  answerer: LongMemEvalAnswerer,
): RunOptions {
  const { dataset, limit } = parseArgs(argv);
  if (dataset === null) {
    throw new LongMemEvalRunError(
      'Usage: npm run bench:longmemeval -- --dataset <path to longmemeval_*.json> [--limit N]',
    );
  }
  return {
    dataset,
    outDir: 'artifacts/longmemeval/run',
    answerer,
    ...(limit === undefined ? {} : { limit }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { dataset } = parseArgs(argv);
  if (dataset === null) {
    throw new LongMemEvalRunError(
      'Usage: npm run bench:longmemeval -- --dataset <path to longmemeval_*.json> [--limit N]',
    );
  }

  // Loading first, so a missing dataset reports the download before opening a
  // store or writing an artifact.
  const records = loadDataset(dataset);
  process.stdout.write(`Loaded ${records.length} instances from ${dataset}\n\n`);
  const { createDeterministicAnswerer } = await import('./answerer.js');
  const outcome = await runLongMemEval(cliRunOptions(argv, createDeterministicAnswerer()));
  process.stdout.write(`Wrote ${outcome.hypotheses.length} hypotheses to ${outcome.hypothesisPath}\n`);
  process.stdout.write(`Run artifact: ${outcome.artifactPath}\n`);
}

// Keep the CLI entrypoint import-safe for unit tests and library callers. The
// previous unconditional top-level invocation made importing `runLongMemEval`
// parse the test runner's argv and throw before a test could exercise it.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
