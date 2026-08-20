# Lacuna: final judges-master storyboard

This file describes the rendered judges-master candidate. It is a record of the
implemented edit, not a wishlist for a later production.

## Master contract

- Frame: 1920x1080, 16:9, 30 fps.
- Host duration: 179 seconds.
- Narration: verified ElevenLabs `Vaibhav Lalwani Professional` clone, voice id
  `GAeq3X4y41cIseBkBfsS`, Eleven Multilingual v2.
- Narration source: `assets/narration-vaibhav/lacuna-v8-vaibhav.mp3`,
  177.3975 seconds, SHA-256
  `FF7472F1C136C7C4FAE8C72F09F90D6D74EA503366D6CDD3F2F398F6604A263A`.
- Spoken copy: [SCRIPT.md](SCRIPT.md), without substitutions or retiming.
- Captions: deterministic sentence timing from `compositions/captions.html`,
  burned into the picture. The matching 45-cue sidecar is
  `renders/lacuna-v8-judges-master-vaibhav.srt` and ends at `00:02:57,398`.
- Audio mix: narration only. The film contains no music bed or sound effects.
- Motion: paused, seek-safe GSAP timelines over captured product frames and
  first-party graphic elements. The edit contains no authored cursor, fake
  typing, simulated product response, live-action footage, or render-time
  network request.
- Local render: `renders/lacuna-v8-judges-master-vaibhav.mp4`, 126,468,170
  bytes, SHA-256
  `C941FDA5F1D40856FBCB1C2D18816C6E4C917924740B78B80351D940E5BDFD28`.
- Render status: HyperFrames artifact validation passed. Owner approval,
  YouTube upload, Supademo, and submission remain open.

The narration runs continuously across scene cuts. Each scene below references
the exact time window in [SCRIPT.md](SCRIPT.md); scene boundaries do not define
new or paraphrased voiceover.

## Implemented host order

| Order | Composition | Host time | Duration | Purpose |
| --- | --- | --- | --- | --- |
| 1 | `beat-01-aperture` | 0:00-0:09 | 9s | Lacuna mark and deployed landing hero |
| 2 | `beat-02-problem` | 0:09-0:27 | 18s | Current, history, and conflict |
| 3 | `beat-03-architecture` | 0:27-0:43 | 16s | Extraction, provenance graph, Context Pack |
| 4 | `beat-04-demo` | 0:43-1:02 | 19s | Conflict and never-stated product answers |
| 5 | `beat-05-graph` | 1:02-1:20 | 18s | Overview, proof graph, readable proof row |
| 6 | `beat-06-agents` | 1:20-1:39 | 19s | Recommendation, bounded agents, run, schedule |
| 7 | `beat-09-everywhere` | 1:39-1:59 | 20s | Web, CLI, and MCP parity |
| 8 | `beat-07-voice` | 1:59-2:11 | 12s | Product voice boundary and typed fallback |
| 9 | `beat-08-hydradb` | 2:11-2:28 | 17s | Provenance and HydraDB graph walk |
| 10 | `beat-10-proof` | 2:28-2:47 | 19s | Generated evaluation and store parity |
| 11 | `beat-11-close` | 2:47-2:59 | 12s | Client convergence and Lacuna close |

## Scene 01: aperture and landing hero, 0:00-0:09

**Narration:** Exact `SCRIPT.md` audio from 0:00 through 0:09.

The first-party Lacuna mark draws on black. A circular reveal opens onto
`capture-final/screenshots/scroll-000.png`, the deployed landing hero. The mark
moves into the captured hero position, the capture holds under a slow camera
push, and the camera moves back through the aperture for the next scene.

No source chips, telemetry, cursor, or sound cue is present.

## Scene 02: current, history, conflict, 0:09-0:27

**Narration:** Exact `SCRIPT.md` audio from 0:09 through 0:27.

The aperture opens onto three implemented states in sequence:

