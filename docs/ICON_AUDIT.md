# Icon audit

What is actually in the icon set, read out of the source rather than off the
render. Nothing here was changed. This is a description of what a reviewer
opening the repository today would find.

The files read in full: [web/src/design/icons.ts](../web/src/design/icons.ts),
[web/src/design/connectors.ts](../web/src/design/connectors.ts),
[web/src/design/mark.tsx](../web/src/design/mark.tsx) and
[src/cli/mark.ts](../src/cli/mark.ts). Then the whole of `web/src` was searched
for other inline SVG, for emoji used as interface elements, and for any
reference to an image or font file, and `web/public` was listed for what is
actually shipped.

Every number below was extracted from the source text, not measured off a
screenshot. The contact sheet at
[artifacts/icons/contact-sheet.html](../artifacts/icons/contact-sheet.html)
is generated from the same parse and renders all sixteen entries at 24px on
black, so the family can be looked at rather than described.

## The set

Sixteen entries in `ICONS`, all built through the same `w()` helper, so all
sixteen share the viewBox `0 0 24 24` and all sixteen are inline
`data:image/svg+xml` URIs applied as a CSS `background-image` by `icStyle()`.
Nothing is a file and nothing is fetched, which is why `img-src 'self' data:`
covers the whole set without being loosened.

Five are generic controls drawn for this project. Eleven occupy a slot that
stands for somebody else's product.

| Entry | What it is | Kind |
|---|---|---|
| `files` | a document outline | generic control |
| `api` | a node with four spokes | generic control |
| `chip` | a processor with legs | generic control |
| `cloud` | a cloud outline | generic control |
| `orb` | a ringed circle with an arc under it | generic control |
| `github` | the Octocat silhouette | third-party mark |
| `slack` | the four-colour octothorpe | third-party mark |
| `gitlab` | the tanuki | third-party mark |
| `linear` | the four-segment corner form | third-party mark |
| `notion` | a rounded square holding an N | third-party mark |
| `gmail` | a grey envelope with a red chevron | third-party mark |
| `jira` | two blue chevrons | third-party mark |
| `confluence` | two blue swooshes | third-party mark |
| `claude` | an eight-ray burst | third-party mark |
| `codex` | a hexagon inside a hexagon | third-party mark |
| `hydra` | a three-spoke graph node | third-party mark |

`icFor()` maps a free-text name onto one of these by substring, and falls back
to `files` when nothing matches. So an unrecognised connector gets a document
icon rather than a blank, which is the right default but does mean a
misspelled provider name silently renders as a file.

## Is the generic set one family

No. Three of the four axes disagree.

**Stroke width.** `files`, `api` and `chip` are drawn at 1.5. `cloud` and `orb`
are drawn at 1.6. There is no size or weight reason for the split, and at 24px
in a 12px to 15px render the two weights are close enough that the
inconsistency reads as sloppiness rather than as intent.

**Stroke colour.** `files`, `api` and `cloud` are `#9A9A9A`. `chip` is
`#BDBDBD`. `orb` is `#FFB829`. Three inks across five icons.

**Cap style.** Every one of the sixteen uses the SVG default, which is butt,
with a single exception noted below. Within the generic five this axis is
consistent.

**Corner radius.** Only two entries contain a rectangle. `chip` uses `rx="1.5"`
and `notion` uses `rx="2.5"`. They are the only two radii in the set and they
disagree with each other.

Named plainly, the entries inconsistent with the rest:

- **`orb` is the odd one out.** It is the only generic control drawn in an
  accent colour rather than a neutral, it is one of only two entries carrying a
  translucent secondary stroke, and it carries two stroke weights at once
  (1.6 for the ring, 1.2 for the arc at 50% opacity). Set beside `files` and
  `api` on the contact sheet it does not look like a sibling.
- **`chip` is the second.** It is the only generic control at `#BDBDBD` rather
  than `#9A9A9A`, and the only one that fills with the violet accent `#8052FF`.
- **`cloud` carries the 1.6 weight** that puts it on the wrong side of the
  stroke-width split from `files`, `api` and `chip`.
