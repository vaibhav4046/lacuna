# Lacuna as an MCP server

Lacuna exposes its answer path over the Model Context Protocol, so an MCP client
can ask the corpus a question and get back the answer together with the claim it
came from, the quotations that support it, and the reads that produced it.

Four tools, all read-only. There is no tool that writes, resets or deletes
anything, and the server holds no session state between calls.

## Running it

Both transports come from one entry point, [`scripts/mcp.ts`](../scripts/mcp.ts).
It loads `.env.local` from the repository root, which must supply
`HYDRA_HTTP_URL`, `HYDRA_NAMESPACE`, `HYDRA_GRAPH`, `HYDRA_CELL` and
`HYDRA_TOKEN`. The graph must already be seeded; see [INGEST.md](INGEST.md).

```
npm run mcp -- --stdio
npm run mcp -- --http --port 3015
```

stdio is the primary transport. The client spawns the process and talks over the
pipe, which needs no port, no origin policy and no listening socket. Every
diagnostic goes to stderr, because under stdio stdout carries JSON-RPC frames and
one stray line on it corrupts the session.

A client entry for the stdio transport looks like this:

```json
{
  "mcpServers": {
    "lacuna": {
      "command": "npm",
      "args": ["run", "mcp", "--", "--stdio"],
      "cwd": "/path/to/lacuna"
    }
  }
}
```

The HTTP transport exists for clients that cannot spawn a process. It is
Streamable HTTP mounted at `/mcp`, stateless: a fresh server and a fresh
transport per request, closed when the response ends. It binds to `127.0.0.1`
unless `HOST` says otherwise, and the port comes from `--port` or `MCP_PORT`,
defaulting to 3015. POST is the only method served; the GET stream would carry
nothing, since this server never sends an unsolicited notification.

A POST must send `Accept: application/json, text/event-stream`. The transport
answers 406 without it.

## The tools

| Tool | Input | What it adds to the envelope |
| --- | --- | --- |
| `lacuna_read_question` | `question`, a sentence | the reading it used, so a misread is visible |
| `lacuna_ask` | `subject`, `predicate`, optional `via` | nothing, this is the envelope |
| `lacuna_explain` | same | `explanation`, `trace` |
| `lacuna_timeline` | same | `considered`, every claim about the predicate, oldest first |
| `lacuna_health` | none | a different shape: `reachable`, `error` |

`via` is a single hop. When set, the predicate is read on the entity the
subject's claims name through that relation rather than on the subject itself.
Omit it or pass null for a direct read.

Every result comes back twice: as a `content` block holding pretty JSON, and as
`structuredContent`. Each tool advertises an `outputSchema`, and an SDK client
validates the structured object against it on every successful call.

### The envelope

The three question tools share one shape, defined in
[`src/mcp/result.ts`](../src/mcp/result.ts):

| Field | Meaning |
| --- | --- |
| `status` | `answered` or `abstained`. No third outcome. |
| `answer` | The stated value, null when abstaining. |
| `reasonCode` | Why it abstained: `never_stated`, `retracted`, `contradicted`, `unconnected`, `out_of_scope`. Null when it answered. |
| `claimId` | The claim the answer came from. |
| `supersededClaims` | Ids of claims about this predicate that something newer replaced, oldest first. |
| `evidence` | Quotations, each with its span, claim, session id, session title, message id, the role of the speaker, and timestamp. |
| `evidenceTotal` | What the answer held before the cap. |
| `queries` | Every read this call ran, with its Cypher, its bound parameters, row count, milliseconds and read epoch. |
| `timingMs` | The whole call. |
| `sourceState` | Always `live`. Nothing here is cached or replayed. |
| `hydra` | Namespace, graph, cell, and the read epoch the answer observed. |

Each field is derived from the `Answer` the retrieval layer produced. There is no
confidence score, no relevance ranking and no count of sources consulted, because
the domain does not produce any of those.

Abstention is a normal result, not an error. `status: "abstained"` with a reason
code arrives as a successful tool call.

### Health

`lacuna_health` runs one entity lookup for a name the corpus does not contain.
The miss returns zero rows and still reports a read epoch, which is all the probe
needs, and it means health does not start failing when someone renames an entity.
On failure it returns `reachable: false` and an error class name.

## Bounds and safety

**Terms are capped.** `subject`, `predicate` and `via` go through `buildQuestion`
in [`src/retrieval/question.ts`](../src/retrieval/question.ts), which caps each at
`MAX_TERM_CHARS` (200) and rejects control characters. An over-length term comes
back as an `InvalidParams` protocol error whose message states the cap without
echoing the submitted text.

**Nothing is concatenated into Cypher.** `buildQuestion` is the only path a
caller's text takes to the graph, and it hands values to prepared queries as bound
parameters. The `queries` array in a result shows both halves, the query text and
the parameters, separately.

**Evidence is capped at 50 items.** The corpus does not produce anything near that
for one claim, so in practice the cap never bites. It exists because a result goes
into a model's context window. `evidenceTotal` reports what the answer held, so a
caller can tell a truncated list from a short one.

**Quotations are data.** Corpus text is quoted, never interpreted. The tool
descriptions and the output schemas both say so, and the server initializes with
instructions that repeat it, because a model reading the result is the layer that
has to honour it.

