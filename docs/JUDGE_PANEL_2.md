# Judge panel, second pass

A re-run of the adversarial review in [JUDGE_PANEL.md](JUDGE_PANEL.md), against
the repository at `733a261` and against <https://lacuna-five.vercel.app> on
2026-08-19, later the same day. The first panel ran at `128e1c6`; there are
fourteen commits between them.

The question this pass asks is narrow: were the twelve CRITICAL and HIGH
findings actually fixed, or only claimed to be. A commit message is not
evidence here. Every row below was checked against the file or the live
endpoint, and the second half of this document is about problems the fixes
themselves introduced, which is the part worth reading.

Read only. Nothing in the repository was modified except this file. No script
that writes was run.

**The working tree moved during this review, again.** `git status` was clean
when this pass started and by the end carried uncommitted edits to
`JUDGE_SCORECARD.md`, `scripts/copy-lint.ts`, `artifacts/proof/proofs.json`,
`artifacts/hydra/cloud-parity.json` and `artifacts/mcp/stdio-timings.txt`, none
of them made by this review. Two findings below turn on that, finding 3 and
NEW-1, and both are reported against **both** states so it is clear which is
committed and which is not. Everything else in this document was read in a file
that did not move.

Gates re-run for this pass:

```
npx tsc --noEmit              exit 0
npx vitest run tests/unit     51 files, 1023 tests, all passed, exit 0
npm run copy:lint             47 files, 1 finding, exit 1   at the start of this pass
npm run copy:lint             47 files, 0 findings, exit 0  after the linter was
                                                            edited mid review, see NEW-1
```

---

## The twelve prior findings

**10 FIXED, 1 PARTIAL, 1 STILL OPEN.**

