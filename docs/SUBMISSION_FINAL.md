# Hack Hydra final submission handoff

This is the canonical owner handoff for the protected V10 release. It is
paste-ready except for the YouTube URL, which only the owner adds after the
local film passes owner review and is uploaded. The V10 machine gates now pass;
nothing in this file means the video
was uploaded or the form was submitted.

## Release identity

| Item | Accepted value |
| --- | --- |
| Track | 03 — Memory and Context Retrieval |
| Product commit | `05fe9d15dea75e4db7f5eb61d17533aa26e6e5a8` |
| Acceptance-doc commit | `695b55e63dd3a28ff6ee2f6f83ec3919bf6f0eaf` |
| Immutable deployment | `dpl_GZhotqcHc2p3f2AKCeezQKNidjwc` |
| Immutable URL | <https://lacuna-6fq3hiy9q-vaibhav4046s-projects.vercel.app> |
| Stable URL | <https://lacuna-five.vercel.app> |
| No-account judge path | <https://lacuna-five.vercel.app/judge> |
| Public repository | <https://github.com/vaibhav4046/lacuna> |
| Public `main` at release probe | `05fe9d15dea75e4db7f5eb61d17533aa26e6e5a8` |

The machine-readable release probe is
[`artifacts/submission/v10-exact-release-probe.json`](../artifacts/submission/v10-exact-release-probe.json).
Later local commits do not inherit this deployment gate.

## Paste-ready official form answers

### Project name

```text
Lacuna
```

### Short project description

```text
Lacuna is temporal, provenance-first memory for long-running agents, built on
HydraDB. It keeps corrections, contradictions and exact source evidence as a
queryable graph, returns the current supported answer, and names the reason
when the history cannot support one.
```

### Problem being addressed

```text
Long-running agents do not only forget. They confidently retrieve facts that
were later corrected, treat proposals as decisions, collapse two disagreeing
sources into one answer, and invent answers for facts that were never stated.
Similarity search can rank relevant passages, but it does not establish which
claim is current, what it replaced, or whether the evidence is missing.

Lacuna gives cross-session memory an explicit temporal and provenance model so
another model receives a small, evidence-bearing Context Pack instead of an
unresolved transcript.
```

### What was built

```text
Lacuna ingests conversations as immutable source evidence and claim records.
Corrections create explicit supersession history instead of overwriting old
facts. A deterministic resolver returns current answers, source quotations,
revisions, conflicts, proof paths and machine-readable abstention reasons.

The product includes a deployed no-account judge workspace, plain-English Ask,
a searchable memory table, an interactive overview graph, an exact evidence
DAG, a nine-command CLI, stdio MCP, a live seven-tool read-only HTTP MCP
endpoint, and two bounded no-write agent roles with persisted Work records and
handoffs. Signed-in workspaces and daily schedule definitions exist; the public
preview remains read-only.

The reproducible demo corpus contains 72 generated sessions, 5,246 messages,
174 claims and 86 entities. On its generated 64-question evaluation, Lacuna
answered 64/64 with zero false or unsupported answers and used 18.27 mean
estimated context tokens. The strongest tested flat-retrieval configuration
answered 63/64 with 1,842.57. This is a single generated corpus, not official
LongMemEval or a general accuracy claim. No LongMemEval score was produced.
```

### Deployed project link

```text
https://lacuna-five.vercel.app
```

Optional direct judge link:

```text
https://lacuna-five.vercel.app/judge
```

### How the project uses the HydraDB Open Source Repo

```text
HydraDB is Lacuna's persistent context substrate, not a decorative export. In
the accepted production profile, 72 generated conversation sources, 86
addressed entity records and one index record were accepted and indexed in a
workspace-scoped HydraDB Cloud collection. The answer path fetches those
deterministically addressed records; HydraDB's query and relations surfaces
separately expose semantic and graph context. Lacuna then applies temporal
standing, contradiction handling, abstention and bounded relationship
resolution in application code.

The repository also includes a self-hosted adapter pinned to HydraDB v0.1.1.
That adapter stores nodes and edges and executes bounded native Cypher through
NodeSource; 162 compatibility probes are retained. Native Cypher is genuine
self-hosted proof, but it is not the deployed Cloud answer path.

The two adapters returned field-for-field identical outcomes on all 64
generated questions. Without HydraDB, the deployed product loses its durable,
collection-scoped source and claim records, relation inspection, graph context
and shared retrieval seam. Lacuna's policy layer is deliberately separate: it
decides what is current or unsupported after HydraDB returns the evidence.
```

