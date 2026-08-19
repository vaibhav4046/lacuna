# Architecture, as built

What the code actually does, read off the files rather than off the plan.

The intended shape was: clients on top, one service contract under them, a
context kernel that decides, a source seam under that, and HydraDB at the
bottom. Most of that is what is there. The places where it is not are named in
[Where the code differs](#where-the-code-differs) rather than smoothed over,
because a diagram that disagrees with the source is worse than no diagram.

Every path below is a file in this repository. Read it if a sentence here looks
generous.

## The flow

```
CLIENTS
  web/src/                     React application, 18 routes. This is production.
  src/server/ + src/view/      the older HTML page server. Local only,
                               reached by npm run serve on :3014.
  bin/lacuna.js -> src/cli/    command line
  scripts/mcp.ts -> src/mcp/   MCP, stdio and HTTP

TRANSPORT AND ENVELOPE
  src/api/router.ts            the JSON surface the React app talks to
  src/api/workspace.ts         AnswerEnvelope, the web's answer shape
  src/mcp/server.ts            four tools, one implementation
  src/mcp/result.ts            AskResult, ExplainResult, TimelineResult
  src/cli/question.ts          one path for ask, explain and timeline
         |                              |                        |
         +--------------+---------------+------------+-----------+
                        |                            |
              src/contract/result.ts        (the HTML pages skip this
              AskCore, the one shared        and render Answer directly
              projection of an Answer        through src/view/*)
                        |
KERNEL  src/retrieval/
  question.ts    parse the sentence into subject, predicate, via, blast
  fetch.ts       gather what the question needs, record every read
  resolve.ts     decide: answer, or abstain with one of five reasons
  blast.ts       dependency closure for "which services are affected"
                        |
SEAM    src/hydra/source.ts     interface HydraSource: entity, subject,
                                evidence, dependents. Four reads, nothing else.
        src/hydra/open.ts       picks the profile once, in one place
                        |
          +-------------+--------------+
          |                            |
  src/hydra/node-source.ts     src/hydra/cloud-source.ts
  Cypher over HTTP             records addressed by id
  src/hydra/queries.ts         src/hydra/cloud-graph.ts
  src/retrieval/queries.ts
          |                            |
  HydraDB node (loopback)      HydraDB Cloud (api.hydradb.com)
          |
  src/snapshot/replay.ts       a FetchLike under HydraClient that answers
                               recorded wire responses. Not a second resolver.
```

Nothing above the seam knows which store answered. `src/retrieval/fetch.ts`
takes a `HydraSource` and never asks what kind it is. `HydraSource.kind` exists
and is reported on screens, and the comment on it in `src/hydra/source.ts` says
what the code does: it is never used to change a result.

## Where the code differs

Five places where the intended shape and the source do not line up. All five
are visible in the files, none of them is a defect that breaks a gate, and
each one is a thing a reader would otherwise find on their own.

**There is no Context Pack compiler.** The landing copy, the developer screen
and two source comments (`src/hydra/source.ts`, `src/hydra/cloud.ts`) refer to
one. No module compiles a pack. `context_pack_id` is produced in
`src/api/workspace.ts` as the string `pack-${claimId}` when an answer is
returned, and null otherwise. The developer screen already prints `CONTRACT
SHOWN AS DESIGNED · THE IMPLEMENTED API IS THE SOURCE OF TRUTH` next to the
envelope it draws, which is the honest label, but the two source comments name
a component that does not exist.

**There is no evidence gate module.** What plays that role is two things in
different files: `citedClaims` in `src/retrieval/resolve.ts` decides which
claims deserve a citation, including for four of the five abstentions, and
`MAX_EVIDENCE_ITEMS` in `src/contract/result.ts` caps the list at 50 with
`evidenceTotal` carrying the real count. That is a policy, not a layer.

**Two of the four clients bypass `openSource`.** The seam is decided in one
place for the CLI (`src/cli/question.ts`), the MCP server (`scripts/mcp.ts`)
and the continuity script (`scripts/continuity.ts`). The two servers construct
a source directly instead: `scripts/serve.ts` builds `new NodeSource(new
HydraClient(config))`, and `api/index.ts` builds `new CloudSource(cloud)`.
Both land on the same interface, so nothing above them can tell, but the
sentence in `src/hydra/open.ts` about which store a client reads being
"decided once, in one place" is true for three callers out of five.

**The snapshot fallthrough in `api/index.ts` is not reached in production.**
The rewrites in `vercel.json` send `/api/(.*)` to the function and everything
else to `index.html`, so the function only ever sees a path starting with
`/api/`, and `ApiRouter.handle` returns handled for every one of those,
including its own 404. Both calls to `snapshot(request, response)` in
`api/index.ts` are therefore dead on the deployment. The recorded snapshot is
still a live surface elsewhere: `npm run serve:snapshot` serves it with no
database and no token, and `npm run snapshot:verify` replays all 64 gold
questions through it.

**Scope is not a kernel stage.** The intended kernel began with scope. In the
code, scope is a client concern: `web/src/api/scope.tsx` picks `/api/demo` or
`/api/workspace` for a subtree, and `src/api/router.ts` decides that a
signed-in session reaches the ingested corpus only when its workspace is the
one named `DEMO_WORKSPACE`. The kernel itself has no workspace parameter. One
store holds one corpus, and every question reads all of it.

## Canonical contracts

| Contract | Type names | Owner |
|---|---|---|
| Answer envelope, machine clients | `AskCore`, `EvidenceItem`, `QueryItem`, `RevisionItem` | `src/contract/result.ts` |
| The same, plus which node answered | `AskResult`, `ExplainResult`, `TimelineResult`, `HydraIdentity` | `src/mcp/result.ts` |
| Answer envelope, web and REST | `AnswerEnvelope`, `AnswerStatus`, `EnvelopeEvidence` | `src/api/workspace.ts` |
| Resolved answer, internal | `Answer`, `Resolution`, `Outcome`, `ClaimRecord`, `EvidenceRecord`, `Mention`, `SubjectView`, `QueryTrace` | `src/retrieval/types.ts` |
| Abstention vocabulary, five reasons | `AbstentionReason`, `ABSTENTION_REASONS` | `src/model/abstention.ts` |
| Claim state vocabulary, four states | `ClaimState`, `CLAIM_STATES`, `STATE_MEANINGS` | `src/report/inventory.ts` |
| Capability and data state, five each | `CapabilityState`, `DataState` | `src/model/capability.ts` |
| The HydraDB source interface | `HydraSource`, `Read<T>` | `src/hydra/source.ts` |
| Which store a process reads | `Profile`, `OpenedSource`, `openSource` | `src/hydra/open.ts` |
| Cypher the node actually executes | `PreparedQuery`, `VertexUpsert` | `src/hydra/queries.ts` |
| The read shapes retrieval uses | `entityByName`, `claimsAbout`, `mentionsFrom`, `evidenceForClaim`, `dependentsOf` | `src/retrieval/queries.ts` |
| Cloud record layout | `EntityRecord`, `IndexRecord` | `src/hydra/cloud-graph.ts` |
| Account and session records | `Accounts`, `Account`, `SessionRecord` | `src/auth/accounts.ts`, `src/auth/store.ts` |
| The 18 app routes | `TITLES`, `RouteKey`, `NAV_GROUPS` | `web/src/app/routes.ts` |
| Which workspace a screen reads | `Scope` | `web/src/api/scope.tsx` |

Two answer envelopes exist, and they are not siblings. `AnswerEnvelope` is
built from `askCore`, in `askEnvelope`, so the web shape is a projection of the
shared one rather than a second mapping. The mapping is narrow and it loses
things: an abstention keeps its reason code but the resolver's trace and the
per-read costs do not cross into the web envelope, and evidence collapses to a
session title, a role, a timestamp and a standing.

`AnswerStatus` carries `PARTIAL`, which the resolver cannot produce. The
comment above the type says so.

## What each store owns

**HydraDB owns the context.** Sessions, messages, evidence spans, claims,
entities, and the edges between them: `ABOUT`, `SUPPORTS`, `MENTIONS`,
`SUPERSEDES`, `CONTRADICTS`. Both profiles hold the same corpus in a different
shape. The node holds it as a labelled property graph read with Cypher. The
cloud holds it as one record per entity plus an index record, addressed by a
derived id, which is why a question costs one cloud fetch against the node's
three.

**The operational store owns accounts and sessions, and nothing else.** Email,
argon2id password hash, created-at, workspace name, onboarded flag, and session
records keyed by a token hash. It has two implementations behind one interface
in `src/auth/accounts.ts`. Locally it is a directory of append-only JSON lines
(`FileAccounts` over `src/auth/store.ts`). In production it is HydraDB Cloud
again, but in its own collection, `accounts`, apart from the context collection
(`CloudAccounts`, default collection `accounts`).

The reason accounts are kept out of the context graph is written into
`src/auth/store.ts` and it is two reasons. `npm run census` asserts the exact
vertex and edge count of the graph against the ingest plan, so an account
written into the same cell would fail that gate on the first sign up. And
accounts are not context: they have no evidence and no temporal state, and a
product whose answer surface can retrieve its own user table is a different
product.

When the store cannot be written, it reports unavailable and the auth endpoints
answer 503. That path is live: the deployment ran on a read-only filesystem
before `CloudAccounts` existed.

## Second implementations of the same semantics

Looked for, and what turned up. The method was to grep for the vocabulary that
would have to appear in a duplicate (`supersededBy`, `polarity`,
`MULTI_VALUED_PREDICATES`, `contradict`, `validFrom`, `txTime`) across `src`,
`api`, `scripts` and `web/src`, then read every file that matched.

**No client reimplements temporal or contradiction logic.** In `web/src` the
only matches are `web/src/app/routes/Ask.tsx` and `web/src/pages/Judge.tsx`,
and both only render a `standing` field the server already decided. The web
computes nothing about supersession. `src/snapshot/replay.ts` looks like a
second read path and is not: it is a `FetchLike` under `HydraClient` that
returns recorded wire bodies, so the real decoder and the real resolver run
over them unmodified.

**One resolver.** `resolve` in `src/retrieval/resolve.ts` is the only place an
answer or an abstention is chosen, and `selectHopTarget` in the same file is
deliberately shared with the fetcher so the two cannot pick different hop
targets. `src/retrieval/fetch.ts` asserts that they agreed and throws
`RetrievalConsistencyError` if they did not.

**Three places express "this claim is live", and they agree.** `isLive` in
`src/retrieval/resolve.ts`, `liveDependencyEdges` in `src/retrieval/blast.ts`,
and `current: claim.supersededBy.length === 0` in `toRevisionItem` in
`src/contract/result.ts`. The rule is the same in all three: nothing supersedes
it, and for the first two, positive polarity. It is one predicate written out
three times rather than one function called three times.

**One place derives the claim-state vocabulary a second way, on purpose.**
`src/report/inventory.ts` produces `current`, `historical`, `contradicted` and
`withdrawn` by walking the ingest plan's edges rather than by asking the graph.
Its own header explains the choice, and it is not on the answer path: it feeds
the Memory, Health and Timeline screens and the demo workspace counts, never a
question. It is still a second derivation of the same words, and a change to
the planner would move it without moving the resolver.

**Two things are called a timeline and they are not the same thing.** The
`lacuna_timeline` MCP tool and the `lacuna timeline` command return
`resolution.considered`, the revision chain for one predicate, oldest first.
The web Timeline screen (`web/src/app/routes/context.tsx`) reads the
workspace's `changes` and `conflicts` lists, which come from the inventory. A
reader who saw one and then the other would reasonably expect the same data.

## Related

- [docs/EVIDENCE_INDEX.md](EVIDENCE_INDEX.md), every number and the file it
  came out of.
- [docs/END_TO_END_MATRIX.md](END_TO_END_MATRIX.md), every surface and what was
  actually exercised on it.
- [RELEASE_GATE.md](../RELEASE_GATE.md), the gates and their commands.
- [docs/adr/0002-temporal-evidence-graph.md](adr/0002-temporal-evidence-graph.md),
  why the graph is shaped this way.