- **`claude` is the only entry in the whole set that declares
  `stroke-linecap="round"`.** Fifteen of sixteen inherit butt caps. This one
  matches the mark's cap treatment instead of the icon set's.

There is also a **second icon system** that the set does not know about. The
five claim-state glyphs in
[web/src/app/routes/context.tsx](../web/src/app/routes/context.tsx) are inline
`<svg>` elements on a `0 0 10 10` viewBox with a 1.2 stroke, delivered as real
SVG elements rather than as background images. They share no viewBox, no stroke
weight and no delivery mechanism with the sixteen. They are internally
consistent and they are good work, but they are a separate system living in the
same product.

## Third-party marks, one by one

This is the part that matters beyond taste, so it is stated flatly.

**None of the eleven is the vendor's official asset.** Every one of them was
drawn as inline SVG inside the design file. `icons.ts` says so in its own header
comment, and the claim checks out: the `ICOS()` block in
`design/reference/Lacuna Product.dc.html` contains the same paths, character for
character, and `icons.ts` is a port of it. No vendor brand kit, no downloaded
SVG, and no vendor licence file exists anywhere in the repository for any of
these eleven.

What separates them is how close the drawing gets.

| Entry | Verdict | What it actually is |
|---|---|---|
| `github` | close redrawing | A detailed Octocat silhouette, ~40 curve segments, rendered `#FFFFFF`. The vendor's mark is monochrome and white-on-dark is a normal use of it. This is the closest of the eleven. |
| `slack` | close redrawing | Four shapes in `#E01E5A`, `#36C5F0`, `#2EB67D`, `#ECB22E`, which are the vendor's four brand colours, in the vendor's octothorpe construction. |
| `gitlab` | close redrawing | The tanuki construction in `#E24329`, `#FC6D26`, `#FCA326`, the vendor's three brand colours. |
| `linear` | close redrawing | The corner-arc construction in `#5E6AD2`, the vendor's brand colour. |
| `notion` | **approximation** | A plain grey rounded rectangle containing a straight-sided letter N. The vendor's mark is a specific letterform. The ink `#BDBDBD` is Lacuna's own neutral, not a vendor colour. |
| `gmail` | **approximation** | A grey envelope outline with one red chevron. The vendor's mark is a four-colour form. This one borrows a single Google red `#EA4335` and draws the rest in Lacuna grey. It is recognisable as meaning Gmail while not being the Gmail mark, which is the least comfortable position of the eleven. |
| `jira` | **approximation** | Two flat chevrons in Atlassian blue `#2684FF`, one at 55% opacity. The vendor's mark is a different form and carries a gradient. |
| `confluence` | **approximation** | Two flat swooshes in the same `#2684FF` at the same 55% opacity. Structurally in the right family, simplified well past the vendor's mark. |
| `claude` | **approximation** | A symmetric eight-ray burst in `#D97757`, which is the provider's brand colour. The provider's actual mark is an asymmetric radial form, so the colour is right and the geometry is a simplification. |
| `codex` | **approximation** | A hexagon with a rotated hexagon inside it, in white. This does not resemble the vendor's mark and would not be identified as that vendor without the label next to it. |
| `hydra` | **approximation, and the colour is wrong too** | A three-spoke graph node in `#15846E`. HydraDB's actual logo is in this repository at `design/incoming2/uploads/.../assets/hydradb-logo.svg`: an `#ff5719` rounded square with white blocks. The shipped `hydra` icon shares neither the form nor the colour. It is a Lacuna-drawn glyph standing in for a vendor mark. |

Two consequences worth separating.

The four close redrawings are the ones with legal exposure, because they
reproduce a vendor's mark and its trade dress without a licence to do so. Most
vendors permit factual, unmodified use of their mark to indicate an
integration, and most require the official asset rather than a redrawing. A
redrawing is the case their guidelines usually name explicitly as not allowed.

The seven approximations have the opposite problem. They are unlikely to draw a
trademark complaint because they do not reproduce the mark closely enough to be
confused with it. What they do instead is look unfinished, and in three cases
(`codex`, `jira`, `confluence`) they carry so little of the vendor's identity
that they are doing no recognition work at all.

