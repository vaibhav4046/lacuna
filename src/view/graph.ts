import type { Answer, ClaimRecord } from '../retrieval/types';
import { shortDate } from './format';
import { html, type Html } from './html';
import { panel } from './layout';

/**
 * The path the verdict came down, drawn as the graph actually stores it.
 *
 * Five columns, left to right: Session, Message, Span, Claim, Entity. That is
 * the direction the arrows point in `src/retrieval/queries.ts`, so the drawing
 * can be checked against the query text without translating anything. The
 * relationship names sit in the gaps between the columns rather than on every
 * edge, which turns a tangle of repeated labels into one legible line across the
 * top and leaves the edges themselves plain.
 *
 * The one edge that gets its own label is MENTIONS, because it is the hop, and
 * the hop is the whole reason a two step question is answerable at all. It is
 * drawn in the annotation colour for the same reason.
 *
 * Only the claims that were cited appear here. Superseded claims are the
 * timeline's subject and putting them in would double the node count to say
 * something the panel above already says better.
 */

const WIDTH = 1000;
const PAD = 10;
const NODE_W = 150;
const NODE_H = 46;
const GAP = 60;
const PITCH = NODE_H + 16;
const HEADER_Y = 16;
const CONTENT_TOP = 34;
/** 130px of usable box at 11px monospace. */
const LABEL_CAP = 19;
const SUB_CAP = 22;

const COLUMNS = ['SESSION', 'MESSAGE', 'SPAN', 'CLAIM', 'ENTITY'] as const;
/** One per gap between columns, so an edge does not have to carry its own name. */
const RELATIONS = ['CONTAINS', 'HAS_SPAN', 'SUPPORTS', 'ABOUT'] as const;

type Accent = 'plain' | 'subject' | 'answering';

interface Node {
  readonly key: string;
  readonly column: number;
  readonly label: string;
  readonly sub: string;
  readonly accent: Accent;
}

interface Edge {
  readonly from: string;
  readonly to: string;
  /** Only the hop carries one; the rest take their name from the column gap. */
  readonly label: string | null;
  readonly hop: boolean;
}

function clip(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap - 1)}…`;
}

function columnX(column: number): number {
  return PAD + column * (NODE_W + GAP);
}

/**
 * Nodes in first-appearance order, deduplicated by key.
 *
 * Order is the order the evidence came back in, so a reader following the
 * citations in the panel above meets the nodes in the same sequence.
 */
class Collector {
  private readonly seen = new Map<string, Node>();
  private readonly links: Edge[] = [];

  add(node: Node): string {
    if (!this.seen.has(node.key)) this.seen.set(node.key, node);
    return node.key;
  }

  link(from: string, to: string | null, label: string | null = null): void {
    if (to === null) return;
    if (!this.links.some((edge) => edge.from === from && edge.to === to)) {
      this.links.push({ from, to, label, hop: label !== null });
    }
  }

  get nodes(): readonly Node[] {
    return [...this.seen.values()];
  }

  get edges(): readonly Edge[] {
    return this.links;
  }
}

function claimNode(claim: ClaimRecord | undefined, id: number, accent: Accent): Node {
  const text = claim === undefined
    ? 'not loaded'
    : claim.polarity === 'negative' ? `not ${claim.objectText}` : claim.objectText;
  return { key: `c:${id}`, column: 3, label: `claim ${id}`, sub: clip(text, SUB_CAP), accent };
}

function walk(answer: Answer): Collector {
  const collected = new Collector();
  const claims = new Map<number, ClaimRecord>();
  for (const claim of answer.subject.claims) claims.set(claim.id, claim);
  for (const claim of answer.bridge?.claims ?? []) claims.set(claim.id, claim);

  const { outcome, hop } = answer.resolution;
  const answering = outcome.type === 'answer' ? outcome.claimId : null;

  // A subject with no id has no node in the graph, and drawing one would be the
  // single most misleading mark this product could make.
  const subject = answer.subject.id === null ? null : collected.add({
    key: `e:${answer.subject.name}`,
    column: 4,
    label: clip(answer.subject.name, LABEL_CAP),
    sub: answer.subject.kind ?? '',
    accent: 'subject',
  });
  const bridge = answer.bridge === null ? null : collected.add({
    key: `e:${answer.bridge.name}`,
    column: 4,
    label: clip(answer.bridge.name, LABEL_CAP),
    sub: answer.bridge.kind ?? '',
    accent: 'plain',
  });

  for (const span of answer.evidence) {
    const session = collected.add({
      key: `s:${span.sessionId}`,
      column: 0,
      label: clip(span.sessionTitle, LABEL_CAP),
      sub: `session ${span.sessionId}`,
      accent: 'plain',
    });
    const message = collected.add({
      key: `m:${span.messageId}`,
      column: 1,
      label: `message ${span.messageId}`,
      sub: `${span.role} · ${shortDate(span.ts)}`,
      accent: 'plain',
    });
    const quoted = collected.add({
      key: `p:${span.spanId}`,
      column: 2,
      label: `span ${span.spanId}`,
      sub: `chars ${span.start}–${span.end}`,
      accent: 'plain',
    });
    const claim = collected.add(claimNode(
      claims.get(span.claimId),
      span.claimId,
      span.claimId === answering ? 'answering' : 'plain',
    ));

    collected.link(session, message);
    collected.link(message, quoted);
    collected.link(quoted, claim);

    // A hop claim is stated about the subject and points at the bridge. Every
    // other cited claim is about whichever entity the answer was read from.
    if (hop !== null && span.claimId === hop.throughClaimId) {
      collected.link(claim, subject);
      if (bridge !== null) collected.link(claim, bridge, 'MENTIONS');
    } else {
      collected.link(claim, bridge ?? subject);
    }
  }

  return collected;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Placement {
  readonly at: ReadonlyMap<string, Point>;
  /** The tallest column, which is what sets the height of the drawing. */
  readonly rows: number;
}

/** Columns stacked from the top and centred against each other. */
function place(nodes: readonly Node[]): Placement {
  const byColumn = COLUMNS.map((_, column) => nodes.filter((node) => node.column === column));
  const rows = Math.max(1, ...byColumn.map((column) => column.length));
  const at = new Map<string, Point>();

  byColumn.forEach((column, index) => {
    const top = CONTENT_TOP + ((rows - column.length) * PITCH) / 2;
    column.forEach((node, row) => {
      at.set(node.key, { x: columnX(index), y: top + row * PITCH });
    });
  });
  return { at, rows };
}

function box(node: Node, at: Point): Html {
  const accent = node.accent === 'plain' ? '' : ` ${node.accent}`;
  return html`<rect class="node${accent}" x="${at.x}" y="${at.y}" width="${NODE_W}"
