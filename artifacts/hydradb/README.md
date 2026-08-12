# HydraDB bring-up evidence

Real output from a real node. Nothing here was typed by hand or reconstructed
from memory. Every file is the unedited response of the command that produced it.

Captured 2026-08-12 against HydraDB at commit
`02a40025d2d57e97ab2754c8256219cdbfeab379` (`v0.1.1`), built from source under
WSL2 Ubuntu 24.04 following upstream `AGENTS.md` steps 3 to 8.

## What each file is

| File | Produced by | Why it is here |
|---|---|---|
| `just-smoke-result.txt` | `just smoke` (AGENTS.md step 4) | The object-store layer works. Upstream's expected line is `graph object-store smoke passed at epoch 10`. |
| `runtime-smoke-result.txt` | `scripts/runtime_smoke.sh` (step 6) | The full runtime works. Upstream's expected line is `runtime-smoke-ok`. |
| `metrics-ready.txt` | `GET :19091/metrics` | `graph_runtime_ready 1` from the admin server. |
| `smoke-write.json` | `POST :18443/v1/graphs/default/query` with a `CREATE` | The mutation envelope. Empty `columns` and `rows` is correct for a write, not a failure. |
| `smoke-read.json` | the same endpoint with a `MATCH` | **The actual proof.** One row holding `{"type":"vertex_id","value":2}`. |
| `bolt-read.txt` | Neo4j Python driver 6.2.0 over Bolt on `:17687` | The same fact read back over the other transport. Prints `{'id': 2}`. |
| `provenance.txt` | `git rev-parse`, `rustc --version`, `uname -a` | What was actually running when the above was captured. |

## Why the read matters and the port does not

Upstream puts it plainly: a listening port is not proof the node works, a
round-tripped write is. So the check is not "did `/readyz` answer". The check is
that a value written through one request comes back through a second one, and
that it comes back exactly once.

`smoke-read.json`, verbatim:

```json
{"query_id":"http-query-2","columns":["id"],"rows":[[{"type":"vertex_id","value":2}]],"read_epoch":1,"next_cursor":null,"bookmark":"sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:1"}
```

Two rows here instead of one would mean the store was not empty and the `CREATE`
ran twice. One row is the pass condition.

## The response fields Lacuna builds on

`read_epoch` and `bookmark` are the two that matter beyond this smoke test. They
are the engine's own answer to "which version of the graph did you just read",
and they are what the HydraDB Proof screen will show next to an answer. They come
from the database, so they are not something this project can fake.

The `bookmark` is a SlateDB commit sequence with hex-encoded scope components.
Its exact value varies between runs and is not part of any assertion.

## Reproducing this

Follow upstream `AGENTS.md` steps 3 to 8. Two things about this machine are worth
knowing before you do, both recorded in [../../STATE.md](../../STATE.md):

1. `just` shebang recipes fail under WSL2 unless `XDG_RUNTIME_DIR` is unset or
   `--tempdir` is passed.
2. `/tmp` is cleaned under this distro, which removes `/tmp/sgk-venv` and
   `/tmp/sgk-env.sh` between sessions. Upstream says as much: those paths are
   disposable, so anything meant to survive belongs somewhere else.

The auth token in the upstream local recipe is a documented development
placeholder for a loopback-only node with TLS disabled. It is not a secret, and
nothing else in this repository uses it.