| # | Prior finding | Verdict | Evidence checked this pass |
|---|---|---|---|
| 1 | README says the deployment answers from a recorded snapshot | **FIXED** | `README.md:37-49` now reads "it answers live from HydraDB Cloud", and keeps a paragraph saying what it used to say and why that changed. `curl /api/health` returns `HydraDB Cloud, database lacuna, collection backend` with all four checks `pass`. Every `/api/ask` call in this pass returned `source_state: live`. |
| 2 | Harness components absent | **STILL OPEN**, now disclosed | Greps across `src api scripts web/src` for `runstate\|run_state\|RunState`, `capability.?manifest\|CapabilityManifest`, `trajectory`, and `progressive.?hydrat\|hydration` all return nothing. `budget` still hits only `src/corpus/predicates.ts` (the `budget_code` predicate), `src/corpus/types.ts`, `src/snapshot/serve.ts` and the Chrome flag in `scripts/social-card.ts`. The code gap is unchanged. What is new is `docs/HARNESS_CONFORMANCE_MATRIX.md`, scoring ten capabilities as six ABSENT, four PARTIAL, none IMPLEMENTED, and stating "No row in this table is fully met." |
| 3 | `JUDGE_SCORECARD.md` false on soak and on the model provider | **FIXED in the working tree, NOT YET COMMITTED** | The soak half is fixed and committed: lines 34-39 describe the soak run and cite `artifacts/soak/soak.json`. The model half is fixed only in the uncommitted working copy, which says one provider is configured with six models CONNECTED, and adds a paragraph recording that the line has now been wrong in both directions. `git show HEAD:JUDGE_SCORECARD.md` still reads "**The deployment has no model provider configured at all**" at line 23 and "970 unit tests" at line 12, and production contradicts both: `/api/demo/model` returns `{"label":"ALLAM-2-7B · CLOUD"}` and `/api/demo/models` returns six Groq rows, `state: CONNECTED`, `lat: 83 ms`. **Commit this or the committed scorecard is false in the opposite direction.** The route count is fixed and committed: eighteen app routes plus four public paths, and `artifacts/route-audit/routes.json` records `"routes": 22`, `"checks": 198`, with `/docs` dropped from `APP_ROUTES` under a comment closing the class rather than the instance. |
| 4 | Three disproved entries in `docs/CLAIMS.json` | **FIXED** | All three rewritten, each carrying a `caveat` recording the old wording rather than silently correcting it. `no-runtime-dependencies` now says two and names them. `no-client-script` is now scoped `"src/view only, not the deployment"` and states the deployment's real `script-src 'self'`. `deployment` now says live from HydraDB Cloud. See NEW-3: a fourth entry went stale today. |
| 5 | `RELEASE_GATE.md` "no invented operational strings" vs the served bundle | **FIXED** | Line 140 is rescoped to "no invented operational strings **in the terminal block**", and line 141 is a new row reading "still there, and labelled rather than removed", naming `@lacuna/sdk` and `POST /v1/query`. Checked against the served bundle `/assets/index-CrRJVv-f.js`: `@lacuna/sdk` 1, `POST /v1/query` 1, `context.pack` 1, `handoff` 4, `trace_id` 10, `context_pack_id` 4, `acme` 6. Those are still present, which is now exactly what the table says. |
| 6 | `docs/EVIDENCE_INDEX.md` says the contract suite skips rather than fails | **FIXED** | Line 62 now reads "**fails rather than skips**". Matches all four headers under `tests/contract/`. The same file has other problems, see NEW-2. |
| 7 | Production ships no CSP and no frame protection | **FIXED** | `curl -sD- https://lacuna-five.vercel.app/` returns `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`, plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS. `/api/health` sends the same set. The CSP blocks nothing the app needs, verified below. |
| 8 | SDK screen ships a non-existent API and points at a key issuer that does not exist | **FIXED** | `web/src/landing/Sdk.tsx:31-34` and `web/src/app/routes/developers.tsx:75-78` both render a full-size amber badge above the code block: `NOT SHIPPED · DESIGN CONTRACT, NOT A RUNNING API`. The key line changed from `ISSUE ONE FROM SETTINGS` to `NO ACTIVE KEY · KEY ISSUING NOT IMPLEMENTED`; the bundle contains zero occurrences of the old string. This was the recommended fix, which was to label rather than remove. |
| 9 | Connectors marks "Custom ingestion" AVAILABLE | **FIXED** | `web/src/design/connectors.ts:48` is now `{ n: 'Custom ingestion', st: 'PLANNED' }`. All sixteen rows are PLANNED. The file header records why the old status was wrong. |
| 10 | No claim extraction from text, and the README does not say so | **FIXED** | `README.md:28-35` states it in the thesis section: "point this at a folder of somebody else's meeting notes today and there is no step that turns those sentences into claims", and says it is deliberately not faked. |
| 11 | `foxglove` returns `out_of_scope`, which is false about the corpus | **FIXED** | Tested live through the CSRF handshake. `Foxglove`, `foxglove`, `FOXGLOVE` and `FoXgLoVe` all return `ANSWERED` / `"Stonecrop"` / 1 evidence / `source_state: live`. `Redshank` returns `NO_EVIDENCE` / `out_of_scope` in both casings, so a true refusal still refuses. `Fox`, `Lowbanl` and `foxgloves` also refuse. Two costs and one hole came with it, see NEW-4 and NEW-6. |
| 12 | The production store performs no server-side graph operation | **PARTIAL** | The recommended smallest fix was made and works: `/api/demo/relations` returns `{"available":true,"ms":67,...}` with 47 normalised relations carrying predicate, confidence and the source sentence, rendered on the HydraDB screen. The answer path is unchanged. `src/hydra/cloud-source.ts` still issues only `GET /context/inspect id=...` (lines 62 and 96) and traversal is still the loop in `src/retrieval/blast.ts`. `JUDGE_SCORECARD.md:50-55` states this accurately rather than claiming otherwise. |

---

## Was any test weakened?

**No. The test tree got stronger, and two changes are meaningful strengthenings.**

This was the highest-value thing to check, so it is reported in full.

