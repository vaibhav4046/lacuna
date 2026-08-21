/**
 * A typed question, read out of a sentence somebody actually wrote.
 *
 * The resolver takes a subject and a predicate. Nobody types that. A judge with
 * three minutes types "who owns checkout?" into the first box, gets nothing
 * back, and concludes the product cannot answer questions — which is the exact
 * opposite of true, and an entirely self-inflicted wound.
 *
 * So this reads the sentence. What it deliberately is **not** is a model. The
 * whole argument of this project is that what is current gets decided by a
 * resolver with evidence rather than by something that predicts plausible text,
 * and putting a model on the front of that path would mean a wrong answer could
 * come from the model misreading the question while every screen still showed a
 * confident quotation. A known list of names and a closed set of predicates is
 * enough, it runs in microseconds, and it can show its work.
 *
 * The predicates are **not** hardcoded. The first version of this file carried
 * a hand-written vocabulary, and it invented three properties the corpus does
 * not record while missing six it does — which would have turned every question
 * about a real property into a confident refusal. So the caller supplies the
 * predicates the subject actually holds, read from the store, and the synonym
 * table below only maps English onto that list rather than defining it.
 *
 * Showing its work is the point of `matched`: the product says "read as
 * Checkout · owner, from your words 'who owns'" and the reader can see it was
 * understood before they read the answer. A parser that silently guesses wrong
 * is worse than one that asks.
 */

/** How a question failed to parse, when it did. */
export type PlanFailure = 'no_subject' | 'no_predicate' | 'empty';

export interface PlannedQuestion {
  readonly subject: string;
  readonly predicate: string;
  /** Second subject for a multi-hop question, when the sentence names a path. */
  readonly via: string | null;
  /** The words that selected each part, so the product can show its reading. */
  readonly matched: { readonly subject: string; readonly predicate: string };
}

/**
 * English for predicates, mapped onto whatever the store actually holds.
 *
 * Every entry is a *candidate*: it only ever selects a predicate the subject
 * already has. An entry naming something the store does not record simply never
 * fires, which is why adding a phrase here cannot invent a property.
 */
const SYNONYMS: readonly (readonly [string, readonly string[]])[] = [
  ['owner', ['owned by', 'owner of', 'owner', 'owns', 'own', 'maintainer', 'maintains', 'responsible for', 'accountable for', 'looks after', 'who runs']],
  ['runbook_owner', ['runbook owner', 'runbook', 'who is paged', 'paged for']],
  ['depends_on', ['depends on', 'dependencies', 'dependency', 'depend on', 'depends', 'depend', 'requires', 'require', 'needs', 'uses', 'built on', 'downstream of', 'upstream of']],
  ['pool_size', ['connection pool size', 'connection pool', 'pool size', 'pool', 'connections', 'capacity']],
  ['region', ['region', 'deployed in', 'hosted in', 'located in', 'zone', 'datacentre', 'datacenter']],
  ['launch_date', ['launch date', 'launching', 'launches', 'launch', 'ship date', 'ships', 'go live', 'release date']],
  ['migration_window', ['migration window', 'migration', 'maintenance window', 'cutover']],
  ['beta_partner', ['beta partner', 'beta', 'pilot partner', 'design partner']],
  ['budget_code', ['budget code', 'budget', 'cost centre', 'cost center', 'charge code']],
  ['on_call_length', ['on call length', 'on call rotation', 'rotation length', 'on call', 'oncall', 'shift length']],
  ['contact', ['contact', 'point of contact', 'reach out to', 'escalation contact']],
  ['status', ['status', 'state of', 'progress']],
];

/**
 * Predicates the product understands the English for, whatever a subject holds.
 *
 * A property this list names but the subject does not record is still a real
 * question, and the resolver has a real answer for it: nothing states it. That
 * answer — evidenced absence — is the whole point of this product, and letting
 * the parser short-circuit it would replace the strongest thing it does with a
 * shrug. A word in neither this list nor the subject's own claims is the only
 * case that is genuinely unreadable.
 */
export const UNDERSTOOD_PREDICATES: readonly string[] = SYNONYMS.map(([name]) => name);

/** Strips punctuation and folds separators so "trace collector" finds "trace-collector". */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Names the sentence holds, in the order it names them.
 *
 * Two rules doing different jobs. Length settles *overlap*: a workspace holding
 * both `replay-queue` and `queue` must not answer a question about the replay
 * queue with whatever it knows about queues. Position settles *role*: the first
 * one named is the thing being asked about, and the second is the hop. Sorting
 * by length instead would silently swap those and answer a different question.
 */
export function subjectsIn(text: string, known: readonly string[]): readonly string[] {
  const haystack = ` ${fold(text)} `;
  const byLength = known
    .filter((name) => haystack.includes(` ${fold(name)} `))
    .sort((a, b) => b.length - a.length);

  const distinct = byLength.filter((name, at) =>
    !byLength.slice(0, at).some((longer) => fold(longer).includes(fold(name))));

  return [...distinct].sort((a, b) => haystack.indexOf(` ${fold(a)} `) - haystack.indexOf(` ${fold(b)} `));
}

/**
 * The predicate being asked for, chosen only from ones that exist.
 *
 * `available` is what the store holds for this subject, so a question about a
 * property nothing records is refused rather than answered about a neighbouring
 * property. Each candidate is tried by its own name first — `runbook_owner`
 * matches the words "runbook owner" with no table involved — and then by the
 * synonyms, so a workspace built from a pasted transcript gets sensible
 * matching for predicates this file has never heard of.
 *
 * Earliest match wins. "Who owns the service Bellwether depends on" holds both
 * `owns` and `depends on` and is a question about ownership: English puts what
 * is being asked for at the front and the qualification behind it. Length only
 * breaks a tie between phrases starting at the same word, which is what lets
 * "connection pool size" beat "pool" without letting a trailing phrase win.
 */
export function predicateIn(
  text: string,
  available: readonly string[],
): { predicate: string; matched: string } | null {
  const haystack = ` ${fold(text)} `;

  // Every phrase that could select an available predicate. Built first rather
  // than folded in a closure, because a closure that writes to an outer `let`
  // defeats the narrowing and makes the result read as `never` afterwards.
  const cues: { predicate: string; word: string }[] = [];
  for (const predicate of available) {
    // Its own name, spelled the way a person would write it.
    cues.push({ predicate, word: predicate.replace(/_/g, ' ') });
    for (const [name, words] of SYNONYMS) {
      if (name !== predicate) continue;
      for (const word of words) cues.push({ predicate, word });
    }
  }

  const hits = cues
    .map((cue) => ({ ...cue, at: haystack.indexOf(` ${fold(cue.word)} `) }))
    .filter((cue) => cue.at >= 0)
    // Earliest wins; length only breaks a tie at the same position.
    .sort((a, b) => (a.at === b.at ? b.word.length - a.word.length : a.at - b.at));

  // A concrete object noun must beat a generic ownership verb. In questions
  // such as "Who owns the billing-gate runbook?", `owns` appears first but the
  // thing being owned is explicitly the runbook. Reading that as the generic
  // `owner` predicate produces a truthful-looking answer to the wrong
  // property. Keep the general earliest-cue rule for multi-hop questions, but
  // let this unambiguous domain noun select the more specific predicate.
  if (haystack.includes(' runbook ')) {
    const runbookOwner = hits.find((hit) => hit.predicate === 'runbook_owner');
    if (runbookOwner !== undefined) {
      return { predicate: runbookOwner.predicate, matched: runbookOwner.word };
    }
  }

  const best = hits[0];
  return best === undefined ? null : { predicate: best.predicate, matched: best.word };
}
