# The command line

`lacuna` is a terminal client for the same answer path the web UI and the MCP
server use. It asks a running HydraDB node a question about the sessions and
prints the answer with the evidence under it, or prints that there is no answer
and why.

There is no build step. The entry point is [`bin/lacuna.js`](../bin/lacuna.js),
which registers `tsx` and hands over to [`src/cli/`](../src/cli).

```bash
node bin/lacuna.js doctor
npm run cli -- ask Bellwether beta_partner
```

`npm link` puts it on the path as `lacuna`. Every example below is written as
`lacuna` for brevity.

## Commands

### `lacuna doctor`

Six checks, one line each, before you spend time on a question that cannot be
answered. It resolves the configuration, opens a real connection to the node,
runs a real query and reports the latency and the read epoch it came back at.

```
  node        PASS  v24.12.0, needs >=20.11.0
  config      PASS  http://127.0.0.1:18443, namespace local, graph default, cell cell-0
  token       PASS  set
  reachable   PASS  http://127.0.0.1:18443/v1/graphs/default/query answered
  round trip  PASS  MATCH (n:Entity) RETURN count(*) AS n returned 1 row in 101.8ms, read epoch 5967
  artifacts   PASS  artifacts/ is writable
```

The token is reported as `set` or `missing`. Its value is never printed, and it
is not in the `--json` payload either.

`reachable` and `round trip` are separate checks because they fail for different
reasons and want different fixes. A node that never answered is a node to start.
A node that answered with a 401 is a token to correct. The exit code is the code
of the first failing check, so the difference is visible to a script:

```
  reachable   FAIL  request failed before a response arrived (http://127.0.0.1:18999/v1/graphs/default/query)
  round trip  FAIL  not attempted, the node did not answer

  2 check(s) failed, exit code 4.
```

`artifacts` is a writability test on the directory, not a write. Nothing under
`artifacts/` is created or modified by any command in this CLI.

### `lacuna status`

What this CLI is pointed at, one count per node label, and the read epoch the
counts were answered at.

```
  node        http://127.0.0.1:18443
  namespace   local
  graph       default
  cell        cell-0
  read epoch  5967

  Nodes in the graph
  Session       72
  Message       5268
  EvidenceSpan  118
  Claim         118
  Entity        66
```

### `lacuna ask <subject> <predicate>`

The answer, the quote it rests on, the session that quote came from, and what
the question cost.

```
Q  Bellwether beta_partner
A  Halverd
   This replaced 2 earlier values and nothing has superseded it.

   Cited from
     Platform handover notes, 2025-03-11, user
       "Correction on Bellwether: the beta partner is now Halverd."

   4 queries, 170.1ms
```

