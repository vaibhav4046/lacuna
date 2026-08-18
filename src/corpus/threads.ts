import { at, CorpusError } from './errors.js';
import type { PredicateValue } from './predicates.js';
import {
  predicateSpec,
  PROJECT_PREDICATES,
  SERVICE_PREDICATES,
  VENDOR_PREDICATES,
} from './predicates.js';
import type { Rng } from './rng.js';
import type { ClaimKind, GoldQuestion, PredicateName, ThreadKind } from './types.js';
import { OUT_OF_SCOPE_SUBJECTS, PACKAGES, PROJECTS, SERVICES, VENDORS } from './vocab.js';

/**
 * Thread planning decides what is claimed, corrected, withdrawn and never said.
 * It does not decide where any of it appears: placement into sessions and
 * messages is `transcript.ts`, and node ids and edges are ingestion's job.
 *
 * The important structure here is that `multi_hop` and `unconnected` ask the
 * same shaped question. Both are "who is our contact for the vendor behind X",
 * both need the vendor claim followed to a second subject, and they differ only
 * in whether the terminal contact claim exists. A retriever cannot tell them
 * apart by keyword overlap, only by walking the graph and finding out.
 */

export interface PlannedClaim {
  readonly key: string;
  readonly subject: string;
  readonly predicate: PredicateName;
  readonly kind: ClaimKind;
  readonly objectText: string;
  readonly objectEntity: string | null;
  readonly supersedes: string | null;
  /** The exact sentence the message will contain, which is also the evidence quote. */
  readonly sentence: string;
}

export interface Thread {
  readonly id: string;
  readonly kind: ThreadKind;
  readonly claims: readonly PlannedClaim[];
}

export interface ThreadPlan {
  readonly threads: readonly Thread[];
  readonly questions: readonly GoldQuestion[];
}

const STABLE_COUNT = 12;
const REVISED_COUNT = 8;
const TWICE_REVISED_COUNT = 2;
const RETRACTED_COUNT = 6;
const CONTRADICTED_COUNT = 6;
const MULTI_HOP_COUNT = 8;
const UNCONNECTED_COUNT = 6;
const NEVER_STATED_COUNT = 8;
const OUT_OF_SCOPE_COUNT = 6;
const BACKGROUND_CLAIMS = 42;
const BACKGROUND_REVISE_CHANCE = 0.25;
const VALUE_ATTEMPTS = 64;

/** Random dependencies on top of each service's anchored first package. */
const SERVICE_EXTRA_DEPENDENCY_MAX = 2;
/** Random dependencies from a package onto later indexed packages. */
const PACKAGE_DEPENDENCY_MAX = 2;
/**
 * A forced chain of package indices, head depending on middle depending on
 * tail, so a transitive closure of depth three exists on every seed.
 */
const DEPENDENCY_CHAIN = [0, 5, 12] as const;
/** Service indices forced onto the chain head, so one package is shared. */
const SHARED_DEPENDENT_SERVICES = [0, 1] as const;
/** The service whose dependency gets corrected, old index and new index. */
const REVISED_DEPENDENCY_SERVICE = 3;
const REVISED_DEPENDENCY_OLD = 19;
const REVISED_DEPENDENCY_NEW = 7;
/** Chain tail, chain head, chain middle, and the revision's new target. */
const BLAST_PACKAGE_INDICES = [12, 0, 5, 7] as const;
/** How many distinct packages the live dependency claims must touch. */
const MIN_PACKAGES_TOUCHED = 15;