### Tech stack used

```text
TypeScript, Node.js 20.11+, HydraDB over HTTP, React 19, React Router, Vite,
the official Model Context Protocol SDK, Vitest, hash-wasm and HyperFrames.
Lacuna code is Apache-2.0. HydraDB is AGPL-3.0 and runs as a separate service.
```

### Team members and individual contributions

```text
Vaibhav Lalwani — solo builder: product design, temporal memory model, HydraDB
adapters and evaluation, web product, CLI and MCP surfaces, agent runtime,
testing, deployment, documentation and demo direction.
```

### GitHub repository link

```text
https://github.com/vaibhav4046/lacuna
```

### Three-minute demo video link

```text
[OWNER: PASTE THE VERIFIED UNLISTED YOUTUBE URL HERE]
```

Do not use an earlier V8 render. The accepted V10 master must be at most 179
seconds, carry the Vaibhav Lalwani Professional narration, contain burned-in
captions, and pass the local metadata and full-length review gates. Publication
of the clone narration also requires the owner's confirmation that its use is
authorized.

Local V10 master: `video/hyperframes-v10/renders/lacuna-v10-hack-hydra-final.mp4`
(178.500 seconds; SHA-256
`e73e6e0bf1de598b3c1c998a43057ac06e8dcb3b492a19d3ac8623c8d9cb9d96`).
Machine acceptance is recorded in
[`artifacts/video/v10-final-metadata.json`](../artifacts/video/v10-final-metadata.json).

## Claims deliberately excluded

- Production Cloud does not execute the self-hosted native-Cypher answer path.
- The exact 399-character `package-session` request is `NOT_PROVEN`.
- Bounded file ingestion (TXT, Markdown, JSON, CSV, PDF and DOCX), public
  GitHub/GitLab snapshots, public HTTPS/API import and signed webhook delivery
  are implemented. Linear, Jira, Slack, Notion, Gmail, Confluence and Database
  source remain planned account integrations. Spotify is not implemented.
- ChatGPT is proved only for the seven-tool public read-only corpus. Private
  `remember` is not accepted. Claude was not tested.
- No packaged Lacuna SDK is published. The official MCP SDK is an internal
  dependency.
- Provider-backed voice is bounded and tested; typed Ask remains the explicit
  fallback whenever microphone, provider or browser playback is unavailable.
- Google OAuth security and an authorized chooser → callback → dashboard round
  trip are accepted on the stable alias. The latest hosted session-read timeout
  and cross-browser playback candidate are pushed but await Vercel promotion.
- Hosted schedules are persistent; distributed exactly-once execution is not
  claimed.
- The evaluation is generated and is not LongMemEval. No official benchmark
  score exists.

## Exact owner-only finish

1. Open the final local MP4 and its matching V10 metadata/SRT; confirm duration
   is at most 179 seconds, audio and captions are complete, no secret or private
   identifier appears, and every claim matches
   [V10_FINAL_EVIDENCE_MAP.md](V10_FINAL_EVIDENCE_MAP.md).
2. Watch the entire film once without scrubbing. Confirm the Vaibhav clone is
   authorized for publication.
3. Upload that exact MP4 to YouTube as **Unlisted**. Do not upload the rejected
   V8 film.
4. Open the YouTube URL in a signed-out/private window, confirm it plays without
   an access request, and verify YouTube displays a runtime below 3:00.
5. Paste the URL above, copy the official answers into the form, re-open the
   production and repository links signed out, then submit and retain the
   confirmation.

Optional proof improvements such as completing a fresh Google identity callback
or reminting a private MCP capability are not required to submit and must not be
described as complete unless separately captured.

## Current submission state

The repository and product links are public and verified, and the local V10
master passes codec, duration, decode, audio, SRT and sampled-frame gates. The
official entry is still incomplete until the owner watches and authorizes the
film, uploads it, inserts its
viewable URL, and submits the form. No upload or submission was performed while
preparing this handoff.
