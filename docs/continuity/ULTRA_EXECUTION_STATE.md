# Execution state

Status: `ACTIVE`
Commit: `933dc2a`
Production: https://lacuna-five.vercel.app (verified, health live against HydraDB Cloud)
Preview: https://lacuna-j2a378v60-vaibhav4046s-projects.vercel.app (public, 200)
Rollback tag: `rollback-pre-v6-react-cutover` at `6c5d9e8`

## Green this session

| Gate | Result | Command |
| --- | --- | --- |
| typecheck | exit 0 | `npx tsc --noEmit` |
| unit | 936 of 936, 42 files | `npx vitest run tests/unit` |
| contract | 77 of 77, 4 files | `npx vitest run tests/contract` |
| census | graph matches the plan exactly | `npm run census` |
| parity, 3 surfaces, 64 questions | `ALL_IDENTICAL: True` | `npm run parity` |
| web smoke, local | 9 of 9 | `npm run smoke:web` |
| web smoke, production | 9 of 9 | `npm run smoke:web -- https://lacuna-five.vercel.app` |
| production browser | 0 console errors, 28 scenes, canvas painting | Playwright |

The MCP stdio parity defect named in the directive does not reproduce. The
assertion that produces that message is `scripts/parity.ts:124` and it is
unchanged.

## The finding that matters most

**HydraDB Cloud is a different API from the node this product was built
against, and the difference is not a configuration value.**

The proven core speaks Cypher over a self-hosted graph node:

    POST {HYDRA_HTTP_URL}/v1/graphs/{graph}/query
    { cell_id, query, query_id, parameters }   → tagged value rows

HydraDB Cloud, at `https://api.hydradb.com`, API version 2.0.1, is a REST
application API:

    POST /databases              provision a database
    GET  /databases/status       poll until infra.ready_for_ingestion
    POST /context/ingest         type "knowledge" or "memory"
    GET  /context/status         poll until indexing completes
    POST /query                  type "knowledge" | "memory" | "all"
    GET  /context/relations      graph relations
    POST /feedback

Thirty-one paths, none of them Cypher. `src/hydra/client.ts` cannot talk to it,
and pointing `HYDRA_HTTP_URL` at the cloud host would fail on the first
request rather than work differently.

## What is already done against the cloud

The operator's key authenticates. Probed directly:

    GET /databases/status  →  400 INVALID_INPUT "database is required"

A validation error rather than a 401, which is the proof the bearer token was
accepted and the request reached the application layer. Round trip 40.8ms.

Then:

    POST /databases {"database":"lacuna"}  →  200 accepted, tenant_id lacuna
    GET  /databases/status?database=lacuna →  200

Current provisioning state:

    graph_status                true
    vectorstore_status.knowledge true
    vectorstore_status.memories  false
    scheduler_status             false
    ready_for_ingestion          false

So the database exists and is still coming up. Ingestion cannot start until
`ready_for_ingestion` is true.

## Done since that finding

The cloud adapter exists and is exercised against the live service.

`src/hydra/cloud.ts` covers provision, readiness, ingest, status, query and
relations, on the node client's contract: timeout per call, cancellable
AbortSignal, the existing typed errors, measured latency, and never the token
or a response body inside an error.

Measured against the running service:

    readyForIngestion   true
    query               2986ms, 1 chunk, score 0.629
    graph_context       present
    temporal_facts      present
    relations           4

The deployed health check is live. `GET /api/health` on production returns
`ok: true` with four passing checks and `api.hydradb.com answered in 206ms`,
in the doctor's own shape so no screen needed changing.

Two traps, both mine, both now encoded in the adapter:

- `/context/status` is scoped by collection. Omitting it returns
  FILE_NOT_FOUND for a source that ingested successfully.
- The chunk text field is `chunk_content`. Reading `content` or `text` gives an
  empty string for a chunk the service delivered in full, which presents as an
  empty retrieval rather than a wrong field name.

## The one thing still missing

`ask()` still reads the self-hosted node. On the deployed URL health is live
but Ask is not: the four envelope states, the 174 claims and the computed
blast radius all still run locally against the WSL node.

This is not a small task and should not be estimated as one. It is a second
retrieval implementation against a different data model — chunks and graph
paths rather than Cypher rows — and it needs its own tests and its own parity
run before it can be trusted. Budget a fresh session for it.

Shape of the work:

1. `HydraSource` interface expressing what the resolver actually needs from a
   store: subject lookup, claims for a subject and predicate, evidence spans,
   graph neighbours. Both the node client and `HydraCloud` implement it.
2. `ask()` takes a `HydraSource` rather than a `HydraClient`. Nothing above it
   changes: the temporal resolver, contradiction policy, evidence gate and
   Context Pack compiler consume claims, not transport.
3. Ingest the generated corpus through `POST /context/ingest` and poll
   `/context/status` with the collection.
4. Run the 64-question parity sweep against the cloud surface. It must stay
   `ALL_IDENTICAL`.
5. Redeploy and re-verify.

## Exact next command

    set -a && . ./.env.deploy && set +a
    curl -s -H "Authorization: Bearer $HYDRA_TOKEN" \
      "https://api.hydradb.com/databases/status?database=lacuna"

When `ready_for_ingestion` is true, the next task is a cloud adapter:

1. `src/hydra/cloud.ts` — one client for the six endpoints the product needs:
   ingest, status, query, relations, inspect, list. Same timeout, abort,
   typed-error and latency-measurement contract as the node client.
2. A `HydraSource` seam so `ask()` can read from either the node or the cloud
   without a second copy of the resolver. The temporal, contradiction,
   abstention and Context Pack layers do not change: they consume claims, not
   transport.
3. Ingest the generated corpus through `POST /context/ingest`, poll
   `/context/status`, then run the same 64-question parity sweep against the
   cloud surface.
4. Push `HYDRA_*` to Vercel with `bash scripts/push-env.sh` and redeploy.

Nothing about the frontend, the answer envelope, or the release gates changes.

## Deliberately not done

- Preview deployments are behind Vercel SSO. Production is public, so
  verification ran there. Turning preview protection off is one toggle in the
  project settings.
- Accounts on Vercel are per-instance: only `/tmp` is writable and it does not
  survive between invocations. Durable accounts need Postgres.
- No credentials were harvested from any account. The one key in use was
  supplied directly and lives only in `.env.deploy`, which is gitignored.
