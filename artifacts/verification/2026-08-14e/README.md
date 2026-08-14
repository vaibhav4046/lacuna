# Verification, 2026-08-14, fifth run

This run closes the one gap `docs/MCP.md` still named: no client outside this
repository had ever connected to the MCP server. The client here is the MCP
Inspector's CLI, `@modelcontextprotocol/inspector` pinned at `2.2.0`, run with
`npx --yes`. It is a separate codebase with its own client implementation; the
only thing it was given from this repository is the config file below and, for
the HTTP leg, a URL.

## The config block, exercised

`inspector-config.json` in this directory is the `mcpServers` block
`docs/MCP.md` documents, with `cwd` filled in for this machine:

```json
{
  "mcpServers": {
    "lacuna": {
      "command": "npm",
      "args": ["run", "mcp", "--", "--stdio"],
      "cwd": "D:\\project\\lacuna"
    }
  }
}
```

The inspector consumed that file with `--config ... --server lacuna`, spawned
the server through `npm run mcp -- --stdio` exactly as written, and every call
below went through it. The config block in `docs/MCP.md` is no longer written
only from the transport's requirements; this is a session that used it.

## What was run

Every command exited 0. Files are the unedited stdout of each call; each
`.stderr` file holds the server's one-line startup banner (stdio) or nothing
(HTTP).

| File | Call | Result |
|---|---|---|
| `inspector-stdio-tools-list.txt` | `tools/list` over stdio | all four tools with input and output schemas |
| `inspector-stdio-ask-answered.txt` | `lacuna_ask` Bellwether / beta_partner | `answered`, `Halverd`, claim `797564529472318` |
| `inspector-stdio-ask-abstained.txt` | `lacuna_ask` Meridian / migration_window | `abstained`, `never_stated` |
| `inspector-stdio-ask-via.txt` | `lacuna_ask` replay-queue / contact via vendor | `answered`, `Farah Haddad` |
| `inspector-stdio-health.txt` | `lacuna_health` | `reachable: true`, read epoch 6459 |
| `inspector-http-tools-list.txt` | `tools/list` over Streamable HTTP | byte-identical to the stdio capture |
| `inspector-http-ask-answered.txt` | `lacuna_ask` Bellwether / beta_partner over HTTP | same status, answer and claim id as stdio |

The HTTP leg ran against `npm run mcp -- --http --port 3015`, started
separately and stopped after the captures; the inspector was pointed at
`http://127.0.0.1:3015/mcp` with `--transport http`.

Two details worth naming:

- The two `tools/list` captures, one per transport, hash identical
  (SHA-256 `79c690fa...`). The tool surface is one definition served two ways,
  and now a third-party client has read it both ways.
- The inspector announces protocol version `2025-11-25`; this server's is
  `2025-06-18`. Every call succeeded, which is the SDK's version negotiation
  working against a client newer than the server.

The answered values match the fourth run's parity sweep in
[../2026-08-14d/](../2026-08-14d/README.md): same answer, same claim id, same
reason code on the abstention. The multi-hop call passed `via` as a plain
`--tool-arg`, so the optional argument works from a client that knows nothing
about this repository's types.

## What this does and does not prove

It proves a client not written here can consume the documented config, spawn
the server, list the tools and call them over both transports. It does not
put an editor or agent runtime on the other end; no interactive host has held
a session with this server, and `docs/MCP.md` still says so.

## Node state

The HydraDB node was up on loopback for the whole run, checked on the admin
port before and after by status code, since `/readyz` answers 200 with an
empty body:

```
curl.exe -s -m 5 -w "HTTP %{http_code}\n" http://127.0.0.1:19091/readyz
HTTP 200
```

`sourceState` is `live` on every result. The tree is the one committed as
`1e55414aa44d47c7dbe62391a8316cc0997d9839`, unchanged by this run except for
this directory.

## Secrets

No file in this directory contains a credential. The captures carry entity
names, node ids, query text and bound parameters. A search for `Bearer`,
`HYDRA_TOKEN` and `authorization` across the directory returns nothing.
