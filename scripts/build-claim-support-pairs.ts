import { writeFileSync } from 'node:fs';

import { generateCorpus } from '../src/corpus/index.js';
import type { ClaimAnnotation, PredicateName } from '../src/corpus/types.js';

/**
 * Builds artifacts/eval/claim-support-pairs.json from the seeded demo corpus.
 *
 * Every row pairs a one-sentence claim, phrased the way the Researcher writes
 * a draft, with one evidence quote from the corpus annotations. Labels follow
 * from the construction rule named in `kind`, and every row was then read to
 * confirm the label is what a careful human would give the pair in isolation.
 * Nothing here comes from a model. Rebuild with:
 *   npx tsx scripts/build-claim-support-pairs.ts
 */

type Label = 'supported' | 'not_supported';
interface Row {
  readonly id: string;
  readonly claim: string;
  /** The value the claim asserts, as written in the claim. Used by the lexical baseline. */
  readonly value: string;
  readonly passage: string;
  readonly label: Label;
  readonly source: string;
  readonly kind: string;
}

const corpus = generateCorpus();
const claims = new Map<string, ClaimAnnotation & { quote: string; session: string }>();
for (const session of corpus.sessions) {
  for (const message of session.messages) {
    for (const span of message.spans) {
      const claim = message.claims.find((item) => item.key === span.claimKey);
      if (claim !== undefined) claims.set(claim.key, { ...claim, quote: span.quote, session: session.key });
    }
  }
}
const find = (subject: string, predicate: string, kind?: string) =>
  [...claims.values()].filter((c) => c.subject === subject && c.predicate === predicate && (kind === undefined || c.kind === kind));

const CLAIM: Partial<Record<PredicateName, (s: string, v: string) => string>> = {
  launch_date: (s, v) => `${s} launches on ${v}.`,
  region: (s, v) => `${s} is hosted in ${v}.`,
  migration_window: (s, v) => `${s} migrates during ${v}.`,
  beta_partner: (s, v) => `${s}'s beta partner is ${v}.`,
  budget_code: (s, v) => `${s} is billed to budget code ${v}.`,
  owner: (s, v) => `${s} is owned by ${v}.`,
  contact: (s, v) => `${v} is our contact at ${s}.`,
  status: (s, v) => `${s} is currently ${v}.`,
  on_call_length: (s, v) => `The on-call rotation for ${s} lasts ${v}.`,
  runbook_owner: (s, v) => `${v} maintains the ${s} runbook.`,
};
const say = (subject: string, predicate: PredicateName, value: string) => {
  const template = CLAIM[predicate];
  if (template === undefined) throw new Error(`no template for ${predicate}`);
  return template(subject, value);
};
/** "25 July 2026" -> "July 25, 2026"; the reformatting an LLM draft commonly does. */
const usDate = (value: string) => value.replace(/(\d{1,2}) ([A-Z][a-z]+) (\d{4})/, '$2 $1, $3');

const rows: Row[] = [];
const add = (kind: string, label: Label, subject: string, predicate: PredicateName, value: string, passage: string, source: string) =>
  rows.push({ id: `csp-${String(rows.length + 1).padStart(3, '0')}`, claim: say(subject, predicate, value), value, passage, label, source, kind });

const answers = corpus.questions.flatMap((q) => (q.expected.type === 'answer' ? [{ q, key: q.expected.claimKey }] : []));

