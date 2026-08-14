# Screens

Thirteen captures of the running product. Not mockups, not renders, not a design
file: a browser was pointed at `http://127.0.0.1:3014`, that process read a live
HydraDB node over HTTP, and this is the pixels that came back.

Captured 2026-08-14 by `npm run screens`, which drives headless Chrome over the
DevTools Protocol, writes each PNG, then reads it back off disk and checks it.
The server was `npm run serve` on loopback `:3014`, reading HydraDB `v0.1.1`
(commit `02a40025d2d57e97ab2754c8256219cdbfeab379`) on loopback `:18443`,
namespace `local`, graph `default`, cell `cell-0`. That is the same node the
probes in [../cypher-probe](../cypher-probe) were run against, started by
[`scripts/hydra-node.sh`](../../scripts/hydra-node.sh).

## What each file is

The last column is what the browser was told the reader prefers, not what the
page did about it. The page has one ground and ignores the preference, which is
the point of the fourth row.

| File | URL | Viewport | Extent | Preference |
|---|---|---|---|---|
| `home-1920x1080.png` | `/` | 1920x1080 | viewport | dark |
| `home-3840x2160.png` | `/` | 3840x2160 | viewport | dark |
| `home-375x812.png` | `/` | 375x812 | viewport | dark |
| `home-light-preference-1920x1080.png` | `/` | 1920x1080 | viewport | light |
| `bench-1920x1080.png` | `/bench` | 1920x1080 | viewport | dark |
| `bench-fullpage.png` | `/bench` | 1920x1080 | full page | dark |
| `hydradb-fullpage.png` | `/hydradb` | 1920x1080 | full page | dark |
| `interface-fullpage.png` | `/interface` | 1920x1080 | full page | dark |
| `voice-fullpage.png` | `/voice` | 1920x1080 | full page | dark |
| `answer-revised-1920x1080.png` | `/ask?subject=Bellwether&predicate=beta_partner` | 1920x1080 | viewport | dark |
| `answer-revised-fullpage.png` | `/ask?subject=Bellwether&predicate=beta_partner` | 1920x1080 | full page | dark |
| `answer-multihop-fullpage.png` | `/ask?subject=replay-queue&predicate=contact&via=vendor` | 1920x1080 | full page | dark |
| `answer-never-stated-1920x1080.png` | `/ask?subject=Meridian&predicate=migration_window` | 1920x1080 | viewport | dark |

The full-page captures are the ones that show a whole page rather than the part
of it that fits: four panels on an answer, the sweep table on the benchmark, the
statement list on the database page, the fourteen states on the voice page. The
viewport captures are what a visitor sees before scrolling, which is the other
thing worth having a record of.

Three of them exist to answer one question each.

`home-3840x2160.png` answers the 4K question: the measure holds. The document
does not stretch to fill the panel, it stays at its max width and centres, and
the panel rail stays where it is. That is a decision about line length rather
than a layout that ran out of ideas, and it is easier to show than to argue.

`home-375x812.png` answers the narrow question: the page bar wraps to two lines,
the four figures stack into one column, the panel rail moves above its heading
instead of beside it, and nothing scrolls sideways.

`home-light-preference-1920x1080.png` answers whether the ground is a choice or a
default. Chrome was told the reader prefers light and the page came back
identical: 315100 bytes, the same byte count as `home-1920x1080.png`, which was
captured at the same size preferring dark. The stylesheet contains no
`prefers-color-scheme` block at all, so there is nothing for the preference to
switch. One ground, stated once in the sheet and once in a `color-scheme` meta
element so the browser paints the scrollbars to match.

## The numbers differ between images, and that is the point

Each page prints the reads it just made. `answer-revised-fullpage.png` says
"4 reads, 10 rows, 244.6 ms inside the client and 194.7 ms end to end".
`answer-multihop-fullpage.png` says "8 reads, 11 rows, 971.8 ms inside the client
and 737 ms end to end". Neither figure is a benchmark and neither is carried
anywhere else. They are what those round trips cost on this machine at that
moment, which is why two captures of two different questions do not agree and
are not supposed to.

Both proof panels also print the read epoch every query reported, 5844 in both,
and say in the same breath that this is an observation rather than a guarantee
the store makes. An earlier set of these captures showed epoch 36889. The number
went down because the store underneath it is not the same store: the write path
wedged on a `PutMode::Update` the local object store has not implemented, the
directory was moved aside, and the corpus was ingested again into an empty one.
That is recorded as [D-058](../../DECISIONS.md). An epoch counts writes against
one store and means nothing across two.

## What the capture script checks

A screenshot is easy to take and easy to be wrong about. A file can be the right
size and be a blank rectangle, or be a viewport crop where a full page was
wanted. So `npm run screens` reads every PNG back after writing it and fails the
run if any of these does not hold:

- the eight byte PNG signature, 8 bit depth, and a colour type of RGB or RGBA
- width exactly as requested
- height exactly as requested, or at least the viewport height for a full page
- top left pixel averaging at or below 90, whichever ground the browser asked for
- at least 0.005 compressed bytes per pixel, which a flat fill cannot reach

The first pixel is readable without decoding the image, because every PNG row
filter subtracts a neighbour that does not exist at row 0 column 0, so the first
three bytes of the inflated stream are the literal top left colour. That is what
makes the ground assertion cheap enough to run on every capture.

The ceiling is one number rather than a floor and a ceiling because there is one
ground. A capture that came back light would fail whether it was asked for light
or dark, which is the assertion worth making now that the preference is ignored.

## What these captures caught

The first pass of this set was taken before
[D-047](../../DECISIONS.md), and the multi-hop proof panel in it read
"448.4000000000003 ms inside the client". Eight measurements, each already
rounded to a tenth of a millisecond, summed into a float that printed sixteen
significant figures on a page whose whole argument is that its numbers are
measurements. No test caught it, because no test added eight tenths together.

That is the reason this directory is worth having: rendering a page and looking
at it is a test, and it found something the suite did not. The set is now taken
by one command against one build, so a page that changes shape cannot leave a
stale image behind next to a current one.

## No secrets in any of these

None of these pages can print the bearer token, and it is not a matter of having
been careful with the crop. The proof panel takes a `NodeIdentity`, the only way
to construct one is `describeNode` in `src/view/proof.ts`, and that function
keeps the namespace, graph and cell and drops the base URL and the token.
`tests/unit/view-pages.test.ts` asserts the serialised value contains neither.

The URL bar is not in frame in any capture, so no local path or port appears
either, beyond the loopback address printed above deliberately.

## Reproducing these

```bash
scripts/hydra-node.sh start
npm run serve
npm run screens
```

`npm run screens` needs Chrome. It looks in the usual install locations and
takes `CHROME` from the environment if it is somewhere else. It runs its own
throwaway profile in a temp directory and removes it afterwards.

You can also open any URL in the table by hand. The layout will match; the
millisecond figures and the epoch will not, because they are yours and not
these.
