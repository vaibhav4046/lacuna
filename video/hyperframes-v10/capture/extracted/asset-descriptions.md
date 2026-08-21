# Accepted V10 asset inventory

This inventory contains only the frozen V10 product and approved repository
assets. The rejected V8 film, V8 composition and V8 screenshots are excluded.
Every raw clip below passed the strict recorder gate: 1920×1080 H.264/yuv420p
at 30 fps, zero CDP protocol gaps, zero acknowledgement failures, matching
file/metadata SHA-256 and no unexpected API or transport failure.

## Immutable live captures

- `[video] assets/captures/01-landing-truth.mp4` — V10 landing truth scroll.
- `[video] assets/captures/02-memory-table.mp4` — searchable memory table and contradicted record.
- `[video] assets/captures/03-ask-conflict-abstain.mp4` — real `CONFLICT` answer followed by `NO_EVIDENCE / NEVER_STATED`.
- `[video] assets/captures/04-graph-3d.mp4` — real graph rotate, zoom, filter and relationship selection.
- `[video] assets/captures/05-agent-recommendations.mp4` — memory-derived Researcher/Reviewer recommendations.
- `[video] assets/captures/06-agent-work.mp4` — completed run, lifecycle receipt and persisted schedule.
- `[video] assets/captures/07-mcp-live.mp4` — two real Streamable HTTP `/mcp` POSTs, both HTTP 200.
- `[video] assets/captures/08-cli-recorded.mp4` — recorded real CLI session artifact in the frozen V10 product.
- `[video] assets/captures/09-hydradb-proof.mp4` — connected HydraDB records, native relations and evidence path.
- `[video] assets/captures/10-evaluation-truth.mp4` — explicitly generated 64-question evaluation and no-LongMemEval-score disclosure.
- `[video] assets/captures/11-voice-truth.mp4` — typed fallback and truthful provider-unavailable state; its only non-2xx response is the exact declared `POST /api/explore/voice/speech = 403` boundary.
- `[video] assets/captures/12-landing-close.mp4` — final `#hydra → #evals → close` landing motion.
- `assets/brand/lacuna-mark.svg` — exact accepted white open spiral and `#FFB829` amber origin dot.

## Timing-only edit derivatives

These files change playback timing only. They contain no reconstructed UI,
synthetic product state, inserted cursor, invented graph data or substituted
response. Each remains 1920×1080 H.264/yuv420p at 30 fps.

- `[video] assets/cuts/12-frame1-6.4.mp4` — Frame 1 landing close, 6.4s.
- `[video] assets/cuts/01-frame2-16.2.mp4` — Frame 2 landing truth, 16.2s.
- `[video] assets/cuts/02-frame3-13.0.mp4` — Frame 3 memory table, 13.0s.
- `[video] assets/cuts/03-frame4-20.8.mp4` — Frame 4 Ask proof, 20.8s.
- `[video] assets/cuts/04-frame5-15.8.mp4` — Frame 5 graph proof, 15.8s.
- `[video] assets/cuts/05-frame6a-5.0.mp4` — Frame 6 agent recommendations, 5.0s.
- `[video] assets/cuts/06-frame6b-11.8.mp4` — Frame 6 work receipt, 11.8s.
- `[video] assets/cuts/08-frame7a-14.6.mp4` — Frame 7 CLI proof, 14.6s.
- `[video] assets/cuts/07-frame7b-18.0.mp4` — Frame 7 MCP proof, 18.0s.
- `[video] assets/cuts/11-frame8-16.0.mp4` — Frame 8 voice boundary, 16.0s.
- `[video] assets/cuts/09-frame9-20.2.mp4` — Frame 9 HydraDB proof, 20.2s.
- `[video] assets/cuts/10-frame10-15.0.mp4` — Frame 10 generated evaluation, 15.0s.

The local Vaibhav Professional narration cues are deliberately outside this
inventory and gitignored as biometric source audio.