1. `capture-final/screenshots/scroll-017.png` with `Find what is true now.`
2. `capture-final/screenshots/scroll-023.png` with the retained-history copy.
3. `assets/screens/live-timeline-1920x1080.png` with the conflict state and
   `NO ANSWER · CONTRADICTED`.

Clip-path reveals, capture translation, copy changes, and the persistent Lacuna
mark provide the movement. No synthetic four-card source stack is shown.

## Scene 03: extraction to Context Pack, 0:27-0:43

**Narration:** Exact `SCRIPT.md` audio from 0:27 through 0:43.

`assets/screens/live-extract-1920x1080.png` opens first. The scene wipes to
`assets/screens/live-proof-graph-v8-1920x1080.png`, then reframes the captured
source, evidence, claim, and entity path. A first-party Context Pack panel
appears with four rows: standing state, evidence, history, and missing evidence.

This is the implemented architecture claim: conversations become structured
evidence and claims, HydraDB holds the graph substrate, and Lacuna compiles a
bounded context result. The scene does not show seven animated clients or a
live ingest transaction.

## Scene 04: conflict and absence, 0:43-1:02

**Narration:** Exact `SCRIPT.md` audio from 0:43 through 1:02.

The scene starts on `assets/screens/live-ask-1920x1080.png`, the captured
billing-gate conflict result. Focus rectangles identify the two current sources
and contradiction trace. It then cuts to
`assets/screens/live-judge-fullpage.png` and moves to the captured Foxglove
result with zero sources and `never_stated`.

The film shows completed product states. It does not show a cursor, keystrokes,
loading, streaming, or a fabricated interaction.

## Scene 05: overview to exact proof, 1:02-1:20

**Narration:** Exact `SCRIPT.md` audio from 1:02 through 1:20.

`assets/screens/live-graph-v8-1920x1080.png` establishes the accepted public
overview and its 453-record total. The edit changes to
`assets/screens/live-proof-graph-v8-1920x1080.png`, follows the captured
source-to-evidence-to-claim-to-entity layout, and ends on a readable selected
proof row.

The count and proof content come from the captures. No generated graph nodes or
interactive table action is added in the film.

## Scene 06: bounded agents and schedule, 1:20-1:39

**Narration:** Exact `SCRIPT.md` audio from 1:20 through 1:39.

Four captured states appear in order:

1. `assets/screens/live-agent-recommendations-v8-1920x1080.png`.
2. `assets/screens/live-agents-v8-1920x1080.png`.
3. `assets/screens/live-agents-1920x1080.png`.
4. `assets/screens/live-work-v8-1920x1080.png`.

The phase rail reads `MEMORY RECOMMENDS`, `AGENTS ARE BOUNDED`, `RUN IS
PERSISTED`, and `DAILY · 06:00 UTC`. The persistent boundary reads `NO
AUTHORITATIVE WRITE`.

This scene proves two built-in roles, one persisted eight-event run, its
artifacts, and one daily schedule. It does not claim arbitrary user-created
agents, distributed atomic leases, or cross-instance exactly-once execution.

## Scene 09: one context across web, CLI, and MCP, 1:39-1:59

**Narration:** Exact `SCRIPT.md` audio from 1:39 through 1:59.

The scene renders the recorded cloud CLI result and the recorded parity result
as first-party HTML. Its source records are `assets/continuity.txt` and the
repository-level `artifacts/cli/session.txt`. It shows Bellwether resolving to
Halverd, six representative parity rows, `ONE_CONTEXT_IDENTICAL: true`, and the
same HydraDB Cloud collection across web, CLI, and MCP.

The final panel states `Packaged Lacuna SDK: not shipped` and names the shipped
HTTP, CLI, and MCP surfaces. This is not evidence that ChatGPT or Claude
connected to Lacuna.

## Scene 07: product voice boundary, 1:59-2:11

**Narration:** Exact `SCRIPT.md` audio from 1:59 through 2:11.

