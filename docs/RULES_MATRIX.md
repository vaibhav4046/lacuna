# Rules matrix

Every published Hack Hydra requirement, mapped to where this repository
satisfies it and how that can be checked. Source text captured verbatim at
[`artifacts/rules/hackhydra-rules-2026-08-12.txt`](../artifacts/rules/hackhydra-rules-2026-08-12.txt)
(https://hackhydra.hydradb.com, retrieved 2026-08-12, HTTP 200, 18804 chars).

Status values: `done`, `in progress`, `pending`, `blocked`.

## Hard deadlines

| Item | Value |
|---|---|
| Build window opens | 2026-08-12 |
| Official close | 2026-08-20, 11:59 PM PT |
| Internal target | 2026-08-19, 21:00 Europe/London |
| Winners announced | 2026-08-24 |

The internal target exists so the official deadline is a buffer, not the plan.

## Eligibility and disqualification

The rules list seven disqualification triggers. Each one, and what prevents it
here.

| Trigger | Prevention | Status |
|---|---|---|
| Work started before August 12, 2026 | Fresh repository, `git init` on 2026-08-12. No pre-hackathon code, assets, or history imported from any prior project. Full history is inspectable and unmodified | done |
| Missing or private GitHub repository | Public at <https://github.com/vaibhav4046/lacuna> since 2026-08-13. Check with `git ls-remote --heads https://github.com/vaibhav4046/lacuna`; the route it took is item 2 in [NEEDS_VAIBHAV.md](../NEEDS_VAIBHAV.md) | done |
| No open-source license in the repository | `LICENSE`, canonical Apache-2.0 text fetched from apache.org | done |
| Missing demo video | 3 minutes or less, recorded near the end of the build | pending |
| HydraDB not used meaningfully | HydraDB is the storage and traversal engine for the evidence graph. The answer path is four graph reads and no similarity score, itemised in [HYDRADB_INTEGRATION.md](HYDRADB_INTEGRATION.md), executed against a live node by the contract suite. See also ADR 0002 and the HydraDB proof panel | done |
| Submitted after the deadline | Internal target is a full day early | pending |
| Breaking the rules or code of conduct | This matrix | in progress |

## Repository content requirements

The rules name eight things the repository must contain.

| Requirement | Where | Status |
|---|---|---|
| Complete source code for the submitted project | whole repo | in progress |
| No participant-authored commits before August 12, 2026 | `git log` | done |
| A clear README | [`README.md`](../README.md) | done |
| Setup and run instructions | `README.md`, "Running it", six steps, verified from a fresh clone by [`artifacts/repro`](../artifacts/repro/README.md) | done |
| An explanation of how HydraDB is used | `README.md` plus [`docs/HYDRADB_INTEGRATION.md`](HYDRADB_INTEGRATION.md), which names the four reads on the answer path and what the engine refused | done |
| Required environment or dependency information | `.env.example` with all five keys, README prerequisites, `engines.node >= 20.11.0` | done |
| Attribution for third-party libraries, APIs, datasets, open-source code | [`THIRD_PARTY.md`](../THIRD_PARTY.md), [`SOURCE_LOG.md`](SOURCE_LOG.md): HydraDB, all six npm packages with licenses, the synthetic corpus, and the audit findings | done |
| An open-source license | `LICENSE` | done |

## Submission (three parts, all required)

| Part | Content | Status |
|---|---|---|
| Official form | Project name, short description, problem, what was built, deployed link, how it uses the HydraDB OS repo, tech stack, team members and contributions, repo link, video link | pending |
| Demo video | 3 minutes or less. Must cover the problem, what was built, a working demo, how the HydraDB repo is used and why it matters. Viewable without requesting access | pending |
| Public GitHub repository | Live, see the eligibility table above | done |

Anything past the 3-minute mark may not be reviewed, so the video is cut to
time, not trimmed to it.

## Track 03, verbatim requirements

> Build an agent memory layer for cross session continuity. It has to process
> chat histories spanning 30 to 40 sessions and 115,000 tokens per question.
>
> The system has to synthesize facts across sessions, keep chronological order
> and track information that was later overwritten. Long context models drop 30
> to 60% in accuracy here, and they mostly fail at abstention: knowing when the
> answer simply is not in the history and saying so instead of inventing one.

| Track requirement | How Lacuna addresses it | Status |
|---|---|---|
| Cross-session continuity | Sessions are first-class nodes; claims link to the session and message span they came from, over `(Session)-[:CONTAINS]->(Message)-[:HAS_SPAN]->(Span)-[:SUPPORTS]->(Claim)`. 72 sessions loaded | done |
| 30-40 sessions, 115k tokens per question | Retrieval never loads the full history. 1 to 42 queries per question over a 117,041-token corpus, mean 18 context tokens handed to the answering step | done |
| Synthesize facts across sessions | One hop over `MENTIONS` from the claims about the subject, in a single request. No path procedure: see [HYDRADB_INTEGRATION.md](HYDRADB_INTEGRATION.md) for why `algo.SPpaths` is probed and unused | done |
| Keep chronological order | Bitemporal model: `valid_from` and `tx_time` returned on every claim, and the timeline panel orders on them | done |
| Track information later overwritten | Non-destructive revision. Corrections add `SUPERSEDES` edges; superseded claims stay queryable and visible in the timeline | done |
| Abstention | Proof-carrying abstention: one of five machine-readable reason codes, plus the claims considered, the hop taken, and a step-by-step trace of what was searched. It does not suggest a next action | done |

Named datasets are LongMemEval, LongMemEval V2 and BEAM. FAQ item 13 confirms
they are not mandatory: "You may use your own datasets or other public datasets,
provided you disclose them in your README." Both paths are used here, and both
are disclosed.

## Judging criteria

Five published criteria, plus what the rules say a strong submission has.

Per-criterion evidence and status live in
[`JUDGE_SCORECARD.md`](../JUDGE_SCORECARD.md), which is the file a judge should
open. The summary:

| Criterion | What Lacuna leans on |
|---|---|
| Technical execution | Working end-to-end product, 1,189 unit tests plus 77 contract tests against a live node, measured numbers, no mocks in the demo path |
| Use of HydraDB and graph-native approaches | Four graph reads on the answer path and no similarity score. The traversal is the answer, not a decoration on a ranked list |
| Product completeness and usability | A developer product someone can run, verified from a fresh clone, not a benchmark script with a chart |
| Quality of results | Measured against lexical, vector and hybrid baselines over 51 configurations, reported honestly: on correctness it is a tie, and the difference is context size and construction |
| Originality | Proof-carrying abstention with five structural reason codes, and a queryable "what changed" timeline |

> We care about working, thoughtful products, not just benchmark scores.

A strong submission is stated to have: a functional product or demo, real
ingestion and retrieval workflows, a clear use case, and a thoughtful technical
implementation. All four are treated as requirements here, not as nice to have.

## Also noted

- Teams of 1 to 4. This is a solo entry.
- One track per submission. This project enters Track 03 only.
- Existing libraries, frameworks, APIs, public datasets and AI coding assistants
  are explicitly allowed. Original project work must still be created during the
  event, which it is.
- Upstream commit history of dependencies does not count against the entry
  (FAQ 17). HydraDB is consumed as a separate service and is not vendored, so
  this does not arise.
- "Open your repo, video and demo links yourself before you submit. Broken links
  are the most common way people lose." A link check is part of the final
  pre-submission pass.
