/**
 * What is built, and what the numbers on a page are made of.
 *
 * Two small unions, kept together because they answer the same question from
 * two directions. A capability state says how far a feature got. A data state
 * says where the values it displays came from. A screenshot of a feature that
 * is `VERIFIED` reading `SEEDED_DEMO` data is honest; the same screenshot with
 * the second half left off is not, which is why both are named here rather
 * than left to prose.
 *
 * These are read by the interface pages and by docs/CLAIMS.json. One union,
 * two readers, so a sixth state cannot appear in one and not the other.
 */

/** How far a capability actually got. */
export const CAPABILITY_STATES = [
  'NOT_STARTED',
  'PARTIAL',
  'VERIFIED',
  'BLOCKED',
  'REMOVED',
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/** Where the values a capability shows actually came from. */
export const DATA_STATES = [
  'LIVE',
  'SEEDED_DEMO',
  'FIXTURE',
  'RECORDED',
  'UNAVAILABLE',
] as const;

export type DataState = (typeof DATA_STATES)[number];

const CAPABILITY_MEANINGS: Readonly<Record<CapabilityState, string>> = {
  NOT_STARTED: 'No code exists for it. Named here so its absence is on the record '
    + 'rather than discovered later.',
  PARTIAL: 'Some of it runs. The part that runs has been exercised; the rest has '
    + 'not, and the gap is stated wherever it is shown.',
  VERIFIED: 'It runs and has been exercised end to end in this repository, with '
    + 'the command and its output committed.',
  BLOCKED: 'It cannot proceed without something outside this repository. The '
    + 'missing thing is named in NEEDS_VAIBHAV.md.',
  REMOVED: 'It existed and was taken out. Kept in the list so a reader who '
    + 'remembers it is told what happened.',
};

const DATA_MEANINGS: Readonly<Record<DataState, string>> = {
  LIVE: 'Read from the running HydraDB instance at request time.',
  SEEDED_DEMO: 'Read from the graph, which was loaded from the generated corpus '
    + 'in this repository. Real reads over known content.',
  FIXTURE: 'A committed file in tests. Never shown on a page that claims a '
    + 'measurement.',
  RECORDED: 'The committed output of a run that happened once, with the commit '
    + 'that produced it named beside it.',
  UNAVAILABLE: 'There is no value. The place it would go says so instead of '
    + 'showing a plausible one.',
};

export function explainCapability(state: CapabilityState): string {
  return CAPABILITY_MEANINGS[state];
}

export function explainData(state: DataState): string {
  return DATA_MEANINGS[state];
}
