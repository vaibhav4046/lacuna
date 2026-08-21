# Claims the V10 submission film may make, and where to check them

The earlier rendered V8 candidate was rejected and is not the submission
master. This table is the V10 editorial gate: a claim may be spoken only when
the evidence in its row exists for the final deployed build and appears in the
live capture or a clearly labelled artifact.

| Film claim | Checkable evidence |
| --- | --- |
| The deployed product answers on load | <https://lacuna-five.vercel.app/judge>; `web/src/pages/Judge.tsx`; `artifacts/video/judges-master/02-ask-conflict.png` |
| Current answers include their sources | `/judge`; `POST /api/ask` |
| Replaced values remain revision history | `/judge`; answer envelope `revisions` |
| Conflicting sources are both kept | `/judge`; `CONFLICT` / `contradicted` |
| Unstated values produce no answer | `/judge`; `NO_EVIDENCE` / `never_stated` |
| A two-hop answer is cited | `/judge`; `via=vendor`, two evidence records |
| Lacuna web, CLI and MCP share one context | `artifacts/continuity/one-context.json`; do not call this ChatGPT/Claude proof |
| The seeded public graph measured 453 nodes and 682 edges | `GET /api/explore/graph`; `artifacts/video/judges-master/03-graph-overview.png`; label the deployment/build |
| Two built-in governed roles persisted one eight-event completed run | `GET /api/explore/agents`, `GET /api/explore/runs`; `artifacts/video/judges-master/04-agents.png`; do not imply arbitrary agents |
| The voice UI has explicit states and an honest fallback | `src/api/voice.ts`, `web/src/voice`; `artifacts/video/judges-master/05-voice.png`; do not imply provider audio |
| The accepted V10 film uses the Vaibhav Lalwani Professional narration | regenerate and verify `video/hyperframes/narration.json` plus `artifacts/video/final-metadata.json`; the exact raw MP3 remains local and gitignored; V8 metadata does not pass the V10 master; this is not product voice proof |
| HydraDB Cloud stores conversations as evidence and entities as claims | `artifacts/hydra/cloud-ingest.json`; `src/hydra/cloud-graph.ts`; `artifacts/video/judges-master/06-hydradb.png` |
| Lacuna filters statements that do not assert a fact | `video/hyperframes/assets/screens/live-hydradb-1920x1080.png`; extraction tests |
| Lacuna answers 64/64 at 18 context tokens on the generated 64-question evaluation | `artifacts/bench/results.json`; `artifacts/video/judges-master/07-evaluation.png`; explicitly say generated, not public benchmark |
| Self-hosted node and HydraDB Cloud matched field by field | `artifacts/hydra/cloud-parity.json` |
| Repository and deployment are public | <https://github.com/vaibhav4046/lacuna>; <https://lacuna-five.vercel.app>; `artifacts/video/judges-master/08-close.png` |

## Claims blocked from narration

- Google sign-in security until provider binding is integrated and reverified.
- Distributed exactly-once scheduler execution.
- Private MCP until issue/use/revoke works on production.
- A packaged Lacuna SDK or CLI/MCP agent lifecycle.
- A working product voice round-trip until STT, TTS, playback and interruption
  are heard in a production acceptance capture. The film narration is separate.
- ChatGPT or Claude continuity until each named client has connected.
- Supademo publication, owner approval, or a YouTube URL until each exists.
- Spotify or any other native connector.

The older graph, agent and voice PNGs are real production captures of the
previous acceptance build. They are not reconstructed interfaces, but they must
be recaptured when the final UI or deployment differs. See
`SCREENSHOT_EVIDENCE_PLAN.md`.
