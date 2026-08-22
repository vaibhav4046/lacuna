# Lacuna production guard

Checked 2026-08-22 around 06:15 UTC against the stable production alias and public repository.

## Release integrity

- Stable alias at audit start: `dpl_Bdod4AG9yLCqiTnESEnxetQvJ4Ch`, product commit `ff4e23cb121bd0d6c2b6f8ee697d515d5cf051f4`, READY, CLI/Codex deployment with `gitDirty=1` metadata.
- Public `main` was eight strict fast-forward commits behind the verified V10 release line. It was advanced without force to `72d0ddbed83f3ece6bb5fa750651d8020f38a21a` after GitHub compare reported `ahead_by=8`, `behind_by=0` and Vercel status `success` for the head.
- `72d0dd...` adds bounded Google callback input/provider-timeout handling and targeted unit regressions on top of the currently served product.
- This audit log commit is documentation-only; its purpose is to preserve the evidence and produce a clean Git-triggered deployment from the public default branch. Production must be smoke-tested again after that deployment becomes READY.

## Live gates reproduced

- HydraDB: `/api/health` HTTP 200, 4/4 checks pass, database `lacuna`, collection `backend`, 102 ms round trip in this run.
- Memory: `/api/explore/memory` reports 174 claims; current, superseded and contradicted states are present together.
- Graph: `/api/explore/graph?mode=overview&limit=5` reports 453 nodes, 682 edges, 0 orphan edges and a signed cursor.
- Hydra-native relations: `/api/explore/relations` HTTP 200, 96 ms.
- Graph-impact proof: `tenant-router` reached 21 candidate relations in 3102 ms; current `token-forge` and `hash-fence` dependencies were accepted, historical `moss-index` and non-structural/non-event relations were refused.
- Surface continuity: recorded Web/CLI/MCP artifact reports six questions, all identical across answer, revision, retraction, contradiction, multi-hop and out-of-scope outcomes. It remains recorded evidence, not a fresh local CLI execution.
- Agents: Researcher and Reviewer are live on `groq/compound-mini`, bounded Context Packs, read-only permissions, `NO_WRITE`. The `pact-check` run completed Researcher→Reviewer and Reviewer rejected two unsupported depth claims. Unknown `package-session` failed `no_known_subject` rather than hallucinating.
- Tools: `lacuna_context_pack` is AVAILABLE, read-only, with explicit input/output schema and no side effects.
- Connectors publicly catalogued as available: GitHub, Markdown, Text, PDF, DOCX, HTTPS API and Webhook. No other connector was promoted to available.
- Official-format LongMemEval adapter: 500 instances, 948 sessions, 10,960 messages, about 3.30M estimated tokens, 0 parse failures, 0 adapter failures, 0 ground-truth leaks, 117 extracted claims across 78/500 instances = 15.6% coverage. No official correctness score is claimed.
- Anonymous session: `signedIn:false`, `Cache-Control: no-store, private`, Secure SameSite CSRF cookie.
- Google OAuth start: real Google origin, exact production callback, only `openid email profile`, PKCE S256, nonce/state and isolated 10-minute HttpOnly/Secure attempt cookie.
- Security headers: HSTS preload, CSP, `frame-ancestors 'none'`, X-Frame-Options DENY, nosniff, strict referrer policy, COOP and `microphone=(self)`.
- Runtime errors: Vercel reported no runtime error clusters in the previous two hours. The inspected current-deployment status counts contained no 5xx responses.
- Targeted tracked-tree searches returned no committed assignment for `ELEVENLABS_API_KEY`, `GOOGLE_CLIENT_SECRET` or `HYDRA_CLOUD_TOKEN`.

## Open acceptance gaps

- Scheduler: daily Context Health definition is enabled for `06:00 UTC`, but the persisted public schedule still reports `lastRunAt: null` and no `/api/cron/agents/daily` invocation was present in Vercel logs as of this audit. Do not claim hosted execution until a real cron invocation is recorded.
- Voice: current release evidence/provider smoke exists, but this audit did not capture a fresh full microphone → STT → Lacuna → TTS → speaker-playback session.
- Private MCP: public ChatGPT MCP evidence exists; fresh workspace capability issue → external use → revoke → expiry and a named Claude/Claude Code production session remain outstanding.
- Browser/mobile: a fresh rendered screenshot/console/network sweep could not run because the configured Firecrawl account returned `Insufficient credits`; paid billing was not enabled. Stored V10 browser matrices remain dated evidence only.
- Release manifest: `artifacts/release/current.json` is stale at SHA `52e505ca...`, 1,251 unit tests and old Voice/recovery/video state. Do not hand-edit it; rerun the exact-SHA release gate and regenerate it from artifacts.

## No unsafe actions

No paid billing was enabled, no legal agreement accepted, no hackathon form submitted, no final video uploaded, no tests weakened, and no secrets were exposed.
