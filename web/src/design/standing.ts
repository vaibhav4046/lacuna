/**
 * How a piece of evidence is labelled, and in what colour.
 *
 * One table rather than a conditional per screen, because the same claim has to
 * read the same way on the Ask page, the judge board and anywhere else evidence
 * is rendered. The vocabulary is the canonical one the shared core produces; no
 * screen invents a state of its own.
 *
 * `CURRENT · CONFLICTING` is the one worth reading twice. Two live claims that
 * disagree are both current, and neither replaced the other, which is why the
 * resolver refuses to pick between them.
 */
export type EvidenceStanding =
  | 'current'
  | 'current_conflicting'
  | 'superseded'
  | 'withdrawal_current'
  | 'proposal';

export const STANDING_LABEL: Readonly<Record<EvidenceStanding, string>> = {
  current: 'SUPPORTS THE ANSWER',
  current_conflicting: 'CURRENT · CONFLICTING',
  superseded: 'SUPERSEDED',
  withdrawal_current: 'WITHDRAWAL · CURRENT',
  proposal: 'PROPOSAL · NEVER CURRENT',
};

export const STANDING_COLOUR: Readonly<Record<EvidenceStanding, string>> = {
  current: '#FFB829',
  current_conflicting: '#FFB829',
  superseded: '#7A7A7A',
  withdrawal_current: '#BDBDBD',
  proposal: '#7A7A7A',
};
