# Reproduction

Whether a judge can run this is a claim like any other, so it gets an
experiment rather than an assurance. [`repro.sh`](repro.sh) clones this
repository into a directory that has never held it, installs from the lockfile,
typechecks, runs the unit suite, starts the server, and asks it the four demo
questions. Two runs are recorded here, both unedited:

| Transcript | Commit | Why it is kept |
|---|---|---|
| [`clean-clone-2026-08-13.txt`](clean-clone-2026-08-13.txt) | `ffbe274`, 29 commits | The first run at the full 568-test suite |
| [`clean-clone-4de1a65.txt`](clean-clone-4de1a65.txt) | `4de1a65`, 40 commits | The tip at the time, which is what a judge actually clones |

**Neither hash resolves any more, and both transcripts still print them.** After
these runs were recorded, the author's email address was rewritten across every
commit so that a private address would not be published, which changed every hash
in the repository. `ffbe274` is now `bac9d9d`; `4de1a65` is now `2954b15`. The
reasoning, and the checks proving that dates, messages and file content all came
through byte identical, are in D-050 of [DECISIONS.md](../../DECISIONS.md).

The transcripts were left exactly as the runs printed them. Editing recorded
output so that it agrees with a history which did not exist when the run happened
would destroy the only property that makes a transcript worth committing.

The second exists because the first was going stale in a specific way. Eleven
commits landed after it, and although all of them were documentation, "all of
them were documentation" is a claim, and the fix for a claim is to run the
thing. Source, tests and `package-lock.json` are byte for byte identical
between the two commits. The only non-markdown difference is one line of
`package.json`, an `eval` script alias that no step of this run touches.

```bash
artifacts/repro/repro.sh
```

It takes an optional source and destination (`repro.sh <source> <dest>`) and
honours `PORT`. By default it clones from the repository the script lives in,
into a fresh temporary directory.

## What each step is worth

Steps 1 to 4 need nothing but the repository and a Node 20.11 or newer. They
prove the checkout is complete, that the lockfile installs, that it typechecks,
and that 568 tests pass, all from a path with no leftovers in it.

Steps 5 to 7 need two more things: a HydraDB node running, and a `.env.local`
pointing at it. See the quickstart in the top-level [README](../../README.md).
The clone has no `.env.local` of its own, because that file is git-ignored and
always has been, so the script copies yours in without reading it and prints
only the key names. If you have not made one, the script says so and stops after
step 4 rather than pretending.

## The error lines in step 4 are supposed to be there

```
request failed: HydraQueryError: HydraDB returned 403: principal bearer principal is not authorized to read graph scope tenant-b/graphs/default
```

A full run prints five of these: the 403 above three times, plus one
`HydraTransportError` and one `RetrievalDecodeError`. Step 4 prints `tail -8`,
so which of the five you see there depends on the order the test files happened
to finish in. Both transcripts here caught two of the three 403s, which is a
coincidence and not a guarantee.

Every one of them is a test provoking an error on purpose and the code logging
the error it was handed. The 403 is `tests/unit/security-namespace.test.ts`
checking that a refusal from the node is surfaced as a failure rather than
rendered as an answer, so it has to cause a refusal to check it. The other two
cover a node that will not accept a connection and an entity name that matches
two nodes. `tenant-b` is a fixture name and not a namespace on anybody's node.

The counts on the following lines are the result. Both runs end
`Tests 568 passed (568)` and `UNIT_EXIT=0`.

## The two runs disagree about latency, and neither one is wrong

Step 8 prints the server's own request log. The two transcripts do not match:

```
ffbe274    GET / 200 1ms     GET /ask 200 190ms   227ms   137ms   291ms
4de1a65    GET / 200 5ms     GET /ask 200 1167ms  529ms   240ms   1184ms
```

Same source, byte for byte, four to six times the wall clock. No cause was
established, so none is offered. What can be said is what it is not: it is not
a code change, because there is no code change between these two commits, and
it is not a different graph, because both ran against the same node holding the
same corpus. It is a laptop under an unknown load, measured twice.

This is the same instability [docs/BENCHMARKS.md](../../docs/BENCHMARKS.md)
already reports in its latency column, where the same harness against the same
graph produced a p50 of 188.1ms and then 243.4ms. Treat any millisecond figure
in this repository as an order of magnitude. Every correctness figure in these
two runs is identical, which is the part they were run to check.

## This script passed once without proving anything

Worth writing down, because it is the failure this directory exists to prevent.

An earlier version killed the server with `kill` on the shell job. That job is
npm, and npm had spawned node, so node survived and kept the port. The next run
started, failed to bind, and had all four of its questions answered by the
previous run's orphan. Every check passed. The transcript looked perfect. The
only tell was that the server log it printed was empty, which is the sort of
detail that is easy to read past.

Two things came out of it. The script now refuses to start if anything already
answers on the port, rather than quietly letting a server it did not launch take
the questions, and it verifies the process that answers is the one that
announced itself on that port. Cleanup now kills whatever owns the listening
socket instead of the shell job, since msys `ps` has no `-o` and the process
tree was not walkable the way the first attempt assumed.

A reproduction script that can pass without running the thing is worse than no
reproduction script, because it produces evidence for a claim it never tested.