**One deadline per call.** `TOOL_TIMEOUT_MS` is 10 seconds over the whole call
rather than per query, because a tool that runs four reads can be slow without any
single read being slow. Passing it returns a result with `isError: true` and a
message naming the tool and the limit.

**The node address and the token never appear in a result.** `describeNode`
narrows the config to three strings, so a result carries a node identity and
cannot carry a credential. Failure messages are reduced to an error class name for
the same reason: a transport failure names the endpoint it could not reach, and
that endpoint is built from the base URL.

**Origin is checked on HTTP.** A request with an `Origin` header must point at
loopback over http or https, or it gets 403. An absent header is allowed, because
command-line clients do not send one and the header exists to stop a page in a
browser from reaching a loopback server. The literal `null` origin, which is what
a sandboxed frame or a `file:` page sends, fails the check. Bodies over 1 MiB are
refused with 413.

## Errors

Two kinds, split on purpose.

A protocol error is thrown: an unknown tool name is `MethodNotFound`, and a
missing or wrongly typed argument is `InvalidParams`. The caller sent something
the server does not implement.

A tool failure comes back as a result with `isError: true`: a read that timed out,
or a graph that did not answer. That is a fact about the world the model can act
on rather than a mistake in the request. The SDK prefixes these messages with
`MCP error <code>: `.

## Layout

| File | What is in it |
| --- | --- |
| [`src/mcp/tools.ts`](../src/mcp/tools.ts) | The four tool definitions: descriptions, input schemas, output schemas, annotations. |
| [`src/mcp/result.ts`](../src/mcp/result.ts) | `Answer` to result. Pure: no I/O, no environment, no transport. |
| [`src/mcp/server.ts`](../src/mcp/server.ts) | Argument validation, dispatch, the deadline, the error split. |
| [`src/mcp/http.ts`](../src/mcp/http.ts) | The Streamable HTTP listener and the origin policy. |
| [`scripts/mcp.ts`](../scripts/mcp.ts) | Argument parsing, config loading, both transports. |

`callTool` is exported separately from `createMcpServer` so a test can drive the
whole tool path with no transport attached. The unit tests in
[`tests/unit/mcp-tools.test.ts`](../tests/unit/mcp-tools.test.ts) and
[`tests/unit/mcp-server.test.ts`](../tests/unit/mcp-server.test.ts) do exactly
that, and the second also connects the real SDK client to the real server over a
linked in-memory transport, which is what makes the output schemas checked rather
than merely written. Neither file needs a running node.

## What has actually been exercised

A client spawned the stdio server, initialized, listed the tools, called
`lacuna_ask` twice and `lacuna_health` once against a live node. The whole
transcript is at
[artifacts/verification/2026-08-14b/mcp-stdio.txt](../artifacts/verification/2026-08-14b/mcp-stdio.txt),
unedited, and the directory's README says what produced it.

The repeatable version is:

```
npm run parity
```

It drives this server over stdio, drives it again over the HTTP transport, and
runs the command line in its own process. It asks all three two questions with
full payloads printed, then sweeps the evaluation's sixty-four gold questions
through the same three surfaces, comparing every result field by field. The
output is [parity.txt](../artifacts/verification/2026-08-18/parity.txt) and it
ends `SWEEP_IDENTICAL: 64 of 64` then `ALL_IDENTICAL: True`. One stdio session
serves all the questions, so the stdio side is also sixty-six tool calls
through one process rather than a fresh server per call. The shared shape the
two adapters build from is
[`src/contract/result.ts`](../src/contract/result.ts).

The HTTP case is the transport being exercised rather than the answer. It starts
the listener the way this document says to start it, connects the SDK's own
`Client` over `StreamableHTTPClientTransport`, and does the initialize handshake
a third-party client would do. Because every tool declares an `outputSchema` and
the client validates against it, a successful call there is schema conformance
and not only reachability. The run is written up in
[the directory README](../artifacts/verification/2026-08-14c/README.md).

A client from outside this repository has now connected over both transports.
The MCP Inspector's CLI, `@modelcontextprotocol/inspector` at `2.2.0`, consumed
the exact `mcpServers` block earlier in this document, spawned the server
through it, listed the tools and called `lacuna_ask` and `lacuna_health` over
stdio, then did the same over Streamable HTTP against a running listener. The
two `tools/list` responses are byte-identical across transports, and the
answered values match the parity sweep's. That run is
[the fifth run's README](../artifacts/verification/2026-08-14e/README.md), and
the config file it consumed is committed next to it. What remains unproven is
narrower: no editor or agent runtime has held an interactive session with this
server. The inspector is a client, not a host, so nothing here claims Claude
Desktop, Cursor, or any other host works until one has.

## One note on the SDK

This is built on the SDK's low-level `Server` rather than `McpServer`. The SDK
marks `Server` with a `@deprecated` tag pointing at the high-level API, and the
same tag says to use `Server` for advanced cases. This is one: `McpServer.registerTool`
accepts only Zod schemas, so using it would mean adding Zod as a second runtime
dependency and translating every schema through a converter to reach the JSON
Schema that travels on the wire. `Server` takes the wire types directly, and the
JSON Schemas in `tools.ts` are the ones a client receives.

The SDK version in use is `@modelcontextprotocol/sdk` 1.30.0, the only runtime
dependency this repository has.
