# Demo video script

Shot by shot, cut to 2:49. The rules say three minutes or less and that
"anything past the 3-minute mark may not be reviewed", so this is built to land
eleven seconds short rather than trimmed back to the line afterwards.

Everything below was checked against the running product on 2026-08-15, not
recalled. Section heights, the wording on each panel and the example links are
what the server returns today.

## What the rules require, and where it happens

The video must cover four things. Each one has a shot.

| Required | Shot |
|---|---|
| The problem | 1 |
| What was built | 2 |
| A working demo | 3, 5, 6 |
| How the HydraDB repo is used and why it matters | 4 |

[PLAN.md](../PLAN.md) also names the two claims the video exists to make: a
superseded fact handled correctly, and a structured abstention. Those are shots
3 and 5. If anything gets cut, it is not those.

## Before recording: the state every take starts from

```bash
scripts/hydra-node.sh start
npm run ingest
npm run census
npm run serve
```

`npm run census` must end with `graph matches the plan exactly`. If it does not,
stop and fix that first, because every value spoken in the narration comes from
that graph.

The corpus is generated from the seed `lacuna-demo-v1`, so entity names, values
and dates are identical on every rebuild. Two things are not stable and must
never be spoken aloud:

- **Millisecond figures and the read epoch.** They are measurements of the run
  you are recording. The narration never quotes one, deliberately.
- **Claim IDs.** Long integers on screen. Nobody reads them out, and they are
  not part of any line below.

Verify the graph is the right one by looking at values, not numbers: Bellwether
should read Stonecrop, then Millbrace, then Halverd.

## Capture setup

- Browser window **1920x1080**, page zoom **125%**.
- Measured: the content column is 1448px wide at 100% zoom, which is 75% of the
  frame. At 125% it renders at 92% of the frame, and the layout does not change
  shape between the two: no breakpoint sits between those widths, so the only
  difference is a few pixels of fluid margin. 125% is the setting.
- Hide the bookmarks bar and any extension icons.
- The URL bar stays in frame on purpose. It reads `127.0.0.1:3014`, which is the
  point: this is running, not hosted somewhere you cannot check.
- Cursor visible. The clicks are part of the evidence.
- No music. Nothing in this repository is licensed for a soundtrack and a silent
  technical demo loses nothing.

### Never in frame

- Any terminal showing `.env.local`, `HYDRA_TOKEN`, or the value of any variable.
- Any file manager or editor tab exposing paths under your home directory.
- The node's admin port or any curl command carrying a bearer token.

The product itself cannot leak the token: the proof panel takes a `NodeIdentity`
built by `describeNode` in `src/view/proof.ts`, which keeps the namespace, graph
and cell and drops the base URL and the token. The risk is what is behind the
browser, not what is in it.

## Pacing

The narration below totals **158 seconds** read at 150 words per minute. The
shot durations total 169 seconds. The 11 second difference is the gaps between
shots.

If your natural pace is slower than 150 wpm, do not speed up. Cut shot 6, which
takes it to 2:32. If it is still long, cut shot 7 as well, for 2:15. Both cuts
are clean: shot 6 makes a point shot 4 already made structurally, and shot 7 is
honesty about the benchmark that the repository states in writing anyway.

## The shots

### Shot 1. The problem
**0:00 to 0:17.** Home page, top. Static, no scrolling. The hero reads
"Memory that knows what changed, what remains true, and what was never known."
The benchmark strip sits directly under it; it stays in frame and is not
narrated here, because shot 7 owns the honest version of that claim.

> A long chat history holds three kinds of fact. Ones that still hold. Ones that
> were replaced. And ones that were never in there at all. A long-context model
> blurs all three, and when the answer is missing it invents one.

### Shot 2. What was built
**0:17 to 0:31.** Scroll down to `03 Corpus`, hold two seconds on the counts
(72 sessions, 5,246 messages, 174 claims, 86 entities, 117,041 estimated
tokens), then scroll back up to `01 Ask`. The typed form sits just below the
example questions in that panel.

> Lacuna is a memory layer that keeps them apart. Seventy-two sessions and a
> hundred and eighteen claims, in a HydraDB graph. Ask it for a property of
> something the sessions discussed.

### Shot 3. A fact that was revised twice
**0:31 to 1:03.** Type into the form rather than clicking the example. Subject
`Bellwether`, predicate `beta_partner`, leave Via empty, press Ask. Typing it
live is what shows this is a product and not eight canned links.

