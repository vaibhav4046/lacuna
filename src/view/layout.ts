/**
 * The shell every page is served inside.
 *
 * The shape is the approved product design
 * (design/reference/Lacuna Product.dc.html, and the frontend handoff shipped
 * beside it): a fixed rail on the left carrying the mark and the routes in
 * grouped monospace, a hairline bar across the top naming the route you are
 * on, and the page itself in the space that is left. Nothing else on screen
 * competes with the answer.
 *
 * The design was drawn as a client-side component with a particle canvas
 * behind it. Two things in its own handoff made that safe to drop rather than
 * reproduce. The canvas is a marketing device and the handoff says the app
 * view hides it entirely, so the product loses nothing by never loading it.
 * And every piece of state the component tracked, which route and which
 * filter, is state a URL already carries, so the rail is anchors and the
 * filters are query parameters, and a page arrives already in the state it is
 * meant to be in. That is why the content security policy still says
 * `script-src 'none'` with nothing load bearing removed from the design.
 *
 * See DECISIONS.md D-086.
 */
import { html, markup, type Html, type Renderable } from './html.js';

/**
 * The policy, as a list so it can be served two ways.
 *
 * `frame-ancestors` is meaningless in a meta tag and browsers say so in the
 * console, so the meta version drops it and the header keeps it. Everything
 * else is identical, which is the point of writing it once.
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

export const CONTENT_SECURITY_POLICY = DIRECTIVES.join('; ');

export const META_CONTENT_SECURITY_POLICY = DIRECTIVES
  .filter((directive) => !directive.startsWith('frame-ancestors'))
  .join('; ');

/**
 * The mark: three semicircles that never close.
 *
 * The design specifies an open spiral whose centre stays open, because the gap
 * is the product's subject, the thing nobody ever said. The terminal dot is
 * the evidence amber. Drawn inline as geometry so it costs no request, and
 * repeated as the favicon so the tab strip carries the same shape.
 */
export const MARK: Html = html`<svg class="glyph-mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g transform="translate(-1.2 1.475)"><path d="M12 2.6A8.4 8.4 0 0 1 12 19.4A6 6 0 0 1 12 7.4A3.7 3.7 0 0 1 12 14.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><circle cx="12" cy="2.6" r="1.9" fill="#ffb829"></circle></g></svg>`;

export const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<rect width="32" height="32" fill="#000000"/>'
  + '<g transform="translate(5.6 3.3)">'
  + '<path d="M12 2.6A8.4 8.4 0 0 1 12 19.4A6 6 0 0 1 12 7.4A3.7 3.7 0 0 1 12 14.8"'
  + ' fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round"/>'
  + '<circle cx="12" cy="2.6" r="2.1" fill="#ffb829"/>'
  + '</g></svg>\n';

export const PROMISE = 'Memory that knows what changed, what remains true, '
  + 'and what was never known.';

/**
 * The routes, grouped the way the design groups them.
 *
 * Overview is where a question goes in. Context is what the graph holds and
 * how healthy it is. Proof is the two places a claim about the product itself
 * can be checked. Developers is the surface other programs use, and Voice is
 * the one surface that is specified and not built. One array, read by the rail
 * and by the footer, so a route cannot appear in one and not the other.
 */
export type Route =
  | '/'
  | '/memory'
  | '/health'
  | '/bench'
  | '/hydradb'
  | '/interface'
  | '/voice';

export interface NavItem {
  readonly href: Route;
  readonly label: string;
}

export interface NavGroup {
  readonly group: string;
  readonly items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  { group: 'Overview', items: [{ href: '/', label: 'Ask' }] },
  {
    group: 'Context',
    items: [
      { href: '/memory', label: 'Memory' },
      { href: '/health', label: 'Health' },
    ],
  },
  {
    group: 'Proof',
    items: [
      { href: '/bench', label: 'Benchmark' },
      { href: '/hydradb', label: 'HydraDB' },
    ],
  },
  { group: 'Developers', items: [{ href: '/interface', label: 'Interfaces' }] },
  { group: 'Voice', items: [{ href: '/voice', label: 'Voice' }] },
];

/** Every route in one flat list, for anything that does not care about groups. */
export const PAGES: readonly NavItem[] = NAV.flatMap((section) => section.items);

/**
 * The rail.
 *
 * `aria-current` rather than a class is what marks the route you are on: it is
 * the announcement a screen reader makes, and the stylesheet reads the same
 * attribute, so the visible marker and the spoken one cannot disagree. The
 * violet tick beside the current route is drawn by the stylesheet off that
 * same attribute rather than by a second element in the markup.
 */
function rail(current: Route | null): Html {
  return html`<nav class="rail-nav" aria-label="Routes">${NAV.map((section) => html`<p class="rail-group">${section.group}</p>
<ul class="rail-list">${section.items.map((entry) => html`<li><a href="${entry.href}"${entry.href === current ? html` aria-current="page"` : null}>${entry.label}</a></li>`)}</ul>`)}</nav>`;
}

/** The same routes again at the foot of the page, as plain links. */
function ways(current: Route | null): Html {
  return html`<nav class="ways" aria-label="Routes, repeated">${PAGES.map((entry) => html`<a
href="${entry.href}"${entry.href === current ? html` aria-current="page"` : null}>${entry.label}</a>`)}</nav>`;
}

export interface PageOptions {
  readonly title: string;
  readonly description: string;
  /** Which of them this is, or null on a page that is none of them. */
  readonly current: Route | null;
  /** What the bar across the top says. Falls back to the route's own label. */
  readonly heading?: string;
  readonly body: Renderable;
  /** An extra line in the footer, when the page has something to add there. */
  readonly note?: Renderable;
}

/** What the top bar says, when the page did not say it itself. */
function barTitle(options: PageOptions): string {
  if (options.heading !== undefined) return options.heading;
  const match = PAGES.find((entry) => entry.href === options.current);
  return match === undefined ? 'Lacuna' : match.label;
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
<div class="app">
<aside class="side">
<a class="side-mark" href="/">${MARK}<span>Lacuna</span></a>
${rail(options.current)}
<div class="side-foot">
<p class="side-key">Workspace</p>
<p class="side-val">demo &middot; seeded corpus</p>
<p class="side-note">One generated history, one graph. No account, no cookie,
no session.</p>
</div>
</aside>
<div class="pane">
<div class="topbar">
<span class="topbar-route">${barTitle(options)}</span>
<span class="topbar-source">Graph &middot; HydraDB</span>
</div>
<main class="sheet" id="start">
${options.body}
</main>
<footer class="foot">
${ways(options.current)}
<p>Lacuna. ${PROMISE}</p>
<p>This page ships no JavaScript. Every sentence on it is either a fixed
template or a quotation carried out of the graph.</p>
${options.note === undefined ? null : html`<p>${options.note}</p>`}
</footer>
</div>
</div>
</body>
</html>
`;
  return markup(document);
}

/** The promise, for the page a reader arrives at. */
export function masthead(): Html {
  return html`<header class="masthead full">
<p class="promise">${PROMISE}</p>
</header>`;
}

/** A page that is mostly a result says what the result is about instead. */
export function mastheadCompact(subtitle: Renderable): Html {
  return html`<header class="masthead full">
<p class="promise compact">${subtitle}</p>
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
