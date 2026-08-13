# Screens

Six captures of the running product. Not mockups, not renders, not a design
file: a browser was pointed at `http://127.0.0.1:3014`, that process read a live
HydraDB node over HTTP, and this is the pixels that came back.

Captured 2026-08-13 with Chromium under Playwright, `scale: "css"`, PNG. The
server was `npm run serve` on loopback `:3014`, reading HydraDB `v0.1.1` (commit
`02a40025d2d57e97ab2754c8256219cdbfeab379`) on loopback `:18443`, namespace
`local`, graph `default`, cell `cell-0`. That is the same node the probes in
[../cypher-probe](../cypher-probe) were run against, started by
[`scripts/hydra-node.sh`](../../scripts/hydra-node.sh).

## What each file is

| File | URL | Viewport | Extent |
|---|---|---|---|
| `home-1920x1080.png` | `/` | 1920x1080 | viewport |
| `home-3840x2160.png` | `/` | 3840x2160 | viewport |
| `answer-revised-1920x1080.png` | `/ask?subject=Bellwether&predicate=beta_partner` | 1920x1080 | viewport |
| `answer-revised-fullpage.png` | `/ask?subject=Bellwether&predicate=beta_partner` | 1920x1080 | full page |
| `answer-multihop-fullpage.png` | `/ask?subject=replay-queue&predicate=contact&via=vendor` | 1920x1080 | full page |
| `answer-never-stated-1920x1080.png` | `/ask?subject=Meridian&predicate=migration_window` | 1920x1080 | viewport |

The two full-page captures are the ones that show all four panels: the answer,
the timeline of every claim on that pair, the subgraph the verdict was read out
of, and the reads themselves. The viewport captures are what a visitor sees
before scrolling, which is the other thing worth having a record of.

`home-3840x2160.png` exists to answer one question and it answers it: the
measure holds. The document does not stretch to fill a 4K panel, it stays at its
max width and centres, and the panel rail stays where it is. That is a decision
about line length rather than a layout that ran out of ideas, and it is easier
to show than to argue.

## The numbers differ between images, and that is the point

Each page prints the reads it just made. `answer-revised-fullpage.png` says
"4 reads, 10 rows, 200.8 ms inside the client and 166.8 ms end to end".
`answer-multihop-fullpage.png` says "8 reads, 11 rows, 394.6 ms inside the
client and 298.4 ms end to end". Neither figure is a benchmark and neither is
carried anywhere else. They are what those round trips cost on this machine at
that moment, which is why two captures of two different questions do not agree
and are not supposed to.

Both proof panels also print the read epoch every query reported, 36520 in both,
and say in the same breath that this is an observation rather than a guarantee
the store makes.

## What these captures caught

The first pass of this set was taken before
[D-047](../../DECISIONS.md), and the multi-hop proof panel in it read
"448.4000000000003 ms inside the client". Eight measurements, each already
rounded to a tenth of a millisecond, summed into a float that printed sixteen
significant figures on a page whose whole argument is that its numbers are
measurements. No test caught it, because no test added eight tenths together.

Three images in this directory were recaptured afterwards so the whole set comes
from one build. That is also the reason this is worth doing at all: rendering a
page and looking at it is a test, and it found something the suite did not.

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
```

Then open any URL in the table. The layout will match; the millisecond figures
and the epoch will not, because they are yours and not these.
