# V10 live-capture acceptance gate

Captured from the frozen local V10 product at `http://127.0.0.1:4174` on
2026-08-21. These are the only browser/CLI/MCP visuals eligible for the final
judge film. The rejected V8 film and its screenshots are excluded.

## Shared gate

- 12/12 clips: 1920×1080, H.264, yuv420p, 30/1 fps, no audio.
- 12/12 clips: non-empty and independently ffprobed.
- 12/12 clips: file SHA-256 matches its persisted metadata.
- 12/12 clips: `protocolSequenceGaps = 0` and `acknowledgementFailures = 0`.
- Same-origin `/api/*` and `/mcp` traffic: no unexpected HTTP ≥400 response
  and no unmatched transport failure.
- React development StrictMode cancellations are retained in metadata and are
  tolerated only when the same method/path completed below HTTP 400 in that
  exact shot.
- Voice truth shot: the only declared non-2xx response is the real
  `POST /api/explore/voice/speech = 403` provider boundary.
- MCP shot: two real Streamable HTTP `/mcp` POSTs both returned HTTP 200.

## Per-clip receipt

| # | Clip | Seconds | SHA-256 |
|---:|---|---:|---|
| 01 | `01-landing-truth.mp4` | 5.833 | `a5fa3a7fe39ff5434c31825cb6b65c43c7abd82ccacdc4a1016e7755f3e6626b` |
| 02 | `02-memory-table.mp4` | 3.867 | `ae405829a0e14d44204b4417d4d79e317ae05a574950d78139e16fd4432b0e04` |
| 03 | `03-ask-conflict-abstain.mp4` | 12.967 | `54c528a3808c01da0ae60969f43f21a2ffeb718baaf860d4286b75fd2a1e95ea` |
| 04 | `04-graph-3d.mp4` | 7.000 | `7391f4eb6db98b34b5655ab9b733c40b5d7fb3810643f9d9d5fad065ce28a348` |
| 05 | `05-agent-recommendations.mp4` | 3.800 | `1060ccdcf16694192f02581df5f37c0bafd598f1e4b8a9851cffd4a52e23e4a3` |
| 06 | `06-agent-work.mp4` | 3.267 | `f45bb484722da00a50498b1fc4682685bd4c7aafe164d01e7fc73a973f16b17e` |
| 07 | `07-mcp-live.mp4` | 3.200 | `899480503eb5c92c6ef70660a2e718da6ea5b6facdda240e21993f18a3b44873` |
| 08 | `08-cli-recorded.mp4` | 5.967 | `341866cd3ab4b453c1ff93472407f93a852e426d307930e10980a50bf7557309` |
| 09 | `09-hydradb-proof.mp4` | 5.867 | `633f5ca39c6bb668567859952d8e107df0a4245b8422d71e082c884b9e6e58e1` |
| 10 | `10-evaluation-truth.mp4` | 4.167 | `9e6a4a89a165c201b4e656fbd48a2f196de30d12ea43ba1d87b6ab6cf7c29c75` |
| 11 | `11-voice-truth.mp4` | 6.533 | `97d9ad4ea5b4842eebb2866856978f6c5e34b970e20df19f158f9a659f528ce0` |
| 12 | `12-landing-close.mp4` | 7.067 | `7bc021ded242e055ff8c63dbb0363f3b2dec89c895ae4cd7c78784e89f8e32ea` |

The MP4s are generated local evidence and gitignored. Their redacted metadata
JSON files remain beside them for reproducibility; typed values and exact text
markers are never persisted.