// Positives: every gold answer restated as a draft sentence, against its own quote.
for (const { q, key } of answers) {
  const c = claims.get(key)!;
  add('positive', 'supported', c.subject, c.predicate, c.objectText, c.quote, `${q.id} ${key}`);
}
// Positives: dates reformatted the way a draft might write them.
for (const { q, key } of answers) {
  const c = claims.get(key)!;
  if (c.predicate !== 'launch_date' && c.predicate !== 'migration_window') continue;
  add('positive_reformatted', 'supported', c.subject, c.predicate, usDate(c.objectText), c.quote, `${q.id} ${key}`);
}
// Negatives: a superseded value stated as current, against the correction that replaced it.
// Positives: the same superseded value against its own original quote, which does state it.
for (const { q, key } of answers.filter(({ q }) => q.kind === 'revised')) {
  const current = claims.get(key)!;
  const old = claims.get(current.supersedes!)!;
  add('superseded_as_current', 'not_supported', old.subject, old.predicate, old.objectText, current.quote, `${q.id} ${old.key} vs ${key}`);
  add('superseded_both_lines', 'not_supported', old.subject, old.predicate, old.objectText, `${old.quote} ${current.quote}`, `${q.id} ${old.key}+${key}`);
  add('positive_original_quote', 'supported', old.subject, old.predicate, old.objectText, old.quote, `${q.id} ${old.key}`);
}
// Negatives: a retracted value stated as current, against the retraction.
for (const q of corpus.questions.filter((item) => item.kind === 'retracted')) {
  const asserted = find(q.subject, q.predicate, 'assert')[0]!;
  const retraction = find(q.subject, q.predicate, 'retract')[0]!;
  add('retracted_as_current', 'not_supported', q.subject, q.predicate, asserted.objectText, retraction.quote, `${q.id} ${asserted.key} vs ${retraction.key}`);
}
// Negatives: one side of a live contradiction, against the other side's quote.
for (const q of corpus.questions.filter((item) => item.kind === 'contradicted')) {
  const [a, b] = find(q.subject, q.predicate, 'assert');
  add('contradicted_other_side', 'not_supported', q.subject, q.predicate, a!.objectText, b!.quote, `${q.id} ${a!.key} vs ${b!.key}`);
}
// Negatives: the right subject and passage with another subject's value for the same property.
const stableAndHop = answers.filter(({ q }) => q.kind === 'stable' || q.kind === 'multi_hop').map(({ q, key }) => ({ q, c: claims.get(key)! }));
for (const [i, { q, c }] of stableAndHop.entries()) {
  // The next row (wrapping) that holds a different value for the same property.
  const rotated = [...stableAndHop.slice(i + 1), ...stableAndHop.slice(0, i)];
  const other = rotated.find((item) => item.c.predicate === c.predicate && item.c.objectText !== c.objectText);
  if (other === undefined) continue;
  add('wrong_value', 'not_supported', c.subject, c.predicate, other.c.objectText, c.quote, `${q.id} ${c.key} with value of ${other.c.key}`);
}
// Negatives: a true-sounding sentence whose value appears in the passage, but for a different subject.
const SAME_VALUE_OTHER_SUBJECT: readonly [string, PredicateName, string, string][] = [
  // [claim subject, predicate, value, key of the passage that states the value for someone else]
  ['Foxglove', 'beta_partner', 'Stonecrop', 'Cindermark::beta_partner'],
  ['Cindermark', 'beta_partner', 'Stonecrop', 'Foxglove::beta_partner'],
  ['Larkspur', 'beta_partner', 'Northfold', 'Inkwell::beta_partner'],
  ['Wrenfield', 'owner', 'Mei Lin Chow', 'Coppice::owner'],
  ['Coppice', 'owner', 'Priya Raman', 'Marrowdale::owner'],
  ['Quillon', 'region', 'Frankfurt', 'search-shard::region'],
  ['Bellwether', 'beta_partner', 'Millbrace', 'Foxglove::beta_partner'],
  ['Ostara', 'region', 'Frankfurt', 'Quillon::region'],
];
for (const [subject, predicate, value, prefix] of SAME_VALUE_OTHER_SUBJECT) {
  const passage = [...claims.values()].find((c) => c.key.startsWith(`${prefix}::`) && c.objectText === value);
  if (passage === undefined) throw new Error(`no passage stating ${value} under ${prefix}`);
  add('other_subject_same_value', 'not_supported', subject, predicate, value, passage.quote, `${passage.key}`);
}
// Negatives: a correct answer sentence paired with evidence about a different subject.
for (let i = 0; i < stableAndHop.length; i += 2) {
  const { q, c } = stableAndHop[i]!;
  const other = stableAndHop.find((item) => item.c.predicate === c.predicate && item.c.subject !== c.subject);
  if (other === undefined) continue;
  add('other_subject', 'not_supported', c.subject, c.predicate, c.objectText, other.c.quote, `${q.id} ${c.key} vs ${other.c.key}`);
}

const supported = rows.filter((row) => row.label === 'supported').length;
writeFileSync(new URL('../artifacts/eval/claim-support-pairs.json', import.meta.url), `${JSON.stringify({
  about: [
    'Claim-support pairs for measuring the optional reranker claim verifier against a no-model baseline.',
    'Built by scripts/build-claim-support-pairs.ts from the seeded demo corpus (src/corpus, seed lacuna-demo-v1): its gold answers and evidence-span annotations.',
    'Labels follow the construction rule in each row\'s kind and were then read row by row to confirm them. Hand-checked, not crowd-labelled, and small: treat differences of a few rows as noise.',
    'The passage is a single quote (or two adjacent quotes for superseded_both_lines) judged in isolation, without the standing the resolver attaches.',
  ],
  seed: corpus.seed,
  counts: { total: rows.length, supported, not_supported: rows.length - supported },
  rows,
}, null, 2)}\n`);
console.log(`${rows.length} rows, ${supported} supported, ${rows.length - supported} not_supported`);
