import { openSource } from '../hydra/open.js';
import { UNDERSTOOD_PREDICATES, predicateIn, subjectsIn } from '../retrieval/plan.js';
import type { Palette } from './color.js';

/**
 * Reading a question typed at a shell, against this machine's own store.
 *
 * The same two functions the web and the MCP server use, so `lacuna read` and
 * the Ask screen agree about what a sentence means. That agreement is the point
 * of putting the parser in `src/retrieval` rather than in a route: a parser per
 * surface is three parsers that drift, and the one thing this product cannot
 * afford is two surfaces answering the same question differently.
 *
 * Both halves come from the store rather than from a list written here. The
 * names are whatever this workspace holds, and the predicates are whatever the
 * matched subject records, widened by the vocabulary the product understands so
 * that a property the subject does not hold still reaches the resolver and gets
 * its real answer, which is that nothing ever stated it.
 */

export type Plan =
  | {
    readonly kind: 'read';
    readonly subject: string;
    readonly predicate: string;
    readonly via: string | null;
    readonly fromWords: string;
    readonly records: readonly string[];
  }
  | {
    readonly kind: 'unread';
    readonly reason: 'no_subject' | 'no_predicate';
    readonly holds: readonly string[];
    readonly records: readonly string[];
    readonly subject: string | null;
  };

export async function planFromStore(
  env: Record<string, string | undefined>,
  text: string,
  timeoutMs: number,
): Promise<Plan> {
  const { source } = openSource(env);

  const known = source.subjects === undefined ? [] : (await source.subjects(timeoutMs)).value;
  const [subject, second] = subjectsIn(text, known);
  if (subject === undefined) {
    return { kind: 'unread', reason: 'no_subject', holds: known.slice(0, 24), records: [], subject: null };
  }

  const held = await source.subject(subject, timeoutMs);
  const records = [...new Set(held.value?.claims.map((claim) => claim.predicate) ?? [])];
  const found = predicateIn(text, [...new Set([...records, ...UNDERSTOOD_PREDICATES])]);
  if (found === null) {
    return { kind: 'unread', reason: 'no_predicate', holds: [], records, subject };
  }

  return {
    kind: 'read',
    subject,
    predicate: found.predicate,
    via: second ?? null,
    fromWords: found.matched,
    records,
  };
}

/**
 * What it understood, printed before the answer.
 *
 * Above the answer rather than below it, because somebody reading a terminal
 * reads downward and the reading has to arrive before the thing it qualifies.
 */
export function renderReading(plan: Extract<Plan, { kind: 'read' }>, palette: Palette): string {
  const via = plan.via === null ? '' : ` via ${plan.via}`;
  return [
    palette.dim(`read as  ${plan.subject} ${plan.predicate}${via}`),
    palette.dim(`         from your words "${plan.fromWords}"`),
  ].join('\n');
}

/**
 * Which half could not be read, and what the workspace does hold.
 *
 * The distinction carries real information for whoever is reading: a name this
 * workspace has never heard of is a different situation from a name it holds
 * that records nothing of what was asked, and only one of them is fixed by
 * asking a different question about the same thing.
 */
export function renderUnread(plan: Extract<Plan, { kind: 'unread' }>, palette: Palette): string {
  if (plan.reason === 'no_subject') {
    return [
      palette.warn('Nothing in that question names something this workspace holds.'),
      palette.dim('It holds:'),
      palette.dim(`  ${plan.holds.join(', ')}`),
    ].join('\n');
  }
  return [
    palette.warn(`This workspace holds ${plan.subject ?? 'that'} but records nothing of what you asked for.`),
    palette.dim('It records:'),
    palette.dim(`  ${plan.records.map((one) => one.replace(/_/g, ' ')).join(', ')}`),
  ].join('\n');
}
