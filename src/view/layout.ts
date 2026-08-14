import { html, markup, type Html, type Renderable } from './html.js';

/**
 * The document shell every page is poured into.
 *
 * There is one shell rather than one per route because the two routes are the
 * same document at different lengths, and because the security properties of a
 * page live in its head. Putting the head in one place means the policy below
 * is the policy on every response rather than the policy on the pages someone
 * remembered.
 */

/**
 * What this page is allowed to do, which is almost nothing.
 *
 * `default-src 'none'` is the whole argument: no script, no fetch, no frames,
 * no workers, no fonts, no media. The three narrow allowances are the
 * stylesheet, the favicon, and posting the question form back to this origin.
 * `script-src` is stated separately even though the default already covers it,
 * because a reader checking this line should not have to know that.
 *
 * The page can afford this because it has no client side code at all. Nothing
 * here degrades without JavaScript, since there is no enhanced version.
 *
 * It is sent as a header by the server and mirrored into a meta element, so a
 * page saved to disk and reopened keeps the same restrictions.
 */
const DIRECTIVES = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
] as const;

/** The policy the server sends as a header, where every directive applies. */
export const CONTENT_SECURITY_POLICY = DIRECTIVES.join('; ');

/**
 * The same policy minus the one directive a meta element cannot carry.
 *
 * `frame-ancestors` is ignored when delivered in a meta element, and browsers
 * say so in the console. Leaving it in bought nothing and printed an error on
 * every page load, which on a page that exists to be trusted is worse than the
 * shorter list. Framing is still refused, by `frame-ancestors` in the header
 * and by `x-frame-options` beside it.
 *
 * Both strings are built from one array so the mirror cannot drift from the
 * policy it mirrors.
 */
export const META_CONTENT_SECURITY_POLICY = DIRECTIVES
  .filter((directive) => !directive.startsWith('frame-ancestors'))
  .join('; ');

/**
 * The mark: a ruled line with a piece missing.
 *
 * Geometry only, no script, no external reference. The black ground is the
 * product's own ground rather than a concession to the browser chrome, and it
 * reads against a light and a dark tab strip equally, which matters because
 * the tab strip is the one place on screen the page does not control.
 */
export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
  + `<rect width="32" height="32" rx="6" fill="#000000"/>`
  + `<path d="M5 16h7M20 16h7" stroke="#ffffff" stroke-width="2.75" stroke-linecap="round"/>`
  + `<circle cx="16" cy="16" r="2" fill="#ff5719"/>`
  + `</svg>\n`;

export const PROMISE = 'Memory that knows what changed, what remains true, '
  + 'and what was never known.';

/**
 * The pages, in the order of the argument they make together.
 *
 * Ask a question, then check the score, then check the database the score came
 * from, then check the surface all three are served over, then check the one
 * surface that does not exist yet. One array, read by both the bar at the top
 * of every page and the list at the bottom, so a page cannot appear in one and
 * not the other.
 */
export const PAGES = [
  { href: '/', label: 'Ask' },
  { href: '/bench', label: 'Benchmark' },
  { href: '/hydradb', label: 'Database' },
  { href: '/interface', label: 'Interface' },
  { href: '/voice', label: 'Voice' },
] as const;

/** One of the pages. A notice is not one of them, which is why null is allowed. */
export type Route = (typeof PAGES)[number]['href'];

/**
 * The same links, twice.
 *
 * `aria-current` rather than a class is what marks the page you are on: it is
 * the announcement a screen reader makes, and the stylesheet reads the same
 * attribute, so the visible marker and the spoken one cannot disagree.
 */
function ways(current: Route | null, style: string, label: string): Html {
  return html`<nav class="${style}" aria-label="${label}">${PAGES.map((entry) => html`<a
href="${entry.href}"${entry.href === current ? html` aria-current="page"` : null}>${entry.label}</a>`)}</nav>`;
}

export interface PageOptions {
  readonly title: string;
  readonly description: string;
  /** Which of them this is, or null on a page that is none of them. */
  readonly current: Route | null;
  readonly body: Renderable;
  /** An extra line in the footer, when the page has something to add there. */
  readonly note?: Renderable;
}

export function page(options: PageOptions): string {
  const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${META_CONTENT_SECURITY_POLICY}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="description" content="${options.description}">
<title>${options.title}</title>
<link rel="stylesheet" href="/lacuna.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#start">Skip to the content</a>
<div class="doc">
<div class="bar full">
<a class="bar-mark" href="/">Lacuna</a>
${ways(options.current, 'tabs', 'Pages')}
</div>
<main class="sheet" id="start">
${options.body}
</main>
<footer class="foot full">
${ways(options.current, 'ways', 'Pages, repeated')}
<p>Lacuna. ${PROMISE}</p>
<p>This page ships no JavaScript. Every sentence on it is either a fixed
template or a quotation carried out of the graph.</p>
${options.note === undefined ? null : html`<p>${options.note}</p>`}
</footer>
</div>
</body>
</html>
`;
  return markup(document);
}

/** The full masthead, for the page a reader arrives at. */
export function masthead(): Html {
  return html`<header class="masthead full">
<h1 class="wordmark">Lacuna</h1>
<p class="promise">${PROMISE}</p>
</header>`;
}

/** The compact one, for a page that is mostly a result. */
export function mastheadCompact(subtitle: Renderable): Html {
  return html`<header class="masthead full">
<h1 class="wordmark compact"><a href="/">Lacuna</a></h1>
<p class="promise">${subtitle}</p>
</header>`;
}

export interface PanelOptions {
  /** Its place in the reading order, printed in the margin. */
  readonly index: number;
  readonly label: string;
  readonly heading: string;
  readonly body: Renderable;
}

/**
 * One numbered section with its label in the margin.
 *
 * The number is the reading order and the label is what the section is, both of
 * which belong beside the section rather than inside it. On a narrow screen the
 * margin has nowhere to go, so the stylesheet moves the label above the
 * heading; the markup does not change.
 */
export function panel(options: PanelOptions): Html {
  return html`<section class="panel">
<p class="rail">${String(options.index).padStart(2, '0')}<b>${options.label}</b></p>
<h2>${options.heading}</h2>
${options.body}
</section>`;
}

/** The rule between two sections, which is a thematic break and is drawn as one. */
export function separator(): Html {
  return html`<hr class="sep">`;
}
