# Verification, 2026-08-24

Retaken because the connector surface grew from eight to thirteen: Slack on
2026-08-24, then Notion, Jira, Confluence and Gmail as reviewed per-request-
credential reads behind one shared route. The 2026-08-19 numbers no longer
described what runs, and `release-manifest.ts` reads its counts from here.

The local node had been lost with `/tmp` on a WSL restart and was healed by
`npm run node:heal` immediately before this run: `scripts/hydra-node.sh heal`
restarts the pinned v0.1.1 `graph-node`, then `npm run ingest` rewrites the
seed `lacuna-demo-v1` corpus at 72 sessions fresh rather than accumulated.
`census.txt` is the check on that: it reads every stored key back and names
anything the plan did not write.

| File | Command | Result | Exit |
|---|---|---|---|
| `unit.txt` | `npx vitest run tests/unit` | 2361 passed, 124 files | 0 |
| `contract.txt` | `npx vitest run tests/contract` | 77 passed, 4 files | 0 |
| `typecheck.txt` | `npx tsc --noEmit` | no output | 0 |
| `census.txt` | `npm run census` | graph matches the plan exactly | 0 |

The unit suite under parallel scheduling can intermittently lose a worker to
the documented vitest fork teardown flake; the run recorded here is a complete
pass. The contract suite reaches the live local node over stdio and HTTP and
is never skipped when the node is unreachable, which is how this retake caught
the dead node in the first place.
