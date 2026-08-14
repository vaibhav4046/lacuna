import type { Answer, ClaimRecord, EvidenceRecord } from '../retrieval/types';
import type { Palette } from './color';
import { columns, truncate } from './table';

/**
 * The terminal rendering of an answer.
 *
 * Three commands share this file because they render three views of one object:
 * `ask` states the verdict and quotes the evidence, `explain` adds the ordered
 * trace, `timeline` draws the claim chain. Splitting them across files would
 * duplicate the header, the verdict line and the cost footer three times over.
 *
 * An abstention is rendered as an answer, not as an error. It gets the same
 * shape of output, says which of the five reasons applies, and carries the same
 * explanation line, because "the sessions never settled this" is a result.
 */

/** Wide enough to recognise a statement, short enough to keep a row on one line. */
const CYPHER_WIDTH = 44;

/** Claim values are usually short. This only bites on a pathological one. */
const VALUE_WIDTH = 44;

function questionLine(answer: Answer, palette: Palette): string {
  const { subject, predicate, via } = answer.question;
  const tail = via === null ? '' : ` via ${via}`;
  return `${palette.dim('Q')}  ${subject} ${predicate}${tail}`;
}

function verdictLines(answer: Answer, palette: Palette): readonly string[] {
  const { outcome, explanation } = answer.resolution;
  const headline = outcome.type === 'answer'
    ? palette.heading(outcome.text)
    : `${palette.bad('No answer')} (${outcome.reason})`;
  return [`${palette.dim('A')}  ${headline}`, `   ${explanation}`];
}

function hopLines(answer: Answer): readonly string[] {
  const { hop } = answer.resolution;
  if (hop === null) return [];
  return [
    '',
    `   Followed "${hop.via}" to ${hop.toEntityName} `
    + `(entity ${hop.toEntityId}, through claim ${hop.throughClaimId})`,
  ];
}

function evidenceLines(evidence: readonly EvidenceRecord[]): readonly string[] {
  if (evidence.length === 0) return [];
  const lines = ['', '   Cited from'];
  for (const record of evidence) {
    lines.push(`     ${record.sessionTitle}, ${record.ts.slice(0, 10)}, ${record.role}`);
    lines.push(`       "${record.quote}"`);
  }
  return lines;
}

function costLine(answer: Answer, palette: Palette): string {
  const count = answer.queries.length;
  return palette.dim(`   ${count} ${count === 1 ? 'query' : 'queries'}, ${answer.ms}ms`);
}

export function renderAsk(answer: Answer, palette: Palette): string {
  return [
    questionLine(answer, palette),
    ...verdictLines(answer, palette),
    ...hopLines(answer),
    ...evidenceLines(answer.evidence),
    '',
    costLine(answer, palette),
  ].join('\n');
}

export function renderExplain(answer: Answer, palette: Palette): string {
  const trace = answer.resolution.trace;
  const steps = trace.length === 0
    ? []
    : ['', '   How it got there', ...trace.map((step, at) => `     ${at + 1}. ${step}`)];

  const queries = answer.queries.length === 0
    ? []
    : [
      '',
      '   What it asked HydraDB',
      ...columns(
        answer.queries.map((trip, at) => [
          `${at + 1}.`,
          truncate(trip.cypher, CYPHER_WIDTH),
          `${trip.rows} ${trip.rows === 1 ? 'row' : 'rows'}`,
          `${trip.ms}ms`,
          trip.readEpoch === null ? 'no epoch' : `epoch ${trip.readEpoch}`,
        ]),
        '     ',
      ),
    ];

  return [
    questionLine(answer, palette),
    ...verdictLines(answer, palette),
    ...hopLines(answer),
    ...steps,
    ...queries,
    '',
    costLine(answer, palette),
  ].join('\n');
}

/**
 * The claim chain, oldest first.
 *
 * The order is not imposed here. `decode.ts` sorts every claim it reads by valid
 * time and then by id, and `resolve` filters that list without reordering it, so
 * `considered` arrives oldest first and re-sorting it would only hide a change
 * in either of those files.
 */
export function renderTimeline(answer: Answer, palette: Palette): string {
  const { considered } = answer.resolution;
  const answered = answer.resolution.outcome.type === 'answer'
    ? answer.resolution.outcome.claimId
    : null;

  const table = considered.length === 0
    ? ['', '   No claim was ever made on this pair.']
    : [
      '',
      `   Claims on ${answer.question.subject} ${answer.question.predicate}, oldest first`,
      ...columns(
        [
          ['claim', 'valid from', 'recorded', 'value', 'state'],
          ...considered.map((claim) => [
            `#${claim.id}`,
            claim.validFrom,
            claim.txTime,
            truncate(claimValue(claim), VALUE_WIDTH),
            state(claim, answered),
          ]),
        ],
        '     ',
      ),
    ];

  return [
    questionLine(answer, palette),
    ...verdictLines(answer, palette),
    ...hopLines(answer),
    ...table,
    '',
    costLine(answer, palette),
  ].join('\n');
}

/** A negative claim withdraws a value rather than stating one. */
function claimValue(claim: ClaimRecord): string {
  return claim.polarity === 'negative' ? `${claim.objectText} (withdrawn)` : claim.objectText;
}

function state(claim: ClaimRecord, answeredWith: number | null): string {
  if (claim.supersededBy.length > 0) {
    const by = claim.supersededBy.map((id) => `#${id}`).join(', ');
    return `superseded by ${by}`;
  }
  return claim.id === answeredWith ? 'current, answered with this' : 'current';
}
