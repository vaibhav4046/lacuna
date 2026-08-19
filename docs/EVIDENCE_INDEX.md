# Evidence index

Every number this project states in public, and the file it came out of.

[docs/CLAIMS.json](CLAIMS.json) is the ledger of what Lacuna can do. This is the
other direction: it starts from the sentences a reader actually meets, in the
README, the submission draft, the scorecard and the benchmark document, and
points each one at the raw output that produced it. A number in this repository
that is not in this table is either a defect or a number nobody has to trust.

The rule the two files share is that evidence is a path, not a paraphrase. A row
here that says 64/64 does not restate the score, it names the file that printed
it and the command that wrote the file, so the check is opening something rather
than believing something.

## How to read a row

**Said in** is where a reader meets the number without going looking for it.

**Artifact** is the committed file that contains it, unedited.

**Command** is what wrote that file. Every one of them runs from a clean clone,
though the ones marked LIVE need a HydraDB node up first.

**State** is one of the five in
[src/model/capability.ts](../src/model/capability.ts), and it means what the data
behind the number is rather than how good the number is:

| State | Means |
|---|---|
| `LIVE` | Read from a running HydraDB node during the run that produced it |
| `SEEDED_DEMO` | Real code over the synthetic corpus generated from seed `lacuna-demo-v1` |
| `RECORDED` | A real run that happened once, kept as its transcript |
| `FIXTURE` | Made up input, used to exercise a code path |
| `UNAVAILABLE` | The thing does not exist yet and nothing is claimed |

