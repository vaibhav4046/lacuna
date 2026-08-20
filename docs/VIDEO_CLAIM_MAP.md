# Every claim the V8 film makes, and where to check it

| Film claim | Checkable evidence |
| --- | --- |
| The deployed product answers on load | <https://lacuna-five.vercel.app/judge> and `web/src/pages/Judge.tsx` |
| Current answers include their sources | `/judge`; `POST /api/ask` |
| Replaced values remain revision history | `/judge`; answer envelope `revisions` |
| Conflicting sources are both kept | `/judge`; `CONFLICT` / `contradicted` |
| Unstated values produce no answer | `/judge`; `NO_EVIDENCE` / `never_stated` |
| A two-hop answer is cited | `/judge`; `via=vendor`, two evidence records |
| Site, CLI and MCP share one context | `artifacts/continuity/one-context.json` |
| The public graph contains 453 nodes and 682 edges | `GET /api/explore/graph`; `artifacts/screens/v8/proof-dag-final.png` |
| Two governed agent roles persist an eight-event completed run | `GET /api/explore/agents`, `GET /api/explore/runs`; `artifacts/screens/v8/agents-live.png` |
| The voice UI has 15 explicit states and an honest fallback | `src/api/voice.ts`, `web/src/voice`; `artifacts/screens/v8/voice-idle.png` |
| HydraDB Cloud stores conversations as evidence and entities as claims | `artifacts/hydra/cloud-ingest.json`; `src/hydra/cloud-graph.ts` |
| Lacuna filters statements that do not assert a fact | `video/hyperframes/assets/screens/live-hydradb-1920x1080.png`; extraction tests |
| Lacuna answers 64/64 at 18 context tokens in the recorded benchmark | `artifacts/bench/results.json`; `/demo/evals` |
| Self-hosted node and HydraDB Cloud matched field by field | `artifacts/hydra/cloud-parity.json` |
| Repository and deployment are public | <https://github.com/vaibhav4046/lacuna> · <https://lacuna-five.vercel.app> |

The film does not narrate latency, adoption, a testimonial, a provider-enabled
voice deployment, or arbitrary third-party connectors. Its graph, agent and
voice frames are production captures, not reconstructed interfaces.
