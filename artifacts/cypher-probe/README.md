# Cypher subset probe evidence

[PLAN.md](../../PLAN.md) names the riskiest assumption in this project: "does
HydraDB's Cypher subset actually express the queries this design needs". This
directory is the answer, produced by executing 119 probes against a live node
instead of reading the compatibility document again.

Captured 2026-08-12 against HydraDB `v0.1.1` (commit
`02a40025d2d57e97ab2754c8256219cdbfeab379`), built from source under WSL2 Ubuntu
24.04, HTTP query API on loopback `:18443`, graph `default`, namespace `local`,
cell `cell-0`.

Every file is machine-written. Each record holds the exact query sent, the
parameters, the HTTP status, the verdict, and the full unedited response body
including the engine's own rejection text.

## What each file is

| File | What it holds |
|---|---|
| `round1.py`, `round1-results.json` | 47 probes, **31 pass, 16 fail**. First contact. Every read that did not depend on missing data passed; every single write path was rejected. |
| `round2.py`, `round2-results.json` | 38 probes, **29 pass, 9 fail**. The forms round one's error messages named, executed. The write path is recovered here. |
| `round3.py`, `round3-results.json` | 34 probes, **34 pass, 0 fail**. Edges written one statement at a time, then every read checked against the exact rows it must return. |
| `path-value-shape.json` | One `algo.SPpaths` result in full, kept because the property encoding inside a path differs from the encoding everywhere else. |

## Why there are three rounds and not one

Round one failed on writes and that was the useful part. HydraDB's rejections
name the accepted form rather than just refusing, so each error was an
instruction. Round two executed what round one's errors said, and the write path
worked.

Round two then looked better than it was. Ten of its read probes returned zero
rows. They were counted as accepted, because they were, but a query that parses
and returns nothing has not been shown to be correct. The cause was that
`UNWIND` had refused to create edges, so the graph held vertices and almost no
relationships, and the reads were traversing an empty neighbourhood.

Round three exists to close that gap. It writes the fourteen missing edges one
statement per edge, then asserts on values: three claims about the launch entity
and specifically January, March and April; the superseded claim naming
`2000000000002` as its superseder while the other two come back `null`; the
bounded traversal returning exactly the one superseded claim. A probe that
returns the right number of wrong rows fails.

Round three ends `0 failed`. Rounds one and two are kept because a record that
only shows the working version is not evidence, it is a demo.

## What this changed in the design

Three statements in [ADR 0002](../../docs/adr/0002-temporal-evidence-graph.md)
were taken from the compatibility document and are wrong about the running
engine. They are corrected in that ADR's amendment section with the original
text left visible. In short:

- `UNWIND` upserts vertices and cannot write edges. Edges go one per statement.
- A bare `MERGE` outside `UNWIND` creates edges only, never a labelled vertex.
- `count(<binding>)` does not parse, so the abstention check projects the
  superseder's id and reads `null` as "current".

None of this changed the data model. It changed the number of round trips at
ingest and the text of two queries.

## Reproducing this

The node must be running per upstream `AGENTS.md` steps 3 to 8. Then, with the
token in the environment rather than in the file:

```bash
HYDRA_TOKEN="$GRAPH_AUTH_TOKEN" python3 round3.py
```

Round three is idempotent. Every write is a `MERGE`, and the last section
re-runs all fourteen edges and re-counts to prove it: `I01` and `I02` assert the
graph is unchanged after the second pass.

The three scripts are stdlib-only Python and take the token from `HYDRA_TOKEN`.
An earlier version had the upstream development placeholder token written into
the source. That is a documented placeholder for a loopback node with TLS
disabled and not a secret, but a literal shaped like a credential does not
belong in a repository, so it was replaced with an environment read and all
three rounds were re-run to confirm the committed scripts are the ones that
produced the committed results.