`assets/screens/live-voice-v8-1920x1080.png` remains the product frame. Camera
reframes identify the real ready state, the typed fallback, and the provider
acceptance boundary. The overlay distinguishes `FILM NARRATION · EXACT CLONE
VERIFIED` from `PROVIDER ACCEPTANCE PENDING`.

No microphone, STT, product TTS, interruption, transcript, waveform, or product
voice round-trip is simulated. The narration proves the selected film voice;
the product route remains separately gated on its server key and production
acceptance.

## Scene 08: HydraDB provenance and graph walk, 2:11-2:28

**Narration:** Exact `SCRIPT.md` audio from 2:11 through 2:28.

The scene begins on `assets/screens/live-proof-graph-v8-1920x1080.png` with the
captured source, evidence, claim, and entity order. It then changes to
`assets/screens/live-hydradb-1920x1080.png` and reframes the product's HydraDB
walk for one subject. The visible copy states that standing and replaced edges
remain readable.

HydraDB is shown as the graph retrieval substrate. The scene does not claim a
generic results bucket, a live write during playback, or a storage capability
that is absent from the product evidence.

## Scene 10: generated evaluation and parity, 2:28-2:47

**Narration:** Exact `SCRIPT.md` audio from 2:28 through 2:47.

`assets/screens/live-evaluations-1920x1080.png` is the base frame. The first-
party overlay keeps `generated 64-question evaluation` and `not a public
benchmark` visible with 64/64, zero false answers, zero unsupported answers,
18.27 mean estimated context tokens, the 1,843-token baseline, and the baseline
result of 63/64. The second proof panel shows self-hosted node and HydraDB Cloud
field parity as `ALL_IDENTICAL: true` and `0 mismatches`.

The cited records are `artifacts/bench/results.json` and
`artifacts/hydra/cloud-parity.json`. The film makes no general accuracy claim
beyond this labelled generated corpus and question set.

## Scene 11: close, 2:47-2:59

**Narration:** Exact `SCRIPT.md` audio from 2:47 through 2:57.398. The final
1.6025 seconds is picture hold without narration.

The labels `WEB`, `CLI`, `MCP`, `AGENTS`, `VOICE`, and `API` converge on
`assets/favicon.svg`. The close resolves to `THE AGENT CAN CHANGE. LACUNA
STAYS.`, `One evidence-bearing memory · every client · built on HydraDB`, and
`lacuna-five.vercel.app`.

The frame holds on the real Lacuna mark and deployment URL. It does not show a
repository URL, upload state, submission state, or partner logo wall.

## Source and output paths

All paths below exist in the current workspace. Paths beginning with
`video/hyperframes/` are relative to the repository root.

```text
video/hyperframes/
|-- index.html
|-- DESIGN.md
|-- SCRIPT.md
|-- STORYBOARD.md
|-- hyperframes.json
|-- meta.json
|-- narration.json
|-- assets/
|   |-- continuity.txt
|   |-- favicon.svg
|   |-- fonts/
|   |-- narration-vaibhav/lacuna-v8-vaibhav.mp3
|   `-- screens/
|-- capture-final/screenshots/
|-- compositions/
|   |-- beat-01-aperture.html
|   |-- beat-02-problem.html
|   |-- beat-03-architecture.html
|   |-- beat-04-demo.html
|   |-- beat-05-graph.html
|   |-- beat-06-agents.html
|   |-- beat-07-voice.html
|   |-- beat-08-hydradb.html
|   |-- beat-09-everywhere.html
|   |-- beat-10-proof.html
|   |-- beat-11-close.html
|   `-- captions.html
`-- renders/
    |-- lacuna-v8-judges-master-vaibhav.mp4
    `-- lacuna-v8-judges-master-vaibhav.srt

artifacts/
|-- bench/results.json
|-- cli/session.txt
|-- hydra/cloud-parity.json
`-- video/
    |-- final-metadata.json
    `-- judges-master/
```

The MP4 is a local ignored render output. Its metadata and curated review frames
are retained under `artifacts/video/`. The rendered candidate still requires
the owner's full-length approval before publication.
