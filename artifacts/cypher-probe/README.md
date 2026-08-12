# Cypher subset probe evidence

[PLAN.md](../../PLAN.md) names the riskiest assumption in this project: "does
HydraDB's Cypher subset actually express the queries this design needs". This
directory is the answer, produced by executing 162 probes against a live node
instead of reading the compatibility document again.

Captured 2026-08-12 against HydraDB `v0.1.1` (commit
`02a40025d2d57e97ab2754c8256219cdbfeab379`), built from source under WSL2 Ubuntu
24.04, HTTP query API on loopback `:18443`, graph `default`, namespace `local`,
cell `cell-0`.

Every file is machine-written. Each record holds the exact query sent, the
parameters, the HTTP status, the verdict, and the full unedited response body
including the engine's own rejection text.

## What each file is

| File | What it holds |
|---|---|
| `round1.py`, `round1-results.json` | 47 probes, **31 pass, 16 fail**. First contact. Every read that did not depend on missing data passed; every single write path was rejected. |
| `round2.py`, `round2-results.json` | 38 probes, **29 pass, 9 fail**. The forms round one's error messages named, executed. The write path is recovered here. |
| `round3.py`, `round3-results.json` | 34 probes, **34 pass, 0 fail**. Edges written one statement at a time, then every read checked against the exact rows it must return. |
| `round4.py`, `round4-results.json` | 13 probes, **12 pass, 1 fail**. Value encodings the client has to decode, and the access controls [SECURITY.md](../../SECURITY.md) claims. The one failure was mine, not the engine's. |
| `round5.py`, `round5-results.json` | 24 probes, **24 pass, 0 fail**. Round four's failure taken apart, then the question it raised: a cursor is a small integer, so can it be used as a way past the token. |
| `round6.py`, `round6-results.json` | 6 probes, **6 pass, 0 fail**. Two questions the TypeScript client's shape depended on, asked once the client existed and the answers had somewhere to go. |
| `path-value-shape.json` | One `algo.SPpaths` result in full, kept because the property encoding inside a path differs from the encoding everywhere else. |

## Why there are six rounds and not one

Round one failed on writes and that was the useful part. HydraDB's rejections
name the accepted form rather than just refusing, so each error was an
instruction. Round two executed what round one's errors said, and the write path
worked.

Round two then looked better than it was. Ten of its read probes returned zero
rows. They were counted as accepted, because they were, but a query that parses
and returns nothing has not been shown to be correct. The cause was that
`UNWIND` had refused to create edges, so the graph held vertices and almost no
relationships, and the reads were traversing an empty neighbourhood.

Round three exists to close that gap. It writes the fourteen missing edges one
statement per edge, then asserts on values: three claims about the launch entity
and specifically January, March and April; the superseded claim naming
`2000000000002` as its superseder while the other two come back `null`; the
bounded traversal returning exactly the one superseded claim. A probe that
returns the right number of wrong rows fails.

Round four moved from "does it parse" to "what comes back on the wire", and
added the security claims, because a control named in a threat model and never
executed is a wish.

Round five exists because round four got something wrong. See below.

Round six is the odd one out. Rounds one to five were run before any client
code existed, so they asked what the engine supports. Round six was run while
`src/hydra/queries.ts` was being written, and it asks two much narrower
questions that only appear once you are deciding what the client actually
sends. Six probes rather than thirty, because by then most of the surface was
already settled.

## The round four mistake, which is the most useful record here

Round four probe `L02` sent a `page_size`, got back two rows of three and a
`next_cursor`, sent that cursor on the next request, and was refused:

```
ClientProtocol query is not supported yet: result cursor does not belong to this query request
```

The obvious reading is that server-side paging is unfinished in `v0.1.1`. That
reading was wrong, and it was one commit away from being written into
[docs/THREAT_MODEL.md](../../docs/THREAT_MODEL.md) as a limitation of HydraDB.

The request body carries a `query_id` field. The cursor is scoped to it, and
`L02` did not send one. Round five executes all three readings of that error and
the contract falls out immediately:

