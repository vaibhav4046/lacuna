#!/usr/bin/env python3
"""Execute every Cypher construct ADR 0002 depends on against a live HydraDB node.

Stdlib only. Writes one JSON file per probe plus a combined results file, so the
raw output is evidence rather than a summary of evidence.

Probe categories:
  required  - the design does not work if this is rejected
  substitute- the workaround ADR 0002 chose for a missing operator
  negative  - expected to be rejected; run to learn the rejection shape
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:18443/v1/graphs/default/query"
TOKEN = os.environ["HYDRA_TOKEN"]
NAMESPACE = "local"
CELL = "cell-0"
EV = "/root/evidence/probe"

# Ids sit far above the step-8 smoke vertices (1 and 2) so nothing collides.
SESSION_1 = 5000000000001
MSG_1, MSG_2 = 4000000000001, 4000000000002
SPAN_1, SPAN_2, SPAN_3 = 3000000000001, 3000000000002, 3000000000003
CLAIM_1, CLAIM_2, CLAIM_3 = 2000000000001, 2000000000002, 2000000000003
ENTITY_LAUNCH, ENTITY_ATLAS = 1000000000001, 1000000000002


def call(query, parameters=None, consistency=None, timeout_ms=None):
    """POST one statement. Returns (http_status, parsed_body_or_error_text)."""
    body = {"cell_id": CELL, "query": query}
    if parameters is not None:
        body["parameters"] = parameters
    if consistency is not None:
        body["consistency"] = consistency
    if timeout_ms is not None:
        body["timeout_ms"] = timeout_ms

    req = urllib.request.Request(
        URL, data=json.dumps(body).encode("utf-8"), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("X-Graph-Namespace", NAMESPACE)

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            elapsed = (time.perf_counter() - started) * 1000
            try:
                return resp.status, json.loads(raw), elapsed
            except json.JSONDecodeError:
                return resp.status, {"_unparsed": raw}, elapsed
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        elapsed = (time.perf_counter() - started) * 1000
        return e.code, {"_error": raw}, elapsed
    except Exception as e:  # connection refused, timeout, etc.
        elapsed = (time.perf_counter() - started) * 1000
        return 0, {"_exception": "%s: %s" % (type(e).__name__, e)}, elapsed


RESULTS = []


def probe(pid, category, what, query, parameters=None, consistency=None,
          timeout_ms=None, expect="accept"):
    status, body, ms = call(query, parameters, consistency, timeout_ms)
    accepted = status == 200 and "_error" not in body and "_exception" not in body

    if expect == "accept":
        verdict = "PASS" if accepted else "FAIL"
    else:
        verdict = "PASS" if not accepted else "UNEXPECTED-ACCEPT"

    detail = ""
    if accepted:
        detail = "cols=%s rows=%d" % (body.get("columns"), len(body.get("rows", [])))
    else:
        msg = body.get("_error") or body.get("_exception") or ""
        detail = ("HTTP %s " % status) + msg.replace("\n", " ")[:220]

    rec = {
        "probe": pid,
        "category": category,
        "what": what,
        "query": query,
        "parameters": parameters,
        "consistency": consistency,
        "timeout_ms": timeout_ms,
        "expected": expect,
        "http_status": status,
        "accepted": accepted,
        "verdict": verdict,
        "elapsed_ms": round(ms, 1),
        "response": body,
    }
    RESULTS.append(rec)

    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)

    print("%-6s %-10s %-4s %-52s %s" % (pid, category, verdict, what[:52], detail))
    return rec


def main():
    os.makedirs(EV, exist_ok=True)

    print("=" * 110)
    print("SEED: build the ADR 0002 shape (session, messages, spans, claims, entities)")
    print("=" * 110)

    # ---- vertex upsert, the two candidate forms -------------------------------
    probe("R01", "required", "MERGE on id then SET, with a label",
          "MERGE (c:Claim {id: %d}) SET c.predicate = 'launch_date', "
          "c.object_text = 'January', c.valid_from = 20250101, c.tx_time = 20250110, "
          "c.polarity = 1, c.canonical_key = 'claim|launch_date|January'" % CLAIM_1)

    probe("R02", "required", "MERGE on id then SET, no label",
          "MERGE (e {id: %d}) SET e.name = 'Project Atlas launch', e.kind = 'event'"
          % ENTITY_LAUNCH)

    probe("R03", "required", "MERGE folding a non-id property into the pattern",
          "MERGE (x {id: %d, name: 'should be rejected'})" % 9000000000001,
          expect="reject")

    # ---- batch vertex upsert via UNWIND + parameters --------------------------
    batch_rows = [
        {"id": CLAIM_2, "predicate": "launch_date", "object_text": "March",
         "valid_from": 20250101, "tx_time": 20250210, "polarity": 1,
         "canonical_key": "claim|launch_date|March"},
        {"id": CLAIM_3, "predicate": "launch_date", "object_text": "April",
         "valid_from": 20250101, "tx_time": 20250215, "polarity": 1,
         "canonical_key": "claim|launch_date|April"},
    ]
    probe("R04", "required", "UNWIND $rows AS row batch vertex upsert (HTTP params)",
          "UNWIND $rows AS row MERGE (c:Claim {id: row.id}) "
          "SET c.predicate = row.predicate, c.object_text = row.object_text, "
          "c.valid_from = row.valid_from, c.tx_time = row.tx_time, "
          "c.polarity = row.polarity, c.canonical_key = row.canonical_key",
          parameters={"rows": batch_rows})

    span_rows = [
        {"id": SPAN_1, "message_id": MSG_1, "start": 0, "end": 42,
         "text_hash": "a1", "text": "the launch is in January"},
        {"id": SPAN_2, "message_id": MSG_2, "start": 0, "end": 38,
         "text_hash": "b2", "text": "correction, launch moved to March"},
        {"id": SPAN_3, "message_id": MSG_2, "start": 39, "end": 80,
         "text_hash": "c3", "text": "someone else said April"},
    ]
    probe("R05", "required", "UNWIND batch upsert, second label",
          "UNWIND $rows AS row MERGE (s:EvidenceSpan {id: row.id}) "
          "SET s.message_id = row.message_id, s.start = row.start, s.end = row.end, "
          "s.text_hash = row.text_hash, s.text = row.text",
          parameters={"rows": span_rows})

    other_rows = [
        {"id": SESSION_1, "label": "Session", "k": "session_key", "v": "sess-1"},
        {"id": MSG_1, "label": "Message", "k": "role", "v": "user"},
        {"id": MSG_2, "label": "Message", "k": "role", "v": "user"},
        {"id": ENTITY_ATLAS, "label": "Entity", "k": "name", "v": "Project Atlas"},
    ]
    probe("R06", "required", "UNWIND batch upsert, no label in pattern",
          "UNWIND $rows AS row MERGE (n {id: row.id}) SET n.k = row.k, n.v = row.v",
          parameters={"rows": other_rows})

    # ---- edge creation --------------------------------------------------------
    probe("R07", "required", "edge via two MATCH clauses then MERGE",
          "MATCH (a {id: %d}) MATCH (b {id: %d}) MERGE (a)-[:SUPERSEDES]->(b)"
          % (CLAIM_2, CLAIM_1))

    probe("R08", "required", "edge via comma-separated MATCH patterns",
          "MATCH (a {id: %d}), (b {id: %d}) MERGE (a)-[:CONTRADICTS]->(b)"
          % (CLAIM_3, CLAIM_2))

    edge_rows = [
        {"src": SPAN_1, "dst": CLAIM_1},
        {"src": SPAN_2, "dst": CLAIM_2},
        {"src": SPAN_3, "dst": CLAIM_3},
    ]
    probe("R09", "required", "UNWIND batch edge creation",
          "UNWIND $rows AS row MATCH (s {id: row.src}) MATCH (c {id: row.dst}) "
          "MERGE (s)-[:SUPPORTS]->(c)",
          parameters={"rows": edge_rows})

    about_rows = [
        {"src": CLAIM_1, "dst": ENTITY_LAUNCH},
        {"src": CLAIM_2, "dst": ENTITY_LAUNCH},
        {"src": CLAIM_3, "dst": ENTITY_LAUNCH},
    ]
    probe("R10", "required", "UNWIND batch edge creation, ABOUT",
          "UNWIND $rows AS row MATCH (c {id: row.src}) MATCH (e {id: row.dst}) "
          "MERGE (c)-[:ABOUT]->(e)",
          parameters={"rows": about_rows})

    mentions_rows = [
        {"src": CLAIM_1, "dst": ENTITY_ATLAS},
        {"src": CLAIM_2, "dst": ENTITY_ATLAS},
    ]
    probe("R11", "required", "UNWIND batch edge creation, MENTIONS",
          "UNWIND $rows AS row MATCH (c {id: row.src}) MATCH (e {id: row.dst}) "
          "MERGE (c)-[:MENTIONS]->(e)",
          parameters={"rows": mentions_rows})

    struct_rows = [
        {"src": SESSION_1, "dst": MSG_1},
        {"src": SESSION_1, "dst": MSG_2},
    ]
    probe("R12", "required", "UNWIND batch edge creation, CONTAINS",
          "UNWIND $rows AS row MATCH (s {id: row.src}) MATCH (m {id: row.dst}) "
          "MERGE (s)-[:CONTAINS]->(m)",
          parameters={"rows": struct_rows})

    span_rows2 = [
        {"src": MSG_1, "dst": SPAN_1},
        {"src": MSG_2, "dst": SPAN_2},
        {"src": MSG_2, "dst": SPAN_3},
    ]
    probe("R13", "required", "UNWIND batch edge creation, HAS_SPAN",
          "UNWIND $rows AS row MATCH (m {id: row.src}) MATCH (s {id: row.dst}) "
          "MERGE (m)-[:HAS_SPAN]->(s)",
          parameters={"rows": span_rows2})

    print()
    print("=" * 110)
    print("READ: the queries retrieval and abstention actually need")
    print("=" * 110)

    # ---- reads ----------------------------------------------------------------
    probe("R14", "required", "directed single-type match projecting properties",
          "MATCH (c)-[:ABOUT]->(e {id: %d}) RETURN c.id AS id, c.object_text AS txt, "
          "c.tx_time AS tx" % ENTITY_LAUNCH)

    probe("R15", "required", "label filter in MATCH",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN c.id AS id" % ENTITY_LAUNCH)

    probe("R16", "required", "parameter in a plain (non-UNWIND) query",
          "MATCH (c {id: $cid}) RETURN c.object_text AS txt",
          parameters={"cid": CLAIM_2})

    probe("R17", "required", "bounded variable-length traversal *1..3",
          "MATCH (a {id: %d})-[:SUPERSEDES*1..3]->(b) RETURN b.id AS id" % CLAIM_2)

    probe("R18", "required", "two-hop pattern in one MATCH",
          "MATCH (e {id: %d})<-[:ABOUT]-(c)-[:MENTIONS]->(o) "
          "RETURN c.id AS claim, o.id AS other" % ENTITY_LAUNCH)

    probe("R19", "required", "three-hop pattern, span to entity",
          "MATCH (s:EvidenceSpan)-[:SUPPORTS]->(c)-[:ABOUT]->(e {id: %d}) "
          "RETURN s.id AS span, c.id AS claim" % ENTITY_LAUNCH)

    # THE critical one: "is this claim current" without IS NULL.
    probe("R20", "substitute", "OPTIONAL MATCH + count()=0 for 'no inbound SUPERSEDES'",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
          "OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c) "
          "RETURN c.id AS id, c.object_text AS txt, count(newer) AS superseded_by"
          % ENTITY_LAUNCH)

    probe("R21", "substitute", "ORDER BY DESC LIMIT 1 instead of max()",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
          "RETURN c.id AS id, c.tx_time AS tx ORDER BY c.tx_time DESC LIMIT 1"
          % ENTITY_LAUNCH)

    probe("R22", "required", "count() aggregate",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN count(c) AS n"
          % ENTITY_LAUNCH)

    probe("R23", "required", "collect() aggregate",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN collect(c.id) AS ids"
          % ENTITY_LAUNCH)

    probe("R24", "required", "WHERE with comparison operators",
          "MATCH (c:Claim) WHERE c.tx_time > 20250115 RETURN c.id AS id, c.tx_time AS tx")

    probe("R25", "required", "WHERE with STARTS WITH",
          "MATCH (c:Claim) WHERE c.canonical_key STARTS WITH 'claim|launch_date' "
          "RETURN c.id AS id")

    probe("R26", "required", "WHERE combining two predicates with AND",
          "MATCH (c:Claim) WHERE c.tx_time > 20250101 AND c.polarity = 1 "
          "RETURN c.id AS id")

    probe("R27", "required", "WITH as pass-through",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) WITH c RETURN c.id AS id"
          % ENTITY_LAUNCH)

    probe("R28", "required", "DISTINCT",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN DISTINCT c.id AS id"
          % ENTITY_LAUNCH)

    probe("R29", "required", "OPTIONAL MATCH returning the absent side",
          "MATCH (c {id: %d}) OPTIONAL MATCH (c)-[:SUPERSEDES]->(old) "
          "RETURN c.id AS id, old.id AS superseded" % CLAIM_3)

    # ---- path procedures ------------------------------------------------------
    probe("R30", "required", "algo.SPpaths sourceNode/targetNode",
          "CALL algo.SPpaths({sourceNode: %d, targetNode: %d, relTypes: ['SUPPORTS','ABOUT'], "
          "relDirection: 'outgoing', maxLen: 4, pathCount: 1}) YIELD path RETURN path"
          % (SPAN_2, ENTITY_LAUNCH))

    probe("R31", "substitute", "algo.MSpaths sourceValues instead of IN",
          "CALL algo.MSpaths({sourceLabel: 'EvidenceSpan', sourceProperty: 'text_hash', "
          "sourceValues: ['a1','b2'], targetLabel: 'Entity', targetProperty: 'k', "
          "targetValues: ['name'], relTypes: ['SUPPORTS','ABOUT'], relDirection: 'outgoing', "
          "maxLen: 4, pathCount: 1, resultLimit: 10}) YIELD path RETURN path")

    probe("R32", "required", "algo.SSpaths single source",
          "CALL algo.SSpaths({sourceNode: %d, relTypes: ['SUPERSEDES'], "
          "relDirection: 'outgoing', maxLen: 3, resultLimit: 10}) YIELD path RETURN path"
          % CLAIM_2)

    # ---- request-level knobs --------------------------------------------------
    probe("R33", "required", "consistency: strong",
          "MATCH (c {id: %d}) RETURN c.id AS id" % CLAIM_2, consistency="strong")

    probe("R34", "required", "timeout_ms accepted",
          "MATCH (c {id: %d}) RETURN c.id AS id" % CLAIM_2, timeout_ms=5000)

    probe("R35", "required", "EXPLAIN a read",
          "EXPLAIN MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN c.id AS id"
          % ENTITY_LAUNCH)

    probe("R36", "required", "idempotent re-MERGE is a no-op that still commits",
          "MERGE (c:Claim {id: %d}) SET c.predicate = 'launch_date'" % CLAIM_1)

    print()
    print("=" * 110)
    print("NEGATIVE: constructs ADR 0002 designed around. Run to learn the rejection shape.")
    print("=" * 110)

    probe("N01", "negative", "IN", "MATCH (c:Claim) WHERE c.id IN [1,2] RETURN c.id AS id",
          expect="reject")
    probe("N02", "negative", "CONTAINS",
          "MATCH (c:Claim) WHERE c.object_text CONTAINS 'arch' RETURN c.id AS id",
          expect="reject")
    probe("N03", "negative", "IS NULL",
          "MATCH (c:Claim) WHERE c.object_text IS NULL RETURN c.id AS id",
          expect="reject")
    probe("N04", "negative", "RETURN *", "MATCH (c:Claim) RETURN *", expect="reject")
    probe("N05", "negative", "unbounded variable length",
          "MATCH (a {id: %d})-[:SUPERSEDES*]->(b) RETURN b.id AS id" % CLAIM_2,
          expect="reject")
    probe("N06", "negative", "max() aggregate",
          "MATCH (c:Claim) RETURN max(c.tx_time) AS latest", expect="reject")
    probe("N07", "negative", "undirected pattern",
          "MATCH (a {id: %d})-[:SUPERSEDES]-(b) RETURN b.id AS id" % CLAIM_2,
          expect="reject")
    probe("N08", "negative", "two statements in one request",
          "MATCH (c:Claim) RETURN c.id AS id; MATCH (e:Entity) RETURN e.id AS id",
          expect="reject")
    probe("N09", "negative", "multi-type relationship pattern",
          "MATCH (a {id: %d})-[:SUPERSEDES|CONTRADICTS]->(b) RETURN b.id AS id" % CLAIM_2,
          expect="reject")
    probe("N10", "negative", "ENDS WITH",
          "MATCH (c:Claim) WHERE c.object_text ENDS WITH 'ch' RETURN c.id AS id",
          expect="reject")
    probe("N11", "negative", "OPTIONAL MATCH inside a mutation",
          "MATCH (c {id: %d}) OPTIONAL MATCH (c)-[:SUPERSEDES]->(o) SET c.checked = 1"
          % CLAIM_2, expect="reject")

    # ---- summary --------------------------------------------------------------
    print()
    print("=" * 110)
    with open(os.path.join(EV, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)

    fails = [r for r in RESULTS if r["verdict"] != "PASS"]
    req_fails = [r for r in fails if r["category"] in ("required", "substitute")]
    unexpected = [r for r in RESULTS if r["verdict"] == "UNEXPECTED-ACCEPT"]

    print("total probes        : %d" % len(RESULTS))
    print("passed              : %d" % len([r for r in RESULTS if r["verdict"] == "PASS"]))
    print("required/substitute failing : %d" % len(req_fails))
    print("unexpectedly accepted       : %d" % len(unexpected))
    for r in req_fails:
        print("  BLOCKER %s  %s" % (r["probe"], r["what"]))
    for r in unexpected:
        print("  NOTE    %s  accepted though docs say unsupported: %s"
              % (r["probe"], r["what"]))
    print("PROBE_BLOCKERS=%d" % len(req_fails))
    print("=" * 110)


if __name__ == "__main__":
    main()