`hydra` is a third case. HydraDB is the database this product is built on and
the one integration that genuinely runs, and it is the one vendor whose real
logo is sitting in the repository unused.

## Emoji

**No emoji is used as a production icon anywhere in `web/src`.** This was
checked by scanning for the pictographic ranges and for the emoji presentation
selector `U+FE0F`. No pictographic emoji is present and no `U+FE0F` appears in
any file.

What the scan does find is a set of geometric and box-drawing characters used
as typography inside monospace text, which is a different thing and is correct
for a product whose visual language is a terminal:

- `●` U+25CF and `○` U+25CB as list and status bullets in
  `onboarding/Onboarding.tsx`, `landing/Cli.tsx`, `app/routes/developers.tsx`
- `❯` U+276F and `█` U+2588 as a shell prompt and a cursor in
  `app/routes/developers.tsx`
- `←` U+2190 as a back affordance in `pages/Judge.tsx`
- box-drawing characters inside the recorded CLI session in
  `landing/cli-session.ts`

None of these has emoji presentation, none renders in colour, and all of them
sit inside a monospace run where they are the right character. This is not the
defect the question was looking for.

## The old orange mark, and snails

**No snail imagery exists anywhere in the repository.** The word appears
sixteen times and every occurrence is a prohibition in the inherited design
specification, in the form of rules like "no shells, no snails, no illustration
of a mollusc, ever" and "no giant ASCII snail". They are instructions not to
draw one, and nobody drew one.

**The old orange mark does survive, but not in anything that ships.** The
accent `#ff5719` is present in eleven files, all of them under `design/`, which
is the inherited design drop rather than product source. Of those, only three
are tracked in git:

- `design/reference/assets/lacuna-mark.svg`, white spiral with an `#ff5719`
  head
- `design/reference/assets/favicon.svg`, the same in orange, and drawn with
  only two of the three arcs
- and `design/reference/assets/lacuna-mark-white.svg`, which is the all-white
  variant and carries no orange

The remaining eight are under `design/incoming2/`, which `.gitignore` excludes,
so they exist on this disk and not in the repository.

None of these reaches a browser. Vercel builds with `outputDirectory:
web/dist`, and `web/dist` contains only `assets/`, `boot.css`, `favicon.svg`,
`fonts/` and `index.html`. The shipped
[web/public/favicon.svg](../web/public/favicon.svg) is the current mark: three
arcs, `#FFB829` head, and a path identical to the one in `mark.tsx` plus a
black backing rectangle. The web mark and the favicon agree with each other.

So the honest statement is that the orange mark is dead in the product and
alive in a tracked reference directory, where a reviewer browsing the
repository can still find it and where it will keep looking like an
unresolved second brand until somebody deletes it or labels it as superseded.

## The terminal mark against the web mark

**They are geometrically the same drawing, and this was checked rather than
taken on trust.**

`mark.tsx` holds the spiral as one SVG path:

```
M12 2.6 A8.4 8.4 0 0 1 12 19.4 A6 6 0 0 1 12 7.4 A3.7 3.7 0 0 1 12 14.8
```

`src/cli/mark.ts` holds the same shape as three arcs expressed as centre,
radius and swept angle, then samples them onto a character grid. Its header
comment claims the arcs were read off that path directly. Working the arithmetic
back confirms it, arc by arc:

| Arc | SVG endpoints | Chord | Radius | Implied centre | `ARCS` entry |
|---|---|---|---|---|---|
| 1 | (12, 2.6) to (12, 19.4) | 16.8 | 8.4 | (12, 11) | `{cx:12, cy:11, r:8.4, from:-90, to:90}` |
| 2 | (12, 19.4) to (12, 7.4) | 12.0 | 6.0 | (12, 13.4) | `{cx:12, cy:13.4, r:6, from:90, to:270}` |
| 3 | (12, 7.4) to (12, 14.8) | 7.4 | 3.7 | (12, 11.1) | `{cx:12, cy:11.1, r:3.7, from:-90, to:90}` |

