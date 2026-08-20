# Lacuna — three-minute launch film storyboard

**Format:** 1920×1080, 30 fps, 16:9, 175 seconds maximum
**Audio:** verified ElevenLabs narration + minimal electronic underscore + restrained interface SFX
**VO direction:** calm, incisive, technically credible; keynote pace with real pauses; never hype a state that is not visible
**Style basis:** `DESIGN.md` and exact production captures

## Global direction

The viewer travels through one Memory Aperture. It begins as the landing-page Gravity Field, turns to reveal a real artifact through its center, and then disappears once the product has been entered. Every subsequent scene is a distinct working surface: answer, memory, graph, agents, voice, HydraDB, CLI/MCP, and measured artifacts. Captured UI is never color graded or rewritten. Energy comes from camera moves, precise cursor actions, proof-path drawing, foreground metadata, and transitions around unchanged pixels.

The underscore is a restrained modular pulse: low sub and dry clockwork at the problem, a wider harmonic bed when Lacuna resolves the context, a near-silent drop for abstention and security proof, then a confident but not triumphant close. SFX are factual—click, key, path tick, state change, completion chime—not trailer impacts. Motion remains deterministic and seek-safe. Reduced-motion product behavior is shown in the accessibility appendix capture, not mixed into the main edit.

## Asset audit

| Asset | Type | Beat | Role |
| --- | --- | --- | --- |
| `capture-live/screenshots/scroll-000.png` | Live landing capture | 1 | Exact hero and Gravity Field aperture |
| `capture-live/screenshots/scroll-012.png` | Live landing capture | 2 | Six-capability product grid |
| `capture-live/screenshots/scroll-020.png` | Live landing capture | 2 | Temporal resolution transition |
| `capture-live/screenshots/scroll-028.png` | Live landing capture | 3 | How-it-works context architecture |
| `assets/screens/live-ask-1920x1080.png` | Deployed product | 4 | Answer, explanation, evidence, artifact |
| `assets/screens/live-memory-fullpage.png` | Deployed product | 5 | Readable memory inventory |
| `assets/screens/live-graph-v8-1920x1080.png` | Deployed product | 5 | Interactive graph and table |
| `assets/screens/live-agents-v8-1920x1080.png` | Deployed product | 6 | Agent ledger and schedule |
| `assets/screens/live-voice-v8-1920x1080.png` | Deployed product | 7 | Explicit voice state machine |
| `assets/screens/live-hydradb-top-1920x1080.png` | Deployed product | 8 | HydraDB counts and checks |
| `assets/screens/live-hydradb-1920x1080.png` | Deployed product | 8 | Store graph relations |
| `assets/screens/live-evaluations-1920x1080.png` | Deployed product | 10 | Labelled generated evaluation |
| `assets/continuity.txt` | Recorded CLI/MCP output | 9 | Exact same-store parity transcript |
| `assets/favicon.svg` | Brand mark | 1, 11 | Opening and closing Lacuna mark |
| `captures/final/landing-scroll.mp4` | Required real recording | 1–3 | Post-redesign landing scroll, no mockup |
| `captures/final/ask-to-artifact.mp4` | Required real recording | 4 | Typed question → answer → evidence artifact |
| `captures/final/graph-proof.mp4` | Required real recording | 5 | Overview → proof path → edge table |
| `captures/final/agent-schedule.mp4` | Required real recording | 6 | Recommendation → run → persisted result → schedule |
| `captures/final/voice-roundtrip.mp4` | Conditional real recording | 7 | Include only after production STT and TTS pass |
| `captures/final/cli-mcp.mp4` | Required real recording | 9 | Actual CLI plus actual MCP client session |

The final capture pass must refresh all `live-*` frames after the production deploy. Conditional voice media is omitted, not simulated, if the provider gate fails.

## Beat 1 — The memory aperture · 0:00–0:09

**VO:** “Your agent remembers the meeting, the pull request, and the runbook—as if all three were still true.”

**Concept:** We begin inside Lacuna’s mark, not on a title card. Tiny source glyphs orbit at full size, then camera distance reveals that they form the Memory Aperture beside the live landing-page headline. The product identity and problem arrive as one continuous discovery.

