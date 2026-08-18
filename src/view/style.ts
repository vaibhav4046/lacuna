/**
 * The whole appearance of the product, as one response.
 *
 * It is a string constant rather than a file on disk so that serving it reads
 * nothing from the filesystem. A server that never opens a path cannot be
 * talked into opening the wrong one, and no screen here needs another asset.
 *
 * The direction is the frozen design at design/reference/tokens.css, drawn
 * from the approved product design (design/reference/Lacuna Product.dc.html):
 * a pure black ground, neutral charcoal surfaces raised off it, hairline
 * borders at a tenth and a sixth of white, one violet that always means
 * interaction or the thing you are looking at, and one amber that always
 * means evidence. Absence is calm grey rather than a warning colour, because
 * a missing fact is an answer here, not an error. That palette is a decision
 * rather than a default, so the stylesheet commits to one ground and paints
 * it explicitly instead of asking the reader's system what they would prefer.
 *
 * Two rules survive from the earlier drafts because they were right. Monospace
 * is reserved for anything the machine produced, so a figure read off a run
 * never wears the same type as a sentence somebody wrote. And there are no web
 * fonts: nothing to license, nothing to fetch, no flash of unstyled text, and a
 * content security policy that never has to name a font host. Space Grotesk
 * and JetBrains Mono are named first because the design specifies them, and
 * the stacks fall through to the system if they are not installed.
 *
 * See DECISIONS.md D-059 and D-079.
 */