In every case the chord equals twice the radius, which means each arc is an
exact semicircle and its centre is the midpoint of its endpoints. Those
midpoints are the three centres in `ARCS`, to the decimal. The sweep directions
match too: right, then left, then right, which is what alternating between
`-90..90` and `90..270` produces once you account for SVG's y axis pointing
down. `HEAD_POINT` is `(12, 2.6)`, which is the amber circle's centre in
`mark.tsx`.

The one deliberate difference is that the terminal version drops the SVG's
`translate(-1.2 1.475)`. The file explains why, and the explanation holds: a
constant offset applied to every point vanishes when the points are normalised
against their own bounding box, which is exactly what `rasterise()` does. The
head point is the first sample of arc 1, so it is inside that bounding box and
is normalised along with everything else.

The second difference is honest and is documented in the file. At five rows the
compact mark draws two of the three turns rather than three, because three
turns sampled onto five rows put the inner turn on the middle row and fill the
centre in. The centre staying open is the mark, so the small size drops detail
instead of printing a filled blob. That is the same decision a favicon makes,
and it is the right one.

## Colour as the only carrier of meaning

Mostly no, with one place where it is and one place where it nearly is.

**The five claim states are shape-first and correct.** `StateMark()` in
`context.tsx` draws a filled circle for CURRENT, an outline circle for
HISTORICAL, a dashed outline circle for PROPOSAL, a downward fork for
CONTRADICTED and an open arc for UNSUPPORTED. Five distinct silhouettes. The
source comment states the rule as "Shape carries the state, never colour
alone", and the code keeps it. A STATE column carrying the word is rendered
alongside.

**The connector and model state dots are colour-only in themselves, and are
rescued by their labels.** `DOT` in `connectors.ts` maps four state words onto
four colours, and every render is the same 5px or 6px filled circle with only
the background changing. Shape does no work at all. Every call site checked
pairs the dot with the state word as text:

- `landing/Conn.tsx` line 20 and 21, dot then `{c.st}`
- `app/routes/Dashboard.tsx` line 92, dot then `{c.st}`
- `app/routes/models.tsx` line 64, dot then `{m.state}`
- `app/routes/work.tsx` line 132, dot then `{t.conn}`
- `app/routes/developers.tsx` line 157, dot then the state
- `canvas/VoiceOrb.tsx` line 252 and `app/routes/Ask.tsx` line 141, dot then a
  status phrase

So no user has to read a colour to learn a state. The dot is decoration on top
of a label, which is the acceptable arrangement. It is worth writing down that
the labels are load-bearing, because removing one to tidy up a layout would
turn a passing pattern into a failing one, and nothing in the code says so.

**The onboarding stepper is the one place the colour genuinely carries
alone.** `onboarding/Onboarding.tsx` lines 67, 72 and 77 draw the current step
as a filled `#8052FF` dot, a completed step as a filled `#15846E` dot, and a
future step as an unfilled ring. Completed against future is a real shape
difference. Current against completed is not: both are 5px filled circles and
the only difference is hue. Those two hues have almost identical luminance:

| Colour | Relative luminance |
|---|---|
| `#8052FF` current | 0.1784 |
| `#15846E` completed | 0.1779 |

That is a contrast ratio of **1.002:1** between them. Desaturate the interface,
print it, or view it with a red-green deficiency, and the current step and the
completed steps become the same dot. The row is still readable because the
current step's label is `#FFFFFF` while the others are `#71717A`, and that is a
luminance difference that survives desaturation. So the screen is usable, but
the dot is doing nothing and the label is doing all the work, which is the
reverse of what the dot is there for.

For completeness, the four connector state colours separate on luminance as
follows, which is why they read as distinct even before their labels are
considered: AVAILABLE `#9A9A9A` against PLANNED `#5E5E5E` is 2.304:1, CONNECTED
`#15846E` against PLANNED is 1.407:1, and SYNCING `#FFB829` against AVAILABLE
is 1.627:1. None of these is a strong separation and none of them needs to be,
given the labels.

## What could not be verified

Stated so that nothing above is read as more certain than it is.

- **Vendor brand guidelines were not fetched in this session.** The judgements
  about which hex values are a vendor's official brand colour, and about what
  each vendor's mark actually looks like, rest on knowledge rather than on a
  document retrieved and cited today. The claim that no entry is an official
  vendor asset does not depend on this: it rests on the marks being inline SVG
  authored in the design file, which is checkable in the repository.
