# Verification, 2026-08-14, third run

This run exists for one reason: to drive the MCP Streamable HTTP transport end to
end. Until now `docs/MCP.md` described that transport from the code rather than
from a session that used it, and said so. A real SDK client now connects to it
over a real socket, against a listener started the way that document says to
start one, and the answer it gets back is compared field by field against the
same question asked over stdio and over the command line.

| File | Command | Result | Exit |
|---|---|---|---|
| `typecheck.txt` | `npm run typecheck` | no diagnostics | 0 |
| `unit.txt` | `npm test` | 36 files, 807 tests, 26.06s | 0 |
| `parity.txt` | `npm run parity` | 2 cases, both identical across three surfaces | 0 |

`parity.stderr` is empty, which is the whole of what the run wrote outside the
transcript. The parity exit code is in `exit-codes.txt` rather than appended to
the transcript, because the transcript ends on the line a reader is meant to
check, `ALL_IDENTICAL: True`.

All three were run against commit
`101b1999ff3ae9ec97331fa076f9a4b42e8d34bc` with the working tree carrying the
HTTP surface added to `scripts/parity.ts` and that day's ledger changes. The
numbers describe that tree, not the commit alone.

## What the third surface adds

The two MCP surfaces share a tool implementation and differ only in transport, so
this cannot fail on the substance of an answer. What it proves is the transport:
the initialize handshake, the POST contract, the stateless per-request server, and
the response coming back on the JSON body rather than an event stream. The client
is the SDK's own `Client` over `StreamableHTTPClientTransport`, not a hand-written
POST, so the handshake it performs is the one a third-party client would perform.

Every Lacuna tool advertises an `outputSchema`, and the SDK client validates
structured output against the schema of the tool it called. A successful
`callTool` over HTTP is therefore schema conformance, not merely reachability.

One listener serves both questions. That is deliberate: the server builds a fresh
`Server` and a fresh transport per request and closes both when the response ends,
so two requests through one listener is the part worth exercising.

## The two cases

`Bellwether` / `beta_partner` answers. `Meridian` / `migration_window` abstains
with `never_stated`. Both come back identical on all eight compared fields:

```
CASE: answered (Bellwether / beta_partner)
  stdio status=answered claimId=797564529472318 reasonCode=null queries=4
  http  status=answered claimId=797564529472318 reasonCode=null queries=4
  cli   status=answered claimId=797564529472318 reasonCode=null queries=4
  IDENTICAL: True
```

The answered case returns `Halverd` over two superseded claims and one evidence
span, in four reads. The abstained case returns no answer and no claim id, in
three. An abstention arriving as a successful call rather than an error is part
of the contract, and this is the run that shows all three surfaces agreeing on
that.

`parity.txt` prints the read order of each surface beside the verdict. The reads
a question needs are independent and issued together, so they land in the trace
in the order the node answered them, and that order moves between two runs of the
same command on one surface. The comparison is over the set of reads, their
parameters and their row counts, which do not move. The order is printed rather
than dropped so the exclusion stays visible.

## Node state

The HydraDB node was up on loopback for the whole run, on the store at
`/var/lib/lacuna/hydradb` that `scripts/hydra-node.sh` manages. Readiness was
checked before the run rather than inferred from the answers:

```
curl -s -o /dev/null -w "READYZ=%{http_code}\n" --max-time 5 http://127.0.0.1:19091/readyz
READYZ=200
```

Readiness is on the admin port, `19091`, not the query port. `18443` answers 404
for `/readyz` with an empty body, which reads like a dead node and is not one.

`sourceState` is `live` on every result in `parity.txt`. Nothing here is cached,
replayed or seeded from a fixture.

## What this run does not close

The other two gaps `docs/MCP.md` names are still open and stay named there. No
third-party client, editor or agent runtime has connected, so the config block in
that document is still written from the transport's requirements. And the parity
check covers two questions, not the sixty the evaluation covers.

## Secrets

No file in this directory contains a credential. A scan for `Bearer`,
`HYDRA_TOKEN` and `authorization` returns three lines, all in `unit.txt`, all the
same asserted negative path:

```
request failed: HydraQueryError: HydraDB returned 403: principal bearer principal is not authorized to read graph scope tenant-b/graphs/default
```

That is a test proving a token cannot read a namespace it has no grant on. The
word `bearer` there is the node naming the principal class in its own refusal,
and no token value appears. The parity payloads carry query text and query
parameters, which are entity names and node ids, and no configuration.
