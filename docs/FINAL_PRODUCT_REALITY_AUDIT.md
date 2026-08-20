# Product reality audit

Opened in a real browser against production, not read out of the source. Every
line below is something that was observed, with the observation next to it.

Audited at `40bec66`, 2026-08-19, roughly 29 hours before the deadline.

## The verdict first

**It is a submittable Hack Hydra Track 03 entry today, and it is a strong one on
three of the five published criteria.** It is not finished as a general product,
and the gap is not engineering quality; it is breadth of product surface.

| Criterion | State | Why |
|---|---|---|
| Technical execution | Strong | 1,208 unit + 77 contract tests, typecheck clean, no mocks on the answer path, clean-clone reproducible |
| Use of HydraDB and graph-native approaches | Strong | Live cloud reads, the store's own relation graph, a server-side traversal that materially decides an answer, and a documented division of labour |
| Quality of results | Strong | 64/64 with 0 false answers, five abstention reasons, a measured scale curve, node/cloud parity |
| Product completeness and usability | **Mixed** | The core journey works end to end; the landing takes 56 screens to explain it and four feature areas are unbuilt |
| Originality | Strong | Assertion-mode gating, structural abstention, and the non-event finding are not things other memory products do |

The honest summary: **the engine is excellent and the product around it is
narrower than the navigation once implied.** That has been fixed by narrowing
the navigation to what is real, not by widening claims.

## What was verified working, in the browser

| Thing | Evidence |
|---|---|
| Public workspace, no account | `/explore/*`, 22 routes, link crawl clean |
| Six live proofs on `/judge` | Current, revision chain, contradiction with both sources live, absence, graph impact, continuity |
| Real ingestion, signed in | Pasted transcript to HydraDB Cloud, 5 claims, own collection |
| Ask reads back what was ingested | `Sessions / storage` returned Redis, cited, standing `current` |
| Revision visible | `Sessions storage Postgres` HISTORICAL beneath `Redis` CURRENT |
| Proposal never becomes an answer | `storage:proposal` filed and labelled PROPOSAL |
| MCP over HTTPS, public | `tools/list` returns four tools; `tools/call` answers from the cloud |
| MCP scoped to a user's workspace | `x-lacuna-workspace` header returned the ingested claim |
| Contradiction labelled correctly | Both sources read CURRENT · CONFLICTING |
| 404 | Real page, not a redirect to the front |
| Mobile | 0px horizontal overflow, all 13 routes at 375×812 |
| Console | Zero errors on the landing |

## What is broken or weak

### 1. The landing was 30,552 pixels tall. 56 screens. 27 sections. Fixed.

Measured with `document.documentElement.scrollHeight`, which is why it is a
number and not an impression. This was the single largest usability problem in
the product: a judge with limited time cannot be asked to scroll 56 screens to
learn what something is.

Cut to **13,173 pixels, 24 screens, 11 sections**, measured the same way after
deploying. Nothing kept is decorative; what went was repetition, or a scene
describing a surface the product now shows directly and better. The primary
action is now Open live workspace rather than Start building, because the
fastest way to understand this is to watch it answer and that needs no account.

Verified after the cut: zero horizontal overflow at 360, 390, 430, 768, 1366,
1440, 1920 and 2560 wide.

**Severity: was HIGH, now resolved.**

### 2. Four feature areas are unbuilt

`agents`, `tools` and `runs` return `[]` from their endpoints. Voice is not
configured. All four are out of the navigation, so nothing lies about them, but
a memory product without agents is a narrower product than the category
suggests.

**Severity: MEDIUM.** Honest, and still a gap.

### 3. Vendor marks were invented

Fixed during this audit. HydraDB was three lines and four circles; Claude was a
starburst; the key called `codex` was a hexagon. The Google button carried no
Google mark at all, which its branding guidelines do not permit.

All four now use real assets, recorded in `THIRD_PARTY.md`.

**Severity: was HIGH, now resolved.**

### 4. A dangling reference on the dashboard

RECENT RUNS said "work appears when an agent executes a task" on a product where
Agents are not reachable. Removed during this audit, and replaced with four
primary actions that all go somewhere real.

**Severity: was LOW, now resolved.**

## What was deliberately not built, and why

These were specified and are not present. Recording them is more useful than
attempting them badly.

| Not built | Honest reason |
|---|---|
| Agent runtime, handoffs, Work, Tools registry | Days of careful work: capability manifests, a bounded run loop, model calls, writeback policy, and the tests that make any of it trustworthy. Started and half-finished, it would be exactly the empty feature theatre the directive forbids |
| Voice end to end | Realtime STT, single-use tokens, streaming TTS, barge-in, real audio analysers and a state machine that never claims LISTENING without a live track. Not completable and testable in the window |
| Scheduler | Only meaningful once agent runs exist |
| Claude Code lifecycle hooks | Depends on the agent runtime for anything beyond what MCP already does |
| Natural-language query planner | Would put a model call in front of the resolver. The deterministic path is what makes the answers checkable, and rushing a planner over it risks the strongest part of the product |
| Official LongMemEval score | The extractor reads eleven sentence frames and not English, so it does not read that benchmark's domain. Measured and recorded rather than fitted to |

Each of these stays out of the navigation. The rule the product holds to is
that a visible feature works, and an invisible one is honest.

## The single highest-leverage remaining fix

Compress the landing. It costs no engineering risk, touches nothing on the
answer path, and it is the first thing every judge sees.