- **No legal opinion is offered or implied.** The trademark exposure described
  above is the ordinary reading of how vendor mark policies are usually
  written. It is not advice and it has not been checked against any specific
  vendor's current terms.
- **The rendered result was not compared against the vendors' marks
  side by side.** The comparisons are between the source geometry and a
  description of each vendor's mark, not between two images.
- **`design/incoming2/` was read but is not tracked**, so statements about what
  is in it describe this working copy rather than the repository.

## Defects, in priority order

Ranked by what an unsympathetic reviewer would object to first. Nothing in this
list was fixed, and the deadline column is a recommendation, not an action.

**1. Four vendor marks are redrawn rather than licensed. Leave it.**
`github`, `slack`, `gitlab` and `linear` reproduce vendor marks and brand
colours closely enough to be the marks. This is the only item on the list with
a consequence outside the repository. It is also the one that cannot be
responsibly fixed in a few hours: doing it properly means reading four sets of
brand guidelines and sourcing four official assets, and doing it carelessly
means replacing a redrawn mark with a differently redrawn mark. The mitigating
fact is that these appear in a connector catalogue where every entry reads
PLANNED, so the product is not claiming a partnership with any of them. Fix it
after the deadline, deliberately.

**2. `hydra` is not HydraDB's logo, and HydraDB's logo is in the repo.
Borderline, probably leave it.** This is the one integration that genuinely
works, it is named throughout the submission, and the icon standing for it is
an invented teal glyph while the real orange logo sits unused in `design/`.
Of everything here this is the most visible to a judge who knows the platform.
It is also a one-line change, which is exactly why it is tempting and exactly
why it is risky on submission day: the real logo is `#ff5719`, which is the
retired accent colour this design deliberately moved away from, so dropping it
in unchanged would reintroduce a third accent into a two-accent system. Leave
it unless there is time to think about it properly.

**3. The generic five are not one family. Leave it.**
Stroke weight splits 1.5 against 1.6, ink splits three ways, and `orb` is
visibly the odd one out. This is real and a designer will see it. It is also
cosmetic, it is confined to five icons rendered at 12px to 15px, and changing
stroke weights on submission day means re-checking every surface that uses
them. The contact sheet documents it, which is the cheap and honest move.

**4. `codex`, `jira` and `confluence` do no recognition work. Leave it.**
A hexagon, two chevrons and two swooshes. Nobody identifies these without the
text label beside them. Since the text label is always beside them, the cost is
that the interface looks slightly unfinished rather than that anything is
unusable.

**5. The onboarding stepper's current and completed dots are 1.002:1 apart.
Worth fixing if anything is.** This is the only accessibility finding in the
audit, it is confined to one file and three lines, and the fix is to change one
shape rather than one colour, for example by making the completed step a tick
or a smaller dot. It is the smallest diff on this list with the clearest
justification. It is still not required before a deadline, because the step
labels already carry the distinction on luminance.

**6. The old orange mark is tracked in `design/reference/assets/`. Leave it.**
Two files carrying `#ff5719` are committed. They ship nowhere, and `design/` is
plainly a reference directory. The only cost is that somebody browsing the
repository finds two versions of the mark and has to work out which one is
current. A one-line note in that directory would settle it, after the deadline.

**7. There are two icon systems and neither references the other. Leave it.**
The 24px background-image set and the 10px inline-SVG state glyphs are both
internally coherent and they never appear in the same component, so no screen
looks wrong. This is a maintenance observation, not a visible defect.

**8. `icFor()` falls back to a document icon on any unmatched name. Leave it,
but know about it.** A provider whose name is misspelled or newly added renders
as `files` with no warning. That is the correct fallback behaviour and the
right default. It is listed only so that a future wrong icon is diagnosed as a
missing branch in `icFor()` rather than as a broken asset.

Nothing in this list is a blocker. The one item with consequences beyond taste
is the first, and the reason to leave it is that a rushed fix to a trademark
problem is worse than a documented one.
