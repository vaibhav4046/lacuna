/**
 * The whole appearance of the product, as one response.
 *
 * It is a string constant rather than a file on disk so that serving it reads
 * nothing from the filesystem. A server that never opens a path cannot be
 * talked into opening the wrong one, and the four screens need no other assets.
 *
 * The direction is an archival document rather than a dashboard: warm paper,
 * one ink, one annotation red, a ruled margin, and a serif for prose against a
 * monospace for anything the machine produced. Evidence should read as a record
 * someone could have printed and marked up, because that is the claim the
 * product is making about itself. Both the light and the dark ground are
 * written deliberately; the dark one is a lamp on the same paper, not a
 * terminal.
 *
 * No web fonts. Nothing to license, nothing to fetch, no flash of unstyled
 * text, and a content security policy that never has to name a font host.
 * Colour is used to mean something: ink states what the graph holds, and the
 * red marks where it holds nothing.
 */
export const STYLESHEET = `
:root {
  color-scheme: light dark;

  --paper:        #f2efe7;
  --paper-raised: #f9f7f2;
  --paper-sunk:   #eae5d9;
  --ink:          #191713;
  --ink-soft:     #4d4740;
  --ink-faint:    #8b8478;
  --rule:         #cbc4b4;
  --rule-faint:   #e0dacd;
  --mark:         #9c3111;
  --mark-soft:    #bd6a4a;
  --mark-wash:    #f0e2da;

  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif;
  --mono: ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', monospace;

  --t-verdict: clamp(2rem, 1rem + 4vw, 3.75rem);
  --t-lede:    clamp(1.0625rem, 1rem + 0.5vw, 1.375rem);
  --t-body:    1rem;
  --t-small:   0.8125rem;
  --t-micro:   0.6875rem;

  --rail-w: 11rem;
  --main-w: 60rem;
  --gutter: clamp(1.25rem, 3.5vw, 3.5rem);
  --edge:   clamp(1.25rem, 4vw, 5rem);
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper:        #14120e;
    --paper-raised: #1c1a14;
    --paper-sunk:   #0e0d0a;
    --ink:          #ece7da;
    --ink-soft:     #b2a999;
    --ink-faint:    #7c7465;
    --rule:         #3b362c;
    --rule-faint:   #262319;
    --mark:         #e0724b;
    --mark-soft:    #a8543a;
    --mark-wash:    #2a1c14;
  }
}

*, *::before, *::after { box-sizing: border-box; }

/* The bar at the top is sticky, so a jump to an anchor has to clear it or the
   thing you jumped to arrives underneath it. */
html { -webkit-text-size-adjust: 100%; scroll-padding-top: 5rem; }

body {
  margin: 0;
  padding: 0 var(--edge) 6rem;
  background: var(--paper);
  background-image: radial-gradient(120% 70% at 50% 0%, var(--paper-raised) 0%, var(--paper) 55%);
  background-attachment: fixed;
  color: var(--ink);
  font-family: var(--serif);
  font-size: var(--t-body);
  line-height: 1.55;
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

  /* The margin rule. A background rather than an element, so nothing competes
     with the label for the margin column. */
  background-image: linear-gradient(var(--rule-faint), var(--rule-faint));
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
  color: var(--ink-faint);
  padding-top: 0.55rem;
  line-height: 1.7;
}

.rail b { display: block; font-weight: 400; color: var(--mark); }

.sep {
  grid-column: rail / end;
  width: 100%;
  height: 0;
  border: 0;
  border-top: 1px solid var(--rule-faint);
  margin: clamp(2.25rem, 5vw, 3.75rem) 0 0;
}

@media (max-width: 62rem) {
  :root { --rail-w: 0px; }
  .doc, .sheet, .panel { column-gap: 0; }
  .panel { background-image: none; }
  .rail { grid-column: main; justify-self: start; text-align: left; padding-top: 0; }
}

/* ---- the page bar ------------------------------------------------------- */

/*
 * Four pages is few enough that all four fit on one line, and a judge with
 * four minutes should never have to scroll to learn the other three exist.
 *
 * The bar is painted with the body's own ground, attached to the viewport, so
 * it draws exactly the pixels the page behind it would have drawn and there is
 * no seam of the kind a panel laid over a fixed gradient always shows. The rule
 * underneath is the only thing that says it is there.
 */
.bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 1.5rem;
  padding: 0.85rem 0 0.7rem;
  background: var(--paper);
  background-image: radial-gradient(120% 70% at 50% 0%, var(--paper-raised) 0%, var(--paper) 55%);
  background-attachment: fixed;
  border-bottom: 1px solid var(--rule);
}

.bar-mark {
  font-size: var(--t-small);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--ink);
  border-bottom-color: transparent;
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
  padding-bottom: 0.15rem;
}

.tabs a:hover, .ways a:hover { color: var(--mark); }

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
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 2px;
}

/* ---- masthead ----------------------------------------------------------- */

.masthead { padding: clamp(2.5rem, 7vw, 5.5rem) 0 0; }

.wordmark {
  margin: 0;
  font-size: clamp(2.25rem, 1rem + 5vw, 4.5rem);
  font-weight: 400;
  letter-spacing: 0.06em;
  line-height: 0.95;
}

.wordmark a { color: inherit; border-bottom-color: transparent; }
.wordmark a:hover { color: var(--mark); }

/*
 * On a result page the wordmark is a way back, not an announcement. It keeps
 * the letterspacing so the two pages read as one publication.
 */
.wordmark.compact { font-size: clamp(1.5rem, 1rem + 1.6vw, 2rem); }
.masthead:has(.compact) { padding-top: clamp(1.75rem, 4vw, 3rem); }
.masthead:has(.compact) .promise { max-width: 60ch; font-size: var(--t-body); }

.promise {
  margin: 1rem 0 0;
  font-size: var(--t-lede);
  color: var(--ink-soft);
  max-width: 34ch;
  text-wrap: balance;
}

.masthead-note {
  margin: 1.75rem 0 0;
  padding-top: 1.25rem;
  border-top: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-faint);
  max-width: 62ch;
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
 */
.strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11.5rem, 1fr));
  gap: 1px;
  margin: clamp(2rem, 5vw, 3.25rem) 0 0;
  border: 1px solid var(--rule-faint);
  background: var(--rule-faint);
}

.strip .cell {
  padding: 1.15rem 1.25rem 1.1rem;
  background: var(--paper-raised);
  border-bottom: 0;
  transition: background-color 120ms ease;
}

.strip .cell b {
  display: block;
  font-family: var(--mono);
  font-size: clamp(1.5rem, 1rem + 1.7vw, 2.125rem);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: var(--ink);
}

.strip .cell span {
  display: block;
  margin-top: 0.6rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.1em;
  line-height: 1.6;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* The one figure the whole argument turns on. */
.strip .cell.mark b { color: var(--mark); }

.strip .cell:hover { background: var(--paper); }
.strip .cell:hover span { color: var(--ink-soft); }

/* ---- section furniture -------------------------------------------------- */

.panel { padding: clamp(2.25rem, 5vw, 3.75rem) 0 clamp(1.5rem, 3vw, 2.5rem); }

.panel h2 {
  margin: 0 0 1.25rem;
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.01em;
}

.panel h3 {
  margin: 2rem 0 0.75rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  font-weight: 400;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.prose { max-width: 66ch; }

/* Figures break the measure and run the full width of the sheet. */
.figure {
  grid-column: rail / end;
  margin: 1.5rem 0 0;
  padding: 1.5rem clamp(1rem, 2vw, 2rem);
  background: var(--paper-raised);
  border: 1px solid var(--rule-faint);
  border-radius: 2px;
  box-shadow: 0 1px 0 var(--rule-faint), 0 12px 28px -24px rgb(0 0 0 / 0.5);
  overflow-x: auto;
}

.figure svg { display: block; width: 100%; height: auto; min-width: 34rem; }

.caption {
  margin: 1rem 0 0;
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-faint);
  max-width: 74ch;
}

/* ---- links, focus, buttons ---------------------------------------------- */

a {
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px solid var(--rule);
  transition: border-color 120ms ease, color 120ms ease;
}

a:hover { color: var(--mark); border-bottom-color: var(--mark); }
a:active { color: var(--mark-soft); }

:focus-visible {
  outline: 2px solid var(--mark);
  outline-offset: 3px;
  border-radius: 1px;
}

/* Selecting a quotation to paste it into a report is a thing this site expects
   people to do, so the selection is part of the palette rather than the
   browser's blue. */
::selection { background: var(--mark-wash); color: var(--mark); }

/* ---- the question form -------------------------------------------------- */

.ask {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.9rem 1.25rem;
  margin: 2rem 0 0;
  padding: 1.5rem;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 2px;
}

.field { display: flex; flex-direction: column; gap: 0.4rem; flex: 1 1 12rem; }

.field label {
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.field input {
  font-family: var(--mono);
  font-size: 0.9375rem;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 0.55rem 0.65rem;
  min-width: 0;
}

.field input:hover { border-color: var(--ink-faint); }
.field input:focus { outline: none; border-color: var(--mark); box-shadow: inset 0 0 0 1px var(--mark); }

.ask button {
  font-family: var(--mono);
  font-size: var(--t-small);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--paper);
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 2px;
  padding: 0.65rem 1.4rem;
  cursor: pointer;
  transition: background-color 120ms ease, transform 60ms ease;
}

.ask button:hover { background: var(--mark); border-color: var(--mark); }
.ask button:active { transform: translateY(1px); }

/* ---- example questions -------------------------------------------------- */

.examples { list-style: none; margin: 1.25rem 0 0; padding: 0; }

.examples li {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 0 1.25rem;
  align-items: baseline;
  padding: 0.7rem 0;
  border-top: 1px solid var(--rule-faint);
}

.examples li:last-child { border-bottom: 1px solid var(--rule-faint); }

.kind {
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.examples a { border-bottom-color: transparent; }
.examples li:hover .kind { color: var(--mark); }

@media (max-width: 40rem) {
  .examples li { grid-template-columns: minmax(0, 1fr); gap: 0.25rem; }
}

/* ---- the verdict -------------------------------------------------------- */

.asked {
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-faint);
  margin: 0 0 0.75rem;
}

.asked b { color: var(--ink-soft); font-weight: 400; }

.verdict {
  margin: 0;
  font-size: var(--t-verdict);
  line-height: 1.02;
  letter-spacing: -0.015em;
  text-wrap: balance;
}

.verdict.absent { color: var(--mark); }

.reason {
  display: inline-block;
  margin: 1rem 0 0;
  font-family: var(--mono);
  font-size: var(--t-small);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mark);
  background: var(--mark-wash);
  border: 1px solid var(--mark-soft);
  border-radius: 2px;
  padding: 0.25rem 0.6rem;
}

.explain { margin: 1.25rem 0 0; font-size: var(--t-lede); color: var(--ink-soft); max-width: 52ch; }

/* ---- trace -------------------------------------------------------------- */

.trace { list-style: none; margin: 0; padding: 0; counter-reset: step; }

.trace li {
  counter-increment: step;
  display: grid;
  grid-template-columns: 2.25rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.4rem 0;
  max-width: 68ch;
}

.trace li::before {
  content: counter(step, decimal-leading-zero);
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-faint);
  padding-top: 0.15rem;
}

/* ---- citations ---------------------------------------------------------- */

.citation {
  margin: 1.25rem 0 0;
  padding-left: 1.25rem;
  border-left: 2px solid var(--rule);
  max-width: 70ch;
}

.citation .source {
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-faint);
  margin: 0 0 0.35rem;
}

.citation .source em { font-style: normal; color: var(--ink-soft); }

.citation blockquote { margin: 0; font-size: 1.0625rem; }
.citation blockquote::before { content: '\\201C'; }
.citation blockquote::after { content: '\\201D'; }

.nothing {
  margin: 1.25rem 0 0;
  padding: 1rem 1.25rem;
  border-left: 2px solid var(--mark-soft);
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
  color: var(--ink-faint);
  padding: 0 0.9rem 0.5rem 0;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}

td { padding: 0.55rem 0.9rem 0.55rem 0; border-bottom: 1px solid var(--rule-faint); vertical-align: top; }

/* A row is a system in a fifty one row sweep, so following one across the page
   is the main thing anybody does with these tables. Written with the same
   specificity as the rule that marks our own row, and before it, so that the
   marked row keeps its wash rather than losing it under the cursor. */
tr:hover td { background: var(--paper-raised); }

td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.mono { font-family: var(--mono); color: var(--ink-soft); white-space: nowrap; }
td.value { font-size: 1rem; }

.state {
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.state.gone { color: var(--mark); }

/* ---- evidence pages ----------------------------------------------------- */

/* The product's own row, marked rather than moved, so it stays in rank order. */
tr.ours td { background: var(--mark-wash); }
tr.ours td.mono { color: var(--mark); }

/* Wide tables scroll inside the panel instead of widening the page. */
.scroll { overflow-x: auto; }
.scroll table { min-width: 36rem; }

code { font-family: var(--mono); font-size: 0.9em; color: var(--mark); overflow-wrap: anywhere; }

.tally {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 1px;
  margin: 0 0 1.75rem;
  border: 1px solid var(--rule-faint);
  background: var(--rule-faint);
}

.tally > div { padding: 1rem 1.1rem 0.9rem; background: var(--paper-raised); }

.tally b {
  display: block;
  font-family: var(--mono);
  font-size: var(--t-lede);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.tally .mark b { color: var(--mark); }

.tally span {
  display: block;
  margin-top: 0.45rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* ---- query proof -------------------------------------------------------- */

.query { padding: 1.1rem 0; border-bottom: 1px solid var(--rule-faint); }
.query:first-of-type { border-top: 1px solid var(--rule); }

.query-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.25rem;
  font-family: var(--mono);
  font-size: var(--t-micro);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-bottom: 0.6rem;
}

.query-head .n { color: var(--mark); }

.query pre {
  margin: 0;
  padding: 0.85rem 1rem;
  background: var(--paper-sunk);
  border: 1px solid var(--rule-faint);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: var(--t-small);
  line-height: 1.65;
  color: var(--ink-soft);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.params { margin: 0.55rem 0 0; font-family: var(--mono); font-size: var(--t-small); color: var(--ink-faint); }
.params b { color: var(--ink-soft); font-weight: 400; }

/* ---- drawings ----------------------------------------------------------- */

.thread { stroke: var(--ink); stroke-width: 1.5; fill: none; }
.thread-gap { stroke: var(--mark); stroke-width: 1.5; stroke-dasharray: 2 6; stroke-linecap: round; fill: none; }
.axis { stroke: var(--rule); stroke-width: 1; fill: none; }
.tick-live { fill: var(--ink); stroke: none; }
.tick-gone { fill: var(--paper-raised); stroke: var(--ink-faint); stroke-width: 1.5; }
.tick-stop { stroke: var(--mark); stroke-width: 2; fill: none; }

.svg-value { fill: var(--ink); font-family: var(--serif); font-size: 15px; }
.svg-value.gone { fill: var(--ink-faint); }
.svg-date { fill: var(--ink-faint); font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; }
.svg-note { fill: var(--mark); font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; }

.node { fill: var(--paper); stroke: var(--rule); stroke-width: 1; }
.node.subject { stroke: var(--ink); stroke-width: 1.5; }
.node.answering { stroke: var(--mark); stroke-width: 1.5; }
.edge { stroke: var(--rule); stroke-width: 1; fill: none; }
.edge.hop { stroke: var(--mark); stroke-width: 1.5; }
.edge-label { fill: var(--ink-faint); font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; }
.node-label { fill: var(--ink); font-family: var(--mono); font-size: 11px; }
.node-sub { fill: var(--ink-faint); font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.06em; }

/* ---- foot --------------------------------------------------------------- */

.foot {
  margin-top: clamp(3rem, 7vw, 5rem);
  padding-top: 1.25rem;
  border-top: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: var(--t-small);
  color: var(--ink-faint);
  max-width: 74ch;
}

/* Scoped to the prose, so the repeated bar below keeps the link treatment it
   shares with the bar at the top rather than picking up a faint underline on
   all four of its items. */
.foot p a { border-bottom-color: var(--rule-faint); }

/* The bar again at the end, so a reader who has read to the bottom of a page
   does not have to travel back up it to go anywhere else. */
.ways { margin: 0 0 1rem; }

/* ---- motion ------------------------------------------------------------- */

/*
 * There are four moving things on the whole site and all four are named here.
 * A blanket universal selector would be shorter and would lose: it has no
 * specificity at all, so it cannot beat the plain element rule that sets the
 * link transition in the first place. Naming each selector at the specificity
 * it was written with, and after it was written, is what makes the preference
 * actually hold.
 */
@media (prefers-reduced-motion: reduce) {
  a, .strip .cell, .ask button { transition: none; }
  .ask button:active { transform: none; }
}

/* ---- print -------------------------------------------------------------- */

@media print {
  :root { --paper: #fff; --paper-raised: #fff; --paper-sunk: #fff; --ink: #000; }
  body { padding: 0; background: none; }
  /* Navigation and a text box are the two things paper cannot do anything
     with. What survives is the evidence, which is the reason to print a page
     here at all. */
  .skip, .bar, .ask, .foot { display: none; }
  .panel { break-inside: avoid; }
  .figure { box-shadow: none; }
}
`;
