/**
 * The one way text becomes markup.
 *
 * Every page in this product is assembled from template strings, which makes
 * every interpolation an escaping decision. Rather than make that decision
 * repeatedly and correctly, it is made once here: `html` escapes everything it
 * interpolates unless the value is already markup this module produced.
 *
 * There is deliberately no raw() escape hatch. An escape hatch is where the
 * cross site scripting goes, and the evidence this product renders is quoted
 * text from a corpus, which is exactly the kind of content an escape hatch would
 * be reached for. Anything that needs to be markup has to be built by `html`.
 *
 * The escaping is HTML escaping, which is only correct outside raw text
 * elements. So no page has a `<script>` or a `<style>` element: the stylesheet
 * is a separate response and there is no client side script at all. That is a
 * property of the whole view layer rather than a rule to remember here, and it
 * is what makes one escape function sufficient. See DECISIONS.md D-041.
 */

/** Not exported. Holding markup requires having gone through `html`. */
const MARKUP = Symbol('lacuna.markup');

export interface Html {
  readonly [MARKUP]: string;
}

export type Renderable =
  | Html
  | string
  | number
  | null
  | undefined
  | readonly Renderable[];

export class HtmlError extends Error {
  override readonly name = 'HtmlError';
}

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/**
 * The five characters, including both quote marks.
 *
 * Escaping quotes is what lets an interpolation sit inside a quoted attribute
 * value, which is most of what a template like this does. Attribute values are
 * always quoted in this codebase for that reason; an unquoted one would be
 * breakable with a space and no escaping would help.
 */
export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES.get(character)!);
}

function isHtml(value: unknown): value is Html {
  return typeof value === 'object' && value !== null && MARKUP in value;
}

/** Explicit rather than relying on how Array.isArray narrows a readonly type. */
function isList(value: Renderable): value is readonly Renderable[] {
  return Array.isArray(value);
}

function render(value: Renderable): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return escape(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      // NaN in a coordinate is a silently broken drawing rather than a visibly
      // broken one, and this module is where it can still be caught.
      throw new HtmlError(`refusing to render ${String(value)}`);
    }
    return String(value);
  }
  if (isList(value)) return value.map(render).join('');
  if (isHtml(value)) return value[MARKUP];
  throw new HtmlError(`cannot render a ${typeof value} as markup`);
}

export function html(
  strings: TemplateStringsArray,
  ...values: readonly Renderable[]
): Html {
  let out = strings[0]!;
  for (const [at, value] of values.entries()) {
    out += render(value) + strings[at + 1]!;
  }
  return { [MARKUP]: out };
}

/** The finished string, for a response body. */
export function markup(page: Html): string {
  return page[MARKUP];
}

/** Joins pieces with a separator that is itself markup or escaped text. */
export function join(pieces: readonly Renderable[], separator: Renderable): Html {
  const out: Renderable[] = [];
  for (const [at, piece] of pieces.entries()) {
    if (at > 0) out.push(separator);
    out.push(piece);
  }
  return html`${out}`;
}
