# Verification, 2026-08-18

The corpus grew after the earlier parity runs. It now carries the package
topology and the four blast-radius questions, which took the gold set from sixty
to sixty-four, so the transcript the README points at had to be retaken against
the corpus that actually ships. That is the only reason this run exists.

The same is true of the two test suites: the corpus growth added tests, so the
counts recorded in `docs/CLAIMS.json` were retaken here rather than carried
forward from the runs that produced them.

| File | Command | Result | Exit |
|---|---|---|---|
| `parity.txt` | `npm run parity` | 2 deep cases + 64-question sweep, all identical | 0 |
| `unit.txt` | `npm run test` | 39 files, 893 tests, 15.40s | 0 |
| `contract.txt` | `npm run test:contract` | 3 files, 50 tests, 11.42s | 0 |
| `census.txt` | `npm run census` | 5,752 vertices and 5,908 edges, graph matches the plan exactly | 0 |

The transcript ends:

```
SWEEP_IDENTICAL: 64 of 64

ALL_IDENTICAL: True
```

Of the sixty-four, 32 answered and 32 abstained, and every abstention arrived as
a successful call on all three surfaces. The four blast-radius questions are in
the sweep and answered on all three: they are the ones whose value is a list of
affected services computed by traversal, so agreement across stdio, HTTP and the
CLI is agreement on a traversal rather than on a stored string.

The run was made against commit `afcb81a` with the working tree carrying the
blast-radius work. The numbers describe that tree, not the commit alone.

## What the sweep judges

The same eight fields and the same read set the deep cases compare: status,
answer, reason code, claim id, superseded claims, evidence, evidence total,
source state, and the set of reads with their parameters and row counts. It does
not score answers against the gold expectations; `scripts/evaluate.ts` does
that, and a second scorer would be a second definition of correct.

`scripts/parity.ts` gained two pieces of instrumentation before this run: a
sweep failure now names the question, its subject and its predicate, and an MCP
result with `isError` set is raised rather than being read as a missing answer.
The run that prompted them failed once at the sixteenth sweep question and has
not reproduced since, on this run or any other. The cause is unproven. The
instrumentation stays because it is what will name it if it returns.

## The two suites

`unit.txt` prints seven error lines before its summary. They are the point of
the tests that produce them: two transport failures against a port with nothing
on it, two decode failures on an entity name that matches more than one node,
and three authorization refusals on a graph the token cannot read. A run of that
suite with a silent stderr would mean the failure paths went unexercised.

`contract.txt` is the suite that talks to the node, and it skips rather than
fails when nothing is listening, so the count is the only thing that
distinguishes a run that passed from a run that did nothing. Fifty tests over
three files, with the node up on loopback throughout. The figure recorded in
`docs/CLAIMS.json` before this run was 42, from 2026-08-14; the tests added
since are the ones this run counts.

## The census

`census.txt` is the count of what is actually in the graph, label by label and
edge type by edge type, against what the plan says should be there. It is the
stronger of the two ingest reports: the ingest transcript says what was written,
the census says what survived. The counts it prints, 5,752 vertices and 5,908
edges, are the ones `docs/CLAIMS.json` now records; the figures it replaced,
5,642 and 5,705, described the corpus before the package topology was added and
are kept in `artifacts/ingest/` as the dated record of that run.

## Node state

The HydraDB node was up on loopback for the whole run, on the store at
`/var/lib/lacuna/hydradb`. Both printed payloads carry `"sourceState": "live"`,
and the sweep compares that field across the three surfaces on every question
without printing it. Nothing here is cached, replayed or seeded from a fixture.

## Secrets

No file in this directory contains a credential. The payloads carry query text
and query parameters, which are entity names and node ids, and no configuration.
