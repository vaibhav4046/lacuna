# Contract ownership

One table. Every canonical contract in this repository, the single file that
owns it, what consumes it, and whether a second definition of the same idea
exists somewhere else.

[docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md) lists the same contracts as
a map of the code. This asks a narrower question of each one: if two files
disagreed about this shape tomorrow, which of them is wrong?

"Drift" here means a second declaration of the same idea, whether or not the two
currently agree. Two declarations that agree today are still two things to keep
in step.

---

## The table

| Contract | Type names | Owner | Consumers | Drift |
| --- | --- | --- | --- | --- |
| **Answer envelope, machine clients** | `AskCore`, `EvidenceItem`, `QueryItem`, `RevisionItem`, `ResultStatus`, `MAX_EVIDENCE_ITEMS` | `src/contract/result.ts` | `src/mcp/result.ts` (spreads `askCore`), `src/cli/json.ts` (spreads `askCore`), `src/api/workspace.ts` (projects from `askCore`) | **No drift.** This module exists because there used to be two hand-written mappers over the same `Answer`, and its header names the fields that diverged. All three adapters now project through one function. |
| **Answer envelope, plus which node answered** | `AskResult`, `ExplainResult`, `TimelineResult`, `HealthResult`, `NodeIdentity`, `HydraIdentity` | `src/mcp/result.ts` | `src/mcp/server.ts`, `src/mcp/index.ts`, `src/mcp/tools.ts` (reads `MAX_EVIDENCE_ITEMS` for the cap it advertises) | **No drift.** `AskResult extends AskCore`, so the MCP shape cannot diverge from the shared one without failing `tsc`. |
| **Answer envelope, web and REST** | `AnswerEnvelope`, `AnswerStatus`, `EnvelopeEvidence`, `askEnvelope` | `src/api/workspace.ts` | `src/api/router.ts` (`/api/ask`) | **Drift, three declarations.** See C1. |
| **Shared answer projection** | `askCore(answer: Answer): AskCore` | `src/contract/result.ts:168` | all three adapters above | **No drift.** It is the projection. It accepts an `Answer` and nothing else, which is also what keeps a credential out of every result built from it. |
| **Resolved answer, internal** | `Answer`, `Resolution`, `Outcome`, `Hop`, `SubgraphView`, `ClaimRecord`, `EvidenceRecord`, `Mention`, `SubjectView`, `RetrievalQuestion`, `QueryTrace`, `Polarity` | `src/retrieval/types.ts` | `src/retrieval/*`, `src/contract/result.ts`, `src/hydra/source.ts`, `src/view/*`, `src/cli/human.ts` | **No drift.** `src/hydra/source.ts` re-exports four of these at line 62 rather than redeclaring them. |
| **Claim and state vocabulary, four states** | `ClaimState`, `CLAIM_STATES`, `STATE_LABELS`, `STATE_MEANINGS`, `ClaimRow`, `Inventory` | `src/report/inventory.ts` | `src/server/server.ts`, `src/view/memory.ts`, `src/api/workspace.ts`, `api/index.ts` | **Drift, two further vocabularies.** See C2. |
| **Abstention reasons, five** | `AbstentionReason`, `ABSTENTION_REASONS`, `explainAbstention`, `isAbstentionReason` | `src/model/abstention.ts` | `src/retrieval/resolve.ts`, `src/retrieval/types.ts`, `src/contract/result.ts`, `src/mcp/tools.ts` (spreads `ABSTENTION_REASONS` into the published JSON Schema enum), `src/corpus/types.ts:1`, `src/view/answer.ts`, `src/view/format.ts`, `src/bench/reader.ts` | **No drift.** Every one of those imports the union. `ThreadKind` in `src/corpus/types.ts:43` overlaps it (five of its eleven members are spelled the same), but it answers a different question: which kind of thread the generator built, not why the resolver declined. The corpus's own `ExpectedAnswer` at line 106 uses the imported `AbstentionReason`. |
| **Evidence records** | `EvidenceRecord` (owner `src/retrieval/types.ts:107`), `EvidenceItem` (`src/contract/result.ts:45`), `EnvelopeEvidence` (`src/api/workspace.ts:24`) | three files, three deliberately different shapes | `src/hydra/node-source.ts`, `src/hydra/cloud-source.ts`, `src/retrieval/decode.ts` produce the first; `toEvidenceItem` maps to the second; `askEnvelope` maps to the third | **Layering, not drift, plus one duplicate.** The three are a chain of narrowing projections, each derived from the previous by a named function. `EnvelopeEvidence` is the lossy end: a session title, a role, a timestamp and a standing. The duplicate is `interface Evidence` in `web/src/app/routes/Ask.tsx:18` and again in `web/src/pages/Judge.tsx:25`, both hand-copied from `EnvelopeEvidence`. Same cause as C1. |
| **The HydraDB source interface** | `HydraSource`, `Read<T>`, `orderMentions`, `emptySubject` | `src/hydra/source.ts` | `src/retrieval/fetch.ts`, `src/retrieval/blast.ts`, `src/mcp/server.ts`, `src/api/router.ts`, `src/hydra/open.ts` | **No drift.** Two implementations, `NodeSource` and `CloudSource`, and nothing else. Four reads, and `kind` is reported on screens and never used to change a result. |
| **Which store a process reads** | `Profile`, `OpenedSource`, `openSource`, `readProfile` | `src/hydra/open.ts` | `src/cli/question.ts`, `src/cli/status.ts`, `src/cli/profile.ts`, `scripts/mcp.ts`, `scripts/continuity.ts` | **Drift by bypass, not by redeclaration.** Eight surfaces construct a source directly instead, listed with reasons in the `PINNED` set of `tests/unit/architecture.test.ts`. See C3. |
| **Blast radius result** | `BlastRadius`, `BlastAnswer`, `AffectedService`, `BlastStep`, `MAX_BLAST_DEPTH`, `liveDependencyEdges`, `affectedText` | `src/retrieval/blast.ts` | `src/retrieval/index.ts` (re-export), `src/bench/systems.ts`, `src/view/blast.ts`, `src/server/server.ts`, `scripts/proof.ts` | **No drift.** One walk. The fetch loop follows exactly the edges `liveDependencyEdges` admits and the pure pass re-derives its verdict through the same filter, so the two cannot disagree the way two separately written walks could. |
| **CLI palette** | `Palette`, `PLAIN`, `ANSI`, `paletteFor` | `src/cli/color.ts` | `src/cli/main.ts`, `src/cli/human.ts`, `src/cli/human-report.ts`, `src/cli/doctor.ts`, `src/cli/mark.ts`, `src/cli/status.ts` | **No drift in the terminal.** One interface, two instances, one selector. The web has its own colour constants in each component file, but those are a different medium and never claim to be the same palette. |
| **The 18 app routes** | `TITLES`, `RouteKey`, `NAV_GROUPS`, `isRouteKey`, `DEFAULT_ROUTE`, `routeTitle` | `web/src/app/routes.ts` | `web/src/App.tsx`, the shell and sidebar | **No drift, and it is enforced.** `NAV_GROUPS` carries `satisfies readonly { h: string; items: readonly (readonly [string, RouteKey])[] }[]`, so a nav entry naming a route `TITLES` does not have stops the build rather than rendering a dead button. Note that `npm run audit:routes` walks 23 URLs: `APP_ROUTES` in `scripts/route-audit.ts:43` restates the same eighteen keys as a literal array, visited under `/demo/<route>`, plus five paths (`/`, `/judge`, `/docs`, `/signin`, `/signup`) that are not members of `RouteKey`. That restated array is a second copy of the route list, unchecked against `TITLES`. |
| **Which workspace a screen reads** | `Scope`, `ScopeProvider`, `useScope`, `useScoped` | `web/src/api/scope.tsx` | every screen that reads workspace data | **No drift.** Two frozen constants, `SIGNED_IN` and `DEMO`, and one hook. The comment records the alternative that was rejected: a flag threaded through every route. |
| **Cypher the node executes** | `PreparedQuery`, `VertexUpsert`, and the read builders `entityByName`, `claimsAbout`, `mentionsFrom`, `evidenceForClaim`, `dependentsOf`, `contradictionPartners`, `supersededByClaim` | `src/hydra/queries.ts` owns the shape, `src/retrieval/queries.ts` owns the reads | `src/hydra/client.ts`, `src/hydra/node-source.ts`, `src/ingest/run.ts`, `scripts/census.ts` | **No drift.** `CloudSource` speaks no Cypher at all and reports `cypher: null` in its traces rather than inventing a statement, which the comment on `QueryTrace` calls out by name. |
| **Cloud record layout** | `EntityRecord`, `IndexRecord`, `SessionRecord`, `BuiltGraph`, `INDEX_ID`, `entityRecordId`, `sessionRecordId` | `src/hydra/cloud-graph.ts` | `src/hydra/cloud-source.ts`, `scripts/ingest-cloud.ts` | **No drift.** One writer, one reader, one id derivation. |
| **Account and session records** | `Accounts` (interface), `FileAccounts`, `CloudAccounts` in `src/auth/accounts.ts`; `Account`, `SessionRecord`, `AccountStore`, `SESSION_TTL_MS`, `hashToken`, `mintToken` in `src/auth/store.ts` | two files, split write-side and interface-side | `src/api/router.ts`, `api/index.ts`, `scripts/serve.ts` | **No drift.** Two implementations behind one interface. `CloudAccounts` addresses records as `lacuna:account:<hash>` in its own collection; `CloudSource` addresses `lacuna:entity:<hash>` in the context collection. |
| **Capability and data state** | `CapabilityState`, `DataState`, `CAPABILITY_STATES`, `DATA_STATES`, `explainCapability`, `explainData` | `src/model/capability.ts` | the interface pages, and `docs/CLAIMS.json` | **No drift in code.** Its own header states the reason for a single owner: one union, two readers, so a sixth state cannot appear in one and not the other. `docs/CLAIMS.json` is data rather than a type, so nothing compiles the agreement; `tests/unit/claims.test.ts` is what checks it. |
| **Node ids** | `deriveId`, `canonicalKey`, `IdRegistry`, `ID_BITS`, `MAX_ID`, `KEY_SEPARATOR` | `src/model/ids.ts` | `src/ingest/plan.ts`, `src/hydra/cloud-graph.ts` | **No drift.** One derivation, and `IdRegistry.intern` throws `IdCollisionError` rather than overwriting. |