Two commits produced the rows below, and which one a row came from is readable
from the dated directory it names. Everything measured on 2026-08-18, which is
the tests, the corpus, the evaluation, the benchmark and the parity sweep, was
produced at commit `afcb81a406879d43ffebdf2c4a0b3f91b0e96b69`, after the corpus
grew a dependency topology and the blast-radius question kind. The rows pointing
at earlier dated directories were produced at commit
`e33afc574b05aab12b7d04f1899a42f5d33e2144` and are kept rather than re-run, for
the reason [What moves](#what-moves) gives. Both ran on Node v24.12.0, against
HydraDB v0.1.1 at commit `02a40025d2d57e97ab2754c8256219cdbfeab379` serving
`127.0.0.1:18443` from WSL2 on Ubuntu 24.04, namespace `local`, graph `default`,
cell `cell-0`.

## Tests

| Number | Said in | Artifact | Command | State |
|---|---|---|---|---|
| 893 unit tests over 39 files | SUBMISSION, JUDGE_SCORECARD, RULES_MATRIX | [artifacts/verification/2026-08-18/unit.txt](../artifacts/verification/2026-08-18/unit.txt) | `npm test` | `FIXTURE` |
| 50 contract tests over 3 files | README, SUBMISSION, JUDGE_SCORECARD | [artifacts/verification/2026-08-18/contract.txt](../artifacts/verification/2026-08-18/contract.txt) | `npm run test:contract` | `LIVE` |
| 943 tests with a node running | SUBMISSION | the two files above | both commands | mixed, see above |
| Seven error lines on stderr are meant to be there | README | [artifacts/verification/2026-08-18/unit.txt](../artifacts/verification/2026-08-18/unit.txt) | `npm test` | `FIXTURE` |
| Typecheck is clean | JUDGE_SCORECARD | [artifacts/verification/2026-08-18/typecheck.txt](../artifacts/verification/2026-08-18/typecheck.txt) | `npm run typecheck` | `FIXTURE` |

The unit count and the contract count are two different things and the
distinction is the point of keeping them apart. The unit suite needs no database
and will pass on a laptop with nothing installed. The contract suite runs every
query builder against a real node and **fails rather than skips** when no node
answers. That is deliberate and both suites say so in their headers: a green run
that quietly tested nothing is the failure this arrangement exists to prevent.
This paragraph said the opposite until 2026-08-19, which was wrong about the
code it exists to make checkable.

The count is 77 across four files at the time of writing. An earlier recorded
run of 50 is kept unedited in the artifacts rather than restated here.

The seven stderr lines are asserted negative paths, not failures. Two refused
connections, two ambiguous entity names, three 403s from a namespace the token
cannot read. A run that printed none of them would mean the error paths had
stopped being exercised.

The jump from 712 to 807 is the CLI and MCP suites landing; 807 to 816 is the
snapshot-comparison suite landing with the D-078 fix; 816 to 893 is the
blast-radius work, which added two files, `tests/unit/retrieval-blast.test.ts`
and `tests/unit/ground-truth-isolation.test.ts`, and widened cases in the files
already there. The earlier runs are
still on disk at [artifacts/verification/2026-08-14/](../artifacts/verification/2026-08-14/)
and is not deleted, because a superseded measurement is evidence of when the
number changed and why. That is the same rule the product applies to claims.

## Corpus

| Number | Said in | Artifact | Command | State |
|---|---|---|---|---|
| 72 sessions | README, SUBMISSION | [artifacts/verification/2026-08-18/census.txt](../artifacts/verification/2026-08-18/census.txt) | `npm run ingest && npm run census` | `SEEDED_DEMO` |
| 5,246 messages | README, SUBMISSION | same | same | `SEEDED_DEMO` |
| 174 claims, 174 evidence spans | README, SUBMISSION | same | same | `SEEDED_DEMO` |
| 86 entities | SUBMISSION | same | same | `SEEDED_DEMO` |
| 22 SUPERSEDES, 12 CONTRADICTS, 106 MENTIONS edges | HYDRADB_INTEGRATION | same | same | `SEEDED_DEMO` |
| roughly 117,041 tokens of transcript | SUBMISSION, BENCHMARKS | [artifacts/bench/report.txt](../artifacts/bench/report.txt) | `npm run bench` | `SEEDED_DEMO` |

The corpus is synthetic on purpose. No private conversation is in it, and the
whole thing rebuilds from the seed `lacuna-demo-v1` by committed code, which is
what makes every number below it reproducible rather than reported.

`census` is the reason these counts are evidence and not just output. Counting
totals alone would let a missing node and a stray node cancel out, so it also
reads every stored key back and names anything the plan did not write. The line
`graph matches the plan exactly` means both checks passed.

The rows above point at the census rather than at
[artifacts/ingest/README.md](../artifacts/ingest/README.md), which is the
transcript of the 2026-08-13 load and still prints that day's smaller counts.
That file is deliberately not restated, because a transcript edited to agree
with a later run has stopped being a transcript. It says so in its own header.

## Evaluation

| Number | Said in | Artifact | Command | State |
|---|---|---|---|---|
| 64 questions, 64 exact correct | README, SUBMISSION, JUDGE_SCORECARD, BENCHMARKS | [artifacts/eval/report.txt](../artifacts/eval/report.txt) | `npm run eval` | `SEEDED_DEMO` |
| Nine question kinds, all at 100% | BENCHMARKS | same | same | `SEEDED_DEMO` |
| Abstention precision, recall and F1 of 1.000 | JUDGE_SCORECARD, BENCHMARKS | same | same | `SEEDED_DEMO` |
| 32 questions where abstaining was correct | BENCHMARKS | same | same | `SEEDED_DEMO` |
| 0 unsupported answers, 0 false answers | SUBMISSION, BENCHMARKS | same | same | `SEEDED_DEMO` |
| Five reason codes | README, SUBMISSION | [artifacts/eval/cases.json](../artifacts/eval/cases.json) | `npm run eval` | `SEEDED_DEMO` |
| p50 114.1 ms, p95 184.4 ms per question | BENCHMARKS | [artifacts/eval/report.txt](../artifacts/eval/report.txt) | `npm run eval` | `LIVE` |

What a perfect score here does and does not say is written into the artifact
itself: the same generator wrote the corpus and the questions it is scored
against, so 64/64 is a statement that the pipeline does what the structure says,
not that the pipeline is right about the world. It is a correctness check, and
the benchmark below is where it gets compared to something.

The eval latency figures and the benchmark latency figures are different numbers
from different runs and are not interchangeable. This one is one question at a
time against a live node with nothing else running.

## Benchmark

| Number | Said in | Artifact | Command | State |
|---|---|---|---|---|
| 51 configurations, 6 approaches | SUBMISSION, BENCHMARKS | [artifacts/bench/report.txt](../artifacts/bench/report.txt) | `npm run bench` | `RECORDED` |
| Lacuna 64/64, and the best baseline at 63/64 | SUBMISSION, BENCHMARKS, JUDGE_SCORECARD | same | same | `RECORDED` |
| 18 mean context tokens against 1,843 | SUBMISSION, BENCHMARKS | same | same | `RECORDED` |
| 527 and 1,311 context tokens for the vector baselines | SUBMISSION, BENCHMARKS | same, and [artifacts/bench/results.json](../artifacts/bench/results.json) | same | `RECORDED` |
| p50 92.2 ms, p95 169.5 ms | BENCHMARKS | [artifacts/bench/report.txt](../artifacts/bench/report.txt) | same | `RECORDED` |
| Xenova/all-MiniLM-L6-v2, 384 dimensions, run locally | SUBMISSION, BENCHMARKS | same | same | `RECORDED` |

**The result is a one-question lead and is stated as one.**
`hybrid+2hop@50 +conflict` scores 63/64, with the same zero unsupported answers
on both. One question is not a claim of better recall or better abstention, and
none is made anywhere in the repository. What the run showed is that score from
four graph reads and 18 context tokens, against a pipeline needing four
hand-tuned components and 1,843 tokens to come one question short.

**The latency comparison is not like for like, and this sentence belongs next to
the numbers rather than behind a tooltip.** Lacuna's 92.2 ms is HTTP reads
against a live graph over loopback. The baselines' 3.9 ms is in-process array
scanning inside the same Node process. Those measure different things. The
context figure is the comparable one; the millisecond figure is there so nobody
has to discover the trade-off for themselves.

## HydraDB

| Number or claim | Said in | Artifact | Command | State |
|---|---|---|---|---|
| HydraDB v0.1.1 at commit `02a4002` | README, SUBMISSION, SOURCE_LOG | [artifacts/hydradb/provenance.txt](../artifacts/hydradb/provenance.txt) | `scripts/hydra-node.sh start` and the node's own version endpoint | `LIVE` |
| Real write then read over HTTP | JUDGE_SCORECARD, HYDRADB_INTEGRATION | [artifacts/hydradb/smoke-write.json](../artifacts/hydradb/smoke-write.json), [smoke-read.json](../artifacts/hydradb/smoke-read.json) | `npm run serve` prerequisites, see HYDRADB_INTEGRATION | `LIVE` |
| Bolt round trip on 17687 | HYDRADB_INTEGRATION | [artifacts/hydradb/bolt-read.txt](../artifacts/hydradb/bolt-read.txt) | same | `LIVE` |
| The Cypher subset the engine implements | SUBMISSION, HYDRADB_INTEGRATION | [artifacts/cypher-probe/](../artifacts/cypher-probe/), six rounds with results | `python artifacts/cypher-probe/roundN.py` | `RECORDED` |
| Four reads answer a direct question | SUBMISSION, JUDGE_SCORECARD, HYDRADB_INTEGRATION | the proof panel on any answer page, and [artifacts/screens/](../artifacts/screens/) | `npm run serve` | `LIVE` |
| Eight reads answer a two-hop question | HYDRADB_INTEGRATION | same | same | `LIVE` |
| AGPL-3.0, consumed as a service, not vendored | README, SUBMISSION, THIRD_PARTY | [docs/SOURCE_LOG.md](SOURCE_LOG.md) | not a measurement, a licence fact | `LIVE` |

The Cypher probe rounds are the reason the query layer is written the way it is.
What the engine refused is recorded next to the code that works around it rather
than summarised, because a summary of a refusal is not checkable. One honest note
that the repository keeps in the place it would have been easiest to drop:
`algo.SPpaths` probed successfully and is deliberately not on the answer path,
because shortest path needs two known endpoints and a question arrives with one.

## Interface

| Number or claim | Said in | Artifact | Command | State |
|---|---|---|---|---|
| Fourteen screen captures | SUBMISSION, JUDGE_SCORECARD | [artifacts/screens/README.md](../artifacts/screens/README.md) | `npm run screens` | `RECORDED` |
| The pages ship no JavaScript | README, SUBMISSION | [src/view/layout.ts](../src/view/layout.ts) and the CSP it emits | `npm test`, asserted in `tests/unit` | `LIVE` |
| No secret appears in any capture | SECURITY, screens README | [src/view/proof.ts](../src/view/proof.ts), asserted in `tests/unit/view-pages.test.ts` | `npm test` | `LIVE` |

Every capture is checked by the script that took it, on five properties: PNG
signature and bit depth, exact width, exact or minimum height, a dark top left
pixel, and a floor on compressed bytes per pixel so a blank render cannot pass.
That last check is not decorative. It is what caught a proof panel printing
`448.4000000000003 ms`.

## Surfaces

| Number or claim | Said in | Artifact | Command | State |
|---|---|---|---|---|
| The MCP server answers over stdio | CLAIMS, MCP | [artifacts/verification/2026-08-14b/mcp-stdio.txt](../artifacts/verification/2026-08-14b/mcp-stdio.txt) | a throwaway JSON-RPC driver, described in that directory's README | `LIVE` |
| Four tools advertised: `lacuna_ask`, `lacuna_explain`, `lacuna_timeline`, `lacuna_health` | MCP | same, the `tools/list` response | same | `LIVE` |
| The command line answers and abstains with the same typed result | CLAIMS, CLI | [cli-ask.json](../artifacts/verification/2026-08-14b/cli-ask.json), [cli-abstain.json](../artifacts/verification/2026-08-14b/cli-abstain.json) | `node bin/lacuna.js ask Bellwether beta_partner --json` | `LIVE` |
| Both exited 0 and wrote nothing to stderr | CLAIMS | [cli-exit.txt](../artifacts/verification/2026-08-14b/cli-exit.txt) and the two empty `.stderr` files | same | `LIVE` |
| MCP over stdio, MCP over HTTP, and the command line return the same value, on the sixty-four eval questions and two deep cases | CLAIMS, MCP, CLI | [artifacts/verification/2026-08-18/parity.txt](../artifacts/verification/2026-08-18/parity.txt) | `npm run parity` | `LIVE` |
| Four reads for the answered question, three for the abstention | CLAIMS, HYDRADB_INTEGRATION | same, and the two command line captures | same | `LIVE` |
| A third-party client connected over both transports using the documented config block | MCP | [artifacts/verification/2026-08-14e/](../artifacts/verification/2026-08-14e/README.md) | `npx --yes @modelcontextprotocol/inspector@2.2.0 --cli --config artifacts/verification/2026-08-14e/inspector-config.json --server lacuna --method tools/list` | `LIVE` |

The parity check is the reason [src/contract/result.ts](../src/contract/result.ts)
exists. All three surfaces build their output from that one module — the two MCP
transports through one server, the command line through its own process — so
agreement is structural rather than something separate code paths happen to
arrive at, and the check exists to catch the day that stops being true. The
sweep started at sixty questions on 2026-08-14 and covers sixty-four now that
the blast-radius questions are in the gold set; the earlier run is still on disk
at [the fourth run's README](../artifacts/verification/2026-08-14d/README.md),
which records the exact tree it measured along with the timing-dependent
comparison bug the sweep caught in its own referee on its first run. The
third-party client row is the one row in this table not from the commit at the
top of this file: it is the fifth run of 2026-08-14,
[written up in its own README](../artifacts/verification/2026-08-14e/README.md),
which names the tree it ran against.

What it compares is the status, the answer, the reason code, the claim id, the
superseded claims, the evidence, the evidence total, the source state, and the
set of graph reads with their parameters and row counts. What it deliberately
does not compare is the order those reads appear in. The reads a question needs
are independent and are issued together, so they land in the trace in whatever
order the node answers them, and that order moves between two runs of the same
command on the same surface. `parity.txt` prints both orders next to the verdict
so the exclusion is visible rather than buried in the comparison that excludes
it.

The only clients that have connected to the MCP server were run from this
repository: the stdio driver behind the row above, and the SDK's own `Client`
over the HTTP transport in the parity run. No editor or agent runtime has been
pointed at it yet, so nothing in this repository calls the server universal or
claims compatibility with a named host. That row arrives when three materially
different clients connect and each transcript is saved beside the others.

## Repository

| Number or claim | Said in | Artifact | Command | State |
|---|---|---|---|---|
| A clean clone installs, typechecks and passes | README, SUBMISSION | [artifacts/repro/](../artifacts/repro/), two unedited transcripts | `artifacts/repro/repro.sh` | `RECORDED` |
| Every README command runs in printed order on a clean clone | README | [artifacts/verification/2026-08-15/judge-transcript.txt](../artifacts/verification/2026-08-15/judge-transcript.txt), the cold judge simulation at `506e7c0` | the README, top to bottom | `RECORDED` |
| The repository is public | SUBMISSION | `git ls-remote --heads https://github.com/vaibhav4046/lacuna` | that command | `LIVE` |
| One history modification, the author email rewritten at publication | README | D-050 in [DECISIONS.md](../DECISIONS.md), which carries the commit count of the day | `git log --format=%ae` | `RECORDED` |
| One runtime dependency, the MCP SDK, unreachable from the web path | CLAIMS | `package.json`, `package-lock.json`, [src/mcp/](../src/mcp/) | `grep -rn modelcontextprotocol src/server src/view src/retrieval src/hydra` returns nothing | `LIVE` |

The clean clone transcripts print the test count of the day they were run, which
is smaller than today's, because the suite has grown since. They are kept
unedited rather than refreshed, so what they prove is that the checkout is
complete and the lockfile installs, not what the current count is. The current
count is in the [tests](#tests) section, from a run of its own.

The judge-transcript row is a different exercise from the repro script: a fresh
clone in a directory that had never held the project, walked through the README
top to bottom in the order it prints, Phase A with no environment and Phase B
against a live node. It found one real defect, the snapshot verifier comparing
the read epoch, and the transcript keeps the failure, the fix (D-078,
`506e7c0`) and the green re-runs in the order they happened rather than
pretending the walk was clean on the first pass.

The 42 in the history row is the commit count at the time of the email rewrite,
not the count now, which is 84. Both are true and they are not the same fact.

## Deployment

| Number or claim | Said in | Artifact | Command | State |
|---|---|---|---|---|
| <https://lacuna-five.vercel.app> serves every page, 404s unknown paths, 405s POST | README, CLAIMS, SUBMISSION | [artifacts/verification/2026-08-14f/prod-routes.txt](../artifacts/verification/2026-08-14f/prod-routes.txt) | `curl` against the URL, listed in [that run's README](../artifacts/verification/2026-08-14f/README.md) | `RECORDED` |
| The deployed copy returns the recorded answer for one question of each kind, and discloses the replay on its own pages | README, CLAIMS | [artifacts/verification/2026-08-14f/prod-answers.txt](../artifacts/verification/2026-08-14f/prod-answers.txt) | same | `RECORDED` |
| The deployed copy sends the same CSP and nosniff headers as the local server | CLAIMS | [artifacts/verification/2026-08-14f/prod-routes.txt](../artifacts/verification/2026-08-14f/prod-routes.txt) | same | `RECORDED` |
| The snapshot replays all sixty-four gold questions with zero mismatches | README, CLAIMS | [artifacts/verification/2026-08-18/snapshot-verify.txt](../artifacts/verification/2026-08-18/snapshot-verify.txt) | `npm run snapshot:verify` | `RECORDED` |

The deployment is a replay, not a hosted node. Every reply it serves was
produced by the live node at export time and stored byte for byte in
[artifacts/snapshot/graph-snapshot.json](../artifacts/snapshot/graph-snapshot.json);
production decodes them through the same client code the live server uses, and
each answer page marks its reads as replayed. `npm run serve:snapshot` runs the
identical thing locally with no database and no token.

## What this index does not cover

Nothing here supports voice, an LLM router, or authentication, because none of
those has produced an artifact. Their rows in [docs/CLAIMS.json](CLAIMS.json)
carry `UNAVAILABLE` and that is the whole of what is claimed about them. A
capability with no line in this file is a capability with no evidence, which is
the state this file exists to make visible rather than to hide.

## What moves

Some numbers here go stale the moment new work lands, and saying so is cheaper
than being caught by it.

**The unit test count.** It has been 712, then 805, then 807, then 816, and is
893 at the run above.
It moves whenever a test is added, which is often, and it was written into six
files at once, which is exactly how a stale count survives. The durable fix was
to stop repeating it: the README and the scorecard now tell a reader to look at
the pass line rather than at a number, and the count lives in the tests row above
and in the `unit-tests` entry in the ledger, where a single run updates both.
Anywhere it still appears as a figure, it is one commit behind the moment a test
lands.

**The MCP and CLI rows arrived, and then the third-party client did.** They
were promised in this section as pending and are now in [Surfaces](#surfaces)
above. The HTTP transport left the pending list on the day's third run, when
the parity script drove it end to end with a real SDK client; the two-question
coverage caveat left on the fourth, when the parity check grew to sweep the
whole evaluation; and the third-party client left on the fifth, when the MCP
Inspector's CLI consumed the documented config block and drove both transports.
What is still pending is narrower than it was: no editor or agent runtime has
held an interactive session with this server. A client run from a terminal is
not a host, and the row for a host is the one this file does not yet have.

**The deployed URL arrived on the sixth run.** It sat in the not-covered list
until [artifacts/verification/2026-08-14f/](../artifacts/verification/2026-08-14f/README.md)
measured it from outside; its rows are in [Deployment](#deployment) above.
What remains not covered is voice, an LLM router, and authentication. Those
remain `UNAVAILABLE` in the ledger and absent from this index, which is the
same statement made twice on purpose.

**The second store arrived on the seventh run.** Until it did, every claim in
this file rested on one store: a self-hosted node on loopback, which the
deployed function cannot reach. Two artifacts change that.

| Claim | Artifact | What it holds |
| --- | --- | --- |
| The corpus and the claim graph are in HydraDB Cloud | [artifacts/hydra/cloud-ingest.json](../artifacts/hydra/cloud-ingest.json) | 159 records written, 159 indexed, 0 refused; the sampled entity and the index read back byte identical to what was written |
| Both stores return the same answers | [artifacts/hydra/cloud-parity.json](../artifacts/hydra/cloud-parity.json) | 64 gold questions asked of the node and of the cloud, compared field by field: `identical: true`, node 342 reads, cloud 119 |
| A stranger can watch the product work | https://lacuna-five.vercel.app/judge | Six questions computed on load, six different outcomes, `source_state` live on each |

Two fields are excluded from the store comparison and only two: wall clock
milliseconds, which measure the network, and the read log, which is the one
thing meant to differ. A question costs three round trips against the node and
one against the cloud, because one cloud record holds what three Cypher reads
gather.

What this does not cover: the CLI and the MCP server read the node. That is
recorded as a deliberate limit in DECISIONS.md D-119 rather than left for a
reader to discover.
