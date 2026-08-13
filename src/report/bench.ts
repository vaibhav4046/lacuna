/**
 * The benchmark file, read as data rather than trusted as data.
 *
 * `artifacts/bench/results.json` is written by `scripts/benchmark.ts` and read
 * back here to be put on a page. It is a committed file in this repository, so
 * the obvious shortcut is `JSON.parse` and a cast, and the obvious shortcut is
 * wrong for one reason: a cast is a claim about the file made by the person who
 * wrote the type, and this page exists to stop making claims that way. If the
 * benchmark's shape drifts, a cast puts `undefined` on a page under a heading
 * that says the number is measured.
 *
 * So every field is checked at the boundary and a mismatch is a named error
 * with the path to the field in it. The parse is total: after it returns, the
 * view layer can print any field without a guard.
 *
 * Only the fields a page uses are kept. `cases`, the per question record, is
 * 60 entries for each of 51 systems and none of it is rendered, so it is
 * dropped here rather than carried into a page's memory.
 */

export class ReportError extends Error {
  override readonly name = 'ReportError';
}

/** What the corpus held when the run happened, as counted by the run. */
export interface BenchCorpus {
  readonly sessions: number;
  readonly messages: number;
  readonly claims: number;
  readonly characters: number;
  /** Characters over four. An estimate, labelled as one wherever it is shown. */
  readonly estimatedTokens: number;
}

/** How one system did on one question kind. */
export interface KindResult {
  readonly kind: string;
  readonly total: number;
  readonly correct: number;
}

/**
 * The five ways a run can end, which are not all failures of the same size.
 *
 * A `false_answer` is a system stating something the sessions never settled.
 * A `missed_answer` is the opposite, a system declining a question it had the
 * evidence for. Collapsing those two into "wrong" would hide the difference
 * this product is about, so the counts stay separate all the way to the page.
 */
export interface VerdictCounts {
  readonly correct: number;
  readonly wrongAnswerText: number;
  readonly falseAnswer: number;
  readonly missedAnswer: number;
  readonly wrongReason: number;
}

export interface SystemResult {
  readonly label: string;
  readonly family: string;
  readonly description: string;
  readonly total: number;
  readonly correct: number;
  readonly verdicts: VerdictCounts;
  readonly kinds: readonly KindResult[];
  /** Abstention precision, recall and F1, over the questions with no answer. */
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly meanContextChars: number;
  readonly meanEstimatedTokens: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface BenchReport {
  readonly seed: string;
  readonly runAt: string;
  readonly embeddingModel: string;
  readonly cutOffs: readonly number[];
  readonly fusionDepth: number;
  readonly corpus: BenchCorpus;
  readonly systems: readonly SystemResult[];
}

function fail(path: string, expected: string): never {
  throw new ReportError(`${path} is not ${expected}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'an object');
  }
  return value as Record<string, unknown>;
}

function text(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string') fail(`${path}.${key}`, 'a string');
  return value;
}

/**
 * A finite number, which is stricter than `typeof value === 'number'`.
 *
 * `JSON.parse` cannot produce `NaN` or an infinity, so this looks like a check
 * against something that cannot happen. It is a check against the file being
 * written by something other than `JSON.stringify` one day, and it costs a
 * comparison. The view layer's own `render` throws on a non finite number, and
 * being told which field it was here is worth more than being told at the point
 * it reached a template.
 */
function figure(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path}.${key}`, 'a finite number');
  }
  return value;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'an array');
  return value;
}

function parseCorpus(value: unknown): BenchCorpus {
  const source = record(value, 'corpus');
  return {
    sessions: figure(source, 'sessions', 'corpus'),
    messages: figure(source, 'messages', 'corpus'),
    claims: figure(source, 'claims', 'corpus'),
    characters: figure(source, 'characters', 'corpus'),
    estimatedTokens: figure(source, 'estimatedTokens', 'corpus'),
  };
}

function parseVerdicts(value: unknown, path: string): VerdictCounts {
  const source = record(value, path);
  return {
    correct: figure(source, 'correct', path),
    wrongAnswerText: figure(source, 'wrong_answer_text', path),
    falseAnswer: figure(source, 'false_answer', path),
    missedAnswer: figure(source, 'missed_answer', path),
    wrongReason: figure(source, 'wrong_reason', path),
  };
}