Across `128e1c6..HEAD` the tests gained **59** assertion lines and lost **13**.
All thirteen deletions account for as follows.

Twelve are read-count assertions changed from `1` to `2`, in
`tests/contract/retrieval.contract.test.ts`, `tests/unit/cloud-source.test.ts`,
`tests/unit/mcp-server.test.ts`, `tests/unit/retrieval-blast.test.ts`,
`tests/unit/security-namespace.test.ts` and `tests/unit/server-routes.test.ts`.
Every one of them stayed an **exact** count. None was relaxed to a range, a
`toBeGreaterThan`, a `toBeLessThanOrEqual` or a skip. Grepping the whole diff
for loosened matchers returns exactly one added non-exact assertion,
`expect(read.value.claims.length).toBeGreaterThan(0)`, and it is a brand new
assertion in a brand new test that also asserts `read.value.id` exactly.

Three of those changes added coverage rather than only moving a number:

- `tests/contract/retrieval.contract.test.ts` now also asserts
  `expect(queries[1]?.cypher).toContain('MATCH (e:Entity) RETURN e.name')`, so
  the second read has to be the name list and not just any second read.
- `tests/unit/cloud-source.test.ts` now also asserts
  `expect(read.traces[1]?.request).toContain('index')`, same property on the
  cloud side, and adds a test that a wrong-case name resolves to the right
  record.
- `tests/unit/security-namespace.test.ts` changed from destructuring request
  zero and asserting the closed header set on it, to looping over **every**
  request and asserting the same closed set on each. That is a real
  strengthening on exactly the path the second read was added to, and the old
  shape would have let the new request carry anything.

The thirteenth deletion is the only non-count one, in
`tests/unit/architecture.test.ts`, and it is also a strengthening. The old
assertion was `expect(read(join(ROOT, path))).toContain('openSource')` over
three files. It passed on `src/api/router.ts` for a coincidence: the router has
a local variable of that name and never imports the seam. It was replaced by a
regex requiring a real `import ... openSource ... from '.../hydra/open'` on the
two clients that do choose a store, plus three new assertions on the router
(type-only `HydraSource` import present, injected factory field present, no
import from `hydra/open` at all).

Three new test files were added: `canonical.test.ts` (eight cases, six of them
negative, pinning that the fold does not trim, does not match prefixes or
suffixes, does not fold punctuation, and returns null on an ambiguous fold),
`header-model.test.ts` and `relations.test.ts`.

---

## Also checked and clean

- **The CSP blocks nothing.** The served shell references only `/favicon.svg`,
  `/boot.css`, `/assets/index-CrRJVv-f.js` and `/assets/index-DuB2j7-I.css`, all
  same origin. The stylesheet's only `url()` references are nine self-hosted
  `/fonts/*.woff2` files; `jetbrains-mono-latin.woff2` fetches 200, `font/woff2`,
  31432 bytes, which `font-src 'self'` permits. The bundle contains no external
  origin other than W3C XML namespace URIs, two React and React Router
  documentation URLs inside error strings, and the repository URL.
  `style-src 'unsafe-inline'` is present, which the inline style objects
  throughout `web/src` require.
- **The relations panel fails safely and escapes.** `proof.tsx:131-138` renders
  four distinct states: reading, not available with the reason, answered and
  empty, and rows. `src/api/router.ts:353-359` wraps the call in try/catch and
  returns `available: false, reason: 'the store did not answer'` rather than an
  empty graph, which is the right distinction. `cloud.relations()` goes through
  `#send` with `DEFAULT_TIMEOUT_MS`, so a slow store is bounded. Nothing is
  unescaped: `dangerouslySetInnerHTML` and `innerHTML` return zero hits across
  `web/src` and `src`, so the free prose HydraDB extracted into `context` is
  rendered as a React child and escaped.
- **`canonicalName` cannot return a wrong subject through ordering.** An exact
  match short-circuits to null wherever it falls in iteration order; two stored
  names differing only by case return null rather than picking one, asserted at
  `canonical.test.ts:39`; prefixes, suffixes, punctuation folds and whitespace
  all refuse. The one hole is NEW-6 below and it is not an ordering hole.