function pad(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/**
 * Records every subject and predicate pair the corpus has used, and every pair
 * that must stay empty. Forbidding a pair before background generation runs is
 * what keeps an abstention question honest: nothing can wander in later and
 * quietly answer it.
 */
class Ledger {
  readonly #sequence = new Map<string, number>();
  readonly #forbidden = new Set<string>();
  readonly #claims: PlannedClaim[] = [];

  static pair(subject: string, predicate: PredicateName): string {
    return `${subject}::${predicate}`;
  }

  forbid(subject: string, predicate: PredicateName): void {
    const pair = Ledger.pair(subject, predicate);
    if (this.#sequence.has(pair)) {
      throw new CorpusError(`cannot forbid ${pair}, it already carries claims`);
    }
    this.#forbidden.add(pair);
  }

  isAvailable(subject: string, predicate: PredicateName): boolean {
    const pair = Ledger.pair(subject, predicate);
    return !this.#forbidden.has(pair) && !this.#sequence.has(pair);
  }

  claim(
    subject: string,
    predicate: PredicateName,
    kind: ClaimKind,
    value: PredicateValue | null,
    supersedes: string | null,
  ): PlannedClaim {
    const pair = Ledger.pair(subject, predicate);
    if (this.#forbidden.has(pair)) {
      throw new CorpusError(`(${subject}, ${predicate}) is forbidden and cannot take a claim`);
    }
    const sequence = (this.#sequence.get(pair) ?? 0) + 1;
    this.#sequence.set(pair, sequence);

    const spec = predicateSpec(predicate);
    let sentence: string;
    if (kind === 'retract') {
      sentence = spec.retract(subject);
    } else if (value === null) {
      throw new CorpusError(`a ${kind} claim about ${pair} needs a value`);
    } else if (kind === 'revise') {
      sentence = spec.revise(subject, value.text);
    } else {
      sentence = spec.assert(subject, value.text);
    }

    const claim: PlannedClaim = {
      key: `${subject}::${predicate}::${sequence}`,
      subject,
      predicate,
      kind,
      objectText: kind === 'retract' || value === null ? '' : value.text,
      objectEntity: kind === 'retract' || value === null ? null : value.entity,
      supersedes,
      sentence,
    };
    this.#claims.push(claim);
    return claim;
  }

  /** Sorted for determinism, so the caller's `pick` is reproducible. */
  predicatesUsedElsewhere(subject: string): PredicateName[] {
    const here = new Set<PredicateName>();
    const elsewhere = new Set<PredicateName>();
    for (const claim of this.#claims) {
      if (claim.subject === subject) {
        here.add(claim.predicate);
      } else {
        elsewhere.add(claim.predicate);
      }
    }
    return [...elsewhere].filter((name) => !here.has(name)).sort();
  }

  get claims(): readonly PlannedClaim[] {
    return this.#claims;
  }
}

/** A value the predicate can produce that is not one of `avoid`. */
function freshValue(rng: Rng, predicate: PredicateName, avoid: readonly string[]): PredicateValue {
  const spec = predicateSpec(predicate);
  for (let attempt = 0; attempt < VALUE_ATTEMPTS; attempt += 1) {
    const value = spec.value(rng);
    if (!avoid.includes(value.text)) {
      return value;
    }
  }
  throw new CorpusError(
    `no value for ${predicate} differs from the ${avoid.length} already used`,
  );
}

function openPredicate(
  rng: Rng,
  ledger: Ledger,
  subject: string,
  pool: readonly PredicateName[],
): PredicateName {
  const open = pool.filter((name) => ledger.isAvailable(subject, name));
  if (open.length === 0) {
    throw new CorpusError(`every predicate for ${subject} is taken or forbidden`);
  }
  return rng.pick(open);
}

export function planThreads(rng: Rng): ThreadPlan {
  const ledger = new Ledger();
  const threads: Thread[] = [];
  const questions: GoldQuestion[] = [];

  // Stable: asserted once, never touched again. The easy case, and the control.
  for (let i = 0; i < STABLE_COUNT; i += 1) {
    const subject = at(PROJECTS, i, 'stable subject');
    const predicate = openPredicate(rng, ledger, subject, PROJECT_PREDICATES);
    const claim = ledger.claim(subject, predicate, 'assert', freshValue(rng, predicate, []), null);
    threads.push({ id: `t-stable-${pad(i)}`, kind: 'stable', claims: [claim] });
    questions.push({
      id: `q-stable-${pad(i)}`,
      kind: 'stable',
      text: predicateSpec(predicate).ask(subject),
      subject,
      predicate,
      expected: { type: 'answer', text: claim.objectText, claimKey: claim.key },
    });
  }

  // Revised: asserted, then explicitly corrected. Two of them are corrected
  // twice, so a superseded claim can itself be superseded.
  for (let i = 0; i < REVISED_COUNT; i += 1) {
    const subject = at(PROJECTS, STABLE_COUNT + i, 'revised subject');
    const predicate = openPredicate(rng, ledger, subject, PROJECT_PREDICATES);
    const revisions = i < TWICE_REVISED_COUNT ? 2 : 1;

    const first = ledger.claim(subject, predicate, 'assert', freshValue(rng, predicate, []), null);
    const claims: PlannedClaim[] = [first];
    for (let r = 0; r < revisions; r += 1) {
      const previous = at(claims, claims.length - 1, 'previous revision');
      const seen = claims.map((claim) => claim.objectText);
      claims.push(
        ledger.claim(subject, predicate, 'revise', freshValue(rng, predicate, seen), previous.key),
      );
    }

    const latest = at(claims, claims.length - 1, 'latest revision');
    threads.push({ id: `t-revised-${pad(i)}`, kind: 'revised', claims });
    questions.push({
      id: `q-revised-${pad(i)}`,
      kind: 'revised',
      text: predicateSpec(predicate).ask(subject),
      subject,
      predicate,
      expected: { type: 'answer', text: latest.objectText, claimKey: latest.key },
    });
  }

  // Retracted: asserted, then withdrawn with nothing put in its place.
  const retractedSubjects = [...PROJECTS.slice(20, 24), ...SERVICES.slice(0, 2)];
  for (let i = 0; i < RETRACTED_COUNT; i += 1) {
    const subject = at(retractedSubjects, i, 'retracted subject');
    const pool = PROJECTS.includes(subject) ? PROJECT_PREDICATES : SERVICE_PREDICATES;
    const predicate = openPredicate(rng, ledger, subject, pool);
    const asserted = ledger.claim(
      subject,
      predicate,
      'assert',
      freshValue(rng, predicate, []),
      null,
    );
    const withdrawn = ledger.claim(subject, predicate, 'retract', null, asserted.key);
    threads.push({
      id: `t-retracted-${pad(i)}`,
      kind: 'retracted',
      claims: [asserted, withdrawn],
    });
    questions.push({
      id: `q-retracted-${pad(i)}`,
      kind: 'retracted',
      text: predicateSpec(predicate).ask(subject),
      subject,
      predicate,
      expected: { type: 'abstain', reason: 'retracted' },
    });
  }

  // Contradicted: two plain assertions that disagree. Neither says "correction",
  // so nothing supersedes anything and the disagreement stands.
  for (let i = 0; i < CONTRADICTED_COUNT; i += 1) {
    const subject = at(SERVICES, 2 + i, 'contradicted subject');
    const predicate = openPredicate(rng, ledger, subject, SERVICE_PREDICATES);
    const first = ledger.claim(subject, predicate, 'assert', freshValue(rng, predicate, []), null);
    const second = ledger.claim(
      subject,
      predicate,
      'assert',
      freshValue(rng, predicate, [first.objectText]),
      null,
    );
    threads.push({
      id: `t-contradicted-${pad(i)}`,
      kind: 'contradicted',
      claims: [first, second],
    });
    questions.push({
      id: `q-contradicted-${pad(i)}`,
      kind: 'contradicted',
      text: predicateSpec(predicate).ask(subject),
      subject,
      predicate,
      expected: { type: 'abstain', reason: 'contradicted' },
    });
  }

  // Multi hop: service -> vendor -> contact. The answer is never in a message
  // that mentions the service.
  for (let i = 0; i < MULTI_HOP_COUNT; i += 1) {
    const service = at(SERVICES, 8 + i, 'multi hop service');
    const vendor = at(VENDORS, i, 'multi hop vendor');
    const supplied = ledger.claim(service, 'vendor', 'assert', { text: vendor, entity: vendor }, null);
    const contact = ledger.claim(vendor, 'contact', 'assert', freshValue(rng, 'contact', []), null);
    threads.push({
      id: `t-multi_hop-${pad(i)}`,
      kind: 'multi_hop',
      claims: [supplied, contact],
    });
    questions.push({
      id: `q-multi_hop-${pad(i)}`,
      kind: 'multi_hop',
      text: `Who is our contact for the vendor behind ${service}?`,
      subject: service,
      predicate: 'contact',
      expected: { type: 'answer', text: contact.objectText, claimKey: contact.key },
    });
  }

  // Unconnected: the same question shape, the first hop present, the second
  // hop never stated. The vendor is real and named, and has no contact.
  for (let i = 0; i < UNCONNECTED_COUNT; i += 1) {
    const project = at(PROJECTS, i, 'unconnected project');
    const vendor = at(VENDORS, MULTI_HOP_COUNT + i, 'unconnected vendor');
    const supplied = ledger.claim(project, 'vendor', 'assert', { text: vendor, entity: vendor }, null);
    ledger.forbid(vendor, 'contact');
    threads.push({ id: `t-unconnected-${pad(i)}`, kind: 'unconnected', claims: [supplied] });
    questions.push({
      id: `q-unconnected-${pad(i)}`,
      kind: 'unconnected',
      text: `Who is our contact for the vendor behind ${project}?`,
      subject: project,
      predicate: 'contact',
      expected: { type: 'abstain', reason: 'unconnected' },
    });
  }

  // Never stated: the subject is well covered and the predicate is used all over
  // the corpus, just never about this subject. Lexical and vector retrieval both
  // score high here and still have nothing to return.
  for (let i = 0; i < NEVER_STATED_COUNT; i += 1) {
    const subject = at(PROJECTS, i, 'never stated subject');
    const elsewhere = ledger.predicatesUsedElsewhere(subject);
    const open = PROJECT_PREDICATES.filter(
      (name) => elsewhere.includes(name) && ledger.isAvailable(subject, name),
    );
    if (open.length === 0) {
      throw new CorpusError(
        `no predicate is both used elsewhere and free on ${subject}, so never_stated is not provable`,
      );
    }
    const predicate = rng.pick(open);
    ledger.forbid(subject, predicate);
    threads.push({ id: `t-never_stated-${pad(i)}`, kind: 'never_stated', claims: [] });
    questions.push({
      id: `q-never_stated-${pad(i)}`,
      kind: 'never_stated',
      text: predicateSpec(predicate).ask(subject),
      subject,
      predicate,
      expected: { type: 'abstain', reason: 'never_stated' },
    });
  }

  // Out of scope: the subject itself is absent from every message.
  for (let i = 0; i < OUT_OF_SCOPE_COUNT; i += 1) {
    const subject = at(OUT_OF_SCOPE_SUBJECTS, i, 'out of scope subject');
    const predicate = rng.pick(PROJECT_PREDICATES);
    threads.push({ id: `t-out_of_scope-${pad(i)}`, kind: 'out_of_scope', claims: [] });
    questions.push({
      id: `q-out_of_scope-${pad(i)}`,
      kind: 'out_of_scope',
      text: predicateSpec(predicate).ask(subject),
      subject,
      predicate,
      expected: { type: 'abstain', reason: 'out_of_scope' },
    });
  }

  // Dependencies: every service depends on shared packages, and packages
  // depend on later listed packages, so the graph has transitive depth and no
  // cycles. A forced chain and a forced shared package make the interesting
  // shapes seed independent; everything else is drawn from the rng. The
  // planner walks its own edge sets to compute each expected blast radius,
  // which lives only in the gold questions and is never ingested: the product
  // has to recompute the same set from the graph at runtime.
  const [chainHead, chainMid, chainTail] = DEPENDENCY_CHAIN;
  const serviceDeps: Set<number>[] = SERVICES.map(() => new Set<number>());
  const packageDeps: Set<number>[] = PACKAGES.map(() => new Set<number>());

  at(packageDeps, chainHead, 'chain head').add(chainMid);
  at(packageDeps, chainMid, 'chain middle').add(chainTail);
  for (const index of SHARED_DEPENDENT_SERVICES) {
    at(serviceDeps, index, 'shared dependent').add(chainHead);
  }
  for (let i = 0; i < SERVICES.length; i += 1) {
    const deps = at(serviceDeps, i, 'service dependencies');
    deps.add(i % PACKAGES.length);
    const extras = rng.int(SERVICE_EXTRA_DEPENDENCY_MAX + 1);
    for (let e = 0; e < extras; e += 1) {
      deps.add(rng.int(PACKAGES.length));
    }
  }
  for (let j = 0; j < PACKAGES.length - 1; j += 1) {
    const deps = at(packageDeps, j, 'package dependencies');
    const extras = rng.int(PACKAGE_DEPENDENCY_MAX + 1);
    for (let e = 0; e < extras; e += 1) {
      deps.add(rng.between(j + 1, PACKAGES.length - 1));
    }
  }

  // The revised pair is emitted by hand below, so neither index may also
  // arrive as a plain assertion.
  const revisedDeps = at(serviceDeps, REVISED_DEPENDENCY_SERVICE, 'revised service deps');
  revisedDeps.delete(REVISED_DEPENDENCY_OLD);
  revisedDeps.delete(REVISED_DEPENDENCY_NEW);

  const packageValue = (index: number): PredicateValue => {
    const name = at(PACKAGES, index, 'package name');
    return { text: name, entity: name };
  };

  for (let i = 0; i < SERVICES.length; i += 1) {
    const service = at(SERVICES, i, 'dependent service');
    const dependencyClaims: PlannedClaim[] = [];
    for (const dep of [...at(serviceDeps, i, 'service dependencies')].sort((a, b) => a - b)) {
      dependencyClaims.push(ledger.claim(service, 'depends_on', 'assert', packageValue(dep), null));
    }
    if (i === REVISED_DEPENDENCY_SERVICE) {
      const old = ledger.claim(
        service,
        'depends_on',
        'assert',
        packageValue(REVISED_DEPENDENCY_OLD),
        null,
      );
      dependencyClaims.push(old);
      dependencyClaims.push(
        ledger.claim(service, 'depends_on', 'revise', packageValue(REVISED_DEPENDENCY_NEW), old.key),
      );
    }
    threads.push({ id: `t-dependency-s${pad(i)}`, kind: 'dependency', claims: dependencyClaims });
  }
  for (let j = 0; j < PACKAGES.length; j += 1) {
    const deps = at(packageDeps, j, 'package dependencies');
    if (deps.size === 0) {
      continue;
    }
    const subject = at(PACKAGES, j, 'depending package');
    const dependencyClaims: PlannedClaim[] = [];
    for (const dep of [...deps].sort((a, b) => a - b)) {
      dependencyClaims.push(ledger.claim(subject, 'depends_on', 'assert', packageValue(dep), null));
    }
    threads.push({ id: `t-dependency-p${pad(j)}`, kind: 'dependency', claims: dependencyClaims });
  }

  // The revision leaves the old edge dead and the new edge live.
  const liveServiceDeps = serviceDeps.map((deps) => new Set(deps));
  at(liveServiceDeps, REVISED_DEPENDENCY_SERVICE, 'revised live deps').add(REVISED_DEPENDENCY_NEW);

  const affectedServices = (packageIndex: number): readonly string[] => {
    const affected = new Set<string>();
    const seen = new Set<number>([packageIndex]);
    const frontier = [packageIndex];
    while (frontier.length > 0) {
      const current = frontier.pop();
      if (current === undefined) {
        break;
      }
      for (let i = 0; i < liveServiceDeps.length; i += 1) {
        if (at(liveServiceDeps, i, 'live service deps').has(current)) {
          affected.add(at(SERVICES, i, 'affected service'));
        }
      }
      for (let j = 0; j < packageDeps.length; j += 1) {
        if (at(packageDeps, j, 'package dependencies').has(current) && !seen.has(j)) {
          seen.add(j);
          frontier.push(j);
        }
      }
    }
    return [...affected].sort();
  };

  BLAST_PACKAGE_INDICES.forEach((packageIndex, position) => {
    const subject = at(PACKAGES, packageIndex, 'blast package');
    questions.push({
      id: `q-blast_radius-${pad(position)}`,
      kind: 'blast_radius',
      text: `If ${subject} changes, which services are affected?`,
      subject,
      predicate: 'depends_on',
      expected: { type: 'affected', services: affectedServices(packageIndex) },
    });
  });

  // Background: claims nobody asks about. They exist so the graph is not a thin
  // scaffold of exactly the answers, and so retrieval has real competition.
  const candidates = rng.shuffled([
    ...PROJECTS.map((subject) => ({ subject, pool: PROJECT_PREDICATES })),
    ...SERVICES.map((subject) => ({ subject, pool: SERVICE_PREDICATES })),
    ...VENDORS.map((subject) => ({ subject, pool: VENDOR_PREDICATES })),
  ]);

  let made = 0;
  let cursor = 0;
  let background = 0;
  while (made < BACKGROUND_CLAIMS && cursor < candidates.length * 4) {
    const entry = at(candidates, cursor % candidates.length, 'background candidate');
    cursor += 1;
    const open = entry.pool.filter((name) => ledger.isAvailable(entry.subject, name));
    if (open.length === 0) {
      continue;
    }
    const predicate = rng.pick(open);
    const first = ledger.claim(
      entry.subject,
      predicate,
      'assert',
      freshValue(rng, predicate, []),
      null,
    );
    const claims: PlannedClaim[] = [first];
    made += 1;
    if (rng.next() < BACKGROUND_REVISE_CHANCE && made < BACKGROUND_CLAIMS) {
      claims.push(
        ledger.claim(
          entry.subject,
          predicate,
          'revise',
          freshValue(rng, predicate, [first.objectText]),
          first.key,
        ),
      );
      made += 1;
    }
    threads.push({ id: `t-background-${pad(background)}`, kind: 'background', claims });
    background += 1;
  }
  if (made < BACKGROUND_CLAIMS) {
    throw new CorpusError(`background generation ran dry at ${made} of ${BACKGROUND_CLAIMS} claims`);
  }

  const plan: ThreadPlan = { threads, questions };
  validatePlan(plan);
  return plan;
}

/**
 * Every property the evaluation depends on, checked against the plan that was
 * actually produced rather than the one that was intended.
 */
export function validatePlan(plan: ThreadPlan): void {
  const claims = plan.threads.flatMap((thread) => thread.claims);
  const byKey = new Map(claims.map((claim) => [claim.key, claim]));
  if (byKey.size !== claims.length) {
    throw new CorpusError(`claim keys are not unique: ${claims.length} claims, ${byKey.size} keys`);
  }

  const ids = new Set(plan.questions.map((question) => question.id));
  if (ids.size !== plan.questions.length) {
    throw new CorpusError('question ids are not unique');
  }

  const byPair = new Map<string, PlannedClaim[]>();
  for (const claim of claims) {
    const pair = `${claim.subject}::${claim.predicate}`;
    const list = byPair.get(pair);
    if (list === undefined) {
      byPair.set(pair, [claim]);
    } else {
      list.push(claim);
    }
  }
  const pairOf = (subject: string, predicate: PredicateName): readonly PlannedClaim[] =>
    byPair.get(`${subject}::${predicate}`) ?? [];

  const superseded = new Set(
    claims.map((claim) => claim.supersedes).filter((key): key is string => key !== null),
  );

  for (const question of plan.questions) {
    if (question.expected.type === 'answer') {
      const answer = byKey.get(question.expected.claimKey);
      if (answer === undefined) {
        throw new CorpusError(`${question.id} points at missing claim ${question.expected.claimKey}`);
      }
      if (answer.objectText !== question.expected.text) {
        throw new CorpusError(
          `${question.id} expects "${question.expected.text}" but the claim says "${answer.objectText}"`,
        );
      }
      if (superseded.has(answer.key)) {
        throw new CorpusError(`${question.id} points at ${answer.key}, which was superseded`);
      }
      continue;
    }

    if (question.expected.type === 'affected') {
      continue;
    }

    const reason = question.expected.reason;
    if (reason === 'never_stated') {
      const found = pairOf(question.subject, question.predicate);
      if (found.length > 0) {
        throw new CorpusError(
          `${question.id} claims nothing was said, but found ${found.length} claims`,
        );
      }
    } else if (reason === 'out_of_scope') {
      const touched = claims.some(
        (claim) => claim.subject === question.subject || claim.objectEntity === question.subject,
      );
      if (touched) {
        throw new CorpusError(`${question.id} names ${question.subject}, which the corpus claims about`);
      }
    } else if (reason === 'retracted') {
      const found = pairOf(question.subject, question.predicate);
      const last = found[found.length - 1];
      if (last === undefined || last.kind !== 'retract') {
        throw new CorpusError(`${question.id} is not backed by a retraction`);
      }
    } else if (reason === 'contradicted') {
      const found = pairOf(question.subject, question.predicate);
      const live = found.filter(
        (claim) => claim.kind === 'assert' && !superseded.has(claim.key),
      );
      if (live.length < 2) {
        throw new CorpusError(`${question.id} has ${live.length} live assertions, needs at least 2`);
      }
      const values = new Set(live.map((claim) => claim.objectText));
      if (values.size < 2) {
        throw new CorpusError(`${question.id} has agreeing assertions, so nothing contradicts`);
      }
    } else {
      const hop = pairOf(question.subject, 'vendor');
      const first = hop[0];
      if (hop.length !== 1 || first === undefined || first.objectEntity === null) {
        throw new CorpusError(`${question.id} needs exactly one vendor claim to hop through`);
      }
      const terminal = pairOf(first.objectEntity, 'contact');
      if (terminal.length > 0) {
        throw new CorpusError(
          `${question.id} says the link is missing, but ${first.objectEntity} has a contact`,
        );
      }
    }
  }

  for (const question of plan.questions) {
    if (question.kind !== 'multi_hop') {
      continue;
    }
    const hop = pairOf(question.subject, 'vendor');
    const first = hop[0];
    if (hop.length !== 1 || first === undefined || first.objectEntity === null) {
      throw new CorpusError(`${question.id} needs exactly one vendor claim to hop through`);
    }
    const terminal = pairOf(first.objectEntity, 'contact');
    if (terminal.length !== 1) {
      throw new CorpusError(
        `${question.id} needs exactly one contact on ${first.objectEntity}, found ${terminal.length}`,
      );
    }
  }

  const reasons = new Set(
    plan.questions
      .map((question) => (question.expected.type === 'abstain' ? question.expected.reason : null))
      .filter((reason): reason is NonNullable<typeof reason> => reason !== null),
  );
  if (reasons.size !== 5) {
    throw new CorpusError(`expected all 5 abstention reasons, found ${[...reasons].sort().join(', ')}`);
  }

  const chained = claims.some((claim) => {
    if (claim.supersedes === null) {
      return false;
    }
    const parent = byKey.get(claim.supersedes);
    return parent !== undefined && parent.supersedes !== null;
  });
  if (!chained) {
    throw new CorpusError('no fact was revised twice, so nothing exercises a supersession chain');
  }

  // Dependency invariants, rebuilt from the claims alone. The planner's index
  // sets are deliberately not consulted here: if the emitted claims do not
  // carry the whole graph, this is where that fails.
  const serviceNames = new Set(SERVICES);
  const packageNames = new Set(PACKAGES);
  const liveDependencies: { readonly from: string; readonly to: string }[] = [];
  for (const claim of claims) {
    if (claim.predicate !== 'depends_on' || claim.kind === 'retract' || superseded.has(claim.key)) {
      continue;
    }
    if (claim.objectEntity === null) {
      throw new CorpusError(`${claim.key} depends on nothing nameable`);
    }
    if (!packageNames.has(claim.objectEntity)) {
      throw new CorpusError(`${claim.key} depends on ${claim.objectEntity}, which is not a package`);
    }
    if (!serviceNames.has(claim.subject) && !packageNames.has(claim.subject)) {
      throw new CorpusError(`${claim.key} hangs a dependency on ${claim.subject}`);
    }
    liveDependencies.push({ from: claim.subject, to: claim.objectEntity });
  }

  const touchedPackages = new Set<string>();
  for (const edge of liveDependencies) {
    touchedPackages.add(edge.to);
    if (packageNames.has(edge.from)) {
      touchedPackages.add(edge.from);
    }
  }
  if (touchedPackages.size < MIN_PACKAGES_TOUCHED) {
    throw new CorpusError(
      `dependencies touch ${touchedPackages.size} packages, need ${MIN_PACKAGES_TOUCHED}`,
    );
  }

  const packageEdges = liveDependencies.filter((edge) => packageNames.has(edge.from));
  const transitive = packageEdges.some((edge) =>
    packageEdges.some((next) => next.from === edge.to),
  );
  if (!transitive) {
    throw new CorpusError('no package depends on a package with dependencies of its own');
  }

  const dependentsByPackage = new Map<string, Set<string>>();
  for (const edge of liveDependencies) {
    if (!serviceNames.has(edge.from)) {
      continue;
    }
    const dependents = dependentsByPackage.get(edge.to) ?? new Set<string>();
    dependents.add(edge.from);
    dependentsByPackage.set(edge.to, dependents);
  }
  if (![...dependentsByPackage.values()].some((dependents) => dependents.size >= 2)) {
    throw new CorpusError('no package is shared by two services');
  }

  const revisedDependency = claims.some(
    (claim) => claim.predicate === 'depends_on' && claim.kind === 'revise',
  );
  if (!revisedDependency) {
    throw new CorpusError('no dependency was ever revised');
  }

  for (const start of packageNames) {
    const walked = new Set<string>([start]);
    const walk = [start];
    while (walk.length > 0) {
      const current = walk.pop();
      if (current === undefined) {
        break;
      }
      for (const edge of packageEdges) {
        if (edge.from !== current) {
          continue;
        }
        if (edge.to === start) {
          throw new CorpusError(`package dependencies cycle through ${start}`);
        }
        if (!walked.has(edge.to)) {
          walked.add(edge.to);
          walk.push(edge.to);
        }
      }
    }
  }

  for (const question of plan.questions) {
    if (question.expected.type !== 'affected') {
      continue;
    }
    const recomputed = affectedFromClaims(liveDependencies, question.subject, serviceNames);
    if (recomputed.length === 0) {
      throw new CorpusError(`${question.id} has an empty blast radius`);
    }
    if (recomputed.join('|') !== [...question.expected.services].join('|')) {
      throw new CorpusError(
        `${question.id} expects [${question.expected.services.join(', ')}] but the claims give [${recomputed.join(', ')}]`,
      );
    }
  }
}

/**
 * The blast radius a package's change reaches, walked over live dependency
 * edges against their direction. This is the check's own walk, over claims
 * rather than the planner's index sets, so agreement between the two means the
 * emitted claims really carry the graph the questions were scored against.
 */
function affectedFromClaims(
  edges: readonly { readonly from: string; readonly to: string }[],
  pkg: string,
  services: ReadonlySet<string>,
): readonly string[] {
  const affected = new Set<string>();
  const seen = new Set<string>([pkg]);
  const frontier = [pkg];
  while (frontier.length > 0) {
    const current = frontier.pop();
    if (current === undefined) {
      break;
    }
    for (const edge of edges) {
      if (edge.to !== current) {
        continue;
      }
      if (services.has(edge.from)) {
        affected.add(edge.from);
      } else if (!seen.has(edge.from)) {
        seen.add(edge.from);
        frontier.push(edge.from);
      }
    }
  }
  return [...affected].sort();
}
