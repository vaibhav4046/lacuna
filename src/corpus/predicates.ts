import type { Rng } from './rng.js';
import type { PredicateName } from './types.js';
import { MONTHS, PACKAGES, PEOPLE, REGIONS, STATUSES, VENDORS } from './vocab.js';

/**
 * How each predicate is asked, asserted, corrected and withdrawn.
 *
 * The wording carries load. A `revise` sentence says "correction" out loud,
 * because a revision is annotated and produces a SUPERSEDES edge. An `assert`
 * sentence never does, which is what lets two `assert` claims about the same
 * subject and predicate stand as a real contradiction instead of being ordered
 * by timestamp and quietly resolved. Extracting that distinction from free text
 * is a separate research problem and is out of scope here: the corpus is
 * annotated, and the repository says so.
 */

export interface PredicateValue {
  readonly text: string;
  /** Set when the value is an entity that deserves its own node. */
  readonly entity: string | null;
}

export interface PredicateSpec {
  readonly name: PredicateName;
  readonly ask: (subject: string) => string;
  readonly assert: (subject: string, value: string) => string;
  readonly revise: (subject: string, value: string) => string;
  readonly retract: (subject: string) => string;
  readonly value: (rng: Rng) => PredicateValue;
}

const ON_CALL_LENGTHS: readonly string[] = ['5 days', '7 days', '10 days', '14 days'];

function plain(text: string): PredicateValue {
  return { text, entity: null };
}

function entity(name: string): PredicateValue {
  return { text: name, entity: name };
}

/** A prose date such as `12 September 2025`. Never a real calendar lookup. */
export function proseDate(rng: Rng): string {
  const day = rng.between(1, 28);
  const month = rng.pick(MONTHS);
  const year = rng.between(2025, 2026);
  return `${day} ${month} ${year}`;
}