**Visual:** Exact `scroll-000.png` establishes the hero. The Lacuna mark traces on; four mono source chips—MEETING, PR, RUNBOOK, CHAT—ride the captured ring. A subtle telemetry corner shows `4 SOURCES / 1 DECISION`. Headline words settle on their spoken cues. The real CTA and HydraDB line remain visible.

**Techniques:** SVG stroke trace; deterministic Canvas 2D orbit matching captured glyph language; per-word kinetic type; slow push-in.

**Choreography:** mark DRAWS; source chips ORBIT; headline SETTLES word by word; camera PUSHES through the aperture on “true.”

**Transition:** registry `zoom-through-transition`, 0.55s, centered on the aperture opening.

**Depth:** BG captured black field; MG live hero; FG source chips, mark trace, telemetry corners.

**SFX:** one dry path tick per source; low sub begins; no logo boom.

## Beat 2 — Four memories, one decision · 0:09–0:27

**VO:** Problem paragraph from `SCRIPT.md`.

**Concept:** The viewer is inside the memory. Four intact source records occupy one spatial stack; none is erased. The sequence demonstrates why “retrieve everything” is not resolution.

**Visual:** Four exact-text records CASCADE in: Redis, Postgres proposal, implemented PR, confirmation. Their dates and source types remain readable. A thin violet time rail draws below them. On “hopes,” every record compresses into one overcrowded context window; on “current truth,” the current row separates while history and conflict remain behind.

**Techniques:** CSS 3D stack; SVG path drawing; strikethrough-replace only for the visual relationship, never deletion; velocity-matched shared-axis transition.

**Choreography:** records CASCADE; time rail DRAWS; context window COMPRESSES; current row LIFTS; historical rows HOLD.

**Transition:** registry `type-match-cut`; the word CURRENT opens the architecture lane.

**Depth:** BG sparse date grid; MG record stack; FG time cursor and source labels.

**SFX:** paper-dry card landings; one clipped overload hiss; clean locator chime on current.

## Beat 3 — Lacuna on HydraDB · 0:27–0:43

**VO:** What-we-built paragraph.

**Concept:** A living system diagram, not an architecture slide. Evidence enters from distinct clients, passes through Lacuna’s policy/compiler/router, becomes a compact Context Pack, while HydraDB’s persistent graph remains visible underneath as durable state.

**Visual:** The refreshed real landing architecture scroll is the base. Seven input chips arrive from transcript, corpus, ingest, MCP, CLI, API, and agent outcome. SVG beams connect into the Lacuna core. Evidence/claims/relationships descend into HydraDB; one compact pack exits toward MODEL, TOOL, AGENT. Each stage gets one concise live status line.

**Techniques:** real video compositing; tracing-beam path; state-chip rail; CSS 3D depth separation.

**Choreography:** inputs STREAM; beams TRACE; Hydra layer FILLS; Context Pack FOLDS to one-sixth width; output rail ADVANCES.

**Transition:** registry `gravitational-lens`, 0.7s, used once to enter the working product.

**Depth:** BG Hydra persistent layer; MG Lacuna compiler/router; FG clients, pack, telemetry.

**SFX:** seven quiet ingress ticks; low graph rumble; compact snap when the pack closes.

## Beat 4 — Ask, answer, inspect · 0:43–1:02

**VO:** Working-demo paragraph.

**Concept:** No montage tricks. We watch one uninterrupted real product action from question to artifact, then a fast truthful cut to abstention. The cursor is an actor whose movement explains the interface.

**Visual:** `ask-to-artifact.mp4` full frame. Cursor types the real question, submits, pauses during the live state, follows the answer to WHAT CHANGED, opens the cited sentence, then the artifact. A restrained HUD names `ANSWER / EXPLANATION / EVIDENCE / ARTIFACT`. Final five seconds hard-cut to an unanswered question and its reason.

**Techniques:** live video compositing; registry `simulated-cursor` only if capture cursor is absent; registry `ui-focus-zoom`; telemetry HUD.

**Choreography:** cursor TYPES and CLICKS; answer STREAMS; camera FOCUSES; evidence row HIGHLIGHTS; artifact OPENS; abstention CUTS in.

**Transition:** whip-pan along the artifact drawer edge into the memory table.

**Depth:** BG application chrome; MG exact product; FG focus brackets and tiny HUD only.

**SFX:** real keystrokes, one submit click, two evidence ticks, silence before the abstention reason.

## Beat 5 — Readable memory, navigable graph · 1:02–1:20

