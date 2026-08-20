# V8 demo video script

This is the composition that is actually built by
`video/hyperframes/build.mjs`. It supersedes the earlier manual-capture script.
The generated timeline is 175.2 seconds: 2:55.2, leaving 4.8 seconds below the
three-minute judging limit.

## Required coverage

| Submission requirement | Film coverage |
| --- | --- |
| the problem | scenes s01–s02 |
| what was built | scenes s03 and s14 |
| working demo | scenes s04–s09 and s16–s18 |
| how HydraDB is used | scenes s10, s15 and s12 |

## Timeline

| Time | Scene | What the viewer sees |
| --- | --- | --- |
| 0:00.8–0:06.2 | s01 | the memory problem and Lacuna mark |
| 0:06.2–0:21.2 | s02 | four mutually different statements still present in memory |
| 0:21.2–0:33.0 | s03 | conversations → claims/time/source → answer/evidence |
| 0:33.0–0:43.8 | s14 | live extraction: proposal and instruction text excluded from answers |
| 0:43.8–0:52.9 | s04 | deployed current-state answer with evidence |
| 0:52.9–1:03.0 | s05 | revision history preserved |
| 1:03.0–1:12.6 | s06 | explicit conflict, with no arbitrary winner |
| 1:12.6–1:20.3 | s07 | structured no-evidence abstention |
| 1:20.3–1:29.1 | s08 | cited two-hop answer |
| 1:29.1–1:45.3 | s09 | one store read through site, CLI and MCP |
| 1:45.3–1:49.9 | s16 | production graph: 453 nodes, 682 edges, overview/proof/table |
| 1:49.9–1:54.5 | s17 | governed Researcher → Reviewer run with eight persisted events |
| 1:54.5–1:59.1 | s18 | 15-state voice surface and honest typed fallback |
| 1:59.1–2:11.7 | s10 | HydraDB Cloud: evidence and claims stored separately |
| 2:11.7–2:24.3 | s15 | HydraDB's own graph walk and negative-evidence filtering |
| 2:24.3–2:38.2 | s11 | five retrieval baselines and the 64-question result |
| 2:38.2–2:46.9 | s12 | self-hosted/Cloud field-by-field parity |
| 2:46.9–2:54.6 | s13 | public deployment and repository close |

The exact narrated copy lives in `video/hyperframes/SCRIPT.md`. The V8 graph,
agent and voice scenes are intentionally silent proof beats; their claims are
on screen and do not extend the narration.

## Render contract

- 1920×1080, 30 fps, H.264/AAC MP4.
- Captions are generated from the exact scene narration into
  `video/hyperframes/renders/lacuna-demo.srt`.
- HyperFrames runtime, layout, motion and contrast checks must pass before the
  final render.
- The final render requires manual preview approval. The YouTube upload remains
  unlisted and must be opened once without a signed-in session.
