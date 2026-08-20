# Screenshot evidence plan

This is a capture plan, not an asset list. A row becomes evidence only after a
file exists, was captured from the named deployment, and is indexed in
`EVIDENCE_INDEX.md`. Empty rows are not replaced by mockups.

## What exists

The eight PNGs in `artifacts/screens/v8/` are real captures from the previous
V8 acceptance deployment. They prove that build, not the current uncommitted UI
or security changes.

| Existing file | What it proves | Reuse rule |
| --- | --- | --- |
| `landing-1440.png` | previous desktop landing | historical only after landing changes |
| `landing-390.png` | previous mobile landing | historical only after landing changes |
| `memory-field.png` | 140 loaded rows in the 453-node public graph | may support the measured graph count, not final styling |
| `proof-dag-final.png` | exact provenance projection in the previous build | recapture if graph UI changes |
| `agents-live.png` | two built-in roles and a completed run | does not prove recommendations or user-created agents |
| `work-live.png` | one persisted run record | does not prove concurrent writers or arbitrary agents |
| `dashboard-runtime.png` | one persisted daily schedule | does not prove distributed exactly-once execution |
| `voice-idle.png` | voice idle and fallback UI | does not prove provider audio |

## Final capture set

| Required capture | Required visible proof | State |
| --- | --- | --- |
| landing desktop | final mark, problem, real product surfaces, production URL | pending final deployment |
| landing mobile | no horizontal overflow, reachable navigation | pending final deployment |
| Ask artifact | interpretation, current answer, source quotation, timeline | pending recapture |
| conflict artifact | both current conflicting sources, no invented winner | pending recapture |
| graph overview | total count, filters, table and selected node | pending recapture |
| exact proof DAG | source → evidence → claim → entity | pending recapture |
| agent recommendation | memory-derived reason, evidence, permissions, no-write | pending API and UI gate |
| agent run | eight lifecycle events, bounded Context Pack, reviewer verdict | pending recapture |
| schedule | daily cadence, next eligible time, limitation text | pending recapture |
| voice | selected Vaibhav professional clone plus typed fallback | blocked on provider configuration and real audio proof |
| CLI | actual command and output from the final deployment | pending final capture |
| MCP | Inspector or client tool list and evidence-bearing call | pending final capture |
| Google sign-in | provider-bound account and callback success | blocked on security acceptance |
| ChatGPT / Claude | each named client reading the same current value and evidence | not run |
| Supademo | published walkthrough using only the final captures above | not assembled |

## Capture rules

- Keep the production URL or an independently identifiable client surface in
  frame where possible.
- Never show `.env`, bearer values, capability tokens, internal workspace ids,
  account emails, or provider dashboards.
- Do not colour-grade product pixels. Crop, pan, zoom, cursor emphasis, and
  explanatory overlays may surround a capture without altering it.
- File names describe what is visible, not what the editor intended.
- The video and README may cite only files that exist at the cited path.