---

## New findings

### HIGH

**NEW-1. `npm run copy:lint` was red while two documents called it green. It
was fixed during this review by widening the linter, and the widening has no
test.**

At the start of this pass:

```
$ npm run copy:lint
web/src/app/routes/proof.tsx:132  EXCLAMATION    ) : !relations.value.available ? (
47 files scanned, 1 findings.        exit 1
```

`RELEASE_GATE.md:147` says `| plain English in the public copy | 47 files, 0 findings | npm run copy:lint |`
and `docs/END_TO_END_MATRIX.md:77` says the same. The gate exited non-zero.

The linter was reading the JSX negation in `!relations.value.available` as an
exclamation mark in prose. The line was added by `f5e6863`, the relations panel
commit; `git show 128e1c6:web/src/app/routes/proof.tsx` contains no `!` at all,
so the regression was new today, and the two commits after it, one titled
"docs: record the HydraDB relations gate and the unit count", did not re-run the
gate.

**It is green now**, `47 files scanned, 0 findings`, exit 0. It went green
partway through this review through an uncommitted edit to
`scripts/copy-lint.ts` that adds

```ts
const LOOKS_LIKE_CODE = /\)\s*:|\?\s*\(|&&|\|\||=>/;
```

and skips any segment matching it. The flagged line in `proof.tsx` is unchanged;
the linter stopped looking at that class of construct. That is a defensible call
and the comment argues it well, since product prose does not contain `) :`,
`? (`, `&&`, `||` or `=>`.

Two things remain worth doing.

First, **commit it.** As it stands the gate passes only in a working tree, and
the committed state of the repository is a red gate documented as green.

Second, **pin it.** Grepping `tests/` for `LOOKS_LIKE_CODE` returns nothing.
This is a copy gate that was widened to make itself pass, with no test asserting
that the widening skips only code. The narrower alternative was available and is
one operator: rewriting the ternary as `relations.value.available === false`
would have left the linter's reach where it was. If the widening is the right
call, it deserves the same treatment the case-fold fallback got this morning,
which is a test file full of negative cases pinning what it must **not** skip.

**NEW-2. `docs/EVIDENCE_INDEX.md` is now the stale document, and its CSP row
survived the CSP fix.**

Two problems in the file whose job is to make every number checkable.

First, the counts. Line 53 reads `| 893 unit tests over 39 files | Said in SUBMISSION, JUDGE_SCORECARD, RULES_MATRIX |`
and line 54 reads `| 50 contract tests over 3 files |`. The live number measured
in this pass is 1023 over 51 files. `RELEASE_GATE.md:16` says 1023 over 51 and
`JUDGE_SCORECARD.md:12` says 1023, so the attribution on line 53 now points at a
document that says something else. Meanwhile `docs/END_TO_END_MATRIX.md:68`
says "1016 passed, 50 files". That is still **three different unit counts in
three documents**, which is the finding the first panel raised; the fix pass
updated `RELEASE_GATE.md` and the scorecard and left the other two behind.

Second, line 268 still reads "The deployed copy sends the same CSP and nosniff
headers as the local server". It is still false, in a new way. The local HTML
server sends `default-src 'none'` (`src/view/layout.ts:33`); the deployment
sends `default-src 'self'; script-src 'self'`. They are different policies for
two different servers. The nosniff half now matches. This row was named in the
first panel and it outlived the header fix it was about.

*Smallest fix:* quote the live numbers in both documents, and rewrite line 268
to say the deployment sends its own policy and what it is.

### MEDIUM

**NEW-3. The `llm-router` claim went false within hours of the Groq key being
added, and its own reproduce command now proves it.**

`docs/CLAIMS.json:383`:

> "No language model is called anywhere in this project, in the demo path or outside it."

