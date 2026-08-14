import { HydraGuardError } from '../hydra/errors.js';
import { assertVertexId, type PreparedQuery } from '../hydra/queries.js';

/**
 * The read shapes retrieval uses, and only those.
 *
 * Every one of them was executed against a live HydraDB v0.1.1 node before the
 * module that calls it was written. That order matters: the supported Cypher
 * subset is narrow, and finding out that a shape is refused after building a
 * decoder, a resolver and a screen on top of it is a bad afternoon. The refusals
 * and the surprises that shaped these are recorded next to the shape they
 * changed.
 *
 * Names arrive as parameters rather than being spliced into the query text, so
 * nothing a user types becomes Cypher. The caps here are belt to the question
 * layer's braces, because the contract tests call this file directly.
 */

/** Same cap as the question layer. Long enough for any real name. */
const MAX_NAME_CHARS = 200;

function assertName(value: string, role: string): string {
  if (value === '') {
    throw new HydraGuardError(`${role} is empty`);
  }
  if (value.length > MAX_NAME_CHARS) {
    throw new HydraGuardError(
      `${role} is ${value.length} characters, over the ${MAX_NAME_CHARS} character cap`,
    );
  }
  return value;
}

/**
 * Does this name exist, and what kind of thing is it.
 *
 * This is the entry point for every question, and the reason it is a name match
 * rather than a client-side id derivation is that retrieval should not depend on
 * ingestion's hashing scheme. It is also the `out_of_scope` test: a name with no
 * node returns **zero rows**.
 *
 * That is worth stating plainly because the neighbouring shape does not behave
 * that way. `MATCH (n {id: $id}) RETURN n.key` against an id that does not exist
 * returns **one row of nulls**, not zero rows, so existence there cannot be
 * tested by counting rows. Here it can.
 */
export function entityByName(name: string): PreparedQuery {
  return {
    cypher: 'MATCH (e:Entity {name: $name}) RETURN e.id AS id, e.kind AS kind',
    parameters: { name: assertName(name, 'entity name') },
  };
}

/**
 * Every claim about one entity, with whatever supersedes it.
 *
 * The OPTIONAL MATCH is what makes this one query instead of two. It returns one
 * row per (claim, superseder) pair and a single row with a null `superseded_by`
 * for a claim nothing has replaced, so the decoder groups by claim id rather
 * than assuming a row is a claim.
 *
 * The arrow direction is load bearing: `(newer)-[:SUPERSEDES]->(c)` reads
 * "newer supersedes c". Confirmed against the live graph by walking from the
 * oldest claim in a revision chain, which returns zero rows, and from the newest,
 * which returns the rest of the chain.
 */
export function claimsAbout(entityId: number): PreparedQuery {
  return {
    cypher:
      'MATCH (c:Claim)-[:ABOUT]->(e {id: $e}) '
      + 'OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c) '
      + 'RETURN c.id AS id, c.predicate AS predicate, c.object_text AS object_text, '
      + 'c.polarity AS polarity, c.valid_from AS valid_from, c.tx_time AS tx_time, '
      + 'newer.id AS superseded_by',
    parameters: { e: assertVertexId(entityId, 'entityId') },
  };
}

/**
 * Claims about this entity that name a second entity, and which entity that is.
 *
 * This is the hop. A question like "who is our contact for the vendor behind X"
 * cannot be answered from X's own claims: it has to land on the vendor first.
 * The two-arrow pattern gets there in one round trip, and returning `o.name`
 * rather than just `o.id` means the next query can start from a name like every
 * other lookup does.
 */
export function mentionsFrom(entityId: number): PreparedQuery {
  return {
    cypher:
      'MATCH (e {id: $e})<-[:ABOUT]-(c)-[:MENTIONS]->(o) '
      + 'RETURN c.id AS claim, c.predicate AS predicate, o.id AS other, o.name AS other_name',
    parameters: { e: assertVertexId(entityId, 'entityId') },
  };
}

/**
 * The whole citation for one claim: the quotation, where in the message it sits,
 * which message it was, and which session that message belongs to.
 *
 * Four hops in one pattern. The obvious alternative is 1 + 2N queries, one for
 * the spans and then two per span to walk back up to the message and session,
 * and the difference is not academic: this returns in tens of milliseconds where
 * the walk-up version costs a round trip per hop per span.
 *
 * `end` is aliased because it reads as a keyword; the property access itself is
 * fine.
 */
export function evidenceForClaim(claimId: number): PreparedQuery {
  return {
    cypher:
      'MATCH (se:Session)-[:CONTAINS]->(m)-[:HAS_SPAN]->(sp)-[:SUPPORTS]->(c {id: $c}) '
      + 'RETURN sp.id AS span, sp.quote AS quote, sp.start AS start, sp.end AS end_offset, '
      + 'm.id AS message, m.role AS role, m.ts AS ts, '
      + 'se.id AS session, se.title AS title',
    parameters: { c: assertVertexId(claimId, 'claimId') },
  };
}

/**
 * The claims that directly contradict one claim.
 *
 * Contradiction is a stated relation in this graph rather than something
 * inferred at read time from two values differing, because "these two disagree"
 * and "one of these replaced the other" are different situations and the whole
 * product rests on telling them apart.
 */
export function contradictionPartners(claimId: number): PreparedQuery {
  return {
    cypher:
      'MATCH (a {id: $c})-[:CONTRADICTS]->(b) '
      + 'RETURN b.id AS id, b.object_text AS object_text, b.predicate AS predicate',
    parameters: { c: assertVertexId(claimId, 'claimId') },
  };
}

/** Depth cap on the revision walk. Four revisions is past anything the corpus builds. */
export const MAX_SUPERSESSION_DEPTH = 4;

/**
 * Everything one claim supersedes, transitively, oldest reachable last.
 *
 * Bounded rather than open ended. An unbounded variable-length walk on a graph
 * with a cycle in it does not terminate, and while nothing here writes a cycle,
 * a read that depends on that staying true is a read waiting to hang.
 */
export function supersededByClaim(claimId: number): PreparedQuery {
  return {
    cypher:
      `MATCH (c {id: $c})-[:SUPERSEDES*1..${MAX_SUPERSESSION_DEPTH}]->(older) `
      + 'RETURN older.id AS id, older.object_text AS object_text, '
      + 'older.valid_from AS valid_from',
    parameters: { c: assertVertexId(claimId, 'claimId') },
  };
}
