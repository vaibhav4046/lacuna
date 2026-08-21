# V10 final claim-to-evidence map

This is the compact evidence map for the protected Hack Hydra release. The
canonical release identity and exact public probes are in
[`artifacts/submission/v10-exact-release-probe.json`](../artifacts/submission/v10-exact-release-probe.json).
Historical V8 documents and later local patches do not inherit that gate.

## Evidence precedence

1. The immutable deployment and product commit in the exact release probe.
2. Fresh public responses recorded in that probe.
3. [V10_RELEASE_STATUS.md](V10_RELEASE_STATUS.md) for the accepted test matrix.
4. Named raw artifacts below, each within its recorded dataset/build scope.
5. Historical audits only as history, never as current-release proof.

## Claims allowed in the form and film

| Claim | Evidence | Exact scope or caveat |
| --- | --- | --- |
| Product and judge links are public | exact release probe | Stable root, judge path, immutable root and repository returned HTTP 200. |
| Repository meets the inspectability boundary | git history; `README.md`; `LICENSE`; `THIRD_PARTY.md`; `docs/SOURCE_LOG.md` | Earliest participant-authored commit is dated 2026-08-12; setup, HydraDB use, dependencies, licensing and attribution are present. This is repository evidence, not an organizer eligibility ruling. |
| Accepted product identity | exact release probe; `V10_RELEASE_STATUS.md` | Product commit `a3c6a6c…`; baseline acceptance docs and public `main` at probe time `695b55e…`; immutable deployment `dpl_CTX86…`. |
| HydraDB Cloud is reachable | exact release probe | Four health checks passed with zero warnings on the immutable URL. This proves the public Cloud profile, not self-hosted Cypher. |
| Public graph contains 453 nodes and 682 edges | exact release probe | Count belongs to the generated public workspace at probe time; zero orphan edges. It is not a general scale claim. |
| Public MCP has seven read-only tools | exact release probe | `lacuna_ask`, `lacuna_explain`, `lacuna_timeline`, `lacuna_read_question`, `search`, `fetch`, `lacuna_health`; no write tool. |
| Anonymous public agent creation is disabled | exact release probe | Both `/api/explore/agent/run` and `/api/demo/agent/run` returned HTTP 403. Existing public run records remain readable. |
| Two built-in roles exist | exact release probe | Researcher and Reviewer have no write permission. Do not call this an arbitrary agent builder. |
| Release test gate passed | current release transcript; `V10_RELEASE_STATUS.md` | Hardened tree: 84 unit files / 1,380 tests, typecheck and production build. Exact stable and immutable deployment: web 9/9 and demo/API 30/30; stable Google boundary 15/15. The earlier 198/198 normal plus 198/198 reduced-motion audit remains visual-route evidence for the unchanged product UI. |
| 72 sessions, 5,246 messages, 174 claims and 86 entities | `artifacts/bench/results.json` | Fixed-seed generated corpus `lacuna-demo-v1`; about 117,041 estimated input tokens. |
| 159 Cloud records accepted and indexed | `artifacts/hydra/cloud-ingest.json` | 72 source records, 86 addressed entity records and one index; collection `backend`; 159/159 accepted, zero refused. |
| Cloud and self-hosted answers matched 64/64 | `artifacts/hydra/cloud-parity.json` | Field-for-field parity on the generated 64-question set; not proof of every workload. |
| Generated evaluation scored 64/64 | `artifacts/bench/results.json` | Zero false answers; 18.27 mean estimated Context Pack tokens; p50 193.15 ms and p95 378.59 ms. Generated, not LongMemEval. |
| Strongest tested flat retrieval scored 63/64 | `artifacts/bench/results.json` | `hybrid+2hop@50 +conflict`, 1,842.57 mean estimated context tokens. It was faster; do not suppress that tradeoff. |
| Web, CLI and stdio MCP returned identical envelopes | `artifacts/continuity/one-context.json` | Six generated questions across those three Lacuna surfaces. This is not ChatGPT or Claude continuity. |
| ChatGPT used the public connector | `artifacts/verification/2026-08-21-v10/chatgpt-public-connector.json` | Seven public tools were accepted on the immediately preceding V10 deployment. The artifact is contract proof, not a rerun from the final immutable deployment and not private-memory proof. |
| Google OAuth security boundary passed | `artifacts/verification/2026-08-21-v10/google-auth-boundary.txt` | 15/15 through the real account chooser. Human identity selection and fresh callback were intentionally not completed. |
| A bounded conflict-review run completed | `artifacts/verification/2026-08-21-v10/agent-conflict-run.json` | Immediately preceding V10 deployment; two conflicting values reached the Context Pack, Reviewer approved zero unsupported claims, no authoritative writeback. The exact release probe separately proves the final deployment exposes the two no-write roles and readable run records. |
| Native Cypher exists | `src/hydra/node-source.ts`; `artifacts/cypher-probe/` | Genuine self-hosted HydraDB v0.1.1 path with 162 compatibility probes. It is separate from the production Cloud answer path. |

## HydraDB division of labour

Production writes source and addressed claim-graph records to a
collection-scoped HydraDB Cloud store and fetches deterministic records for the
answer path. HydraDB query and relations endpoints separately expose semantic
and graph context. Lacuna application code performs temporal standing,
supersession, contradiction, abstention and bounded relationship resolution
after the fetch.

The self-hosted adapter stores graph nodes/edges and executes bounded native
Cypher. It is valid HydraDB Open Source proof, but narration must never imply
that production Cloud executes that Cypher path.

## Claims blocked unless new evidence is added

| Blocked claim | Current truth |
| --- | --- |
| Exact 399-character `package-session` workflow | `NOT_PROVEN`; subject absent, request exceeds the 300-character sentence contract, and Web/CLI/MCP expose no general blast command. See `artifacts/verification/2026-08-21-v10/package-session-proof-audit.json`. |
| Native external connectors | Only Text and Custom ingestion are available. Other catalogued connectors are planned; Spotify is absent. |
| Private ChatGPT memory write | Legacy capability fails closed; remint/use/revoke proof is absent. Public read-only ChatGPT proof is separate. |
| Claude continuity | No accepted Claude-to-Lacuna run exists. |
| Packaged Lacuna SDK | None is published; the official MCP SDK is used internally. |
| Production voice round trip | Provider-backed STT → query → TTS → playback/interruption was not accepted. Film narration is not product voice proof. |
| Completed Google sign-in | Security boundary reached the chooser; human selection/fresh callback remains incomplete. |
| Exactly-once hosted schedule | Definitions persist, but there is no distributed compare-and-swap guarantee. |
| Official LongMemEval score | None exists. The committed evaluation is generated. |
| General 453/682 scale claim | Counts belong only to the generated public workspace on the accepted deployment. |

## Film acceptance boundary

The V10 machine-accepted master is recorded in
`artifacts/video/v10-final-metadata.json`: SHA-256, byte length, 178.500-second
duration, 1920×1080/30 fps H.264, AAC stereo audio, full decode, audio levels,
45-cue caption/SRT timing, sampled rendered frames and exact source release.
The existing `artifacts/video/final-metadata.json` remains historical V8 media.
The owner's uninterrupted watch, clone-publication confirmation, upload and
signed-out playback remain owner actions.

## Secret boundary

No evidence used here requires a bearer token, OAuth code, session cookie,
provider identifier, email address, voice asset or local browser profile. The
exact-release probe contains public status and aggregate response fields only.