When the sessions never settled the question, that is the output, and it exits
0. See [Abstention](#abstention-is-not-an-error).

```
Q  Meridian migration_window
A  No answer (never_stated)
   No answer given, because nothing in the sessions ever stated this.

   3 queries, 97.7ms
```

### `lacuna explain <subject> <predicate>`

Everything `ask` prints, plus the ordered resolution steps and every statement
sent to HydraDB with its row count, latency and read epoch.

```
Q  Bellwether beta_partner
A  Halverd
   This replaced 2 earlier values and nothing has superseded it.

   How it got there
     1. Found "Bellwether" as a project with 4 claims about it.
     2. Read 3 "beta_partner" claims about "Bellwether", 2 of them superseded.
     3. One current claim stands: "Halverd", stated 2025-03-11T10:12:00.000Z.

   What it asked HydraDB
     1.  MATCH (e:Entity {name: $name}) RETURN e.i...  1 row   49.4ms  epoch 5967
     2.  MATCH (c:Claim)-[:ABOUT]->(e {id: $e}) OP...  4 rows  28.7ms  epoch 5967
     3.  MATCH (e {id: $e})<-[:ABOUT]-(c)-[:MENTIO...  4 rows  62.3ms  epoch 5967
     4.  MATCH (se:Session)-[:CONTAINS]->(m)-[:HAS...  1 row   30.4ms  epoch 5967

   4 queries, 143.6ms
```

The statements are truncated for the table. `--json` carries them in full.

### `lacuna timeline <subject> <predicate>`

Every claim on the pair, oldest first, with both times, the value, and which
claim superseded which.

```
Q  Bellwether beta_partner
A  Halverd
   This replaced 2 earlier values and nothing has superseded it.

   Claims on Bellwether beta_partner, oldest first
     claim              valid from                recorded                  value      state
     #2475749815969757  2025-03-03T10:18:00.000Z  2025-03-03T10:18:00.000Z  Stonecrop  superseded by #2247326196671333
     #2247326196671333  2025-03-07T11:06:00.000Z  2025-03-07T11:06:00.000Z  Millbrace  superseded by #797564529472318
     #797564529472318   2025-03-11T10:12:00.000Z  2025-03-11T10:12:00.000Z  Halverd    current, answered with this

   4 queries, 160.9ms
```

`valid from` is when the claim became true. `recorded` is when it entered the
graph. The order is the order `considered` arrives in from the resolver, which
sorts by valid time; this command does not re-sort it.

### `lacuna bench`

Prints the committed benchmark report, best configuration of each system family.

```
  Benchmark, best configuration per family
  run 2026-08-13T03:15:14.592Z, seed lacuna-demo-v1, embeddings Xenova/all-MiniLM-L6-v2
  72 sessions, 5268 messages, 118 claims

  system                    correct  false  missed  abstain f1  tokens  p50    p95
  lacuna                    60/60    0      0       1.00        15      243ms  428ms
  hybrid+2hop@20 +conflict  60/60    0      0       1.00        636     4ms    7ms
  lexical@20 +conflict      46/60    0      8       0.89        513     1ms    1ms
  hybrid@20 +conflict       46/60    0      8       0.89        524     4ms    4ms
  vector@50 +conflict       46/60    0      8       0.89        1310    3ms    3ms
  recency@50 +conflict      44/60    0      10      0.86        1087    0ms    0ms

  read from D:\project\lacuna\artifacts\bench\results.json, not rerun
```

This reads `artifacts/bench/results.json` and does not run the benchmark. The
numbers are whatever is in the committed file. To produce new ones, run
`npm run bench`, which is a separate command that takes minutes. If the file is
missing, this is a configuration error and exits 3.

The file is parsed and validated field by field, not cast, so a truncated or
hand-edited report fails loudly rather than printing nonsense.

## Flags

| Flag | Applies to | Effect |
|---|---|---|
| `--via <relation>` | `ask`, `explain`, `timeline` | Follow one relation before asking, turning one question into two hops |
| `--json` | all | One JSON document on stdout and nothing else |
| `--timeout <ms>` | all | Per-query timeout, positive whole milliseconds |
| `-h`, `--help` | all | General help, or help for the named command |
| `-V`, `--version` | | The version from `package.json` |

`--via` and `--timeout` take their value as a separate word or after an equals
sign. `--json` takes no value and `--json=true` is rejected.

An unknown flag is refused rather than ignored, and `--via` on a command that
does not take one is refused too. A typo that silently becomes a default is a
wrong answer to a question nobody asked.

### `--via`

```
Q  replay-queue contact via vendor
A  Farah Haddad
   Stated once and never contradicted or withdrawn.

   Followed "vendor" to Northfold (entity 1635203334682294, through claim 4026755961307662)

   Cited from
     Platform planning call, 2025-03-21, user
       "replay-queue is supplied by Northfold."
     Data handover notes, 2025-03-23, user
       "Our contact at Northfold is Farah Haddad."

   8 queries, 280.3ms
```

The hop is named in the output: which relation was followed, to which entity,
and through which claim. A two-hop answer that does not show its bridge is not
checkable.

### `--json`

Under `--json`, stdout is one JSON document with a trailing newline and nothing
else. Errors, warnings and the "try lacuna --help" line go to stderr, so a pipe
into `jq` sees only the document. On a usage error, stdout stays empty.

The middle of the payload is `askCore`, the same projection the MCP server
returns, so `status`, `claimId`, `reasonCode`, the evidence ids and the revision
chain are the same fields under the same names on both surfaces. A script that
reads one can read the other. What surrounds it is what the command line has and
a tool call does not: the command that ran, the question as it was parsed, and
the resolver's own account of how it decided. Every field is named explicitly.
The configuration object, which holds the bearer token, is never spread into it.

```jsonc
{
  "command": "ask",
  "question": { "subject": "Bellwether", "predicate": "beta_partner", "via": null },
  "status": "answered",           // or "abstained"
  "answer": "Halverd",            // null when abstained
  "reasonCode": null,             // the abstention reason code, null when answered
  "claimId": 797564529472318,     // null when abstained
  "supersededClaims": [ /* ids of considered claims something newer replaced */ ],
  "evidence":   [ /* spanId, claimId, quote, sessionId, sessionTitle, messageId, role, ts */ ],
  "evidenceTotal": 1,             // how many the answer held; evidence is capped at 50
  "queries":    [ /* cypher, parameters, rows, ms, readEpoch */ ],
  "timingMs": 150.4,
  "sourceState": "live",
  "explanation": "This replaced 2 earlier values and nothing has superseded it.",
  "hop": null,                    // via, throughClaimId, toEntityId, toEntityName
  "trace": ["..."],
  "considered": [ /* claimId, predicate, objectText, polarity, validFrom, txTime, supersededBy, current */ ],
  "queryCount": 4
}
```

`doctor`, `status` and `bench` have their own payloads, each with a `command`
field naming the command that produced it. `doctor` carries `ok`, `exitCode` and
one object per check.

### Colour

Colour is an accent, never the meaning. `PASS` and `FAIL` are words, the answer
is on a labelled line, and reading the output with every escape stripped loses
nothing.

It is disabled when `NO_COLOR` is set to any value including empty, when stdout
is not a terminal, and when `TERM` is `dumb`.

## Configuration

Flags beat the environment, the environment beats the defaults.

A `.env.local` at the repository root is read when it exists. It sets only
variables that are not already set, so a value exported in the shell always
wins. The parser is a few lines in [`src/cli/env.ts`](../src/cli/env.ts); there
is no dotenv dependency.

| Variable | Meaning |
|---|---|
| `HYDRA_HTTP_URL` | Base URL of the node |
| `HYDRA_NAMESPACE` | Graph namespace, sent as a header |
| `HYDRA_GRAPH` | Graph name, part of the query path |
| `HYDRA_CELL` | Cell id, sent in the request body |
| `HYDRA_TOKEN` | Bearer token |
| `LACUNA_TIMEOUT_MS` | Per-query timeout when `--timeout` is absent |

`HYDRA_TOKEN` is never printed by any command, in any output mode, and no error
type in the client carries it.

A malformed `LACUNA_TIMEOUT_MS` is a configuration error (exit 3), not a usage
error, because the person at the keyboard did not type it. A malformed
`--timeout` is a usage error (exit 2), because they did.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including an abstention |
| 2 | Usage error: unknown command, unknown flag, missing or extra argument, bad `--timeout` |
| 3 | Configuration or auth error: missing variable, rejected token, missing benchmark file, bad `LACUNA_TIMEOUT_MS` |
| 4 | HydraDB unavailable: no response, 429, 503, or a 5xx from the engine |
| 5 | Internal error: a decode failure, a broken invariant, anything unclassified |

There is no code 1. A shell that sees 1 is seeing the runtime fail before the
CLI got a chance to classify anything.

`doctor` exits with the code of its first failing check, so it reports the same
distinctions as the commands it is diagnosing.

The mapping lives in [`src/cli/exit.ts`](../src/cli/exit.ts) and is asserted
against the real error classes in
[`tests/unit/cli-args.test.ts`](../tests/unit/cli-args.test.ts).

## Abstention is not an error

Five reasons, and each exits 0:

| Reason | Meaning |
|---|---|
| `never_stated` | Nothing in the sessions ever stated this |
| `retracted` | It was stated and then withdrawn |
| `contradicted` | Two or more claims disagree and nothing resolves them |
| `unconnected` | The pieces exist but the link between them was never stated |
| `out_of_scope` | The subject is not in the corpus |

In human output this is the `A  No answer (reason)` line with the explanation
under it. In `--json` it is `"status": "abstained"` with the reason in `reason`
and `answer` null, next to the same evidence and cost fields an answer carries.

Scripts should branch on `status`, not on the exit code. A non-zero exit means
the question could not be asked; it never means the sessions declined to answer.

## Agreement with the MCP server

`askCore` in [`src/contract/result.ts`](../src/contract/result.ts) is the one
place the answer is turned into a result, and both this CLI and the MCP server
call it. Neither maintains its own copy of the field names, so they cannot drift
apart without the shared file changing.

```bash
npm run parity
```

That spawns the MCP server over stdio, connects to it again over its HTTP
transport with the SDK's own client, and runs this CLI in its own process. It
asks all three the same two questions, one answered and one abstained, and
compares status, answer, reason code, claim id, superseded claims, evidence,
evidence total, source state, and the set of reads with their parameters and row
counts. It ends `ALL_IDENTICAL: True`. The saved output is
[artifacts/verification/2026-08-14c/parity.txt](../artifacts/verification/2026-08-14c/parity.txt).

One thing is deliberately excluded: the order the reads appear in. They are
issued together and land as the node answers them, so the order varies between
runs of the same command on the same surface. The artifact prints both orders
next to the verdict, so the exclusion is visible rather than assumed.

Two questions is what this covers, not the sixty in the evaluation, and a
running node is required.

## Tests

```bash
npm run test
```

[`tests/unit/cli-args.test.ts`](../tests/unit/cli-args.test.ts) covers the parser
and the exit-code mapping. [`tests/unit/cli-render.test.ts`](../tests/unit/cli-render.test.ts)
covers the three human renderers and the JSON payload against a hand-built
answer, including an assertion that no spelling of "token" appears in the
output. Neither file needs a running node.
