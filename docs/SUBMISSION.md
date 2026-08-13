# Submission form draft

Every field the official form asks for, pre-written so submitting is
paste-and-check rather than composition under a deadline. The field list is
quoted from the rules as captured on 2026-08-12 in
[artifacts/rules/](../artifacts/rules/hackhydra-rules-2026-08-12.txt), lines 250
to 259. No character limits are stated, so these are written to be read rather
than to fit a counter.

**One field cannot be filled yet**, the video link. It is marked below, and it is
blocked on you rather than on the work. The other nine are ready to paste,
including the repository link, which went live on 2026-08-13.

Every number in this draft came out of a real run. Where a claim is softer than
it sounds, the draft says so, because the repository says so and a form that
oversells what the repository admits is the one thing that will not survive a
judge opening both.

---

## 1. Project name

```
Lacuna
```

## 2. Short project description

```
An agent memory layer that answers from a graph of claims instead of a pile of
transcript, and knows the difference between a fact that still holds, a fact
that was replaced, and a fact that was never stated at all. Built on HydraDB.
Track 03, Memory and Context Retrieval.
```

## 3. Problem being addressed

```
A long chat history contains three different kinds of fact, and a retriever that
ranks passages by similarity cannot tell them apart. Some facts still hold. Some
were corrected later and the old value is still sitting in the transcript,
indexed, and just as retrievable as the correction. Some were never stated at
all.

The third case is where the damage is. A similarity search always has a nearest
neighbour, so it always has something to return, and a long-context model asked
a question the history never answered will answer it anyway. Track 03 names this
directly: accuracy drops 30 to 60% on this workload and the failures concentrate
in abstention, which is knowing the answer is not there and saying so instead of
inventing one.

Superseded facts and missing facts are not retrieval-quality problems that a
better ranker fixes. They are structural properties of the history. If the
memory has no structure that records "this replaced that" and no structure that
distinguishes "never said" from "said and withdrawn", no amount of ranking
recovers the distinction.
```

## 4. What you built

```
Lacuna is a working product, not a benchmark script with a page on top. You run
it, ask it for a property of something the sessions discussed, and get one of
two things: a current value with the sentences that stated it, or a refusal that
carries a reason.

The demo corpus is 72 sessions, 5,268 messages, 118 claims and 66 entities,
roughly 117,395 tokens of transcript, generated from the seed lacuna-demo-v1 by
committed code. It is synthetic on purpose: no private conversation is in it,
and the whole corpus can be rebuilt and checked from one command.

Four things sit on every answer page:

Answer, which gives the value and states its standing. For the Bellwether beta
partner it says "This replaced 2 earlier values and nothing has superseded it",
and quotes the sentence that stated it.

Timeline, which shows every claim ever made on that subject and predicate,
superseded ones included. Corrections never delete anything, so the record of
what changed is queryable rather than lost.

Subgraph, which draws the exact nodes and edges the verdict was read out of and
nothing else.

Proof, which prints the Cypher that produced the page, whole, with parameters,
row counts, timings and the read epoch the node reported. Any line of it can be
pasted into your own node.

When the graph cannot answer, the refusal carries one of five machine-readable
reason codes: never_stated, retracted, contradicted, unconnected, out_of_scope.
These are five different situations. Something never mentioned is not the same
as something withdrawn and not replaced, which is not the same as something two
sessions disagree about. Each is decided by the shape of the graph, not by a
score falling under a threshold, and the panel shows which one applied and what
was searched.

There is deliberately no LLM anywhere in the demo path. The claims are about
retrieval and abstention, and a generated sentence on top would make every one
of them harder to check.

568 unit tests across 28 files run with no database. Three contract suites run
every query builder against a live HydraDB node and fail loudly if the node is
absent rather than quietly mocking it. 610 tests in total with a node running.
```

## 5. Deployed project link, if available

```
None. HydraDB runs locally in this submission, so the product runs locally with
it, and the repository is set up so that is a six-step quickstart rather than an
excuse. artifacts/repro/repro.sh clones the repository into a directory that has
never held the project, follows the README exactly, and its unedited transcript
is committed.
```

If you would rather submit a hosted URL, that is item 5 in
[NEEDS_VAIBHAV.md](../NEEDS_VAIBHAV.md) and it needs a hosting decision from
you. The form says "if available", so leaving this as-is costs nothing stated.

## 6. How the project uses the HydraDB Open Source Repo

