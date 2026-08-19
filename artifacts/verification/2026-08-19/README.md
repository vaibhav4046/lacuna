# Verification, 2026-08-19

Retaken because the repository grew a claim extractor, a HydraDB graph walk and
a scale curve, and the counts recorded across the documentation were from
2026-08-18 and no longer described what runs. Every number a document states
about this repository's own tests now points here.

The node was rebuilt by `scripts/scale-curve.ts` immediately before this run.
That script clears and reingests once per size and ends on the shipped size, so
the graph these commands read is the seed `lacuna-demo-v1` corpus at 72
sessions, written fresh rather than accumulated. `census.txt` is the check on
that: it reads every stored key back and names anything the plan did not write.

| File | Command | Result | Exit |
|---|---|---|---|
| `typecheck.txt` | `npm run typecheck` | clean | 0 |
| `unit.txt` | `npm test` | 55 files, 1,152 tests, 23.81s | 0 |
| `contract.txt` | `npm run test:contract` | 4 files, 77 tests, 33.55s | 0 |
| `census.txt` | `npm run census` | graph matches the plan exactly | 0 |

1,229 tests with a node running, which is the two suites added together and is
the only number that needs both.

The graph, read back rather than asserted:

| label | in graph | planned |
|---|---|---|
| Session | 72 | 72 |
| Message | 5,246 | 5,246 |
| EvidenceSpan | 174 | 174 |
| Claim | 174 | 174 |
| Entity | 86 | 86 |

| edge | in graph | planned |
|---|---|---|
| CONTAINS | 5,246 | 5,246 |
| HAS_SPAN | 174 | 174 |
| SUPPORTS | 174 | 174 |
| ABOUT | 174 | 174 |
| MENTIONS | 106 | 106 |
| SUPERSEDES | 22 | 22 |
| CONTRADICTS | 12 | 12 |

## What moved since 2026-08-18

The unit suite went from 893 tests over 39 files to 1,152 over 55. The contract
suite went from 50 tests over 3 files to 77 over 4. Nothing was removed to get
there and no assertion was loosened; the additions cover the extractor, the
assertion-mode gating, the LongMemEval adapter and its leakage guarantee, the
HydraDB graph walk, and the public extract endpoint including its behaviour on
markup and on oversized input.

The seven error lines on stderr in `unit.txt` are still meant to be there. They
are the failure paths being exercised, and the README says so.
