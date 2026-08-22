import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * What a run has to record about itself before any number it produces is worth
 * reading.
 *
 * A benchmark result with no provenance is a screenshot. The fields here are
 * the ones that decide whether a second person can get the same number: which
 * dataset file, byte for byte, which commit of this repository, which store,
 * which answering model, and what was known to be wrong at the time.
 *
 * `limitations` is not decoration. A run that produced no hypotheses says so
 * here, and this file is written on that path too.
 */

export interface DatasetProvenance {
  readonly path: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly instances: number;
}

export interface RunArtifact {
  readonly benchmark: {
    readonly name: 'LongMemEval';
    readonly repository: string;
    readonly paper: string;
    /** Which release of the dataset, by file. There is no version string upstream. */
    readonly tier: string;
  };
  readonly dataset: DatasetProvenance;
  readonly lacunaCommit: string;
  readonly ranAt: string;
  readonly environment: {
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
  };
  /** Which store answered, as `openSource` describes it. Never a URL or a token. */
  readonly hydra: string;
  /** The model that produced the hypotheses, or null when nothing answered. */
  readonly answerModel: string | null;
  readonly config: Readonly<Record<string, string | number | boolean | null>>;
  readonly questionsAttempted: number;
  readonly hypothesesWritten: number;
  /** Relative path of the official jsonl, or null when none was written. */
  readonly hypothesisFile: string | null;
  readonly limitations: readonly string[];
}

/**
 * What is known to be wrong with any run this harness produces today.
 *
 * Written into every artifact, including the ones that report nothing. See
 * docs/BENCHMARK_LONGMEMEVAL.md for the long form.
 */
export const KNOWN_LIMITATIONS: readonly string[] = [
  'The shipped extractor reads a narrow infrastructure vocabulary. LongMemEval is a personal '
  + 'assistant benchmark, so the adapted sessions carry sparse and potentially low-precision '
  + 'claims; the published oracle run measured 117 claims across 78 of 500 instances.',
  'The deterministic answerer sends sentences through Lacuna\'s bounded planner and resolver. '
  + 'Questions outside that planner\'s known subjects or predicate vocabulary abstain rather than '
  + 'inventing a structured question.',
  'Session ids are preserved verbatim, and an official evidence session id contains the substring '
  + '"answer". Lacuna never reads a session key to decide anything, but the signal is in the store.',
  'Session timestamps are stored verbatim in the dataset format ("2023/05/30 (Tue) 23:40"), which '
  + 'is not ISO 8601 and is not parsed.',
  'One question per graph. Haystack session ids are drawn from a shared pool and repeat across '
  + 'questions, so a second haystack in the same graph collides on keys.',
  'longmemeval_m_cleaned.json cannot be loaded. At 2.74 GB it is past what JSON.parse can hold.',
  'The official evaluation is a paid LLM judge and has not been run by this repository.',
];

export const BENCHMARK_LINKS = {
  name: 'LongMemEval',
  repository: 'https://github.com/xiaowu0162/LongMemEval',
  paper: 'https://arxiv.org/abs/2410.10813',
} as const;

/** Streaming would be tidier; a 277 MB read is under a second and this runs once. */
export function fileDigest(path: string): { readonly sha256: string; readonly bytes: number } {
  const bytes = statSync(path).size;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { sha256, bytes };
}

export function datasetProvenance(path: string, instances: number): DatasetProvenance {
  const { sha256, bytes } = fileDigest(path);
  return { path, file: basename(path), bytes, sha256, instances };
}

/**
 * The commit this ran at, or `unknown`.
 *
 * Never throws. A missing git is a worse artifact, not a failed run, and an
 * artifact that says `unknown` is honest about what it does not know.
 */
export function lacunaCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function environment(): RunArtifact['environment'] {
  return { node: process.version, platform: process.platform, arch: process.arch };
}

/** Writes `<dir>/run.json`. Returns the path written. */
export function writeRunArtifact(dir: string, artifact: RunArtifact): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'run.json');
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return path;
}