```
HydraDB is the storage and traversal engine for the whole evidence graph, and
the only thing on the answer path. There is no vector index, no similarity
score, and no second store holding the real answer.

Answering a question is four graph reads and nothing else:

1. MATCH (e:Entity {name: $name}) to resolve the subject.
2. MATCH (c:Claim)-[:ABOUT]->(e {id: $e}) with an OPTIONAL MATCH for
   (newer)-[:SUPERSEDES]->(c), which returns every claim and what replaced it in
   one request.
3. MATCH (e {id: $e})<-[:ABOUT]-(c)-[:MENTIONS]->(o) for the one hop that answers
   questions needing a bridge entity.
4. MATCH (se:Session)-[:CONTAINS]->(m)-[:HAS_SPAN]->(sp)-[:SUPPORTS]->(c {id: $c}),
   a four-hop path fetched in a single request, which is what the proof panel
   renders as provenance.

The design leans on the graph in three places where a relational or vector
approach would need machinery:

Revision is a DAG, not a version column. A correction adds a SUPERSEDES edge.
The current value is the claim with nothing pointing at it, which is a
structural question, and the superseded claims stay queryable rather than being
overwritten. The timeline panel is that DAG.

Abstention is read off the shape of the subgraph. out_of_scope is no node
carrying that name at all. never_stated is the entity present with nothing
stating that predicate. unconnected is the same emptiness reached through a hop,
where the bridge entity was found and it is the bridge that says nothing.
retracted is the surviving claim withdrawing the value and putting nothing in
its place. contradicted is two claims that nothing supersedes giving different
values, so the disagreement is live rather than resolved.

Worth being exact about that last one, because the obvious guess is wrong: it is
not read off a CONTRADICTS edge. It is derived from two unsuperseded claims
disagreeing, which is the distinction between "these two conflict" and "one of
these replaced the other". A CONTRADICTS query exists in the query module and is
unit-tested, and it is not called on the answer path. That is stated here for
the same reason the algo.SPpaths note is.

A similarity index cannot make any of these five distinctions, because it has a
nearest neighbour in every one of those situations.

Cross-session synthesis is a traversal. "Who is our contact for the vendor
behind replay-queue" is answered by following MENTIONS from replay-queue to
Northfold and reading Northfold's contact. No session states that fact. Two
state it between them.

The query layer was written against the Cypher subset the engine actually
implements, discovered by probing a live node on day two rather than assumed
from documentation. What it refused is recorded in the source next to the code
that works around it, and the probe transcripts are committed. One honest note:
algo.SPpaths was probed successfully and is deliberately not on the answer path,
because shortest-path needs two known endpoints and a question arrives with one.
The repository says this in the same place it would have been easiest to leave
the stronger claim standing.

HydraDB is consumed as a separate service over HTTP and is not vendored, which
also keeps its AGPL-3.0 obligations where they belong rather than mixing them
into an Apache-2.0 codebase.

Pinned to HydraDB v0.1.1 at commit 02a40025d2d57e97ab2754c8256219cdbfeab379.
```

## 7. Tech stack used

```
TypeScript on Node 20.11+, with zero runtime dependencies. The server, the
HydraDB HTTP client, the retrieval layer and the four rendered screens are all
first-party code, and the pages ship no JavaScript at all.

HydraDB v0.1.1 (pinned commit 02a40025d2d57e97ab2754c8256219cdbfeab379), run as
a separate service on loopback and reached over its HTTP query API, in WSL2 on
Ubuntu 24.04.

Five dev dependencies and nothing else: typescript, @types/node, tsx to run
TypeScript directly, vitest for the 610 tests, and @huggingface/transformers.
That last one is worth explaining, because it is the only model in the
repository and it belongs to the opposition: the benchmark baselines embed with
Xenova/all-MiniLM-L6-v2, 384 dimensions, run locally, so the pipelines Lacuna is
measured against are real semantic search rather than keyword strawmen. It is
never loaded on the product's answer path.

Screenshots in artifacts/screens were captured with Chromium under Playwright,
which is a capture tool run against the server and not a dependency of the
project.

Apache-2.0.
```

## 8. Team members and individual contributions

```
Solo entry. One person, all of it: data model, HydraDB adapter and contract
tests, corpus generator, ingestion, retrieval and abstention, the four screens,
the benchmark harness, the threat model and security tests, and the
documentation.
```

Check the form's expected format for a name and handle before pasting. If it
wants a GitHub username, it is the account that owns the repository in field 9.

## 9. GitHub repository link

```
https://github.com/vaibhav4046/lacuna
```

**Live, public, and holding the code** as of 2026-08-13. The remote tip is
`033c1a8`, `git ls-remote` agrees with the local `HEAD`, and the GitHub API
reports `private: false`. This was the one blocker with a disqualification
attached, since a missing or private repository is on the rules' list of seven
triggers, and it is closed.

Check it again anyway, in a logged-out browser, on the day you submit. The rules
say broken links are the most common way entrants lose, and a link that worked a
week ago is not evidence about a link today.

```bash
git ls-remote --heads https://github.com/vaibhav4046/lacuna
```

A line ending in `refs/heads/main` means the push is still there.

## 10. Demo video link

```
BLOCKED. Not recorded yet.
```

The script is written and waiting at
[docs/VIDEO_SCRIPT.md](VIDEO_SCRIPT.md): eight shots, 2:49, exact screens and
URLs in order, and the commands that put the graph in the state every take
needs. Recording and upload are yours. Unlisted YouTube satisfies the rule that
judges must be able to watch without requesting access.

---

## Before you press submit

- [ ] Repository is public, and you have opened it in a logged-out browser.
- [ ] Video link opens in a logged-out browser and runs under 3:00.
- [ ] Both links pasted into the form are the ones you just tested. The rules say
      broken links are the most common way entrants lose.
- [ ] Track selected is 03, Memory and Context Retrieval. One track per
      submission.
- [ ] Submitted before 2026-08-20, 11:59 PM PT. Internal target is 2026-08-19,
      21:00 Europe/London, which is what the schedule was built against.

## What this draft deliberately does not claim

The benchmark result is a tie. Two hand-built hybrid baselines also score 60/60
across 51 configurations, and [docs/BENCHMARKS.md](BENCHMARKS.md) opens by saying
so. No field above claims Lacuna wins on correctness. What it claims is what the
run actually showed: the same score from four graph reads and 15 context tokens,
against pipelines needing four hand-tuned components and 636 or 1,603 tokens to
get there.

If a judge opens the benchmark document expecting to catch an overclaim in this
form, the two documents agree. That is worth more than a stronger sentence here.
