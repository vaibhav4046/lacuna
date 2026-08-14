# Verification, 2026-08-14, second run

Raw output of the gates, kept as the files the commands actually wrote rather
than as numbers copied into prose. The suite logs end with the exit code on its
own line, because a suite that reports a green summary and exits non-zero is a
failure and the summary line alone would hide it. The two command line captures
are JSON documents a reader may want to parse, so their exit codes are in
`cli-exit.txt` rather than appended to the documents.

| File | Command | Result | Exit |
|---|---|---|---|
| `typecheck.txt` | `npm run typecheck` | no diagnostics | 0 |
| `unit.txt` | `npm test` | 36 files, 807 tests, 163.36s | 0 |
| `contract.txt` | `npm run test:contract` | 3 files, 42 tests, 13.35s | 0 |
| `mcp-stdio.txt` | driver over `scripts/mcp.ts --stdio` | 5 responses: initialize, tools/list, two `lacuna_ask`, `lacuna_health` | 0 |
| `cli-ask.json` | `node bin/lacuna.js ask Bellwether beta_partner --json` | answered `Halverd`, 4 reads, 331 ms | 0 |
| `cli-abstain.json` | `node bin/lacuna.js ask Meridian migration_window --json` | abstained `never_stated`, 3 reads, 125.4 ms | 0 |
| `parity.txt` | `npm run parity` | 2 cases, both identical across the two surfaces | 0 |

All of these were run against commit
`e33afc574b05aab12b7d04f1899a42f5d33e2144` with the working tree carrying the
uncommitted cross-surface result contract in `src/contract/`, the two surfaces
rewritten onto it, and the ledger changes of that day. The numbers here describe
that tree, not the commit alone.

`unit.txt` prints handled errors to stderr partway through. Those are asserted
negative paths: a 403 from a namespace the token cannot read, a refused
connection, an entity name that matches two nodes. A run without them would mean
the negative paths stopped being exercised.

`contract.txt` was run with a live HydraDB node on loopback `:18443`, started by
[`scripts/hydra-node.sh`](../../../scripts/hydra-node.sh). The contract suite
skips rather than fails when no node answers, so the count above is only
meaningful next to the fact that the node was up: 42 tests ran, none skipped.

The driver behind `mcp-stdio.txt` was a throwaway script outside the repository,
written to speak plain JSON-RPC at the server with nothing of Lacuna's own code
in the client half. It is not kept, so that row is a record rather than a
command a reader can repeat. The repeatable version of the same exercise is
`npm run parity`, which spawns the same server over the same transport and is in
the tree.

`mcp-stdio.txt`, `cli-ask.json`, `cli-abstain.json` and `typecheck.txt` were
captured after the result contract landed and describe what the code emits now.
The MCP transcript and both command line captures report read epoch `6459` and
`sourceState` `live`, so the three of them describe one state of one store
rather than three separate windows. Their `cli-ask.stderr` and
`cli-abstain.stderr` companions are empty, which is the whole of what the
command line wrote outside the JSON.

`parity.txt` prints the read order of each surface beside a verdict of
`IDENTICAL: True`, and in the abstained case the two orders differ. That is not
a contradiction. The reads a question needs are independent and are issued
together, so they land in the trace in the order the node happened to answer
them, and that order moves between two runs of the same command on one surface.
The comparison is over the set of reads, their parameters and their row counts,
which do not move, along with the status, answer, reason code, claim id,
superseded claims, evidence, evidence total and source state. The order is
printed rather than dropped so the exclusion is visible instead of hidden by the
check that excludes it.

No file in this directory contains a bearer token. A scan of all of them for
`Bearer`, `HYDRA_TOKEN`, `authorization` and the loopback address returns
nothing. The suites print the base URL and the namespace and never the
credential, and the MCP and command line payloads carry query text and query
parameters, which are entity names and node ids, and no configuration.
