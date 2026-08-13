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
and that 442 tests pass, all from a path with no leftovers in it.

Steps 5 to 7 need two more things: a HydraDB node running, and a `.env.local`
pointing at it. See the quickstart in the top-level [README](../../README.md).
The clone has no `.env.local` of its own, because that file is git-ignored and
always has been, so the script copies yours in without reading it and prints
only the key names. If you have not made one, the script says so and stops after
step 4 rather than pretending.

## The two error lines in step 4 are supposed to be there

```
request failed: HydraTransportError: request failed before a response arrived
request failed: RetrievalDecodeError: entity name matched 2 nodes, expected at most one
```

Those are tests asserting what the code does when the node refuses a connection
and when an entity name is ambiguous, and the code logs the error it was handed.
The counts on the following lines are the result. Both runs above end
`Tests 442 passed (442)` and `UNIT_EXIT=0`.

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