with `reproduce`: `grep -rn 'chat/completions\|openai\|anthropic' src/ || echo 'no model calls'`

Running that command returns seven hits, all in `src/provider/registry.ts`,
including `https://api.groq.com/openai/v1` and an `ANTHROPIC_API_KEY` branch.
`src/provider/` contains `openai.ts` and `registry.ts`. The deployment now makes
an authenticated request to a model provider's API on every `/api/demo/model`
and `/api/demo/models` request, which is how the header line and the six
CONNECTED rows are produced.

The substance survives and should be said plainly: nothing on the answer path
consults a model, `resolve()` is still structural, and a catalogue listing is
not a completion. But the entry's own reproduce command now prints the opposite
of the entry, and this is precisely the failure the first panel warned about, in
its words, that a judge who spot-checks one entry and finds it false discounts
the other twenty-two. The scorecard already records that this same fact has now
been wrong in both directions in one day.

*Smallest fix:* change the claim to "no language model participates in an
answer" and point the reproduce command at the retrieval path rather than all of
`src/`.

**NEW-4. The Models screen now looks live, and its router does nothing.**

`web/src/app/routes/models.tsx:22` declares seven router modes, `AUTO`,
`LOCAL FIRST`, `QUALITY FIRST`, `PRIVACY FIRST`, `COST FIRST`, `LATENCY FIRST`,
`CUSTOM`, rendered as clickable buttons under a `ROUTER` label. Grepping `mode`
in that file returns three lines: the `useState`, the `setMode` in the click
handler, and one use at line 43 which sets the clicked button's own text colour.
Nothing routes. Nothing downstream reads it.

This is pre-existing, and it was harmless this morning because the table beside
it was empty and the whole panel read as unconfigured. Adding a real provider
changed that. The screen now shows six models with a green dot, a CONNECTED
state and a measured latency, and seven strategy buttons sit above them looking
like a working control. It is the same class of problem as the "Custom
ingestion AVAILABLE" row that was correctly fixed this morning, and it is now
the most misleading control on the product surface.

*Smallest fix:* one caption in the existing `note` style saying the modes are
not implemented, matching how every other unfinished surface in this product
already behaves.

**NEW-5. The model table is capped at six per provider with no disclosure.**

`src/provider/registry.ts:69` sets `MAX_MODELS_PER_PROVIDER = 6`, applied at
line 107 after an alphabetical sort. Production returns exactly six rows, equal
to the cap. `models.tsx` prints no "6 of N" anywhere; the table simply ends.

I did not enumerate Groq's catalogue, so I am reporting the cap and the equality
rather than a measured total. The reason it matters is the house standard: the
Graph screen in this same product prints "6 shown" against 174, and the first
panel treated that disclosure as the honest behaviour.

There is a second-order effect worth naming. `headerModel` receives the already
capped rows, so the header picks its worker from the alphabetically first six
only. If those six were all voices or classifiers the header would name one, and
`header-model.test.ts:48` pins that fallback as intended
(`WHISPER-LARGE-V3 · CLOUD`). Today `allam-2-7b` sorts first and is not matched
by `NOT_A_WORKER`, so the header is sensible, but it is sensible by alphabet
rather than by selection.

### LOW

**NEW-6. The case fold accepts a character the corpus does not contain.**

`canonicalName` folds with `toLowerCase()`, which is not injective in Unicode.
U+212A KELVIN SIGN lowercases to ASCII `k`. Measured against production:

```
subject 'Lowban' + U+212A   -> NO_EVIDENCE, abstain_reason "retracted"
subject 'Lowbank'           -> NO_EVIDENCE, abstain_reason "retracted"
subject 'Lowbanl'           -> NO_EVIDENCE, abstain_reason "out_of_scope"
```

The first two are the same envelope. The product resolved a name it does not
hold onto a subject it does, while a name one ASCII letter away correctly
refuses.

