# Security

## Reporting

This is a hackathon project, not a deployed service. If you find a
vulnerability, open a GitHub issue. Do not include a working exploit against
anyone's live data in the issue text.

## Scope of what runs

Lacuna is a local-first application. It talks to a HydraDB instance you run
yourself. There is no hosted Lacuna service, no account system, and no telemetry.

## Secrets

- The HydraDB auth token is read from the server environment and used only in
  server-side code. It is never sent to the browser, never logged, and never
  written into a committed file.
- `.env` is git-ignored. `.env.example` lists variable names with empty values.
- The Git history is scanned before publication, not just the working tree. A
  secret removed in a later commit is still a leaked secret.

### The history scan, run rather than promised

Every blob reachable from every ref, not the working tree and not `HEAD`. Run on
2026-08-13 across 26 commits and 229 blobs. The blob list is sanity-checked
against a known object before anything is scanned, because a scan that
enumerates nothing reports zero hits and looks exactly like a pass. The first
attempt at this did precisely that.

| Check | Result |
|---|---|
| Any `.env`, `.env.*`, or `auth-token` file ever added, on any ref | Never. `.env.example` is the only one, and it holds names |
| Vendor key shapes in every blob (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `xox[baprs]-`, `AIza`, PEM private key headers) | 0 hits across 229 blobs |
| Hex runs 44 to 63 characters long, in every blob | 0. The node's token is 48 hex characters, so a leaked one would land in that band. A SHA-256 is 64 and is deliberately outside it |

The token's own value was never read to perform this. Nothing of its shape is in
the history, so the token is not either, and establishing that never required
handling it.

Paths were checked separately, because a home directory in a committed
transcript leaks a username even when it leaks no secret. No tracked file
contains `/home/<user>`, `C:\Users\...`, or any other home directory. The
absolute paths that do appear are `/opt/hydradb` and `/var/lib/lacuna/hydradb`,
which are the documented install and store locations from
[scripts/hydra-node.sh](scripts/hydra-node.sh), plus one line in the
reproduction transcript recording which directory was cloned from. None
identifies a person or a machine.

No screenshot in this repository shows a path, a URL bar, or a token. See
[artifacts/screens](artifacts/screens/README.md) for how they were captured.

If a token is ever exposed, rotate it. HydraDB's local development token is
disposable by design and the documented one is public in upstream's README, which
is exactly why it must never be reused anywhere real.

## Threat model

Written up in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), covering the things
that actually apply to a memory system: prompt injection carried inside stored
content, namespace isolation between users, unbounded input, unbounded queries,
and evidence text rendered back into a page.

The threat model is exercised by tests, not just described. Where a mitigation is
described but not yet tested, [STATE.md](STATE.md) says so.

### Controls executed against the running node

These are not design intentions. Each one is a request that was sent to a live
HydraDB `v0.1.1` node on 2026-08-12, with the status and full response body
recorded in [artifacts/cypher-probe/](artifacts/cypher-probe/README.md).

| Control | What was sent | Result |
|---|---|---|
| Bearer auth required | A valid query with a wrong token | **401** `valid bearer authentication is required` |
| Bearer auth required | The same query with no `Authorization` header | **401** same message |
| Namespace isolation | Valid token, `X-Graph-Namespace: other-tenant` | **403** `principal bearer principal is not authorized to read graph scope other-tenant/graphs/default` |
| No default namespace | The header omitted entirely | **400**, rather than falling back to `local` |
| One statement per request | Two Cypher statements separated by `;` | Rejected, so an injected second statement has nowhere to run |
| Request timeout honoured | `timeout_ms: 1` | **408 in 4.2ms** |
| Result size bounded | `page_size: 2` against a three-row result | Two rows and a `next_cursor` |
| Cursors are not capabilities | A valid cursor replayed with a wrong token, a foreign namespace, a different `query_id`, and different query text | **401**, **403**, **400**, **400**. Auth and namespace are checked before the cursor is looked at |
| Bookmarks are scoped | A well-formed bookmark naming another namespace | **400** `graph scope mismatch: expected local/graphs/default cell cell-0, received other-tenant/graphs/default cell cell-0` |

Two things these results are not. They are controls belonging to HydraDB, so
they set a floor and do not excuse Lacuna's own code from using them correctly.
And they were run against loopback with TLS disabled, which is the documented
local development configuration, so nothing here says anything about a HydraDB
deployment exposed to a network.

## Demo data

The demo corpus is synthetic and generated by committed code. No real personal
chat history, from anyone, appears in this repository, in the screenshots, or in
the video.

## Dependencies

Third-party components and their licenses are listed in
[THIRD_PARTY.md](THIRD_PARTY.md).

Lacuna has no runtime dependencies. `package.json` has no `dependencies` block
at all, only `devDependencies`: the server, the retrieval code and the HydraDB
client are written against Node's standard library.

`npm audit` on 2026-08-13 exits 1 with four high-severity advisories, and both
roots report no fix available:

```
adm-zip  <0.6.0   GHSA-xcpc-8h2w-3j85   crafted archive triggers a 4GB allocation
  via onnxruntime-node, via @huggingface/transformers
sharp    <0.35.0  GHSA-f88m-g3jw-g9cj   libvips CVE-2026-33327/33328/35590/35591
```

Both arrive through `@huggingface/transformers`, which exists here to compute
embeddings for the baseline the benchmark measures Lacuna against. Rather than
assert that this does not matter, here is the reachability, traced:

- `git grep` finds exactly one import of it in tracked source,
  [src/bench/embed.ts:35](src/bench/embed.ts), and it is a dynamic
  `await import()` inside `loadEmbedder()` rather than a module-scope import.
- There is no `dependencies` block, so nothing here is a runtime dependency of
  anything that installs Lacuna, and none of it ships.
- Neither `scripts/serve.ts` nor `src/server/` imports anything from
  `src/bench`. The one occurrence of the word in the server is a comment. The
  server cannot reach the code that reaches the import. `src/bench` is entered
  only by `scripts/benchmark.ts`, by `scripts/evaluate.ts` (which imports only
  the pure scoring module), and by unit tests.
- Lacuna decodes no images anywhere, so the libvips surface has no input to
  reach it. The adm-zip path runs only when the benchmark unpacks the
  `Xenova/all-MiniLM-L6-v2` model archive, from Hugging Face, on the machine of
  whoever chose to run the benchmark.

So the honest statement is not "no vulnerabilities". It is that four real
advisories exist in a devDependency, on a path no served request can reach, with
no upstream fix available to take. Pinning `@huggingface/transformers` to an
older release would trade these for older ones. If that changes upstream, the
lockfile changes with it.

## HydraDB

HydraDB is a separate AGPL-3.0 service. Running it with
`GRAPH_ALLOW_PLAINTEXT=true` and the documented development token is a local
development configuration and upstream says so. Do not expose that configuration
to a network you do not control.