**VO:** Memory-and-graph paragraph.

**Concept:** Scale without spaghetti. The camera starts over a readable table, pulls back to reveal hundreds of graph elements, then follows one violet proof path and returns to the exact edge row.

**Visual:** Memory table scroll, graph overview, proof mode, and edge table all come from `graph-proof.mp4`. Count-up lands at 453 nodes and 682 relationships only when the live UI displays those values. Search/filter chips remain readable. A violet tracer follows query → claim → evidence → source.

**Techniques:** real video compositing; SVG tracing beam; counter; registry `ui-focus-zoom`; velocity throw-and-snap between overview and proof.

**Choreography:** table SCROLLS; camera PULLS BACK; counts LOCK; proof tracer WALKS; matching row SLIDES into focus.

**Transition:** proof tracer continues offscreen and becomes the agent-run event rail.

**Depth:** BG overview graph; MG focused nodes/table; FG violet tracer, counts, focus brackets.

**SFX:** soft node ticks increasing then stopping; four distinct path ticks.

## Beat 6 — Recommended agents that really run · 1:20–1:39

**VO:** Agents-and-scheduler paragraph.

**Concept:** Memory becomes bounded work. A recommendation is visibly justified by workspace evidence; then the run ledger proves Researcher, Reviewer, artifacts, retries, cancellation controls, and the daily schedule are real state—not decorative cards.

**Visual:** `agent-schedule.mp4` shows recommendation reason and evidence count, create/enable decision, one live run, expanding steps, artifact detail, a safe retry/cancel state, and `DAILY · 06:00 UTC`. A compact concurrency proof card appears only from the test artifact: 48 cron contenders, 32 Run Now callers, 32 duplicate callers.

**Techniques:** live video compositing; state-chip rail; tracing beam between Researcher and Reviewer; counter/stagger cascade.

**Choreography:** recommendation REVEALS; run STARTS; state chips ADVANCE; artifacts STACK; schedule LOCKS; concurrency values COUNT and HOLD.

**Transition:** schedule’s circular status indicator enlarges into the voice orb.

**Depth:** BG run ledger; MG artifact/schedule panels; FG state rail and bounded-tools labels.

**SFX:** deterministic state ticks; restrained completion chime; no celebratory confetti.

## Beat 7 — Voice is the same memory · 1:39–1:51

**VO:** Voice paragraph, conditional on the acceptance note in `SCRIPT.md`.

**Concept:** The orb is a state instrument. A real speech roundtrip moves through listening, committed transcript, thinking, evidence answer, speaking, and interruption; the typed fallback remains on screen so failure is never disguised.

**Visual:** `voice-roundtrip.mp4` unchanged. A mono rail names the exact state; the committed transcript appears once, the cited answer remains visible during speech, and an interrupt action returns to ready. If provider credentials are absent, replace this beat with a four-second honest `PROVIDER NOT CONFIGURED` proof and give recovered time to CLI/MCP.

**Techniques:** live video compositing; state-chip rail; audio-reactive orb driven only by recorded waveform amplitude; soft focus zoom.

**Choreography:** orb BREATHES; state rail ADVANCES; transcript COMMITS; answer APPEARS; speech PULSES; interrupt SNAPS to ready.

**Transition:** a clean audio cut and blur-through to HydraDB counts.

**Depth:** BG application; MG orb/transcript/answer; FG state rail and privacy label.

**SFX:** real voice audio; no synthetic waveform; one tactile interrupt click.

## Beat 8 — HydraDB is the durable graph · 1:51–2:08

**VO:** Why-HydraDB paragraph.

**Concept:** We separate evidence from claims physically. The frame becomes a two-layer ledger backed by the product’s HydraDB health and graph screens, making the storage role unmistakable.

**Visual:** `live-hydradb-top` and `live-hydradb` occupy two interlocking planes. 72 conversation records remain on EVIDENCE; 86 entities remain on CLAIMS. Relationships draw between them. Four verified checks light only if the live health route passes. A workspace-isolation bracket encloses one collection while others stay dim.

**Techniques:** CSS 3D planes; SVG path draw; counter; telemetry HUD.

**Choreography:** ledgers SPLIT; counts ROLL; relations DRAW; health checks STAMP; scope bracket CLOSES.

**Transition:** one relation line straightens into a terminal prompt.

