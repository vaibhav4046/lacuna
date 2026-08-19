# Judge scorecard

Scored against the five published Hack Hydra dimensions by a read-only pass
over the repository, the deployment and the artifacts. These are this project's
own scores, not the judges'. They exist to find the weakest dimension and fix
it, so the low ones are the useful ones.

Last run: 2026-08-19, at the commit tagged in `RELEASE_GATE.md`.

## Technical execution — 8/10

**Evidence.** Answering over 117,041 tokens of history costs the same 18.27
context tokens it costs over 16,994, measured at five sizes with the claim set
held constant, 64 of 64 correct at every one. 1,152 unit tests, 77 contract
tests against a live node, a
64-question sweep across three surfaces (`ALL_IDENTICAL: True`), a 64-question
sweep across two stores (`ALL_IDENTICAL: true`), and a three-client check
against production (`ONE_CONTEXT_IDENTICAL: true`). Ground truth is physically
separated from the runtime and there is a test that fails if the runtime ever
imports it.

**Why not higher.** The blast walk is bounded by depth rather than by a measured
budget, and there is no run object to hold a budget on: roughly a fifth of the
harness the plan describes exists, counted in
[docs/HARNESS_CONFORMANCE_MATRIX.md](docs/HARNESS_CONFORMANCE_MATRIX.md). Voice
is not implemented. One model provider is configured on the deployment and six
models report CONNECTED with a measured latency; nothing on the answer path
needs any of them, which is the point of the design.

This entry has now been wrong twice in opposite directions, which is worth
recording rather than tidying away. It first claimed one provider was
configured when the deployment had none. Adding the key made that sentence true
and made its replacement, which said there were none, false within the hour. A
scorecard that describes a moving deployment goes stale faster than the code
does.

**Smallest high-leverage fix.** Done, and it is no longer the weakest point
here: `npm run soak` puts 400 requests at concurrency 12 through the deployed
endpoint and compares every answer to the same question asked alone. 26.3 a
second, p95 805ms, zero failures, no answer changed. Recorded in
[artifacts/soak/soak.json](artifacts/soak/soak.json). What is still missing is
evidence about two writers rather than two readers.

## Use of HydraDB and graph-native approaches — 8/10

**Evidence.** HydraDB Cloud is the production substrate: 159 records, ingest
and read-back verified byte for byte, and every deployed answer reads it. The
claim graph is a real graph — `ABOUT`, `MENTIONS`, `SUPERSEDES`, `CONTRADICTS`,
`SUPPORTS`, `HAS_SPAN`, `CONTAINS` — and the blast radius is a traversal
computed at request time, not a precomputed list. The self-hosted node runs the
same graph in Cypher, and the two agree question for question.

**Why not higher.** The cloud path addresses records by id rather than
traversing server-side, because the cloud API is a document API; the traversal
happens in the product. That is the honest architecture for that API and it is
still less graph-native than the Cypher path. `/context/relations` is now read
and rendered, but it is a panel on one screen rather than something an answer
depends on, and `graph_context` on the query endpoint is still not load-bearing.

**Smallest high-leverage fix.** Done: the HydraDB screen reads
`/context/relations` and shows the 47 relations the store extracted from the
transcripts itself, each with its predicate, its confidence and the sentence it
came from. That matters because it separates the two graphs honestly. Lacuna's
claim graph is built from structured annotations at ingest, and the store's is
extracted from prose, so the screen shows what HydraDB contributes rather than
implying the product did all of it. The next step, not taken today, would be to
let a `graph_context` query participate in an answer.

## Product completeness and usability — 8/10

**Evidence.** Eighteen application routes plus four public paths, every one of
them opened in a real browser at nine viewports and again with reduced motion,
198 checks in each pass with no console error and nothing scrolling sideways
([artifacts/route-audit/routes.json](artifacts/route-audit/routes.json)). The
figure here used to read twenty-six, which no artifact supported. Sign up,
onboarding, workspace
persistence, sign out and sign back in all verified against production
(`12 of 12`). A new account gets an empty workspace, not seeded data. `/judge`
answers six questions live with no account. Every screen that has nothing to
show says so in its own words rather than rendering a placeholder as a value.

**Why not higher.** No Google sign-in. No connector actually syncs. Voice
reports itself unconfigured. Agents and Tools are honest empty states rather
than working surfaces.

**Smallest high-leverage fix.** One real connector — file ingest through the
web, writing to the same workspace.

## Quality of results — 9/10

**Evidence.** 64 of 64 gold questions, against five retrieval baselines whose
best reaches 63 while spending 1843 context tokens to Lacuna's 18. Every number
maps to `artifacts/bench/results.json`. Abstention is structural: no model is
asked when the evidence gate refuses, so a plausible guess cannot overwrite a
refusal.

**Why not higher.** The corpus is generated by this project, so the comparison
is fair between systems but is not a public benchmark. A LongMemEval-style run
would be stronger evidence and is not here.

**Smallest high-leverage fix.** Say this limitation plainly in the README next
to the numbers, which it now does.

## Originality — 8/10

**Evidence.** The thesis is not "remember more" but "govern what the next agent
should believe": bitemporal claims, supersession that preserves history,
contradiction kept rather than resolved, premise checking, and structured
abstention with reason codes. One governed core answers the web, the CLI and
MCP, proven identical against production rather than asserted.

**Why not higher.** Persistent agent memory on a graph is the track's own
premise, so several entries share the shape. What is unusual here is the
refusal to answer and the two-store parity, and those are easy for a judge to
miss in three minutes.

**Smallest high-leverage fix.** Lead the video and the README with the
abstention and the contradiction, which they now do.

## The weakest dimension

Product completeness. The fix with the best ratio of judge-visible value to
risk is one working connector; the fix with the worst is voice.

## What would make this fail

- A cross-tenant read. Tested, and the workspace scope is server-side.
- A fabricated number. Every published figure has an artifact behind it.
- A store that is down at judging time. HydraDB Cloud is a managed service and
  the deployment reports its health honestly rather than pretending.