/**
 * The per kind results, kept in the file's own order.
 *
 * The order in the JSON is the order the corpus generator defines the kinds in,
 * which runs from the easiest shape to the ones only a graph gets right. That
 * ordering is worth keeping, and re-deriving it in the view from a hardcoded
 * list would be a second place to update when a kind is added.
 */
function parseKinds(value: unknown, path: string): readonly KindResult[] {
  const source = record(value, path);
  return Object.entries(source).map(([kind, entry]) => {
    const where = `${path}.${kind}`;
    const counts = record(entry, where);
    return {
      kind,
      total: figure(counts, 'total', where),
      correct: figure(counts, 'correct', where),
    };
  });
}

function parseSystem(value: unknown, index: number): SystemResult {
  const path = `systems[${index}]`;
  const source = record(value, path);
  return {
    label: text(source, 'label', path),
    family: text(source, 'family', path),
    description: text(source, 'description', path),
    total: figure(source, 'total', path),
    correct: figure(source, 'correct', path),
    verdicts: parseVerdicts(source['byVerdict'], `${path}.byVerdict`),
    kinds: parseKinds(source['byKind'], `${path}.byKind`),
    precision: figure(source, 'precision', path),
    recall: figure(source, 'recall', path),
    f1: figure(source, 'f1', path),
    meanContextChars: figure(source, 'meanContextChars', path),
    meanEstimatedTokens: figure(source, 'meanEstimatedTokens', path),
    p50Ms: figure(source, 'p50Ms', path),
    p95Ms: figure(source, 'p95Ms', path),
  };
}

export function parseBenchReport(source: string): BenchReport {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new ReportError(`the benchmark file is not JSON: ${(error as Error).message}`);
  }

  const top = record(raw, 'report');
  const systems = list(top['systems'], 'systems').map(parseSystem);
  if (systems.length === 0) throw new ReportError('the benchmark file records no systems');

  return {
    seed: text(top, 'seed', 'report'),
    runAt: text(top, 'runAt', 'report'),
    embeddingModel: text(top, 'embeddingModel', 'report'),
    cutOffs: list(top['cutOffs'], 'cutOffs').map((entry, at) => {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) {
        fail(`cutOffs[${at}]`, 'a finite number');
      }
      return entry;
    }),
    fusionDepth: figure(top, 'fusionDepth', 'report'),
    corpus: parseCorpus(top['corpus']),
    systems,
  };
}

/** The name the product's own row carries in the file. */
export const LACUNA = 'lacuna';

/**
 * Best first, and among equals the cheapest context first.
 *
 * Correctness leads because a wrong answer that arrives in five tokens is not
 * a better answer. Context breaks the tie rather than latency, because context
 * is the axis this product is arguing about and latency is the axis it loses
 * on; sorting by the one it wins is a choice, and it is stated here rather than
 * left for a reader to infer from the table.
 */
export function ranked(report: BenchReport): readonly SystemResult[] {
  return [...report.systems].sort((a, b) => (
    b.correct - a.correct
    || a.meanEstimatedTokens - b.meanEstimatedTokens
    || a.label.localeCompare(b.label)
  ));
}

export function lacuna(report: BenchReport): SystemResult | undefined {
  return report.systems.find((system) => system.family === LACUNA);
}

/**
 * One row per family, each family's best configuration.
 *
 * A table of all 51 configurations is the evidence and belongs on the page, but
 * it is not readable as a comparison, because most of those rows are the same
 * retriever at a different cut-off. This picks the strongest setting each family
 * managed, which is the fair version of the comparison: the argument is against
 * what these approaches can do when tuned, not against a badly chosen k.
 */
export function bestPerFamily(report: BenchReport): readonly SystemResult[] {
  const best = new Map<string, SystemResult>();
  for (const system of ranked(report)) {
    if (!best.has(system.family)) best.set(system.family, system);
  }
  return [...best.values()];
}

/** Every other system that matched the product's score, which may be several. */
export function tiedWithLacuna(report: BenchReport): readonly SystemResult[] {
  const ours = lacuna(report);
  if (ours === undefined) return [];
  return ranked(report).filter(
    (system) => system.family !== LACUNA && system.correct === ours.correct,
  );
}