export const STYLESHEET = `
:root {
  color-scheme: dark;

  /* Ground and surfaces, from design/reference/tokens.css. The ground is a
     pure void and the surfaces are neutral greys with no blue cast in them. */
  --paper:        #000000;
  --paper-raised: #161616;
  --paper-lift:   #242424;
  --paper-sunk:   #0a0a0a;

  /* Four steps of white, so hierarchy is carried by weight of ink. */
  --ink:       #ffffff;
  --ink-soft:  #bdbdbd;
  --ink-faint: #9a9a9a;
  --ink-dim:   #5e5e5e;

  /* Borders are white at low alpha rather than a grey, so they sit correctly
     on every surface without a second set of values per surface. */
  --rule:        rgba(255, 255, 255, 0.15);
  --rule-faint:  rgba(255, 255, 255, 0.10);
  --rule-strong: rgba(255, 255, 255, 0.25);
  --hair:        rgba(255, 255, 255, 0.04);

  /* One violet. It marks interaction, the row this product is in, and the
     thing you are looking at. It is never decoration. */
  --mark:      #8052ff;
  --mark-lift: #8f66ff;
  --mark-soft: rgba(128, 82, 255, 0.60);
  --mark-wash: rgba(128, 82, 255, 0.08);
  --mark-glow: rgba(128, 82, 255, 0.30);

  /* One amber, for evidence: the figure an argument turns on, the point on a
     drawing where something changed, and the dot in the product's own mark. */
  --spark: #ffb829;

  --sans: 'Space Grotesk', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', monospace;

  --t-display: clamp(2.75rem, 1rem + 4.25vw, 4.75rem);
  --t-verdict: clamp(2rem, 1rem + 4vw, 3.75rem);
  --t-lede:    clamp(1.0625rem, 1rem + 0.45vw, 1.3125rem);
  --t-body:    1rem;
  --t-small:   0.8125rem;
  --t-micro:   0.6875rem;

  /* Radius is zero everywhere per the 2026-08-16 amendment in
     design/reference/tokens.css. The names stay so nothing referencing
     them breaks. */
  --r-panel:   0;
  --r-control: 0;
  --r-pill:    0;
  --r-hair:    0;

  /* Two motion tiers, one curve each: micro for colour, border and
     background; --ease for anything that moves in space. */
  --ease-micro: cubic-bezier(0, 0, .2, 1);
  --ease:       cubic-bezier(.23, 1, .32, 1);
  --dur-hover:  160ms;
  --dur-press:  100ms;

  --side-w: 13.5rem;
  --rail-w: 11rem;
  --main-w: 76rem;
  --gutter: clamp(1.25rem, 3.5vw, 3.5rem);
  --edge:   clamp(1.25rem, 4vw, 5rem);
}

*, *::before, *::after { box-sizing: border-box; }

/* The bar at the top is sticky, so a jump to an anchor has to clear it or the
   thing you jumped to arrives underneath it. */
html {
  -webkit-text-size-adjust: 100%;
  scroll-padding-top: 5rem;
  scrollbar-color: var(--rule-strong) transparent;
}

/*
 * One ground: the void. The approved design keeps the page pure black with no
 * atmosphere behind the wordmark, so depth is carried entirely by the raised
 * surfaces and hairlines sitting on it.
 */
body {
  margin: 0;
  padding: 0;
  background-color: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: var(--t-body);
  line-height: 1.6;
  letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
}

/* ---- the app shell ------------------------------------------------------ */

/*
 * Two columns: the rail, which never scrolls away, and everything else. The
 * design puts the routes down the left and one hairline bar across the top,
 * and the reason it holds up is that neither of them ever moves, so a reader
 * two pages deep still knows where they are without looking for it.
 */
.app {
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr);
  min-height: 100vh;
}

.side {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 1.35rem 1.15rem 1.5rem;
  border-right: 1px solid var(--rule-faint);
  background-color: var(--paper);
}

/* The mark and the name, which are also the way home. */
.side-mark {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0 0.35rem 1.6rem;
  font-size: var(--t-small);
  font-weight: 500;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--ink);
  border-bottom-color: transparent;
}

.side-mark svg { flex: none; overflow: visible; }
.side-mark:hover { color: var(--mark); }

.rail-nav { flex: 1 1 auto; overflow-y: auto; }

.rail-group {
  margin: 1.15rem 0 0.5rem;
  padding: 0 0.35rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.rail-nav > .rail-group:first-child { margin-top: 0; }

.rail-list { list-style: none; margin: 0; padding: 0; }

/*
 * The route you are on is marked three ways: the tick in the margin, the ink
 * going to full white, and aria-current in the markup, which is the one that
 * carries for a reader who is not looking at the colour.
 */
.rail-list a {
  display: block;
  position: relative;
  padding: 0.4rem 0.35rem 0.4rem 0.75rem;
  font-size: var(--t-small);
  color: var(--ink-faint);
  border-bottom-color: transparent;
  transition: color var(--dur-hover) var(--ease-micro),
    background-color var(--dur-hover) var(--ease-micro);
}

.rail-list a::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.45rem;
  bottom: 0.45rem;
  width: 2px;
  background-color: transparent;
}

.rail-list a:hover { color: var(--ink); background-color: var(--hair); }

.rail-list a[aria-current="page"] {
  color: var(--ink);
  background-color: var(--mark-wash);
}

.rail-list a[aria-current="page"]::before { background-color: var(--mark); }

/* What this workspace is, said plainly at the bottom of the rail rather than
   implied by an avatar and a name the product does not have. */
.side-foot {
  padding: 1.5rem 0.35rem 0;
  border-top: 1px solid var(--rule-faint);
  font-size: var(--t-micro);
  line-height: 1.7;
}

.side-key {
  margin: 0;
  font-family: var(--mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.side-val { margin: 0.25rem 0 0; font-family: var(--mono); color: var(--ink-soft); }
.side-note { margin: 0.5rem 0 0; color: var(--ink-dim); }

.pane { display: flex; flex-direction: column; min-width: 0; }

/*
 * The bar across the top says two things: which route this is, and where the
 * page got its figures. Both are the sort of thing a reader checks once and
 * then stops thinking about, which is why they are small, quiet and always in
 * the same place.
 */
.topbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 1.5rem;
  padding: 0.85rem var(--edge);
  background-color: var(--paper);
  border-bottom: 1px solid var(--rule-faint);
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

@supports ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .topbar {
    background-color: rgba(0, 0, 0, 0.62);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
  }
}

.topbar-route { color: var(--ink); }
.topbar-source { color: var(--ink-dim); }

/*
 * The sheet is the page itself, and it carries the ruled column structure the
 * whole product is set on. A panel inside it asks for subgrid, and subgrid
 * resolves against the immediate parent grid rather than against the nearest
 * ancestor that happens to have the right columns, so the columns have to be
 * declared here rather than further out.
 */
.sheet {
  display: grid;
  grid-template-columns: [rail] var(--rail-w) [main] minmax(0, var(--main-w)) [end];
  column-gap: var(--gutter);
  align-content: start;
  width: 100%;
  max-width: calc(var(--rail-w) + var(--main-w) + 3.5rem);
  margin: 0 auto;
  padding: 0 var(--edge) 5rem;
}

.sheet > * { grid-column: main; }
.sheet > .full { grid-column: rail / end; }

/*
 * A panel spans the whole sheet and re-uses the sheet's own columns, so its
 * label sits in the margin and its figures run the full width, without either
 * one being positioned by hand.
 */
.panel {
  grid-column: rail / end;
  display: grid;
  grid-template-columns: subgrid;
  align-content: start;

  /* The margin rule, drawn as a background rather than an element so nothing
     competes with the label for the margin column. It fades out at both ends,
     which is the difference between a border and a considered line. */
  background-image: linear-gradient(
    180deg,
    transparent 0%,
    var(--rule-faint) 9%,
    var(--rule-faint) 91%,
    transparent 100%
  );
  background-repeat: no-repeat;
  background-size: 1px 100%;
  background-position: calc(var(--rail-w) + var(--gutter) / 2) 0;
}

.panel > * { grid-column: main; }
.panel > .figure { grid-column: rail / end; }

.rail {
  grid-column: rail;
  margin: 0;
  justify-self: end;
  text-align: right;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-dim);
  padding-top: 0.6rem;
  line-height: 1.8;
}

.rail b {
  display: block;
  font-weight: 400;
  color: var(--mark);
}

/*
 * The break between sections. A hairline across the sheet with the first inch
 * of it in violet, which lands in the margin column and lines the section
 * numbers up down the page.
 */
.sep {
  grid-column: rail / end;
  width: 100%;
  height: 1px;
  border: 0;
  margin: clamp(2.25rem, 5vw, 3.75rem) 0 0;
  background-color: var(--rule-faint);
  background-image: linear-gradient(90deg, var(--mark) 0 2.25rem, transparent 2.25rem);
  background-repeat: no-repeat;
}

/*
 * Below this width the margin column has nowhere to go, and below the second
 * the rail stops being a column at all: it lies down across the top, which is
 * what a phone has room for, and the routes wrap as a strip.
 */
@media (max-width: 62rem) {
  :root { --rail-w: 0px; }
  .sheet, .panel { column-gap: 0; }
  .panel { background-image: none; }
  .rail { grid-column: main; justify-self: start; text-align: left; padding-top: 0; }
  .sep { background-image: linear-gradient(90deg, var(--mark) 0 1.5rem, transparent 1.5rem); }
}

@media (max-width: 52rem) {
  .app { grid-template-columns: minmax(0, 1fr); }

  .side {
    position: static;
    height: auto;
    padding: 1rem var(--edge) 1.1rem;
    border-right: 0;
    border-bottom: 1px solid var(--rule-faint);
  }

  .side-mark { padding-bottom: 0.9rem; }
  .rail-nav { display: flex; flex-wrap: wrap; gap: 0 1.25rem; }
  .rail-group { display: none; }
  .rail-list { display: flex; flex-wrap: wrap; gap: 0 0.35rem; }
  .rail-list a { padding-left: 0.6rem; }
  .side-foot { display: none; }
}

.ways {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1.4rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.ways a {
  color: var(--ink-faint);
  border-bottom: 1px solid transparent;
  padding-bottom: 0.25rem;
  transition: color var(--dur-hover) var(--ease-micro), border-color var(--dur-hover) var(--ease-micro);
}

.ways a:hover { color: var(--ink); border-bottom-color: var(--rule-strong); }

/* At phone width the routes are one character too wide for one line, which
   orphans the last onto a row of its own. Tighter tracking and gap keep the
   nav whole rather than dropping a page from it. */
@media (max-width: 40rem) {
  .ways { gap: 0.35rem 0.85rem; letter-spacing: 0.06em; }
}

/*
 * The page you are on is said twice here, in colour and in a rule, because
 * colour on its own is not an answer for a reader who cannot see this one. The
 * markup says it a third time in aria-current, which is the copy that carries.
 */
.ways a[aria-current="page"] {
  color: var(--ink);
  border-bottom-color: var(--mark);
}

/*
 * Off the screen until it is focused, which is the one moment it is any use.
 * Fixed rather than absolute on focus, so it lands in the corner of the
 * viewport wherever the reader was when they reached for the keyboard.
 */
.skip { position: absolute; top: 0; left: -100vw; }

.skip:focus {
  position: fixed;
  top: 1rem;
  left: 1rem;
  z-index: 4;
  padding: 0.6rem 1rem;
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--paper);
  background: var(--mark);
  border: 1px solid var(--mark);
  border-radius: var(--r-control);
}

/* ---- masthead ----------------------------------------------------------- */

.masthead { padding: clamp(2rem, 4vw, 3.5rem) 0 0; }

/*
 * The name at display size, set tight. The whole page below it is evidence, so
 * the one place the product is allowed to be loud is its own name.
 */
.wordmark {
  margin: 0;
  font-size: var(--t-display);
  font-weight: 500;
  letter-spacing: -0.055em;
  line-height: 0.82;
  color: var(--ink);
}

.wordmark::after { content: '.'; color: var(--spark); }

.wordmark a { color: inherit; border-bottom-color: transparent; }
.wordmark a:hover { color: var(--mark); }

/*
 * On a result page the wordmark is a way back, not an announcement. It keeps
 * the tracking so the two pages read as one product.
 */
.wordmark.compact {
  font-size: clamp(1.5rem, 1rem + 1.6vw, 2.125rem);
  letter-spacing: -0.035em;
  line-height: 1.05;
}

.masthead:has(.compact) { padding-top: clamp(2rem, 4.5vw, 3.25rem); }
.masthead:has(.compact) .promise {
  max-width: 60ch;
  font-size: var(--t-body);
  font-weight: 400;
  color: var(--ink-soft);
}

/* The promise opens with the design's frozen headline, "Memory that knows
   what changed", so on the front page it is set as the hero line: near
   headline scale, full ink, and a measure that breaks it into two lines. */
.promise {
  margin: 1.5rem 0 0;
  font-size: clamp(1.375rem, 1rem + 1.5vw, 2rem);
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: -0.02em;
  color: var(--ink);
  max-width: 30ch;
  text-wrap: balance;
}

/* ---- the result band ---------------------------------------------------- */

/*
 * Four figures under the name, each at the size of the claim it makes. Three
 * of them are the argument and the fourth is the price, and the price is set in
 * the same type as the other three rather than shrunk into a footnote, because
 * a band that prints only its wins is an advertisement.
 *
 * Every cell links to the run that produced it, so the figure and its evidence
 * are one click apart. The numerals are monospace for the same reason every
 * other machine produced figure here is: it marks them as read off something
 * rather than written by hand.
 *
 * The one pixel gap is the border. Cells sit on a hairline ground and the whole
 * band is clipped to the panel radius, so four surfaces read as one object.
 */
.strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11.5rem, 1fr));
  gap: 1px;
  margin: clamp(1.75rem, 3vw, 2.5rem) 0 0;
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-panel);
  background: var(--rule-faint);
  overflow: hidden;
}

.strip .cell {
  padding: 1.35rem 1.35rem 1.25rem;
  background: var(--paper-raised);
  border-bottom: 0;
  box-shadow: inset 0 1px 0 var(--hair);
  transition: background-color var(--dur-hover) var(--ease-micro);
}

.strip .cell b {
  display: block;
  font-family: var(--mono);
  font-size: clamp(1.625rem, 1rem + 1.8vw, 2.25rem);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.035em;
  line-height: 1.05;
  color: var(--ink);
}

/* The caption under each figure is a sentence, so it is set as one. The
   numeral above it keeps the mono, because the numeral is the thing that was
   measured. */
.strip .cell span {
  display: block;
  margin-top: 0.6rem;
  font-size: var(--t-small);
  line-height: 1.5;
  color: var(--ink-dim);
  transition: color var(--dur-hover) var(--ease-micro);
}

/* The one figure the whole argument turns on, in the evidence amber. */
.strip .cell.mark { box-shadow: inset 0 2px 0 var(--spark); }
.strip .cell.mark b { color: var(--spark); }

/* The score and the ratio are the argument; the configuration count is
   provenance and the median is the price. The last two keep their captions
   word for word but step down in size and ink, so the ranking reads before
   the words do. */
.strip .cell.minor b {
  font-size: clamp(1.25rem, 0.85rem + 1.1vw, 1.625rem);
  color: var(--ink-soft);
}

.strip .cell:hover { background: var(--paper-lift); }
.strip .cell:hover span { color: var(--ink-soft); }

/* ---- section furniture -------------------------------------------------- */

.panel { padding: clamp(2.5rem, 5vw, 4rem) 0 clamp(1.5rem, 3vw, 2.5rem); }

.panel h2 {
  margin: 0 0 1.35rem;
  font-size: clamp(1.375rem, 1rem + 1vw, 1.75rem);
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--ink);
}

/* Subheads are short sentences ("How it got there"), so they are set as
   headings rather than as machine labels. */
.panel h3 {
  margin: 2.25rem 0 0.85rem;
  font-size: var(--t-body);
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.prose { max-width: 66ch; color: var(--ink-soft); }

/*
 * Figures break the measure and run the full width of the sheet. They are the
 * one place a drawing is allowed to be the size of the argument it makes.
 */
.figure {
  grid-column: rail / end;
  margin: 1.75rem 0 0;
  padding: 1.75rem clamp(1rem, 2vw, 2rem);
  background: var(--paper-raised);
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-panel);
  box-shadow: inset 0 1px 0 var(--hair), 0 28px 56px -40px rgb(0 0 0 / 0.9);
  overflow-x: auto;
}

.figure svg { display: block; width: 100%; height: auto; min-width: 34rem; }

.caption {
  margin: 1.1rem 0 0;
  font-size: var(--t-small);
  line-height: 1.7;
  color: var(--ink-dim);
  max-width: 74ch;
}

/* ---- links, focus, buttons ---------------------------------------------- */

a {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--rule);
  transition: border-color var(--dur-hover) var(--ease-micro), color var(--dur-hover) var(--ease-micro);
}

a:hover { color: var(--mark); border-bottom-color: var(--mark); }
a:active { color: var(--mark-lift); }

:focus-visible {
  outline: 2px solid var(--mark);
  outline-offset: 3px;
  border-radius: var(--r-hair);
}

/* Selecting a quotation to paste it into a report is a thing this site expects
   people to do, so the selection is part of the palette rather than the
   browser's blue. */
::selection { background: rgba(128, 82, 255, 0.45); color: #ffffff; }

/* ---- the question form -------------------------------------------------- */

/*
 * The sentence that hands over from the one-click path to the typed one. It is
 * prose, not a caption: it explains a storage model, which captions cannot do.
 */
.formlead {
  margin: 2.25rem 0 0;
  font-size: var(--t-body);
  line-height: 1.6;
  color: var(--ink-dim);
  max-width: 66ch;
}

.ask {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem 1.25rem;
  margin: 1rem 0 0;
  padding: 1.5rem;
  background: var(--paper-raised);
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-panel);
  box-shadow: inset 0 1px 0 var(--hair);
}

.field { display: flex; flex-direction: column; gap: 0.5rem; flex: 1 1 12rem; }

.field label {
  font-size: var(--t-small);
  color: var(--ink-dim);
}

.field input {
  font-family: var(--mono);
  font-size: 0.9375rem;
  color: var(--ink);
  background: var(--paper-sunk);
  border: 1px solid var(--rule);
  border-radius: var(--r-control);
  padding: 0.7rem 0.8rem;
  min-width: 0;
  transition: border-color var(--dur-hover) var(--ease-micro), box-shadow var(--dur-hover) var(--ease-micro);
}

.field input::placeholder { color: var(--ink-dim); }
.field input:hover { border-color: var(--rule-strong); }

.field input:focus {
  outline: none;
  border-color: var(--mark);
  box-shadow: 0 0 0 3px var(--mark-wash);
}

.ask button {
  font-family: var(--sans);
  font-size: var(--t-small);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #000000;
  background: var(--mark);
  border: 1px solid var(--mark);
  border-radius: var(--r-control);
  padding: 0.75rem 1.5rem;
  cursor: pointer;
  transition:
    background-color var(--dur-hover) var(--ease-micro),
    box-shadow var(--dur-hover) var(--ease-micro),
    transform var(--dur-press) var(--ease);
}

.ask button:hover {
  background: var(--mark-lift);
  border-color: var(--mark-lift);
  box-shadow: 0 8px 28px -10px var(--mark-glow);
}

.ask button:active { transform: translateY(1px); box-shadow: none; }

/* ---- example questions -------------------------------------------------- */

.examples { list-style: none; margin: 1.25rem 0 0; padding: 0; }

.examples li {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 0 1.25rem;
  align-items: baseline;
  padding: 0.8rem 0;
  border-top: 1px solid var(--rule-faint);
  transition: background-color var(--dur-hover) var(--ease-micro);
}

.examples li:last-child { border-bottom: 1px solid var(--rule-faint); }
.examples li:hover { background: linear-gradient(90deg, var(--mark-wash), transparent 65%); }

.kind {
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.examples a { border-bottom-color: transparent; }
.examples li:hover .kind { color: var(--mark); }

@media (max-width: 40rem) {
  .examples li { grid-template-columns: minmax(0, 1fr); gap: 0.25rem; }
}

/* ---- the verdict -------------------------------------------------------- */

/* The asked line is a sentence about the question; the subject and predicate
   inside it are the machine values, so they take the mono, not the sentence. */
.asked {
  font-size: var(--t-small);
  color: var(--ink-dim);
  margin: 0 0 0.9rem;
}

.asked b { font-family: var(--mono); color: var(--ink-soft); font-weight: 400; }

.verdict {
  margin: 0;
  font-size: var(--t-verdict);
  font-weight: 500;
  line-height: 1.02;
  letter-spacing: -0.04em;
  text-wrap: balance;
  color: var(--ink);
}

/* Absence is calm in this palette: the verdict steps back to grey rather than
   raising an alarm, because a missing fact is an answer, not an error. */
.verdict.absent { color: var(--ink-faint); }

/* The reason an answer is missing, set as a badge rather than a sentence, so
   the five of them are told apart at a glance. Grey on grey, same register as
   the verdict above it. */
.reason {
  display: inline-block;
  margin: 1.15rem 0 0;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--rule);
  border-radius: var(--r-pill);
  padding: 0.4rem 0.85rem;
}

/* One shape per way a fact can be missing, worn everywhere the reason code
   appears. The shape does the distinguishing, so the encoding survives without
   colour; the violet only points at the shape. */
.glyph {
  display: inline-block;
  min-width: 1.5em;
  font-family: var(--mono);
  font-style: normal;
  letter-spacing: 0;
  text-transform: none;
  color: var(--mark);
}

.explain {
  margin: 1.35rem 0 0;
  font-size: var(--t-lede);
  line-height: 1.5;
  letter-spacing: -0.012em;
  color: var(--ink-soft);
  max-width: 52ch;
}

/* ---- trace -------------------------------------------------------------- */

.trace { list-style: none; margin: 0; padding: 0; counter-reset: step; }

.trace li {
  counter-increment: step;
  display: grid;
  grid-template-columns: 2.25rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.45rem 0;
  max-width: 68ch;
  color: var(--ink-soft);
}

.trace li::before {
  content: counter(step, decimal-leading-zero);
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--mark);
  padding-top: 0.15rem;
}

/*
 * The walk and the quotations, side by side where the sheet is wide enough.
 *
 * The step that names a claim and the quotation that backs it belong on the
 * same horizon, not a screenful apart. Below the breakpoint the pair stacks
 * back into reading order, which is also the order a screen reader gets in
 * either case.
 */
.duo {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 var(--gutter);
  align-items: start;
}

@media (min-width: 68rem) {
  .duo { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ---- citations ---------------------------------------------------------- */

.citation {
  margin: 1.35rem 0 0;
  padding: 0.15rem 0 0.15rem 1.25rem;
  border-left: 2px solid var(--rule-strong);
  max-width: 70ch;
}

.citation .source {
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-dim);
  margin: 0 0 0.4rem;
}

.citation .source em { font-style: normal; color: var(--ink-faint); }

.citation blockquote { margin: 0; font-size: 1.0625rem; line-height: 1.6; color: var(--ink); }
.citation blockquote::before { content: '\\201C'; }
.citation blockquote::after { content: '\\201D'; }

.nothing {
  margin: 1.35rem 0 0;
  padding: 1.1rem 1.35rem;
  border-left: 2px solid var(--rule-strong);
  border-radius: 0 var(--r-control) var(--r-control) 0;
  background: rgba(255, 255, 255, 0.03);
  color: var(--ink-soft);
  max-width: 66ch;
}

/* ---- tables ------------------------------------------------------------- */

table { width: 100%; border-collapse: collapse; font-size: var(--t-small); }

th {
  text-align: left;
  font-family: var(--mono);
  font-size: var(--t-micro);
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-dim);
  padding: 0 0.9rem 0.65rem 0;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}

td {
  padding: 0.65rem 0.9rem 0.65rem 0;
  border-bottom: 1px solid var(--rule-faint);
  vertical-align: top;
  color: var(--ink-soft);
  transition: background-color var(--dur-hover) var(--ease-micro);
}

/* A row is a system in a fifty one row sweep, so following one across the page
   is the main thing anybody does with these tables. Written with the same
   specificity as the rule that marks our own row, and before it, so that the
   marked row keeps its wash rather than losing it under the cursor. */
tr:hover td { background: rgba(255, 255, 255, 0.035); }

td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.mono { font-family: var(--mono); color: var(--ink-faint); white-space: nowrap; }
td.value { font-size: 1rem; color: var(--ink); }
td.mark-cell { width: 1.75rem; padding-right: 0; }
td.mark-cell.past .glyph { color: var(--ink-dim); }

/* A capability or data state, set as a badge because it is a fixed vocabulary
   of five words and not a sentence. */
.state {
  display: inline-block;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-pill);
  padding: 0.22rem 0.6rem;
  white-space: nowrap;
}

/* No longer held. Dimmer and hollow rather than alarmed, because superseded
   is a calm fact about the past, not a warning. */
.state.gone {
  color: var(--ink-dim);
  background: transparent;
  border-color: var(--rule-faint);
}

/* ---- evidence pages ----------------------------------------------------- */

/* The product's own row, marked rather than moved, so it stays in rank order.
   The violet edge is on the first cell only, which reads as a bar down the
   left of the row rather than a box around it. */
tr.ours td { background: var(--mark-wash); }
tr.ours td:first-child { box-shadow: inset 2px 0 0 var(--mark); }
tr.ours td.mono { color: var(--mark); }

/* Wide tables scroll inside the panel instead of widening the page. */
.scroll { overflow-x: auto; }
.scroll table { min-width: 36rem; }

code {
  font-family: var(--mono);
  font-size: 0.9em;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.06);
  border-radius: var(--r-hair);
  padding: 0.1em 0.35em;
  overflow-wrap: anywhere;
}

.tally {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 1px;
  margin: 0 0 1.75rem;
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-panel);
  background: var(--rule-faint);
  overflow: hidden;
}

.tally > div {
  padding: 1.1rem 1.2rem 1rem;
  background: var(--paper-raised);
  box-shadow: inset 0 1px 0 var(--hair);
}

.tally b {
  display: block;
  font-family: var(--mono);
  font-size: var(--t-lede);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--ink);
}

.tally .mark b { color: var(--spark); }

.tally span {
  display: block;
  margin-top: 0.5rem;
  font-size: var(--t-small);
  line-height: 1.5;
  color: var(--ink-dim);
}

/* ---- query proof -------------------------------------------------------- */

.query { padding: 1.25rem 0; border-bottom: 1px solid var(--rule-faint); }
.query:first-of-type { border-top: 1px solid var(--rule); }

.query-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.25rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
  margin-bottom: 0.7rem;
}

.query-head .n { color: var(--mark); }

.query pre {
  margin: 0;
  padding: 1rem 1.15rem;
  background: var(--paper-sunk);
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-control);
  font-family: var(--mono);
  font-size: var(--t-small);
  line-height: 1.7;
  color: var(--ink-soft);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.params {
  margin: 0.7rem 0 0;
  font-family: var(--mono);
  font-size: var(--t-small);
  line-height: 1.8;
  color: var(--ink-dim);
}

.params b { color: var(--ink-faint); font-weight: 400; }

/* ---- drawings ----------------------------------------------------------- */

.thread { stroke: var(--ink); stroke-width: 1.5; fill: none; }
.thread-gap { stroke: var(--ink-dim); stroke-width: 1.5; stroke-dasharray: 2 6; stroke-linecap: round; fill: none; }
.axis { stroke: var(--rule); stroke-width: 1; fill: none; }
.tick-live { fill: var(--ink); stroke: none; }
.tick-gone { fill: var(--paper-lift); stroke: var(--ink-dim); stroke-width: 1.5; }
.tick-stop { stroke: var(--spark); stroke-width: 2; fill: none; }

.svg-value { fill: var(--ink); font-family: var(--sans); font-size: 15px; letter-spacing: -0.01em; }
.svg-value.gone { fill: var(--ink-dim); }
.svg-date { fill: var(--ink-dim); font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; }
.svg-note { fill: var(--ink-faint); font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; }

.node { fill: var(--paper-lift); stroke: var(--rule); stroke-width: 1; }
.node.subject { stroke: var(--ink); stroke-width: 1.5; }
.node.answering { fill: var(--mark-wash); stroke: var(--mark); stroke-width: 1.5; }
.edge { stroke: var(--rule); stroke-width: 1; fill: none; }
.edge.hop { stroke: var(--mark); stroke-width: 1.5; }
.edge-label { fill: var(--ink-dim); font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; }
.node-label { fill: var(--ink); font-family: var(--mono); font-size: 11px; }
.node-sub { fill: var(--ink-dim); font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.06em; }

/* ---- the voice surface -------------------------------------------------- */

/*
 * The sphere from the imported design, drawn once per state.
 *
 * The design animated it against microphone level. Nothing on this site reads
 * a microphone, so it is drawn rather than driven, and its three variables are
 * the three the design used: how solid the surface is, whether its edge is
 * dashed, and whether it is engaged. That is enough to tell fourteen states
 * apart on paper, which is the test this drawing has to pass.
 *
 * It is deliberately not a figure. Figures here break the measure and
 * stretch a diagram across the sheet; this one is 148 pixels of circle beside
 * a sentence, and stretching it would say the wrong thing about its
 * importance.
 */
.orb-figure {
  margin: 1.75rem 0 0;
  display: grid;
  grid-template-columns: auto minmax(16rem, 1fr);
  gap: 0 clamp(1rem, 2.5vw, 2rem);
  align-items: center;
}

.orb { display: block; width: 148px; height: 148px; }

.orb-figure > .caption { margin: 0; max-width: 46ch; }

@media (max-width: 34rem) {
  .orb-figure { grid-template-columns: 1fr; }
  .orb-figure > .caption { margin: 1rem 0 0; }
}

/* Drawn from the outside in: a limit, an edge, and whatever is inside it. */
.orb-limit { fill: none; stroke: var(--rule-faint); stroke-width: 1; }

.orb-fill { fill: none; }
.orb-fill.full { fill: var(--paper-lift); }
.orb-fill.faded { fill: var(--paper-raised); }
.orb-fill.live { fill: var(--mark-wash); }

.orb-ring { fill: none; stroke: var(--rule-strong); stroke-width: 1.5; }
.orb-ring.dashed { stroke-dasharray: 6 5; }

/* Engaged is the one state that gets light, because it is the one state where
   something is actually happening. */
.orb-ring.live { stroke: var(--mark); stroke-width: 2; filter: drop-shadow(0 0 7px var(--mark-glow)); }

/* Fourteen links is too many for the page bar and exactly right for a list
   that is the subject of the section it sits in. Set as chips, because that is
   what a set of states you can switch between looks like. */
.states {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1.1rem 0 0;
  font-family: var(--mono);
  font-size: var(--t-small);
  letter-spacing: 0.04em;
}

.states a {
  display: inline-block;
  padding: 0.35rem 0.75rem;
  color: var(--ink-faint);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--rule-faint);
  border-radius: var(--r-pill);
  transition:
    color var(--dur-hover) var(--ease-micro),
    border-color var(--dur-hover) var(--ease-micro),
    background-color var(--dur-hover) var(--ease-micro);
}

.states a:hover { color: var(--ink); border-color: var(--rule-strong); background: var(--paper-lift); }

.states a[aria-current="page"] {
  color: var(--mark);
  border-color: var(--mark-soft);
  background: var(--mark-wash);
}

/* ---- foot --------------------------------------------------------------- */

.foot {
  margin-top: auto;
  padding: 1.35rem var(--edge) 2.5rem;
  border-top: 1px solid var(--rule-faint);
  font-size: var(--t-small);
  line-height: 1.75;
  color: var(--ink-dim);
}

.foot > * { max-width: 74ch; }

/* Scoped to the prose, so the repeated bar below keeps the link treatment it
   shares with the bar at the top rather than picking up a faint underline on
   all four of its items. */
.foot p a { border-bottom-color: var(--rule-faint); }

/* The bar again at the end, so a reader who has read to the bottom of a page
   does not have to travel back up it to go anywhere else. */
.ways { margin: 0 0 1.15rem; }

/* ---- motion ------------------------------------------------------------- */

/*
 * Every moving thing on the site is named here. A blanket universal selector
 * would be shorter and would lose: it has no specificity at all, so it cannot
 * beat the plain element rules that set these transitions in the first place.
 * Naming each selector at the specificity it was written with, and after it was
 * written, is what makes the preference actually hold.
 */
@media (prefers-reduced-motion: reduce) {
  a,
  .ways a,
  .states a,
  .strip .cell,
  .strip .cell span,
  .examples li,
  .field input,
  .ask button,
  td {
    transition: none;
  }

  .ask button:active { transform: none; }
}

/* ---- print -------------------------------------------------------------- */

/*
 * Paper is white and has no backlight, so the whole palette inverts rather
 * than printing a black page. The borders have to be named again because the
 * screen ones are white at low alpha and would come out invisible.
 */
@media print {
  :root {
    --paper:        #ffffff;
    --paper-raised: #ffffff;
    --paper-lift:   #ffffff;
    --paper-sunk:   #ffffff;
    --ink:          #000000;
    --ink-soft:     #222222;
    --ink-faint:    #444444;
    --ink-dim:      #555555;
    --rule:         #999999;
    --rule-faint:   #cccccc;
    --rule-strong:  #666666;
    --hair:         transparent;
    --mark:         #5b2fd9;
    --spark:        #7a5200;
    --mark-wash:    transparent;
    --mark-glow:    transparent;
  }

  body { padding: 0; background: none; color: #000000; }

  /* Navigation and a text box are the two things paper cannot do anything
     with. What survives is the evidence, which is the reason to print a page
     here at all. */
  .skip, .side, .topbar, .ask, .foot { display: none; }
  .panel { break-inside: avoid; }
  .figure, .strip, .tally, .ask { box-shadow: none; }
  .orb-ring.live { filter: none; }
}
`;
