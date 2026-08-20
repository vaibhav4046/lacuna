# Credential rotation checklist

Names only. No value, no prefix and no last characters of any secret appear in
this file, and none may be added to it.

Everything below was read from variable names in gitignored files and from
`vercel env ls production`, which prints names and the word Encrypted. The
availability column is the result of a live call where one was possible, made
without printing the key.

Last inventory: 2026-08-19.

## What exists

| Credential | Where it lives | Availability | Used by |
| --- | --- | --- | --- |
| `HYDRA_CLOUD_URL`, `HYDRA_CLOUD_TOKEN`, `HYDRA_DATABASE`, `HYDRA_COLLECTION` | `.env.cloud`, gitignored | AVAILABLE, `/api/health` reports a round trip to the managed service | every deployed answer, `npm run parity:cloud`, `npm run continuity`, `npm run proof`, the cloud CLI and MCP profiles |
| `HYDRA_HTTP_URL`, `HYDRA_TOKEN`, `HYDRA_NAMESPACE`, `HYDRA_GRAPH`, `HYDRA_CELL` | `.env.local`, gitignored | AVAILABLE, the node answers `/readyz` | the self-hosted node profile, the contract suite, the benchmark |
| `HYDRA_TOKEN`, `HYDRA_HTTP_URL`, `HYDRA_DATABASE`, `HYDRA_COLLECTION` | Vercel, Production environment | AVAILABLE, encrypted at rest | the deployed function |
| `LACUNA_ACCOUNTS_DIR`, `LACUNA_SECURE_COOKIES` | Vercel, Production environment | AVAILABLE | durable accounts |
| `GROQ_API_KEY` | `.env.local`, `.env.deploy` | AVAILABLE, the provider answered 200 | the model router, one real provider |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | historical local/deploy files, if still present | NOT INSTALLED on Vercel Production | final narration and product voice remain blocked until the owner supplies and later rotates the server-only values |
| `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` | `.env.deploy` | present, not exercised this run | optional model providers in the router |
| GitHub | `gh` keyring | AVAILABLE, signed in | pushing this repository |
| Vercel | CLI session | AVAILABLE, signed in | preview and production deployments |

## What is missing, and what it blocks

| Credential | State | What it blocks |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | AVAILABLE on Vercel Production | The local provider-bound candidate passes OAuth HTTP/security tests. Production must be redeployed and reverified with a fresh identity; legacy unbound records fail closed. |
| Supabase project URL and keys | MISSING | Nothing today. Accounts are durable in HydraDB Cloud already, so the Supabase path described in the earlier plan is not on the critical path and starting it now would replace a working, tested auth store with an untested one. |
| A connector credential of any kind | MISSING | One real connector syncing. The Connectors screen reports the honest empty state. |

## One secret to rotate, and why

The first client secret was shown in a console dialog that was captured while
this was being set up, which put it in a transcript. It was replaced the same
hour: a second secret was added on the client, verified against Google's token
endpoint before being stored, and the deployment now uses it.

**The first secret is still enabled on the client and should be deleted.** Open
the client, find the secret ending `ERa7`, disable it, confirm sign in still
works, then delete it. It is not the one in use, so removing it changes nothing
that is running.

The lesson is recorded rather than the incident: a secret that is only ever
shown on screen cannot be handled without being seen. The reliable path is the
clipboard into `printf '%s' | vercel env add`, never a screenshot and never a
PowerShell pipe, which appends a newline and produced an `invalid_client` that
looked like a wrong key.

## Deployment environments

Preview deployments carry none of the HydraDB variables, which live on the
Production environment only. That is why `npm run smoke:demo` scores 21 of 30
against a preview and 30 of 30 against production: a preview has no context
store and says so through `/api/health`. This is a scope decision rather than a
defect, and it is recorded here so the difference is never read as a regression.

## Stale, and removed from the templates

`LACUNA_SESSION_SECRET` appears in `.env.deploy` and `.env.deploy.example` and
in no source file in the repository. It is a leftover from a signed cookie
design that was replaced: a session is now an opaque 32 byte random token,
stored server side as a SHA-256 digest, so there is no secret to sign with and
nothing to rotate. It is absent from the Vercel environment, which is why
authentication passes without it. A variable that implies a secret nobody holds
is worse than no variable, because the next person to read the template will go
looking for it.

## If a key is believed exposed

1. Rotate at the provider first, not in the repository. A key that is still
   valid while the file is being edited is still exposed.
2. Replace the value in the gitignored file, then in the Vercel environment for
   Production, then redeploy. The order matters: a deployment carrying the old
   value outlives the local edit.
3. Rerun the gate that exercises it. For HydraDB that is
   `npm run parity:cloud` and `npm run continuity`; for the deployment it is
   `npm run smoke:auth -- https://lacuna-five.vercel.app`.
4. Check the artifacts. `artifacts/` is committed, so a key that reached a
   recorded transcript is in the git history and rotating is not optional.
   The scan for that is in the security section of `docs/JUDGE_PANEL.md`.

## Rules that produced this file

No raw key enters a task file, a subagent prompt, git, a HydraDB memory, a
Context Pack, a trace, a screenshot, the demo film, a social asset, a document
or a log. The recorded CLI session in `artifacts/cli/session.txt` was checked
against this rule: it prints the store description, which names a database and a
collection, and never a URL or a token.
