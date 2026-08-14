import type { Rng } from './rng.js';
import { PROJECTS, SERVICES, SESSION_TOPICS, TEAMS, VENDORS } from './vocab.js';

/**
 * Text around the claims.
 *
 * Filler names subjects and never states a value for one. That is deliberate:
 * a lexical or vector retriever should find plenty of high scoring text about
 * the right subject and still find no answer in it, which is exactly the
 * situation `never_stated` is supposed to catch. Out of scope names appear
 * nowhere here, so `out_of_scope` stays a different situation and not a weaker
 * version of the same one.
 */

const LEADS: readonly string[] = [
  'We came back to {s} for a few minutes.',
  '{s} was on the list again this week.',
  'Someone raised {s} in the channel beforehand.',
  'I had the notes for {s} open going into this.',
  'There is still an open thread on {s}.',
  'We were asked for an update on {s}.',
  '{s} took up most of the first half.',
  'Quick one on {s} before the rest.',
];

const TAILS: readonly string[] = [
  'Nothing else moved on it.',
  'We can pick the rest up next time.',
  'I will put the detail in the written summary.',
  'That was the only change worth recording.',
  'The rest of it is unchanged.',
  'No other decisions came out of that part.',
];

const USER_FILLER: readonly string[] = [
  'Nothing new on {s} this week, we are waiting on the review.',
  'The {t} team asked about {s} again but there is nothing to report.',
  'I read back through the older notes on {s} and they still match.',
  'We deferred the {s} discussion, it needs more people in the room.',
  '{s} is where it was, no movement to record.',
  'Someone will pick up {s} once the current work clears.',
  'We skipped {s} today, the owner was not on the call.',
  'I have nothing to add on {s} beyond what is already written down.',
];

const ASSISTANT_FILLER: readonly string[] = [
  'Noted. I have put that against the earlier entry so the two read together.',
  'Understood. Nothing there changes what I already have written down for it.',
  'Got it. I have recorded that as stated and left the surrounding notes alone.',
  'Thanks. That is written down, and I have not touched anything else in the thread.',
  'Understood. I will keep the previous note as it stands until something replaces it.',
  'Recorded. Carry on whenever you are ready and I will keep following along.',
  'That is captured against the same subject as the earlier notes on it.',
  'Fine. I have it, and it sits alongside what was said about this before.',
];

/** Subjects safe to mention in filler. Out of scope names are excluded. */
const MENTIONABLE: readonly string[] = [...PROJECTS, ...SERVICES, ...VENDORS];

function fill(template: string, subject: string, team: string): string {
  return template.split('{s}').join(subject).split('{t}').join(team);
}

export function mentionableSubject(rng: Rng): string {
  return rng.pick(MENTIONABLE);
}

export function leadSentence(rng: Rng, subject: string): string {
  return fill(rng.pick(LEADS), subject, rng.pick(TEAMS));
}

export function tailSentence(rng: Rng): string {
  return rng.pick(TAILS);
}

export function fillerText(rng: Rng, speaker: 'user' | 'assistant'): string {
  if (speaker === 'assistant') {
    return rng.pick(ASSISTANT_FILLER);
  }
  return fill(rng.pick(USER_FILLER), mentionableSubject(rng), rng.pick(TEAMS));
}

export function sessionTitle(rng: Rng): string {
  return `${rng.pick(TEAMS)} ${rng.pick(SESSION_TOPICS)}`;
}
