# Claims the final V8 film may make, and where to check them

No final film is accepted yet. This table is the editorial gate: a claim may be
spoken only when the evidence in its row exists for the final deployment.

| Film claim | Checkable evidence |
| --- | --- |
| The deployed product answers on load | <https://lacuna-five.vercel.app/judge> and `web/src/pages/Judge.tsx` |
| Current answers include their sources | `/judge`; `POST /api/ask` |
| Replaced values remain revision history | `/judge`; answer envelope `revisions` |
| Conflicting sources are both kept | `/judge`; `CONFLICT` / `contradicted` |
| Unstated values produce no answer | `/judge`; `NO_EVIDENCE` / `never_stated` |
| A two-hop answer is cited | `/judge`; `via=vendor`, two evidence records |
| Lacuna web, CLI and MCP share one context | `artifacts/continuity/one-context.json`; do not call this ChatGPT/Claude proof |
| The seeded public graph measured 453 nodes and 682 edges | `GET /api/explore/graph`; `artifacts/screens/v8/proof-dag-final.png`; label the deployment/build |
| Two built-in governed roles persisted one eight-event completed run | `GET /api/explore/agents`, `GET /api/explore/runs`; `artifacts/screens/v8/agents-live.png`; do not imply arbitrary agents |
| The voice UI has explicit states and an honest fallback | `src/api/voice.ts`, `web/src/voice`; `artifacts/screens/v8/voice-idle.png`; do not imply provider audio |
| HydraDB Cloud stores conversations as evidence and entities as claims | `artifacts/hydra/cloud-ingest.json`; `src/hydra/cloud-graph.ts` |
| Lacuna filters statements that do not assert a fact | `video/hyperframes/assets/screens/live-hydradb-1920x1080.png`; extraction tests |
| Lacuna answers 64/64 at 18 context tokens on the generated 64-question evaluation | `artifacts/bench/results.json`; `/demo/evals`; explicitly say generated, not public benchmark |
| Self-hosted node and HydraDB Cloud matched field by field | `artifacts/hydra/cloud-parity.json` |
| Repository and deployment are public | <https://github.com/vaibhav4046/lacuna> · <https://lacuna-five.vercel.app> |

## Claims blocked from narration

- Google sign-in security until provider binding is integrated and reverified.
- Distributed exactly-once scheduler execution.
- Private MCP until issue/use/revoke works on production.
- A packaged Lacuna SDK or CLI/MCP agent lifecycle.
- A working Vaibhav voice clone until STT and TTS are heard in a production
  acceptance capture.
- ChatGPT or Claude continuity until each named client has connected.
- Supademo publication, a final MP4, or a YouTube URL until each artifact exists.
- Spotify or any other native connector.

The older graph, agent and voice PNGs are real production captures of the
previous acceptance build. They are not reconstructed interfaces, but they must
be recaptured when the final UI or deployment differs. See
`SCREENSHOT_EVIDENCE_PLAN.md`.