| Probe | Request | Result |
|---|---|---|
| `H1a` | `page_size: 2`, no `query_id` | 200, 2 rows of 3, `next_cursor: 11`, server-assigned `query_id: "http-query-286"` |
| `H1b` | cursor, **no** `query_id` | 400 `result cursor does not belong to this query request` |
| `H1c` | cursor **plus** the server's `query_id` | 200, the third row, `next_cursor: null` |
| `H2a`/`H2b` | client-chosen `query_id` on both requests | 200 then 200, pages correctly |

So paging works, and the "limitation" was a malformed request. The finding that
survives is a different and smaller one, recorded in
[D-012](../../DECISIONS.md): the client must mint and carry its own `query_id`.

`next_cursor` is a per-node counter, not a row offset. Across round five it was
handed out as 11, 12, 13, 14, 15, 16 for six unrelated paged queries. Nothing may
be inferred from its value and nothing may be constructed from it.

## Can a cursor be used as a way in

It is a small integer, it is server-side state, and it addresses rows. That is
worth six probes rather than an assumption.

| Probe | Attack | Result |
|---|---|---|
| `X11` | valid cursor and `query_id`, different `X-Graph-Namespace` | **403** `principal bearer principal is not authorized to read graph scope other-tenant/graphs/default` |
| `X12` | valid cursor and `query_id`, wrong bearer token | **401** `valid bearer authentication is required` |
| `X13` | valid cursor and `query_id`, no `Authorization` header | **401** `valid bearer authentication is required` |
| `X14` | guessed cursor under a fresh `query_id` | **400** `result cursor is unknown or expired` |
| `X16` | correct cursor and `query_id`, different query text | **400** `result cursor does not belong to this query request` |
| `X17b` | a **live** cursor replayed under a different `query_id`, identical query text | **400** `result cursor does not belong to this query request` |

Authentication and namespace authorisation are both evaluated before the cursor
is looked at, and the cursor is bound to the `query_id` and the query text
together, not to either alone. A cursor on its own carries no authority.

## bookmark, and the one thing round five could not prove

`H3b` tried to pin a read to a previous `read_epoch` and the engine answered with
the mechanism instead:

```
HTTP query is not supported yet: read_epoch is not a storage snapshot selector; use bookmark for causal reads
```

Which sent round five looking at `bookmark`, and it turns out to matter for this
project more than paging does:

- `B01`: a **write** returns a bookmark. The response is
  `{"query_id": "http-query-296", "columns": [], "rows": [], "read_epoch": null, "next_cursor": null, "bookmark": "sgk:1:6c6f63616c:64656661756c74:63656c6c2d30:67"}`.
  The hex fields decode to `local`, `default`, `cell-0`, and the tail is the
  epoch. Writes carry a bookmark and a null `read_epoch`; reads carry both.
- `B02`: passing that bookmark on the next read returns the row just written.
- `B04`: a well-formed bookmark naming another namespace is refused with
  `graph scope mismatch: expected local/graphs/default cell cell-0, received other-tenant/graphs/default cell cell-0`.
  A bookmark is scoped, so it is not a capability that travels.

What round five did **not** establish: that the bookmark is what made the write
visible in `B02`. This is a single node answering `consistency: "strong"`, so the
read would very likely have seen the write anyway. `B02` proves the bookmark is
accepted and the data is there. It does not isolate the bookmark as the cause,
and it cannot on this deployment. Recorded as accepted-and-useful rather than
proven-necessary.

`B03` is kept as a smaller result than its first name suggested. It sends
`sgk:1:deadbeef:deadbeef:deadbeef:999999` and gets
`invalid bookmark: namespace is not UTF-8`, which only proves the bookmark is
parsed, because `deadbeef` unhexes to bytes that are not text. `B04` was written
afterwards to ask the question `B03` was supposed to ask.

## Round six: can an id be a parameter, and how long can a query_id be

Two questions, both of which decide something in the client rather than
something in the model.

**One: does a `MERGE` edge pattern take parameters.** Every edge written in
rounds two and three used integer literals, so the only proven way to write an
edge was to build the query text around the ids. That is the shape of a string
concatenation bug waiting to happen, and it would have had to be written into
the client with an integer guard around it.