The answer panel reads **Halverd**, and under it, "This replaced 2 earlier values
and nothing has superseded it."

Hold three seconds, then scroll to `02 Timeline`.

> Who is the beta partner for Bellwether? Halverd. And underneath it, the part a
> ranked passage list cannot give you: this replaced two earlier values, and
> nothing has superseded it. The timeline is the whole thread. Stonecrop, then
> Millbrace, then Halverd. The replaced claims are still in the graph and still
> queryable. Nothing was overwritten. That is a SUPERSEDES edge, not a version
> column, and the current value is the claim with nothing pointing at it.

### Shot 4. How HydraDB is used
**1:03 to 1:33.** Same page. Scroll past `03 Subgraph` without stopping, down to
`04 Proof`. This panel is 1276px tall so it needs about one and a half screens.
Scroll slowly and evenly through all four reads. Do not stop on any single one.

> This is the HydraDB panel, and it is on every answer. Four reads produced that
> page. Find the entity. Read its claims, with an optional match for whatever
> supersedes them. One hop over MENTIONS. Then a four-hop path back to the
> sentence that said it. The Cypher is printed whole, with its parameters, its
> row count and the read epoch the node reported. No similarity score anywhere
> on the page.

The panel also prints the HydraDB version and pinned commit it was written
against. Let it pass in frame; it does not need narrating.

### Shot 5. Abstention that carries a reason
**1:33 to 2:03.** Back to the home page, then click the example labelled
**never stated**, "When is the migration window for Meridian?"

The answer panel reads **Never stated.**, tagged `never_stated`, with
"No answer given, because nothing in the sessions ever stated this."

Hold three seconds. Scroll to `02 Timeline`, which reads NOTHING WAS EVER STATED
HERE. Then to `03 Subgraph`, which reads NO PATH TO ANY STATEMENT.

> Now one the sessions never answered. Never stated. Not a guess and not a
> nearest neighbour, but a reason code, and there are five of them. Never
> stated. Retracted. Contradicted. Unconnected. Out of scope. Those are
> different situations and a threshold cannot tell them apart. The timeline says
> nothing was ever stated here. The subgraph says no path to any statement.
> Meridian is in the graph; nothing connects it to this question.

### Shot 6. A fact no single session states
**2:03 to 2:20.** Home, then the example labelled **multi hop**, "Who is our
contact for the vendor behind replay-queue?"

Stay on the answer panel. It reads **Farah Haddad**, and the "How it got there"
trace reads "Followed "vendor" from "replay-queue" to "Northfold"". Two
quotations are shown, from two different sessions two days apart.

> One more. No session says who the contact for replay-queue is. Two say it
> between them. Lacuna follows vendor from replay-queue to Northfold, reads
> Northfold's contact, and quotes both sentences from the two sessions they came
> from.

This page's proof panel shows eight reads rather than four, because it resolved
two entities and fetched two quotations. Do not scroll to it. The four-read
claim in shot 4 is about the single-entity path, and putting an eight-read panel
on screen while that sentence is still in the viewer's memory invites a
contradiction that is not there.

### Shot 7. What the benchmark actually says
**2:20 to 2:37.** Cut to `docs/BENCHMARKS.md`. Show the opening line, which
reads "The headline is a tie."

> The benchmark headline is a tie. Two hand-built hybrid baselines also score
> sixty-four out of sixty-four, across fifty-one configurations. What separates them is
> fifteen context tokens against six hundred and thirty-six. That is in the
> repository, in those words.

Leading with the tie is the point. A judge who finds it themselves after hearing
a stronger claim has found a different video.

### Shot 8. Close
**2:37 to 2:49.** Back to the home page, top.

> Memory that knows what changed, what remains true, and what was never known.
> Clone it, start a node, and every number you just saw is one command away.

## Before uploading

- Watch it once at full length with a stopwatch. Under 3:00 or it gets recut.
- Watch it once with the sound off, looking only for a token, a home directory
  path or a private tab title that got into frame.
- Upload unlisted, not private. The rules require judges to view it without
  requesting access, so unlisted YouTube is fine and Drive-with-permissions is
  not.
- Open the link in a logged-out browser before submitting it. A link that only
  works while signed in as you is the single most common way this goes wrong.
