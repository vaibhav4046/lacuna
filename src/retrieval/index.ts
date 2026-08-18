export { RetrievalConsistencyError, RetrievalDecodeError, RetrievalError } from './errors.js';
export { buildPackageName, buildQuestion, MAX_TERM_CHARS, parseBlast, parseVia } from './question.js';
export { ask, DEFAULT_QUERY_TIMEOUT_MS, type AskOptions } from './fetch.js';
export {
  affectedText,
  blastRadius,
  computeBlast,
  liveDependencyEdges,
  MAX_BLAST_DEPTH,
  type AffectedService,
  type BlastAnswer,
  type BlastRadius,
  type BlastStep,
} from './blast.js';
export { citedClaims, resolve, selectHopTarget, type HopSelection } from './resolve.js';
export {
  claimsAbout,
  contradictionPartners,
  dependentsOf,
  entityByName,
  evidenceForClaim,
  MAX_SUPERSESSION_DEPTH,
  mentionsFrom,
  supersededByClaim,
} from './queries.js';
export {
  decodeClaims,
  decodeDependents,
  decodeEntity,
  decodeEvidence,
  decodeMentions,
  type DependentEdge,
  type EntityHead,
  type Row,
} from './decode.js';
export type {
  Answer,
  ClaimRecord,
  EvidenceRecord,
  Hop,
  Mention,
  Outcome,
  Polarity,
  QueryTrace,
  Resolution,
  RetrievalQuestion,
  SubgraphView,
  SubjectView,
} from './types.js';
