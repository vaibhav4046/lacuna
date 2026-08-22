# Lacuna V10: three-minute pitch and live-demo cue sheet

Target master: 177 seconds, 1920x1080, 30 fps, H.264/AAC, web-viewable and
strictly below 180 seconds. The earlier V8 film is rejected and must not be
reused as the submission master.

Narration voice: the owner's **Vaibhav Lalwani Professional** clone, generated
from the approved private voice profile. Keep raw clone audio local and
gitignored. Narration is not evidence that product voice works.

## Editorial rules

- At least 75% of the runtime must show moving, real product capture: browser,
  terminal or MCP client output.
- Use the exact Lacuna mark from `web/public/mark-256.png` or the matching amber
  vector in `web/public/favicon.svg`. Never recolour it purple or substitute the
  older orange-head reference export.
- Keep the browser cursor visible during the demo. Each click, drag, filter and
  scroll must produce a readable state change.
- Do not show a static screenshot for more than five seconds. Camera movement
  over a screenshot does not count as product interaction.
- Burn in sentence captions, not word karaoke. Keep captions inside the lower
  safe area and away from terminal output.
- Put `LIVE PRODUCT`, `RECORDED CLI`, `LIVE MCP` or `GENERATED EVALUATION` on
  proof shots. Never let a reconstruction read as a live result.
- Do not claim ChatGPT, Claude, provider-backed voice, distributed exactly-once
  schedules, private MCP write, native connectors or a packaged SDK.

## Time-coded cut

| Time | Picture and required action | Narration |
| --- | --- | --- |
| 0:00-0:08 | Exact mark draws from white tail to amber head on black. The live landing resolves behind it and starts scrolling before the cut. | **An agent can retrieve the right sentence and still be wrong. It used yesterday's truth.** |
| 0:08-0:23 | Real landing memory-failure sequence. Evidence particles become four readable states: current, replaced, disputed and missing. | **Ordinary memory ranks similar chunks. It does not know which claim was corrected, which was only proposed, where two sources disagree, or whether nobody ever said it.** |
| 0:23-0:41 | Live `/explore/ask`. Type `what does token-forge depend on?`; submit; hold on the visible interpretation, answer and source. Open Evidence. | **We built Lacuna: temporal, provenance-first memory on HydraDB. Ask in plain English. Lacuna shows how it read the question, answers only from standing evidence, and returns the exact source instead of a confidence score.** |
| 0:41-0:59 | Without a hard scene break, run `who is the runbook owner for billing-gate?`, then `when does Lowbank launch?`, then the Foxglove pool-size prompt. Show the changed status and evidence each time. | **Now try the failure cases. Billing-gate has two unresolved owners, so Lacuna keeps both and refuses to pick. Lowbank's launch was taken back. Foxglove's pool size was never stated. Contradicted, retracted and absent are three different answers.** |
| 0:59-1:22 | Live `/explore/graph`. Drag to rotate the V10 memory field, zoom, filter to current then conflict, select a node, switch to the readable table and focus a Context Pack. The totals must be visible. | **The same structure remains navigable in overview and table form. This production workspace reports four hundred fifty-three nodes and six hundred eighty-two edges. Rotate the field, isolate a standing, inspect one node, then use the same data as a table. The visualization is a control surface, not decoration.** |
| 1:22-1:40 | Switch to proof mode. Follow source to evidence to claim to entity. Highlight one superseded edge and its rejection reason. | **Proof mode removes the overview compression. It follows one deterministic path from source, to evidence span, to claim, to entity. Replaced evidence stays in history, and a rejected edge explains why it cannot answer now.** |
| 1:40-1:58 | Live `/explore/agents`, then `/explore/work`. Open Researcher and Reviewer. Expand the accepted run record and scroll through the eight lifecycle events, Context Pack and reviewer verdict. | **Memory becomes bounded work. Lacuna ships two governed, no-write roles: Researcher and Reviewer. The accepted production run persisted eight lifecycle events, the exact Context Pack, tool use, handoff and reviewer verdict. It did not silently write a new truth.** |
| 1:58-2:16 | Real terminal recording. Run `lacuna profile`, `lacuna read "who is the runbook owner for billing-gate?"`, then `lacuna timeline Bellwether beta_partner`. Keep output moving and legible. | **The same contract works outside the browser. The CLI has nine real commands. Here it names the HydraDB profile, reads the same plain-English question, and prints Bellwether's revision chain oldest first. An abstention still exits successfully because it is a result, not a crash.** |
| 2:16-2:31 | Live MCP call, not a mock terminal. Call `tools/list`; show the seven names. Call `lacuna_explain` once and reveal structured evidence. | **The public Streamable HTTP MCP endpoint is live. It advertises seven read-only tools, including search and fetch, and returns structured evidence. Lacuna also runs over stdio. There is no packaged Lacuna SDK, and we do not pretend there is.** |
| 2:31-2:49 | HydraDB architecture harness over real health, ingest/status/inspect/query/relations labels. Show `GET /api/health` four passes, then the Hydra comparison screen moving through relations. | **HydraDB is the context substrate, not a results bucket. Cloud ingest stores collection-scoped records and explicit relations. Status confirms indexing. Deterministic inspect reads feed the answer path. Query requests graph context, and the relations endpoint powers the store comparison. Lacuna applies temporal policy above that storage seam.** |
| 2:49-2:55 | Generated-evaluation card over recorded output. Label it `GENERATED 64-QUESTION EVALUATION — NOT LONGMEMEVAL`, show 64/64, zero unsupported, 18 tokens, and the 63/64 tuned baseline. | **Our generated evaluation—not LongMemEval—scored sixty-four of sixty-four with zero unsupported answers.** |
| 2:55-2:57 | Cut back through the living field into the exact mark. Product and repository URLs appear. | **Lacuna. Memory that knows what changed.** |

## Capture order

Record in this order so a late product fix invalidates the fewest shots:

1. Production health, graph totals and MCP catalog.
2. Ask sequence and exact proof graph.
3. Agents and Work record.
4. CLI and MCP calls.
5. Landing scroll and final logo motion.
6. Architecture and generated-evaluation overlays from verified artifacts.

## Required on-screen proof

| Claim | Source to show or preserve |
| --- | --- |
| HydraDB live | `GET /api/health` with four pass rows |
| 453 nodes, 682 edges | `GET /api/explore/graph?mode=overview&limit=1`, totals in `page` |
| seven public MCP tools | live `/mcp` `tools/list` response |
| two roles, eight events | `/api/explore/agents`, `/api/explore/runs` and the Work UI |
| shared contract | CLI result plus MCP structured result; use `artifacts/continuity/one-context.json` only as a labelled recorded artifact |
| generated evaluation | `artifacts/bench/results.json`; keep `GENERATED` visible for the whole shot |

## Final media gates

- [ ] Duration is at most 179.0 seconds by `ffprobe`, not by timeline estimate.
- [ ] Resolution is 1920x1080, frame rate is 30 fps, audio is present and the
      MP4 has faststart metadata.
- [ ] Narration uses the approved Vaibhav voice and contains no clipped first or
      final word.
- [ ] Every caption matches the heard sentence and remains inside safe bounds.
- [ ] At least 75% of runtime is real moving product capture.
- [ ] No token, cookie, capability, environment value, home path or private tab
      title appears in any frame.
- [ ] Every numeric claim maps to the same deployed build or named artifact.
- [ ] Full-length owner review passes.
- [ ] Owner uploads as unlisted or public and checks playback signed out.