| Probe | Query | Result |
|---|---|---|
| `P02` | `MERGE (a {id: $src})-[:PROBE_EDGE]->(b {id: $dst})` | **200** |
| `P03` | the same edge with integer literals, as a control | **200** |
| `P04` | `MATCH (a {id: $src})-[:PROBE_EDGE]->(b) RETURN b.tag AS tag` | **200**, one row, `{"type": "string", "value": "b"}` |

`P02` on its own would only have proven the query parses. `P04` is the probe
that matters: it reads the edge back through a different statement and gets the
tag of the vertex on the far end. The edge landed. So `mergeEdge` in
`src/hydra/queries.ts` passes `$src` and `$dst` as parameters and no id is ever
concatenated into query text.

**Two: is a UUID-length `query_id` usable.** [D-012](../../DECISIONS.md) has the
client minting its own, and every executed example up to that point used a short
one such as `"H2"`. A `lacuna-` prefix and a UUID is 43 characters.

| Probe | Request | Result |
|---|---|---|
| `P05` | `query_id: "lacuna-3f2b9c1e-5d47-4a80-9e6c-1b2a7d4e8f01"`, `page_size: 2` | **200**, 2 rows, id echoed back unchanged, `next_cursor: 32` |
| `P06` | that cursor under the same 43-character id | **200**, the third row, `next_cursor: null` |

Accepted, echoed verbatim, and it scopes a followable cursor. D-012 works as
written.

`P05` also settles something by accident. Its first execution returned
`next_cursor: 25` and the committed re-run returned `32`, for the same query
over the same three `:Claim` vertices. That is independent support for round
five's conclusion that the value is a per-node counter and not a row offset,
and it is why the client treats a cursor as an opaque token to hand back rather
than a number to reason about.

## What this changed in the design

Three statements in [ADR 0002](../../docs/adr/0002-temporal-evidence-graph.md)
were taken from the compatibility document and are wrong about the running
engine. They are corrected in that ADR's amendment section with the original
text left visible. In short:

- `UNWIND` upserts vertices and cannot write edges. Edges go one per statement.
- A bare `MERGE` outside `UNWIND` creates edges only, never a labelled vertex.
- `count(<binding>)` does not parse, so the abstention check projects the
  superseder's id and reads `null` as "current".

None of this changed the data model. It changed the number of round trips at
ingest and the text of two queries.

Rounds four, five and six changed the client rather than the model: two value
decoders instead of one, a `query_id` on every request, a bookmark carried from
ingest into the read that follows it, and parameterised endpoints on every edge
write so no id is ever pasted into a query string.

## Reproducing this

The node must be running per upstream `AGENTS.md` steps 3 to 8. Then, with the
token in the environment rather than in the file:

```bash
HYDRA_TOKEN="$GRAPH_AUTH_TOKEN" python3 round3.py
```

Round three is idempotent. Every write is a `MERGE`, and the last section
re-runs all fourteen edges and re-counts to prove it: `I01` and `I02` assert the
graph is unchanged after the second pass. Rounds four and five are idempotent for
the same reason: their only writes are `MERGE` by fixed id.

Round five is order-dependent on rounds one to three, because it pages over the
three `:Claim` vertices they create. `C01` asserts that full result up front, so
if the graph is not in the expected state the round fails loudly at its first
probe rather than quietly paging over the wrong thing.

Round six is idempotent and partly order-dependent for the same reason. `P01` to
`P04` seed and read their own two `:ProbeSix` vertices, so they stand alone.
`P05` and `P06` page over the `:Claim` vertices from rounds one to three, so
those two need the earlier rounds to have run. Their `next_cursor` values will
not match the committed ones and are not supposed to.

The scripts are stdlib-only Python and take the token from `HYDRA_TOKEN`. An
earlier version had the upstream development placeholder token written into the
source. That is a documented placeholder for a loopback node with TLS disabled
and not a secret, but a literal shaped like a credential does not belong in a
repository, so it was replaced with an environment read and all rounds were
re-run to confirm the committed scripts are the ones that produced the committed
results.
