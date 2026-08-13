export { RetrievalConsistencyError, RetrievalDecodeError, RetrievalError } from './errors';
export { buildQuestion, MAX_TERM_CHARS, parseVia } from './question';
export { ask, DEFAULT_QUERY_TIMEOUT_MS, type AskOptions } from './fetch';
export { citedClaims, resolve, selectHopTarget, type HopSelection } from './resolve';
export {
  claimsAbout,
  contradictionPartners,
  entityByName,
  evidenceForClaim,
  MAX_SUPERSESSION_DEPTH,
  mentionsFrom,
  supersededByClaim,
} from './queries';
export {
  decodeClaims,
  decodeEntity,
  decodeEvidence,
  decodeMentions,
  type EntityHead,
  type Row,
} from './decode';
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
} from './types';