height="${NODE_H}" rx="3"/>
<text class="node-label" x="${at.x + 10}" y="${at.y + 19}">${node.label}</text>
<text class="node-sub" x="${at.x + 10}" y="${at.y + 33}">${node.sub}</text>`;
}

function wire(edge: Edge, from: Point, to: Point): Html {
  const [x1, y1] = [from.x + NODE_W, from.y + NODE_H / 2];
  const [x2, y2] = [to.x, to.y + NODE_H / 2];
  const bend = Math.max(18, (x2 - x1) * 0.5);
  const path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  const line = html`<path class="edge${edge.hop ? ' hop' : ''}" d="${path}"/>`;
  if (edge.label === null) return line;
  return html`${line}
<text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}"
text-anchor="middle">${edge.label}</text>`;
}

function headers(): Html {
  return html`${COLUMNS.map((name, index) => html`<text class="svg-date" x="${
    columnX(index)}" y="${HEADER_Y}">${name}</text>`)}
${RELATIONS.map((name, index) => html`<text class="edge-label" x="${
  columnX(index) + NODE_W + GAP / 2}" y="${HEADER_Y}" text-anchor="middle">${name}</text>`)}`;
}

const NO_PATH = 'NO PATH TO ANY STATEMENT';

function drawing(answer: Answer, label: string): Html {
  const collected = walk(answer);
  const nodes = collected.nodes;
  const { at, rows } = place(nodes);
  const height = CONTENT_TOP + rows * PITCH + 6;
  const mid = CONTENT_TOP + (rows * PITCH) / 2;

  return html`<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}">
${headers()}
${answer.evidence.length > 0 ? null : html`<line class="thread-gap" x1="${PAD}" y1="${mid}"
x2="${columnX(4) - 8}" y2="${mid}"/>
<text class="svg-note" x="${PAD}" y="${mid - 12}">${NO_PATH}</text>`}
${collected.edges.map((edge) => {
  const from = at.get(edge.from);
  const to = at.get(edge.to);
  return from === undefined || to === undefined ? null : wire(edge, from, to);
})}
${nodes.map((node) => box(node, at.get(node.key)!))}
</svg>`;
}

const CAPTION = 'Arrows point the way the graph stores them, so this reads against '
  + 'the query text in src/retrieval/queries.ts without translation. Only cited claims '
  + 'appear; the claims that were replaced are the subject of the panel above.';

const ORPHAN = 'The entity is in the graph, and nothing in any session connects it to '
  + 'this question. That is a shape a ranked passage list cannot report, because there is '
  + 'no passage to rank and a nearest neighbour is always available.';

const ABSENT = 'No node in the graph carries this name, so there is nothing to draw a path '
  + 'from. The columns are still shown, because the emptiness is under them.';

export function graphPanel(answer: Answer): Html {
  const spans = answer.evidence.length;
  const label = spans === 0
    ? `No path from any session to ${answer.subject.name}.`
    : `The path from ${spans} quoted span${spans === 1 ? '' : 's'} back to `
      + `${answer.subject.name}, through sessions, messages, spans and claims.`;

  const body = [
    html`<p class="prose">The subgraph the verdict was read out of, and nothing else.
Every node here was returned by one of the queries in the next panel.</p>`,
    html`<figure class="figure">${drawing(answer, label)}
<figcaption class="caption">${CAPTION}</figcaption></figure>`,
    spans > 0
      ? null
      : html`<p class="nothing">${answer.subject.id === null ? ABSENT : ORPHAN}</p>`,
  ];

  return panel({ index: 3, label: 'Subgraph', heading: 'Where the answer came from', body });
}