const SPECS: Readonly<Record<PredicateName, PredicateSpec>> = {
  launch_date: {
    name: 'launch_date',
    ask: (s) => `When does ${s} launch?`,
    assert: (s, v) => `${s} is scheduled to launch on ${v}.`,
    revise: (s, v) => `Correction on ${s}: the launch moved to ${v}.`,
    retract: (s) => `We have pulled the launch date for ${s} and there is no date on it now.`,
    value: (rng) => plain(proseDate(rng)),
  },
  owner: {
    name: 'owner',
    ask: (s) => `Who owns ${s}?`,
    assert: (s, v) => `${s} is owned by ${v}.`,
    revise: (s, v) => `Correction on ${s}: ownership moved to ${v}.`,
    retract: (s) => `Ownership of ${s} was handed back and nobody holds it now.`,
    value: (rng) => entity(rng.pick(PEOPLE)),
  },
  vendor: {
    name: 'vendor',
    ask: (s) => `Which vendor supplies ${s}?`,
    assert: (s, v) => `${s} is supplied by ${v}.`,
    revise: (s, v) => `Correction on ${s}: the supplier is now ${v}.`,
    retract: (s) => `We ended the supplier arrangement for ${s} and have not replaced it.`,
    value: (rng) => entity(rng.pick(VENDORS)),
  },
  contact: {
    name: 'contact',
    ask: (s) => `Who is our contact at ${s}?`,
    assert: (s, v) => `Our contact at ${s} is ${v}.`,
    revise: (s, v) => `Correction on ${s}: our contact there is now ${v}.`,
    retract: (s) => `Our contact at ${s} left and nobody has replaced them.`,
    value: (rng) => entity(rng.pick(PEOPLE)),
  },
  status: {
    name: 'status',
    ask: (s) => `What is the status of ${s}?`,
    assert: (s, v) => `${s} is ${v} right now.`,
    revise: (s, v) => `Correction on ${s}: it is ${v} now.`,
    retract: (s) => `We stopped tracking a status on ${s}.`,
    value: (rng) => plain(rng.pick(STATUSES)),
  },
  budget_code: {
    name: 'budget_code',
    ask: (s) => `What budget code does ${s} bill to?`,
    assert: (s, v) => `${s} bills to ${v}.`,
    revise: (s, v) => `Correction on ${s}: it bills to ${v} from now on.`,
    retract: (s) => `${s} bills to no code any more because the line was closed.`,
    value: (rng) => plain(`BC-${rng.between(1000, 9999)}`),
  },
  region: {
    name: 'region',
    ask: (s) => `Which region does ${s} run in?`,
    assert: (s, v) => `${s} runs in ${v}.`,
    revise: (s, v) => `Correction on ${s}: it runs in ${v} now.`,
    retract: (s) => `${s} is not pinned to a region any more.`,
    value: (rng) => plain(rng.pick(REGIONS)),
  },
  migration_window: {
    name: 'migration_window',
    ask: (s) => `When is the migration window for ${s}?`,
    assert: (s, v) => `The migration window for ${s} is ${v}.`,
    revise: (s, v) => `Correction on ${s}: the migration window is now ${v}.`,
    retract: (s) => `The migration window for ${s} was dropped and not rebooked.`,
    value: (rng) => plain(`the weekend of ${proseDate(rng)}`),
  },
  beta_partner: {
    name: 'beta_partner',
    ask: (s) => `Who is the beta partner for ${s}?`,
    assert: (s, v) => `The beta partner for ${s} is ${v}.`,
    revise: (s, v) => `Correction on ${s}: the beta partner is now ${v}.`,
    retract: (s) => `We dropped the beta partner for ${s} and have not signed another.`,
    value: (rng) => entity(rng.pick(VENDORS)),
  },
  on_call_length: {
    name: 'on_call_length',
    ask: (s) => `How long is an on-call rotation for ${s}?`,
    assert: (s, v) => `On-call for ${s} runs ${v}.`,
    revise: (s, v) => `Correction on ${s}: on-call runs ${v} now.`,
    retract: (s) => `${s} no longer has an on-call rotation of its own.`,
    value: (rng) => plain(rng.pick(ON_CALL_LENGTHS)),
  },
  runbook_owner: {
    name: 'runbook_owner',
    ask: (s) => `Who maintains the runbook for ${s}?`,
    assert: (s, v) => `The runbook for ${s} is maintained by ${v}.`,
    revise: (s, v) => `Correction on ${s}: the runbook is maintained by ${v} now.`,
    retract: (s) => `Nobody maintains the runbook for ${s} since the last handover.`,
    value: (rng) => entity(rng.pick(PEOPLE)),
  },
  data_region_policy: {
    name: 'data_region_policy',
    ask: (s) => `What is the data region policy for ${s}?`,
    assert: (s, v) => `Data for ${s} stays in ${v}.`,
    revise: (s, v) => `Correction on ${s}: data for it stays in ${v} now.`,
    retract: (s) => `${s} has no data region policy any more.`,
    value: (rng) => plain(rng.pick(REGIONS)),
  },
  depends_on: {
    name: 'depends_on',
    ask: (s) => `What does ${s} depend on?`,
    assert: (s, v) => `${s} depends on ${v}.`,
    revise: (s, v) => `Correction on ${s}: it depends on ${v} now.`,
    retract: (s) => `We removed the dependency from ${s} and put nothing in its place.`,
    value: (rng) => entity(rng.pick(PACKAGES)),
  },
};

/**
 * Predicates where several live assertions coexist by design: a service that
 * depends on three packages holds three true claims, not one contradiction.
 * Ingestion consults this set before drawing CONTRADICTS edges, and resolution
 * consults it before abstaining over multiple live values.
 */
export const MULTI_VALUED_PREDICATES: ReadonlySet<string> = new Set<PredicateName>([
  'depends_on',
]);

export function predicateSpec(name: PredicateName): PredicateSpec {
  return SPECS[name];
}

/** Predicates that make sense about a project. */
export const PROJECT_PREDICATES: readonly PredicateName[] = [
  'launch_date',
  'owner',
  'status',
  'budget_code',
  'region',
  'migration_window',
  'beta_partner',
];

/** Predicates that make sense about a service. */
export const SERVICE_PREDICATES: readonly PredicateName[] = [
  'owner',
  'status',
  'region',
  'on_call_length',
  'runbook_owner',
  'data_region_policy',
  'migration_window',
  'budget_code',
];

/** Predicates that make sense about a vendor. */
export const VENDOR_PREDICATES: readonly PredicateName[] = ['contact', 'region', 'status'];
