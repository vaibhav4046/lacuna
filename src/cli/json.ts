import { askCore, toRevisionItem } from '../contract/result.js';
import { bestPerFamily } from '../report/bench.js';
import type { Answer } from '../retrieval/types.js';
import type { BenchResult } from './bench.js';
import type { DoctorReport } from './doctor.js';
import type { ProfileReport } from './profile.js';
import type { StatusReport } from './status.js';

/**
 * The machine readable form of every command.
 *
 * Every field in these payloads is named explicitly, either here or in the
 * shared projection the question payload spreads. Nothing hands an internal
 * object to `JSON.stringify` and hopes. That is more code and it is the point:
 * the config object holds the auth token, and a spread of it into an output
 * payload is a token in someone's log file. `askCore` takes an `Answer` and
 * nothing else, so it cannot reach a config even by accident, and the one
 * command here that does read a config, `status`, names the four fields it
 * prints.
 *
 * An abstention serialises as `status: "abstained"` with the reason code, next
 * to the same evidence and cost fields an answer carries. It is a result with a
 * shape, not an error and not an empty object.
 */

export function doctorPayload(report: DoctorReport): unknown {
  return {
    command: 'doctor',
    ok: report.ok,
    warnings: report.warnings,
    exitCode: report.code,
    checks: report.checks.map((check) => ({
      name: check.name,
      // Both, and not one derived from the other by the reader: `ok` is what a
      // script greps for and has meant the same thing since the first release,
      // `state` is the detail it can start reading when it wants to.
      ok: check.state !== 'fail',
      state: check.state,
      detail: check.detail,
    })),
  };
}

/** Which store this machine reads. Names only: no address, no token. */
export function profilePayload(report: ProfileReport): unknown {
  return {
    command: 'profile',
    profile: report.profile,
    decidedBy: report.decidedBy,
    store: report.store,
    available: report.available,
    problem: report.problem,
  };
}

export function statusPayload(report: StatusReport): unknown {
  const counts: Record<string, number> = {};
  for (const entry of report.counts) counts[entry.label] = entry.count;

  return {
    command: 'status',
    node: {
      baseUrl: report.baseUrl,
      namespace: report.namespace,
      graph: report.graph,
      cell: report.cell,
    },
    counts,
    readEpoch: report.readEpoch,
  };
}

/**
 * One question, as JSON.
 *
 * The middle of this payload is `askCore`, the same projection the MCP server
 * returns, so `status`, `claimId`, `reasonCode`, the evidence ids and the
 * revision chain are the same fields under the same names on both surfaces. A
 * script that reads one can read the other.
 *
 * What surrounds it is what the command line has and a tool call does not: the
 * command that was run, the question as it was parsed, and the resolver's own
 * account of how it decided. Those are additions to the shared shape rather
 * than a second version of it.
 */
export function questionPayload(command: string, answer: Answer): unknown {
  const { resolution } = answer;

  return {
    command,
    question: {
      subject: answer.question.subject,
      predicate: answer.question.predicate,
      via: answer.question.via,
    },
    ...askCore(answer),
    explanation: resolution.explanation,
    hop: resolution.hop === null ? null : {
      via: resolution.hop.via,
      throughClaimId: resolution.hop.throughClaimId,
      toEntityId: resolution.hop.toEntityId,
      toEntityName: resolution.hop.toEntityName,
    },
    trace: [...resolution.trace],
    considered: resolution.considered.map(toRevisionItem),
    queryCount: answer.queries.length,
  };
}

export function benchPayload(result: BenchResult): unknown {
  const { report } = result;
  return {
    command: 'bench',
    path: result.path,
    runAt: report.runAt,
    seed: report.seed,
    embeddingModel: report.embeddingModel,
    corpus: {
      sessions: report.corpus.sessions,
      messages: report.corpus.messages,
      claims: report.corpus.claims,
      characters: report.corpus.characters,
      estimatedTokens: report.corpus.estimatedTokens,
    },
    systems: bestPerFamily(report).map((system) => ({
      label: system.label,
      family: system.family,
      total: system.total,
      correct: system.correct,
      falseAnswer: system.verdicts.falseAnswer,
      missedAnswer: system.verdicts.missedAnswer,
      wrongAnswerText: system.verdicts.wrongAnswerText,
      wrongReason: system.verdicts.wrongReason,
      precision: system.precision,
      recall: system.recall,
      f1: system.f1,
      meanEstimatedTokens: system.meanEstimatedTokens,
      p50Ms: system.p50Ms,
      p95Ms: system.p95Ms,
    })),
  };
}

/** One trailing newline, so the output composes with the usual shell tools. */
export function render(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