Practical reach is nil. Nobody types a Kelvin sign by accident, it is not
injectable, and the resolved subject is in the same public corpus. The cost is
the contract. `src/hydra/canonical.ts:23-27` promises "Folding is `toLowerCase`
and nothing else. No trimming, no accent stripping, no punctuation removal, no
fuzzy distance. A near miss that is not a case difference is a genuine absence
and has to keep saying so." A Kelvin sign is not a case difference. This is a
false acceptance where the bug it replaced was a false refusal, and by this
project's own argument that is the worse direction of the two.

*Smallest fix:* after a fold match, require every differing character pair to be
an ASCII case pair.

**NEW-7. The fallback roughly doubles a folded answer and adds about 40 percent
to every abstention.**

Measured against production, three passes, consistently ordered every time:

```
Foxglove  exact hit,   1 read    0.306  0.281  0.298  s
Redshank  genuine miss, 2 reads  0.429  0.452  0.386  s
foxglove  folded hit,  3 reads   0.696  0.541  0.660  s
```

Three samples each over the public internet, so treat the magnitudes loosely,
but the ordering held on every pass and it matches the read counts the tests now
assert. Nothing here is broken; this is the price of the fix and it was worth
paying. It is worth knowing because `/judge` computes six rows including two
abstentions, so the per-row latencies published this morning, 107ms to 218ms,
will have moved.

**NEW-8. `api/index.ts:120-123` still has no `.catch`.**

Unchanged from this morning, where it was a MEDIUM and was deliberately
deferred. Noted only because the relations endpoint added a route through the
same unguarded promise. That handler has its own try/catch so it is safe on its
own; the structural gap is the same one as before.

**NEW-9. The relations panel draws 8 rows and captions 47.**

`proof.tsx:146` slices to 8; line 164 prints
`GET /context/relations · {length} RETURNED IN {ms} MS`, which is 47 on
production. A reader counting rows and reading the caption gets two numbers with
nothing saying "8 shown". Same class as NEW-5, and the Graph screen's "6 shown"
is the house style that resolves it.

---

## Is this in better shape than this morning?

Yes, clearly, and the manner of the fixes is better than the count of them. Ten
of twelve findings are fixed with evidence that survives a second look, and the
work was done in the harder direction each time: the claims ledger entries carry
a `caveat` recording what they used to say instead of being quietly corrected,
the scorecard records that its model line has now been wrong in both directions,
`RELEASE_GATE.md` grew a row admitting that invented strings remain on the SDK
panel rather than deleting the row that was disproved, and
`HARNESS_CONFORMANCE_MATRIX.md` scores the project's largest gap at six ABSENT
and four PARTIAL out of ten with nothing marked implemented. The two findings
that could not be fixed today, the harness and the answer path's use of the
graph, are now documented rather than glossed. And no test was loosened to make
any of it pass, which was the thing most worth checking and the thing most
projects get wrong under deadline.

The single largest remaining weakness is that **the documentation still moves
slower than the deployment, and that is now the only layer failing.** It is the
same weakness the first panel found, one level down. Three documents still give
three unit counts, 1023, 1016 and 893, and the live number matches only one of
them. A claims entry became false within hours of a key being added and its own
reproduce command demonstrates it. The `EVIDENCE_INDEX` CSP row survived the
very fix it was complaining about. The copy gate spent part of today red while
two documents called it green. For a project whose entire pitch is that its
claims are checkable by anyone holding a terminal, the checkable-claims layer is
the part a judge can break, and it is also the cheapest thing in the repository
to repair: every item in that list is prose or JSON, needs no redeploy, and
cannot break the product.

There is a sharper version of the same point, and it is the thing to act on
first. **Commit the working tree.** Right now the committed `JUDGE_SCORECARD.md`
says the deployment has no model provider configured at all, which production
disproves in one curl, and the committed `scripts/copy-lint.ts` fails a gate two
documents call green. Both are already fixed on disk. A judge clones the
repository and gets neither fix. Everything else in this document can wait; that
cannot, because it is the difference between findings that are fixed and
findings that only look fixed from inside this working directory.
