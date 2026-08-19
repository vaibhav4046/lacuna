# Architecture invariants

The rules that have to stay true for this system to mean what it claims. Each
one has a statement, what breaks when it is violated, and how it is enforced
today.

[docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md) describes the shape as
built. This describes what holds that shape in place, and where nothing does.

The enforcement column is the point of the document, so it uses exactly four
values and nothing softer:

- **ENFORCED BY TEST** names the file and the test. A violation fails a run.
- **ENFORCED BY TYPES** names the type and the file. A violation fails `tsc`.
- **ENFORCED BY GATE** names the npm script.
- **CONVENTION ONLY** means nothing stops a violation. Somebody has to notice.

The CONVENTION ONLY list is the useful output. It is gathered at the bottom.

---

## I1 · One seam decides the store

**Statement.** A client does not choose which store it reads. `openSource` in
`src/hydra/open.ts` decides from the environment, and every surface that does
not go through it is on a written list with a written reason.

**Why.** "One context. Any agent." is a claim about where the context lives. If
the CLI reads a node on a laptop and the browser reads HydraDB Cloud, the three
surfaces agree with each other and not with production, and every parity result
becomes a comparison of two things that were never the same thing. The comment
at the top of `src/hydra/open.ts` records that this is exactly what happened
before the file existed.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/architecture.test.ts`, `describe('one seam decides which store a
client reads')`, `it('is the only place a source is constructed, outside the
pinned surfaces')`. It walks `src`, `scripts` and `api` with comments stripped
and fails on any `new NodeSource(` or `new CloudSource(` outside the nine paths
in the `PINNED` set. A third test,
`it('still lists every pinned surface, so the list cannot rot into a rubber
stamp')`, fails when a pinned path stops constructing a source at all.

**One caveat, and it is real.** The companion test
`it('is what the three shipped clients use')` asserts that
`src/api/router.ts`, `src/cli/question.ts` and `scripts/mcp.ts` each contain the
string `openSource`. Two of them import it. `src/api/router.ts` does not: it
never imports `src/hydra/open.js`, and the string the test finds is a local
variable at `src/api/router.ts:376`, `const openSource = this.#source;`. The
router is in fact store-agnostic, because its caller injects a
`source: () => HydraSource` factory, which is arguably a stronger property than
calling the seam. But the test does not prove that. See I1b.

---

## I1b · Each pinned surface reads the store its reason names

**Statement.** The nine surfaces exempted from I1 are each pinned to one store
on purpose. The deployed function reads HydraDB Cloud. The benchmark and the
evaluator read the node. The parity scripts open both.

**Why.** The `PINNED` comment in `tests/unit/architecture.test.ts` states the
worst case in its own words: a production deployment silently answering from a
node on somebody's laptop. The exemption list is what makes I1 usable, and an
exemption nobody checks is a hole with a comment over it.

**Enforcement.** CONVENTION ONLY. The test checks that each pinned path still
constructs a source or mentions the seam. It does not check *which* source. A
change making `api/index.ts` construct a `NodeSource` would keep every test
green.

---

## I2 · The web never imports the resolver

**Statement.** Nothing under `web/src` imports from `../../src/`, and nothing
under `web/src` imports anything matching `retrieval`. The browser talks to the
product over HTTP and no other way.

**Why.** A screen that can call `resolve` can answer a question without the API
having agreed. From then on there are two products, and the one in the browser
is the one users see. It would not look like a bug in either.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/architecture.test.ts`, `describe('the web talks to the product over
HTTP and no other way')`, two tests:
`it('never imports the server source tree')` and
`it('never imports the resolver, so it cannot answer a question itself')`.
Both match against an anchored `import`/`export ... from` statement with
comments stripped, so the SDK snippets held as string literals in
`web/src/landing/copy.ts` do not trip it.

---

## I3 · Temporal and contradiction semantics have one implementation

**Statement.** "Which of these claims is the current one" is decided in
`resolve` in `src/retrieval/resolve.ts` and nowhere else. A client renders that
decision; it does not re-take it.

**Why.** This decision is the product. A second implementation in a client is
how two surfaces begin answering the same question differently, and neither one
will look wrong on its own.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/architecture.test.ts`, `describe('temporal and contradiction
semantics live in one place')`, `it('is not re-decided in a client')`. It fires
when one line both selects (`.filter`, `.find`, `.findLast`, `.some`, `.every`,
`.sort`, `.reduce`) and names temporal state (`supersededBy`, `polarity`,
`validFrom`, `validTo`).

**Two limits worth stating.** The walk covers `src/cli`, `src/mcp` and
`web/src`. It does not cover `src/view`, `src/api` or `src/report`, all of
which are surfaces. And the rule is per line, so the same logic split across two
lines passes.

---

## I3b · The one live-claim predicate is written out three times

**Statement.** "Nothing supersedes it, and its polarity is positive" is the
rule. It exists as `isLive` in `src/retrieval/resolve.ts:28`, as
`liveDependencyEdges` in `src/retrieval/blast.ts:71`, and as
`current: claim.supersededBy.length === 0` in `toRevisionItem` in
`src/contract/result.ts:147`.

**Why.** The three agree today. They are three copies of a predicate rather
than three calls to one function, so a change to the rule has to be made three
times or the surfaces disagree.

**Enforcement.** CONVENTION ONLY. I3 does not catch this, because all three
live inside `src/`, which the client walk does not visit. Already named in
[docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md).

---

## I4 · The fetcher and the resolver pick the same hop target

**Statement.** `selectHopTarget` in `src/retrieval/resolve.ts:53` is called by
both `ask` in `src/retrieval/fetch.ts` and `resolve` in the same file as the
function. If the view handed to the resolver carries a bridge the hop does not
select, the resolver throws rather than answers.

**Why.** A disagreement here shows up as an answer cited from the wrong node.
The comment on the function calls that the worst failure this product has.

**Enforcement.** ENFORCED BY TEST, and by a runtime throw.
`RetrievalConsistencyError` is raised at `src/retrieval/resolve.ts:150` and at
`src/retrieval/fetch.ts:78`. Covered by
`tests/unit/retrieval-resolve.test.ts`, `it('throws when the view carries a
bridge the hop does not select')` and `it('throws when a hop resolves but the
view carries no bridge')`.

---

## I5 · The runtime cannot see evaluator ground truth

**Statement.** The query path cannot reach the gold answers by import, does not
name them in source, and writes a byte-identical graph when every expected
answer is replaced with rubbish.

**Why.** A system that can see the expected answer can be made to score
perfectly in an afternoon, and the score then says nothing about whether the
graph works. This is the invariant every number in
[docs/BENCHMARKS.md](BENCHMARKS.md) rests on.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/ground-truth-isolation.test.ts`, four tests across three describes:

- `describe('the query path cannot reach the gold answers')`,
  `it('src/ingest/plan.ts imports nothing from the benchmark')` and the same
  for `src/retrieval/index.ts`, walking the transitive relative-import closure
  of each entry point;
- the same describe, `it('... reaches only the shape of the corpus, never its
  content')`, which admits only `src/corpus/types.ts`, `predicates.ts`,
  `vocab.ts` and `rng.ts`, and refuses `threads.ts` and `index.ts` where the
  answers are assembled;
- the same describe, `it('names no gold answer anywhere in the product
  source')`, matching `.expected`, `GoldQuestion` and `ExpectedAnswer` across
  all of `src` outside `corpus` and `bench`;
- `describe('ingestion is blind to the answers')`, `it('plans the identical
  graph when every expected answer is replaced')`, which is the strongest form:
  not that ingestion does not read the answers but that it could not have.

---

## I6 · No route hardcodes an answer

**Statement.** No file on the serving path returns a value it knows in advance.
Every answer comes back from the graph.

**Why.** A demo page with a branch keyed on the question is a recording. The
whole submission is a claim that these answers are computed.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/architecture.test.ts`, `describe('no surface hardcodes an
answer')`, `it('does not name a gold answer anywhere on the serving path')`,
scanning `src/api`, `src/cli`, `src/mcp` and `src/retrieval` for three literals
the corpus generator produces. Reinforced by the source-wide
`it('names no gold answer anywhere in the product source')` under I5.

**A limit.** The three literals (`Halverd`, `25 July 2026`, `Farah Haddad`) are
written into the test. If the corpus seed changes, the guard keeps passing while
checking nothing. The I5 test is the durable half, because it matches on the
shape of the ground-truth types rather than on their values.

---

## I7 · An abstention is an outcome, not an error

**Statement.** "The graph does not say" is a member of the result type, with a
status, a reason code, and the same evidence and cost fields an answer carries.
It is never an exception, never an HTTP failure, and never an empty object.

**Why.** The five abstention reasons are structurally different arrangements in
the graph, and the argument of the product is that a graph can tell them apart
where a similarity score flattens them into one low number. A caller that
receives an abstention as an error learns nothing and retries.

**Enforcement.** ENFORCED BY TYPES.
`Outcome` in `src/retrieval/types.ts:86` is a two-member union where `abstain`
carries an `AbstentionReason`. `AskCore` in `src/contract/result.ts:100`
carries `status: 'answered' | 'abstained'` alongside `reasonCode`, `evidence`,
`queries` and `timingMs` for both. `AnswerEnvelope` in
`src/api/workspace.ts:38` maps `contradicted` to `CONFLICT` and every other
reason to `NO_EVIDENCE`, both with HTTP 200. The MCP output schemas in
`src/mcp/tools.ts` require every one of those fields on both statuses.

Also covered by test: `tests/unit/cli-render.test.ts`, `it('reports an
abstention as a status and a reason, not as an error')`, and
`tests/unit/mcp-server.test.ts`, `it('abstains when the subject is not in the
corpus, and says why')`.

---

## I8 · Colour is never the only carrier of meaning

**Statement.** Every verdict reads the same in a pipe, a log file and a terminal
that has never heard of ANSI. A failing check says FAIL in words.

**Why.** A product whose output is meant to be checkable cannot put the check
in a colour. The rule is stated at the top of `src/cli/color.ts`.

**Enforcement, terminal.** ENFORCED BY TEST.
`tests/unit/cli-render.test.ts`, `it('carries no escape sequences under the
plain palette')` and `it('says no answer and gives the reason when it
abstained')`, both driven with `PLAIN`.
`tests/unit/cli-doctor.test.ts`, `it('prints all three verdicts as words')`,
which asserts that `PASS`, `WARN` and `FAIL` each appear in the text under
`PLAIN`; `it('counts the failures and names the exit code')`, which asserts the
sentence `2 check(s) failed, exit code 4.`; and `it('carries no escape sequences
under the plain palette')`.
The switch itself is covered by `describe('paletteFor')`, four tests: `NO_COLOR`
at any value, a non-TTY stdout, `TERM=dumb`, and a real terminal.

**Enforcement, web.** CONVENTION ONLY. See I8b.

---

## I8b · The web pairs every colour with a word, by hand

**Statement.** `web/src/app/routes/Ask.tsx` holds `STATUS_WORD` and
`STATUS_COLOUR` as two parallel records over the same five statuses, so a
status renders as a word and a colour together. `web/src/pages/Judge.tsx` does
the same.

**Enforcement.** CONVENTION ONLY. There are no unit tests under `web/`. The
only automated check that opens the app is `npm run audit:routes`, which records
console errors, failed requests and horizontal overflow, and says nothing about
whether meaning survives without colour. Removing `STATUS_WORD` would fail no
gate.

---

## I9 · Production never silently falls back to the local node

**Statement.** A process configured for the cloud that cannot reach the cloud
refuses. It does not open a node instead. Answering from the wrong store is
worse than refusing to answer.

**Why.** The failure is invisible: correct answers about a workspace nobody
asked about.

**Enforcement, the seam.** ENFORCED BY TEST.
`tests/unit/hydra-open.test.ts`, `describe('opening the store')`, `it('refuses
rather than falling back when the named profile is not configured')`, which
asserts `HydraConfigError` for `LACUNA_PROFILE=cloud` with only node variables
set, and a throw for the reverse. Supported by `it('prefers a configured cloud
when nobody named a profile')` and `it('reads the node when the environment
names it, even with a cloud configured')`.

**Enforcement, the deployed function.** CONVENTION ONLY.
`api/index.ts` reads `cloudFromEnv(process.env)` and constructs only
`CloudSource`. When no cloud is configured it omits the `source` option
entirely, and `/api/ask` returns `SYSTEM_ERROR` with
`abstain_reason: 'no context store is configured'` (`src/api/router.ts:378`).
That is the correct behaviour, and nothing tests it. `api/index.ts` never
imports `NodeSource` today; nothing stops it.

---

## I10 · Secrets never enter a result, a document or a log

**Statement.** The bearer token and the base URL do not reach any output. What a
caller may see about a store is names: namespace, graph, cell, or database and
collection.

**Why.** Every artifact in this repository is committed. A token in one is a
token in the submission.

**Enforcement, structural.** ENFORCED BY TYPES.
`src/contract/result.ts` accepts no config anywhere in the file, which is what
keeps a credential out of every result built from it; the header says so.
`describeNode(config: HydraConfig): NodeIdentity` in `src/mcp/result.ts:109` is
the narrowing: it takes the whole config and returns three strings, so a result
cannot carry a credential even if node identity spreads to more places.

**Enforcement, outputs.** ENFORCED BY TEST.

| Output | Test |
| --- | --- |
| `lacuna doctor`, human | `tests/unit/cli-doctor.test.ts`, `it('never prints the token')` |
| CLI JSON payload | `tests/unit/cli-render.test.ts`, `it('contains no token, under any spelling')` |
| the seam's printable line | `tests/unit/hydra-open.test.ts`, `it('never puts an address or a token in the line it prints')` |
| MCP stdio, both streams | `tests/contract/mcp-stdio.contract.test.ts`, `it('never printed the token it authenticates with')` |
| a failed Cypher query's error and stack | `tests/contract/hydra.contract.test.ts`, `it('keeps the bearer token out of the error it raises for a failed query')` |
| stored account records | `tests/unit/auth-api.test.ts`, `it('never stores the password or the session token')` |

The last two rows in the middle of that table are in `tests/contract`, which
needs a live node and runs under `npm run test:contract`, not `npm test`.

**Enforcement, artifacts and documents.** CONVENTION ONLY. None of the thirty
scripts in `package.json` scans `artifacts/`, `docs/` or the working tree for a
credential. `npm run copy:lint` reads the product's prose for filler words and
is not a secret scan. `docs/CREDENTIAL_ROTATION_CHECKLIST.md` is a procedure a
person follows.

What does exist is `.gitignore`: `.env`, `.env.local`, `.env.*.local`,
`.env.deploy` and `.env.cloud` are all ignored, and `git ls-files` confirms the
only tracked env files are `.env.example` and `.env.deploy.example`. That stops
the obvious mistake. It does nothing about a token pasted into a committed
artifact under `artifacts/`, which is where every gate writes its evidence.

---

## I11 · Evidence is capped, and a truncated list says so

**Statement.** At most `MAX_EVIDENCE_ITEMS` (50) quotations come back with any
result, and `evidenceTotal` carries the real count.

**Why.** A claim with a hundred supporting spans is a corpus problem, not a
reason to send a hundred quotes to a model that gets charged for reading them.
A silent truncation is a lie about how much the answer rests on.

**Enforcement.** ENFORCED BY TYPES, in one place.
`MAX_EVIDENCE_ITEMS` is defined at `src/contract/result.ts:41` and applied in
`askCore` at line 180, which every machine adapter projects through. The MCP
tool descriptions read the same constant (`src/mcp/tools.ts:44`), so the
advertised cap cannot drift from the applied one.

The HTML pages under `src/view/` render `Answer` directly and do not go through
`askCore`, so the cap does not apply there. Those pages are the local-only
server (`npm run serve`).

---

## I12 · The graph walk is bounded

**Statement.** The dependency walk stops at `MAX_BLAST_DEPTH` (6) and never
revisits an entity, so a cycle written by a future ingest cannot turn a read
into one that does not return.

**Why.** The corpus's deepest chain is three hops. The bound is not for the
corpus, it is for whatever gets ingested next.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/retrieval-blast.test.ts`, `describe('computeBlast')`, `it('stops at
the depth cap rather than walking an unbounded chain')` and `it('terminates on a
cycle between two packages')`. The constant is at `src/retrieval/blast.ts:27`
and bounds both loops: the pure `computeBlast` at line 104 and the fetching
`blastRadius` at line 230.

---

## I13 · Every tool a model can call is read-only

**Statement.** The MCP server exposes four tools. None writes a claim, resets
the graph, or deletes anything. All four carry `readOnlyHint: true`.

**Why.** A model holding this connection can quote the corpus and cannot change
it. That is a property of the release rather than an oversight, and it is what
makes the connection safe to hand to an agent.

**Enforcement.** ENFORCED BY TEST.
`tests/unit/mcp-server.test.ts`, `it('name nothing that could be mistaken for a
write')` and `it('say they are read-only, in the annotation a client acts
on')`. The demo API is covered separately by
`tests/unit/demo-api.test.ts`, `it('is read only: a write to it is not a
route')`.

---

## I14 · Accounts are not context

**Statement.** Account and session records live in the operational store, never
in the context graph. Locally that is a directory of append-only JSON lines;
in production it is a separate HydraDB Cloud collection, `accounts`.

**Why.** Two reasons, both written into `src/auth/store.ts`. The census asserts
the exact vertex and edge count of the graph against the ingest plan, so an
account written into the same cell fails that gate on the first sign up. And a
product whose answer surface can retrieve its own user table is a different
product.

**Enforcement.** ENFORCED BY GATE, for the node profile: `npm run census`,
which reads every vertex back by label and diffs against `buildPlan`, exiting
non-zero on any disagreement. The cloud separation is structural: `CloudAccounts`
in `src/auth/accounts.ts:95` addresses records as `lacuna:account:<hash>` in the
`accounts` collection, while `CloudSource` reads `lacuna:entity:<hash>` in the
context collection. Nothing tests that the two collection names differ.

---

## I15 · Ingestion is idempotent

**Statement.** Node ids are derived from what the node is, not handed out, so
re-ingesting the same transcript produces the same ids and the MERGE is a no-op.

**Why.** Named in `src/model/ids.ts`. Without it the census cannot mean
anything, because a second ingest would double the graph.

**Enforcement.** ENFORCED BY TEST, in `tests/contract/ingest.contract.test.ts`
(live node, `npm run test:contract`), and by the id derivation itself:
`IdRegistry.intern` throws `IdCollisionError` rather than overwriting when two
canonical keys truncate to one 52-bit id.

---

## The CONVENTION ONLY list

Nothing in the repository stops any of these. This is the honest output of the
document.

| # | What is unguarded | Where it would break |
| --- | --- | --- |
| I1b | Which store each pinned surface reads. The test checks that a source is constructed, not which one. | `api/index.ts` could construct a `NodeSource` and every gate would stay green. |
| I3b | The live-claim rule is written out three times inside `src/`. The client-drift test does not walk `src/`. | `src/retrieval/resolve.ts`, `src/retrieval/blast.ts`, `src/contract/result.ts` could disagree. |
| I6 | The gold-answer literals are hardcoded in the test. | A new corpus seed leaves the guard passing while checking nothing. |
| I8b | Colour as the only carrier, in the web. There are no unit tests under `web/`. | `web/src/app/routes/Ask.tsx`, `web/src/pages/Judge.tsx`. |
| I9 | The deployed function's pinning to the cloud. | `api/index.ts`. |
| I10 | Secrets in committed artifacts and documents. No scan script exists. | `artifacts/`, `docs/`, `.env.*`. |
| I11 | The evidence cap on the HTML page server, which renders `Answer` directly. | `src/view/answer.ts`. |
| I14 | That the accounts collection and the context collection have different names. | `src/auth/accounts.ts`, `src/hydra/cloud.ts`. |
| C1 | The answer envelope is declared three times. See [docs/CONTRACT_OWNERSHIP.md](CONTRACT_OWNERSHIP.md). | `src/api/workspace.ts`, `web/src/app/routes/Ask.tsx`, `web/src/pages/Judge.tsx`. |

Two of these are consequences of a boundary that is itself enforced. I2 forbids
the web from importing `src/`, so the web has to redeclare the envelope, and
I8b and C1 both follow from that. The fix is a generated or published schema,
not a relaxation of I2.

---

## Related

- [docs/ARCHITECTURE_FINAL.md](ARCHITECTURE_FINAL.md), the shape as built.
- [docs/CONTRACT_OWNERSHIP.md](CONTRACT_OWNERSHIP.md), who owns each contract
  and where a second definition exists.
- [docs/HARNESS_CONFORMANCE_MATRIX.md](HARNESS_CONFORMANCE_MATRIX.md), what
  exists against the specified harness.
- [RELEASE_GATE.md](../RELEASE_GATE.md), the gates and their commands.
