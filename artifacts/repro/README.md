# Reproduction

Whether a judge can run this is a claim like any other, so it gets an
experiment rather than an assurance. [`repro.sh`](repro.sh) clones this
repository into a directory that has never held it, installs from the lockfile,
typechecks, runs the unit suite, starts the server, and asks it the four demo
questions. [`clean-clone-2026-08-13.txt`](clean-clone-2026-08-13.txt) is the
output of one such run, unedited.

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
to finish in. The transcript recorded here caught two of the three 403s.

Every one of them is a test provoking an error on purpose and the code logging
the error it was handed. The 403 is `tests/unit/security-namespace.test.ts`
checking that a refusal from the node is surfaced as a failure rather than
rendered as an answer, so it has to cause a refusal to check it. The other two
cover a node that will not accept a connection and an entity name that matches
two nodes. `tenant-b` is a fixture name and not a namespace on anybody's node.

The counts on the following lines are the result. The run above ends
`Tests 568 passed (568)` and `UNIT_EXIT=0`.

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