---

## C1 · The answer envelope is declared three times

**Owner.** `AnswerEnvelope` in `src/api/workspace.ts:38`, ten fields:
`status`, `answer`, `evidence`, `revisions`, `conflicts`, `abstain_reason`,
`context_pack_id`, `trace_id`, `source_state`, `took_ms`.

**Second declaration.** `interface Envelope` in
`web/src/app/routes/Ask.tsx:24`. All ten fields, hand-copied, including the same
five-member `status` union spelled out inline.

**Third declaration.** `interface Envelope` in `web/src/pages/Judge.tsx:31`.
Nine fields: the same set with `context_pack_id` omitted. The two web copies
are not identical to each other.

`interface Evidence` is duplicated the same way in both files, from
`EnvelopeEvidence`.

**Why it exists, and why it is not simply a mistake.** Invariant I2 in
[docs/ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md) forbids anything
under `web/src` from importing `src/`, and
`tests/unit/architecture.test.ts` fails the build if it does. With no published
schema and no generated client, redeclaring the shape is the only way the web
can type a response. The boundary is worth keeping. The redeclaration is the
cost of keeping it without a generator.

**What actually breaks.** A field added to `AnswerEnvelope` reaches the browser
as JSON and is silently invisible to both screens. A field renamed reaches them
as `undefined`, and TypeScript is happy because the local interface still
describes the old shape. The two web copies already differ by one field, which
is what this failure mode looks like at the start.

