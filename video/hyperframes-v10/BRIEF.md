---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Lacuna gives every agent one current, inspectable, portable memory by compiling provenance-aware context from HydraDB"
destination: youtube-unlisted
aspect: 1920x1080
language: en
audience: Hack Hydra judges
length: 179s-max
angle: problem-to-live-proof
narration: yes
voice: "Vaibhav Lalwani Professional"
style_preset: broadside
---

## Intent

Create the final three-minute Hack Hydra pitch and working-product demo. It must
lead with the failure mode—old truth recalled as current—then prove Lacuna with
real product interaction, explain exactly why HydraDB matters, and close on
bounded evaluation evidence. The tone is technically precise, ambitious, fast,
and understandable without pausing.

## Assets

- `http://127.0.0.1:4174` — accepted V10 local build; capture real browser motion at 1920x1080.
- `../../web/src/design/mark.tsx` — approved one-stroke white spiral and one amber origin dot.
- `../../design/reference/Lacuna Product.dc.html` — source oracle for the approved mark.
- `../../artifacts/cli/session.txt` — recorded real CLI evidence.
- `../../artifacts/hydra/cloud-parity.json` — HydraDB parity evidence.
- `../../artifacts/bench/results.json` — labelled generated evaluation evidence.

## Customizations

- Use moving browser recordings for landing, Ask, Memory/3D graph, Agents, MCP, HydraDB, and evaluation views.
- Use a real terminal recording for CLI and real MCP output; do not simulate typing or responses.
- Include sentence-level captions sized for a 1920x1080 judge video.
- Use the named `Vaibhav Lalwani Professional` voice clone when the local provider credential is available.
- Keep private/generated voice audio local and ignored; never commit biometric audio.

## Notes

- Hard limit: 179 seconds; judges may stop after 180 seconds.
- Required coverage: problem, what was built, working demo, how HydraDB is used and why graph-native memory matters.
- The rejected V8 master, V8 screenshots, and its static framing are forbidden as final footage.
- No generic purple palette, yellow glow, partner-logo wall, invented metrics, fake cursor, fake product state, or unsupported SDK/voice/scheduler claims.
- Do not upload to YouTube, submit the hackathon form, deploy, commit, or push from this project.
