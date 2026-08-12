/**
 * Every name in the corpus, invented for this repository.
 *
 * Nothing here is lifted from a real company, a real product, a real person or
 * any earlier project. The pools are sized so that thread planning can hand out
 * distinct subjects without running out and without reusing a name where reuse
 * would change what a question means.
 */

/** Project names. Subjects for the delivery-facing predicates. */
export const PROJECTS: readonly string[] = [
  'Meridian',
  'Ostara',
  'Vireo',
  'Cindermark',
  'Halcyon',
  'Larkspur',
  'Ninebark',
  'Quillon',
  'Saltmarsh',
  'Thornfield',
  'Wrenfield',
  'Ashgrove',
  'Bellwether',
  'Coppice',
  'Dovetail',
  'Everstone',
  'Foxglove',
  'Gallowtree',
  'Harrowfield',
  'Inkwell',
  'Junco',
  'Kestrel',
  'Lowbank',
  'Marrowdale',
];

/** Service names. Subjects for the operational predicates. */
export const SERVICES: readonly string[] = [
  'ledger-api',
  'ingest-worker',
  'notify-relay',
  'tenant-router',
  'audit-sink',
  'media-thumbs',
  'search-shard',
  'billing-gate',
  'replay-queue',
  'schema-guard',
  'quota-broker',
  'trace-collector',
  'session-mint',
  'export-runner',
  'edge-cache',
  'dead-letter-sweeper',
];

/**
 * Suppliers. These are both objects of `vendor` claims and subjects of their
 * own `contact` claims, which is what makes a two hop question possible.
 */
export const VENDORS: readonly string[] = [
  'Northfold',
  'Baycross',
  'Emberline',
  'Grovewell',
  'Halverd',
  'Ironwick',
  'Kingsloe',
  'Lathefield',
  'Millbrace',
  'Netherby',
  'Pellmoor',
  'Quarrenden',
  'Rushmere',
  'Stonecrop',
];

export const PEOPLE: readonly string[] = [
  'Priya Raman',
  'Tomas Herrera',
  'Anneke Vos',
  'Daniel Okafor',
  'Mei Lin Chow',
  'Rasmus Berg',
  'Farah Haddad',
  'Ivo Petrov',
  'Clara Nwosu',
  'Sofia Marchetti',
  'Hiroshi Tanabe',
  'Yara Bekele',
  'Lucas Duarte',
  'Nadia Salmi',
];

export const TEAMS: readonly string[] = [
  'Platform',
  'Payments',
  'Growth',
  'Trust',
  'Data',
  'Mobile',
];

export const REGIONS: readonly string[] = [
  'Frankfurt',
  'Dublin',
  'Oregon',
  'Singapore',
  'Sydney',
  'Toronto',
];

export const STATUSES: readonly string[] = [
  'paused',
  'in review',
  'shipping',
  'blocked',
  'scoped',
  'archived',
];

/**
 * Subjects that exist only inside questions. They are never claimed about,
 * never mentioned in filler, and never used as a value, which is what makes
 * `out_of_scope` structurally different from `never_stated` rather than a
 * matter of degree. A test asserts none of these strings occurs in any message.
 */
export const OUT_OF_SCOPE_SUBJECTS: readonly string[] = [
  'Redshank',
  'Windrose',
  'Yarrowmere',
  'Zephyrgate',
  'Brackenhall',
  'Duskmoor',
  'Fenwillow',
  'Gildenhark',
];

export const MONTHS: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const SESSION_TOPICS: readonly string[] = [
  'weekly sync',
  'delivery review',
  'operations check-in',
  'planning call',
  'incident follow-up',
  'roadmap catch-up',
  'vendor review',
  'handover notes',
];