**Not drift, checked.** `AnswerEnvelope` is built from `askCore` inside
`askEnvelope`, so the web shape is a projection of the shared contract rather
than a second mapping of `Answer`. The projection is narrow and lossy on
purpose: an abstention keeps its reason code, but the resolver's trace and the
per-read costs do not cross into it, and evidence collapses to four fields.

---

## C2 · Three claim-state vocabularies

**Owner.** `ClaimState` in `src/report/inventory.ts:38`: `current`,
`historical`, `contradicted`, `withdrawn`. Derived structurally from the ingest
plan's edges, with the derivation written out in the file header.

**Second vocabulary.** `EnvelopeEvidence['standing']` in
`src/api/workspace.ts:27`: `current`, `superseded`, `proposal`. Three values,
one of which (`superseded`) is `historical` under another name and one of which
(`proposal`) the inventory cannot produce. It is set by `standingOf` at line 56,
which takes two booleans and is called with `proposal` hardcoded `false` at line
100, so `proposal` is unreachable today.

**Third vocabulary.** `MemoryRow['st']` in `src/api/workspace.ts:160`:
`CUR`, `SUP`, `PRO`, `CON`, `UN`. Five codes for four states. The mapping at
line 234 emits `CUR`, `SUP`, `CON` and falls through to `UN` for `withdrawn`,
so `PRO` is unreachable and `UN` means withdrawn rather than unknown.

**Assessment.** This is real drift, and it is presentational rather than
semantic: all three are computed from the one `ClaimState` the inventory
produces, so no surface can disagree with another about what a claim's state
*is*. What they disagree about is what to call it. The two unreachable values,
`proposal` and `PRO`, come from the design, and `src/report/inventory.ts`
already explains in its header why they were not fabricated into the data.

