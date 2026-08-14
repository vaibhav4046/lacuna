# Verification, 2026-08-14

Raw output of the gates, kept as the files the commands actually wrote rather
than as numbers copied into prose. Each file ends with the exit code on its own
line, because a suite that reports a green summary and exits non-zero is a
failure and the summary line alone would hide it.

| File | Command | Result | Exit |
|---|---|---|---|
| `unit.txt` | `npm test` | 32 files, 712 tests, 13.81s | 0 |
| `contract.txt` | `npm run test:contract` | 3 files, 42 tests, 13.03s | 0 |

Both were run against commit `e33afc574b05aab12b7d04f1899a42f5d33e2144` with the
working tree carrying the uncommitted design and ledger changes of that day.

`unit.txt` prints handled errors to stderr partway through. Those are asserted
negative paths: a 403 from a namespace the token cannot read, a refused
connection, an entity name that matches two nodes. A run without them would mean
the negative paths stopped being exercised.

`contract.txt` was run with a live HydraDB node on loopback `:18443`, started by
[`scripts/hydra-node.sh`](../../../scripts/hydra-node.sh). The contract suite
skips rather than fails when no node answers, so the count above is only
meaningful next to the fact that the node was up: 42 tests ran, none skipped.

No file in this directory contains a bearer token. The suites print the base URL
and the namespace and never the credential.
