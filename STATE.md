# State

What exists right now. Updated as things change, and never ahead of them.

**Last updated: 2026-08-12**

## Built and verified

- Repository initialised 2026-08-12. No code, assets or history imported from
  anywhere.
- Hackathon rules captured verbatim to
  [artifacts/rules/](artifacts/rules/hackhydra-rules-2026-08-12.txt) and mapped
  requirement by requirement in [docs/RULES_MATRIX.md](docs/RULES_MATRIX.md).
- Upstream HydraDB documentation read at pinned commit
  `02a40025d2d57e97ab2754c8256219cdbfeab379`, with what was read and what it
  settled recorded in [docs/SOURCE_LOG.md](docs/SOURCE_LOG.md).
- Track, thesis and data model decided and written up as ADRs
  [0001](docs/adr/0001-track-and-thesis.md) and
  [0002](docs/adr/0002-temporal-evidence-graph.md).
- Ubuntu 24.04 provisioned under WSL2 with HydraDB's native dependencies.
  Verified present: `libcypher-parser 0.6.2`, `libgraphblas.so.7.4.0`,
  Rust stable, `just 1.58.0`.
- HydraDB cloned at the pinned commit and `just native-check` passes.

## In progress

- HydraDB local bring-up, upstream `AGENTS.md` steps 3 to 6: object-store smoke,
  Python Bolt driver, full runtime smoke.

## Not built yet

Everything else. Named explicitly so no reader has to guess:

- No application code
- No HydraDB client adapter
- No ingestion pipeline
- No demo corpus
- No retrieval or abstention logic
- No user interface
- No tests
- No benchmark harness, and therefore no numbers of any kind
- No screenshots
- No deployment
- No demo video

## Known environment deviations

One, recorded because reproducibility depends on it.

**`just` shebang recipes fail under WSL2.** `just 1.58.0` writes shebang recipe
scripts into `$XDG_RUNTIME_DIR/just/`, and WSL mounts `/run/user/0` as tmpfs with
`noexec`. Every shebang recipe therefore dies with:

```
error: recipe `native-check` with shebang `#!/usr/bin/env bash` execution error: Permission denied (os error 13)
```

Confirmed with `strace`: the `execve` of `/run/user/0/just/just-*/native-check`
returns `EACCES`. It is neither a HydraDB bug nor a missing dependency. Handled
without modifying any recipe, by unsetting `XDG_RUNTIME_DIR` or passing
`just --tempdir`, both of which were tested.

## Open questions

- Whether the supported Cypher subset expresses every query
  [ADR 0002](docs/adr/0002-temporal-evidence-graph.md) assumes. Being settled on
  day 2 by executing each one against a live node, because it is the assumption
  the whole design rests on.

## Needs the owner

See [NEEDS_VAIBHAV.md](NEEDS_VAIBHAV.md). Nothing there blocks the build today.