**Related, and already documented.** `src/report/inventory.ts` derives the
vocabulary by walking the ingest plan's edges rather than by asking the graph.
That is a second derivation of the same four words, on purpose, and it is not on
the answer path. [docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md) names it
and I agree with the finding.

---

## C3 · The seam is bypassed by eight surfaces, and by the router in a fourth way

`openSource` in `src/hydra/open.ts` is imported by exactly five files:
`src/cli/question.ts`, `src/cli/status.ts`, `src/cli/profile.ts`,
`scripts/mcp.ts`, `scripts/continuity.ts`.

Eight surfaces construct a source directly, all of them listed with reasons in
the `PINNED` set of `tests/unit/architecture.test.ts`:

| Surface | Constructs | Line |
| --- | --- | --- |
| `api/index.ts` | `CloudSource` | 107 |
| `scripts/serve.ts` | `NodeSource` | 86 |
| `src/server/server.ts` | `NodeSource` | 235 |
| `src/bench/systems.ts` | `NodeSource` | 177, 189 |
| `scripts/evaluate.ts` | `NodeSource` | 79 |
| `scripts/ask.ts` | `NodeSource` | 120 |
| `scripts/cloud-parity.ts` | both | 61, 131 |
| `scripts/verify-snapshot.ts` | `NodeSource` twice, one live and one replaying | 50, 62 |

They all land on `HydraSource`, so nothing above them can tell.
[docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md) already says the sentence in
`src/hydra/open.ts` about the store being decided "once, in one place" holds for
three callers out of five. I agree, and the count is now eight bypassing
surfaces against five importers.

**A finding of my own.** `tests/unit/architecture.test.ts` line 143,
`it('is what the three shipped clients use')`, asserts that
`src/api/router.ts`, `src/cli/question.ts` and `scripts/mcp.ts` each contain the
string `openSource`. Two of them import it. `src/api/router.ts` does not import
`src/hydra/open.js` at all. The string the test finds is a local variable at
`src/api/router.ts:376`:

```ts
      const openSource = this.#source;
```

The router is genuinely store-agnostic, because `ApiOptions.source` is an
injected `() => HydraSource` factory and the callers do the pinning. That is a
stronger property than calling the seam, since the router cannot reach the
environment at all. But the assertion as written does not establish it, and
renaming that local variable would fail a test that is checking something else.

---

## C4 · There is no Context Pack compiler

[docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md) states this. I checked it
rather than repeating it, and I agree.

`context_pack_id` is a field on `AnswerEnvelope` (`src/api/workspace.ts:45`).
It is assigned in exactly four places in that file: three of them set it to
`null` (lines 87, 126, 139) and one sets it at line 111 to

```ts
        context_pack_id: core.claimId === null ? null : `pack-${core.claimId}`,
```

That is a template string over the id of the claim the answer came from. There
is no module that compiles a pack, no type named for one, and nothing on the
read path assembles a set of facts, constraints, evidence and open questions.

Two source comments name a component that does not exist:
`src/hydra/source.ts:13` ("the temporal resolver, the contradiction policy, the
evidence gate and the Context Pack compiler do not know...") and
`src/hydra/cloud.ts:16`. The landing copy also describes one, in
`web/src/landing/copy.ts:15` and `web/src/landing/Route.tsx:12`.

The developer screen is the honest surface: `web/src/app/routes/developers.tsx:72`
prints `CONTRACT SHOWN AS DESIGNED · THE IMPLEMENTED API IS THE SOURCE OF TRUTH`
directly beside the envelope it draws.

---

## C5 · `AnswerStatus` carries a value the resolver cannot produce

`AnswerStatus` in `src/api/workspace.ts:22` has five members. `askEnvelope`
returns `ANSWERED`, `CONFLICT`, `NO_EVIDENCE` and `SYSTEM_ERROR`, and never
`PARTIAL`. The resolver has two outcomes, and an abstention carries a reason;
there is no third thing for `PARTIAL` to describe.

Documented in the comment above the type, and in
[docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md). Verified against the four
`return` statements in `askEnvelope`. I agree.

Both web copies of the envelope carry `PARTIAL` in their status unions, and both
give it a rendering: `web/src/app/routes/Ask.tsx:59` colours it `#FFB829` and
line 164 branches on it beside `ANSWERED`. Dead branches, drawn.

---

## Related

- [docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md), the shape as built.
- [docs/ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md), what holds it
  in place and what does not.
- [docs/HARNESS_CONFORMANCE_MATRIX.md](HARNESS_CONFORMANCE_MATRIX.md), the
  specified harness against what exists.
