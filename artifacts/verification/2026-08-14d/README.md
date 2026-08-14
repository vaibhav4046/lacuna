# Verification, 2026-08-14, fourth run

This run exists to close the last caveat every parity description carried: the
check covered two questions while the evaluation covers sixty. `npm run parity`
now runs the two deep cases with their full payloads printed, and then sweeps
all sixty gold questions from the evaluation through the same three surfaces,
one line each. The sweep questions are built exactly the way
`scripts/evaluate.ts` builds them: the same generated corpus, the same
`parseVia` on the question text, including the fourteen multi-hop questions
that carry a `via` relation.

| File | Command | Result | Exit |
|---|---|---|---|
| `typecheck.txt` | `npm run typecheck` | no diagnostics | 0 |
| `unit.txt` | `npm test` | 36 files, 807 tests, 26.19s | 0 |
| `parity.txt` | `npm run parity` | 2 deep cases + 60-question sweep, all identical | 0 |

`parity.stderr` is empty. The transcript ends:

```
SWEEP_IDENTICAL: 60 of 60
ALL_IDENTICAL: True
```

Of the sixty, 28 answered and 32 abstained, and every abstention arrived as a
successful call on all three surfaces. All three runs were made against commit
`ace82a28e4d937fa91e5a1c5af36e9d791e59bd0` with the working tree carrying the
sweep added to `scripts/parity.ts`. The numbers describe that tree, not the
commit alone.

## The bug the sweep caught in its own referee

The first sweep run ended `SWEEP_IDENTICAL: 45 of 60`, exit 1. All fifteen
mismatches were in the comparison, not the surfaces: the retracted, contradicted
and multi-hop questions issue the same cypher more than once with different
parameters (two evidence-span reads, or one claim-scan per hop), the comparison
sorted reads by cypher alone, the sort is stable, and equal-cypher entries kept
their arrival order, which is timing. An audit of all fifteen dumps confirmed
every canonical field identical across the three surfaces and the read sets
identical once equal-cypher entries were tiebroken by their parameters. The fix
is that tiebreak, in `comparable()` in `scripts/parity.ts`.

The two-question check had the same latent bug and passed on timing luck: its
answered case also issues two span reads with identical cypher. Two is exactly
the coverage at which a timing-dependent referee can look deterministic. That
is the concrete argument for the sweep, made by the sweep.

## What the sweep does and does not judge

The sweep compares the same eight fields and read set the deep cases compare:
status, answer, reason code, claim id, superseded claims, evidence, evidence
total, source state, and the set of reads with their parameters and row counts.
It does not judge answers against the gold expectations, because
`scripts/evaluate.ts` already does and a second scorer would be a second
definition of correct. Here the sixty are sixty distinct values that three
surfaces must agree on, exercised through one stdio session, one HTTP listener,
and one CLI process per question.

## Node state

The HydraDB node was up on loopback for the whole run, on the store at
`/var/lib/lacuna/hydradb`. Readiness was checked on the admin port before the
runs and again after them, by status code, since `/readyz` answers 200 with an
empty body:

```
curl.exe -s -m 5 -w "HTTP %{http_code}\n" http://127.0.0.1:19091/readyz
HTTP 200
```

`sourceState` is `live` on every result in `parity.txt`. Nothing here is
cached, replayed or seeded from a fixture.

## Secrets

No file in this directory contains a credential. The payloads carry query text
and query parameters, which are entity names and node ids, and no
configuration. The only match for `Bearer`, `HYDRA_TOKEN` or `authorization`
is the asserted negative-path line in `unit.txt`, the node refusing a token a
test proves cannot read another tenant's graph, with no token value in it.
