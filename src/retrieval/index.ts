export { RetrievalConsistencyError, RetrievalDecodeError, RetrievalError } from './errors.js';
export { buildQuestion, MAX_TERM_CHARS, parseVia } from './question.js';
export { ask, DEFAULT_QUERY_TIMEOUT_MS, type AskOptions } from './fetch.js';
export { citedClaims, resolve, selectHopTarget, type HopSelection } from './resolve.js';
export {
  claimsAbout,
  contradictionPartners,
  entityByName,
  evidenceForClaim,
  MAX_SUPERSESSION_DEPTH,
  mentionsFrom,
  supersededByClaim,
} from './queries.js';
export {
  decodeClaims,
  decodeEntity,
  decodeEvidence,
  decodeMentions,
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
