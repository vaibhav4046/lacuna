/**
 * The whole appearance of the product, as one response.
 *
 * It is a string constant rather than a file on disk so that serving it reads
 * nothing from the filesystem. A server that never opens a path cannot be
 * talked into opening the wrong one, and no screen here needs another asset.
 *
 * The direction is the frozen design at design/reference/tokens.css: a black
 * ground, charcoal surfaces raised off it, hairline borders at a tenth and a
 * sixth of white, and one orange that is only ever allowed to mean something.
 * That palette is a decision rather than a default. The design was drawn black
 * and this is the same product wearing it, so the stylesheet commits to one
 * ground and paints it explicitly instead of asking the reader's system what
 * they would prefer.
 *
 * Two rules survive from the earlier draft because they were right. Monospace
 * is reserved for anything the machine produced, so a figure read off a run
 * never wears the same type as a sentence somebody wrote. And there are no web
 * fonts: nothing to license, nothing to fetch, no flash of unstyled text, and a
 * content security policy that never has to name a font host. Geist is named
 * first because the design specifies it, and the stack falls through to the
 * system if it is not installed.
 *
 * See DECISIONS.md D-059.
 */
export const STYLESHEET = `
:root {
  color-scheme: dark;

  /* Ground and surfaces, from design/reference/tokens.css. */
  --paper:        #000000;
  --paper-raised: #1c1d21;
  --paper-lift:   #2a2c33;
  --paper-sunk:   #0e0f12;

  /* Four steps of white, so hierarchy is carried by weight of ink. */
  --ink:       #ffffff;
  --ink-soft:  #bcbfcc;
  --ink-faint: #9da2b3;
  --ink-dim:   #6e7180;

  /* Borders are white at low alpha rather than a grey, so they sit correctly
     on every surface without a second set of values per surface. */
  --rule:        rgba(255, 255, 255, 0.15);
  --rule-faint:  rgba(255, 255, 255, 0.10);
  --rule-strong: rgba(255, 255, 255, 0.25);
  --hair:        rgba(255, 255, 255, 0.04);

  /* One orange. It marks absence, the row this product is in, and the thing
     you are looking at. It is never decoration. */
  --mark:      #ff5719;
  --mark-lift: #ff6a33;
  --mark-soft: rgba(255, 87, 25, 0.60);
  --mark-wash: rgba(255, 87, 25, 0.08);
  --mark-glow: rgba(255, 87, 25, 0.30);

  --sans: Geist, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: 'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', monospace;

  --t-display: clamp(2.75rem, 1rem + 4.25vw, 4.75rem);
  --t-verdict: clamp(2rem, 1rem + 4vw, 3.75rem);
  --t-lede:    clamp(1.0625rem, 1rem + 0.45vw, 1.3125rem);
  --t-body:    1rem;
  --t-small:   0.8125rem;
  --t-micro:   0.6875rem;

  --r-panel:   16px;
  --r-control: 13px;
  --r-pill:    9999px;
  --r-hair:    4px;

  --ease:      cubic-bezier(.2, .7, .2, 1);
  --dur-hover: 140ms;
  --dur-press: 100ms;

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
 * Two grounds, both fixed to the viewport.
 *
 * The lower one lifts the top of the page a few percent off black so the page
 * has a horizon rather than an edge. The upper one is the single piece of
 * atmosphere on the site: a very low orange, wide and shallow, sitting behind
 * the wordmark. It is fixed rather than scrolled so the sticky bar can be
 * translucent over it without showing a seam.
 */
body {
  margin: 0;
  padding: 0 var(--edge) 6rem;
  background-color: var(--paper);
  background-image:
    radial-gradient(78% 42% at 50% -6%, rgba(255, 87, 25, 0.10) 0%, rgba(255, 87, 25, 0) 62%),
    radial-gradient(120% 78% at 50% 0%, #101116 0%, #000000 58%);
  background-attachment: fixed;
  color: var(--ink);
  font-family: var(--sans);
  font-size: var(--t-body);
  line-height: 1.6;
  letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
}

/* ---- the ruled sheet ---------------------------------------------------- */

.doc {
  display: grid;
  grid-template-columns: [rail] var(--rail-w) [main] minmax(0, var(--main-w)) [end];
  column-gap: var(--gutter);
  max-width: calc(var(--rail-w) + var(--main-w) + 3.5rem);
  margin: 0 auto;
}

.doc > * { grid-column: main; }
.doc > .full { grid-column: rail / end; }

/*
 * The sheet is everything between the bar and the footer, and it has to span
 * the document and declare the same columns again. A panel inside it asks for
 * subgrid, and subgrid resolves against the immediate parent grid rather than
 * against the nearest ancestor that happens to have the right columns. Without
 * this rule every panel loses its margin and the labels fall into the measure.
 */
.sheet {
  grid-column: rail / end;
  display: grid;
  grid-template-columns: subgrid;
  align-content: start;
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
 * of it in orange, which lands in the margin column and lines the section
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

@media (max-width: 62rem) {
  :root { --rail-w: 0px; }
  .doc, .sheet, .panel { column-gap: 0; }
  .panel { background-image: none; }
  .rail { grid-column: main; justify-self: start; text-align: left; padding-top: 0; }
  .sep { background-image: linear-gradient(90deg, var(--mark) 0 1.5rem, transparent 1.5rem); }
}

/* ---- the page bar ------------------------------------------------------- */

/*
 * Few enough pages that they all fit on one line, and a judge with four
 * minutes should never have to scroll to learn the rest of them exist.
 *
 * The solid version is the fallback, because a translucent bar over content
 * that is not blurred is unreadable. Where the browser can blur what passes
 * under it, it does, and the bar becomes a piece of glass with a hairline
 * under it instead of a block sitting on the page.
 */
.bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
  padding: 0.9rem 0 0.85rem;
  background-color: var(--paper);
  border-bottom: 1px solid var(--rule-faint);
}

@supports ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .bar {
    background-color: rgba(0, 0, 0, 0.62);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
  }
}

.bar-mark {
  font-family: var(--sans);
  font-size: var(--t-small);
  font-weight: 500;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--ink);
  border-bottom-color: transparent;
}

/* The mark itself, drawn in CSS so the markup carries no decoration. */
.bar-mark::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 0.45rem;
  border-radius: 1px;
  background: var(--mark);
  vertical-align: 0.06em;
}

.bar-mark:hover { color: var(--mark); }

.tabs, .ways {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1.4rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.tabs a, .ways a {
  color: var(--ink-faint);
  border-bottom: 1px solid transparent;
  padding-bottom: 0.25rem;
  transition: color var(--dur-hover) var(--ease), border-color var(--dur-hover) var(--ease);
}

.tabs a:hover, .ways a:hover { color: var(--ink); border-bottom-color: var(--rule-strong); }

/* At phone width the five tabs are one character too wide for one line, which
   orphans the last onto a row of its own. Tighter tracking and gap keep the
   nav whole rather than dropping a page from it. */
@media (max-width: 40rem) {
  .tabs { gap: 0.35rem 0.85rem; letter-spacing: 0.06em; }
}

/*
 * The page you are on is said twice here, in colour and in a rule, because
 * colour on its own is not an answer for a reader who cannot see this one. The
 * markup says it a third time in aria-current, which is the copy that carries.
 */
.tabs a[aria-current="page"], .ways a[aria-current="page"] {
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

.wordmark::after { content: '.'; color: var(--mark); }

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
.masthead:has(.compact) .promise { max-width: 60ch; font-size: var(--t-body); }

.promise {
  margin: 1.5rem 0 0;
  font-size: var(--t-lede);
  line-height: 1.5;
  letter-spacing: -0.012em;
  color: var(--ink-soft);
  max-width: 34ch;
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
  transition: background-color var(--dur-hover) var(--ease);
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
  transition: color var(--dur-hover) var(--ease);
}

/* The one figure the whole argument turns on. */
.strip .cell.mark { box-shadow: inset 0 2px 0 var(--mark); }
.strip .cell.mark b { color: var(--mark); }

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
  transition: border-color var(--dur-hover) var(--ease), color var(--dur-hover) var(--ease);
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
::selection { background: var(--mark); color: #000000; }

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
  transition: border-color var(--dur-hover) var(--ease), box-shadow var(--dur-hover) var(--ease);
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
    background-color var(--dur-hover) var(--ease),
    box-shadow var(--dur-hover) var(--ease),
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
  transition: background-color var(--dur-hover) var(--ease);
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

.verdict.absent { color: var(--mark); }

/* The reason an answer is missing, set as a badge rather than a sentence, so
   the five of them are told apart at a glance. */
.reason {
  display: inline-block;
  margin: 1.15rem 0 0;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mark);
  background: var(--mark-wash);
  border: 1px solid var(--mark-soft);
  border-radius: var(--r-pill);
  padding: 0.4rem 0.85rem;
}

/* One shape per way a fact can be missing, worn everywhere the reason code
   appears. The shape does the distinguishing, so the encoding survives without
   colour; the orange is the palette's absence colour doing its stated job. */
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
  border-left: 2px solid var(--mark);
  border-radius: 0 var(--r-control) var(--r-control) 0;
  background: var(--mark-wash);
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
  transition: background-color var(--dur-hover) var(--ease);
}

/* A row is a system in a fifty one row sweep, so following one across the page
   is the main thing anybody does with these tables. Written with the same
   specificity as the rule that marks our own row, and before it, so that the
   marked row keeps its wash rather than losing it under the cursor. */
tr:hover td { background: rgba(255, 255, 255, 0.035); }

td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.mono { font-family: var(--mono); color: var(--ink-faint); white-space: nowrap; }
td.value { font-size: 1rem; color: var(--ink); }

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

.state.gone {
  color: var(--mark);
  background: var(--mark-wash);
  border-color: var(--mark-soft);
}

/* ---- evidence pages ----------------------------------------------------- */

/* The product's own row, marked rather than moved, so it stays in rank order.
   The orange edge is on the first cell only, which reads as a bar down the
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
  color: var(--mark);
  background: var(--mark-wash);
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

.tally .mark b { color: var(--mark); }

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
.thread-gap { stroke: var(--mark); stroke-width: 1.5; stroke-dasharray: 2 6; stroke-linecap: round; fill: none; }
.axis { stroke: var(--rule); stroke-width: 1; fill: none; }
.tick-live { fill: var(--ink); stroke: none; }
.tick-gone { fill: var(--paper-lift); stroke: var(--ink-dim); stroke-width: 1.5; }
.tick-stop { stroke: var(--mark); stroke-width: 2; fill: none; }

.svg-value { fill: var(--ink); font-family: var(--sans); font-size: 15px; letter-spacing: -0.01em; }
.svg-value.gone { fill: var(--ink-dim); }
.svg-date { fill: var(--ink-dim); font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; }
.svg-note { fill: var(--mark); font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; }

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
    color var(--dur-hover) var(--ease),
    border-color var(--dur-hover) var(--ease),
    background-color var(--dur-hover) var(--ease);
}

.states a:hover { color: var(--ink); border-color: var(--rule-strong); background: var(--paper-lift); }

.states a[aria-current="page"] {
  color: var(--mark);
  border-color: var(--mark-soft);
  background: var(--mark-wash);
}

/* ---- foot --------------------------------------------------------------- */

.foot {
  margin-top: clamp(3.5rem, 7vw, 5.5rem);
  padding-top: 1.35rem;
  border-top: 1px solid var(--rule-faint);
  font-size: var(--t-small);
  line-height: 1.75;
  color: var(--ink-dim);
  max-width: 74ch;
}

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
  .tabs a,
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
    --mark:         #a83208;
    --mark-wash:    transparent;
    --mark-glow:    transparent;
  }

  body { padding: 0; background: none; color: #000000; }

  /* Navigation and a text box are the two things paper cannot do anything
     with. What survives is the evidence, which is the reason to print a page
     here at all. */
  .skip, .bar, .ask, .foot { display: none; }
  .panel { break-inside: avoid; }
  .figure, .strip, .tally, .ask { box-shadow: none; }
  .orb-ring.live { filter: none; }
}
`;