**Depth:** BG graph relations; MG evidence/claim planes; FG checks and workspace bracket.

**SFX:** low database pulse; four quiet check ticks; terminal cursor click.

## Beat 9 — One store, every client · 2:08–2:28

**VO:** Everywhere paragraph.

**Concept:** This is the credibility beat developers will pause. A real CLI and real MCP client ask the same question; the output lines, evidence, timing, and parity marker are captured directly.

**Visual:** `cli-mcp.mp4` begins full screen on `lacuna status`, continues to `lacuna ask`, then splits to the MCP client invocation and returned record. The remote endpoint and TypeScript SDK call appear as two brief exact-code inserts. `ONE_CONTEXT_IDENTICAL` lands from the recorded artifact, not retyped marketing copy.

**Techniques:** real video compositing; terminal focus zoom; code highlight; match cut on identical answer lines.

**Choreography:** commands TYPE in the recording; output STREAMS; answer lines ALIGN; parity marker STAMPS; endpoint/SDK inserts SLIDE and HOLD.

**Transition:** terminal rows collapse into the evaluation table rows.

**Depth:** BG terminal capture; MG MCP/SDK inserts; FG source/evidence locator and parity stamp.

**SFX:** recorded key cadence lowered beneath VO; response chime; matched click on parity.

## Beat 10 — Measure before claiming · 2:28–2:47

**VO:** Measured-proof paragraph.

**Concept:** Claims and caveats arrive together. The generated evaluation label is as visible as 64/64; the context-token comparison is large but never detached from the baseline and artifact path.

**Visual:** Exact evaluation screen forms the base. 64/64 counts up beside `GENERATED EVALUATION`; 32 correct abstentions appears; baseline 63/64 and 1,843 tokens draw as a restrained bar; Lacuna’s 18.27 draws beside it. Self-hosted and cloud columns compare field-by-field and resolve to identical. Artifact paths remain readable.

**Techniques:** data chart; SVG line draw; counters; text callout highlight.

**Choreography:** results COUNT; caveat UNDERLINES; bars GROW; parity columns SCAN; `ALL_IDENTICAL` LOCKS.

**Transition:** bars narrow into five client lines converging on one mark.

**Depth:** BG evaluation table; MG counters/bars; FG generated label, artifact paths, parity lock.

**SFX:** dry counter ticks; no casino roll; one restrained resolve chord.

## Beat 11 — The agent can change · 2:47–2:55

**VO:** Close paragraph.

**Concept:** The system expands without turning into a logo wall. Coding, voice, support, personal, music, and enterprise use-case labels orbit once, then disappear into the Lacuna aperture; one durable mark remains.

**Visual:** Six client labels converge along thin lines. The Lacuna logo assembles from its actual SVG geometry, not a new symbol. The final lockup reads `THE AGENT CAN CHANGE. LACUNA STAYS.` with deployment and repository beneath. HydraDB stays in the same frame as a factual foundation line.

**Techniques:** SVG path drawing; radial surround/converge; registry `logo-outro`; per-word closing lockup.

**Choreography:** clients ORBIT; lines CONVERGE; logo ASSEMBLES; tagline SETTLES; URL and repository FADE and HOLD for three seconds.

**Transition:** none; full hold, then clean cut to black before 2:56.

**Depth:** BG black; MG client lines; FG logo, tagline, two links, HydraDB foundation.

**SFX:** pulse resolves to one warm sustained note; no upload or submission slate.

## Production architecture

```text
video/hyperframes/
├── index.html
├── DESIGN.md
├── SCRIPT.md
├── STORYBOARD.md
├── transcript.json
├── narration.wav
├── capture-live/
│   ├── screenshots/
│   └── extracted/
├── captures/final/
├── assets/
│   ├── fonts/
│   ├── narration/
│   └── screens/
├── compositions/
│   ├── beat-01-aperture.html
│   ├── beat-02-problem.html
│   ├── beat-03-architecture.html
│   ├── beat-04-demo.html
│   ├── beat-05-graph.html
│   ├── beat-06-agents.html
│   ├── beat-07-voice.html
│   ├── beat-08-hydradb.html
│   ├── beat-09-everywhere.html
│   ├── beat-10-proof.html
│   ├── beat-11-close.html
│   └── captions.html
├── snapshots/
└── renders/
```
