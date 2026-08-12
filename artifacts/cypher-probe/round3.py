#!/usr/bin/env python3
"""Round three. Round two proved the queries parse. This proves they are correct.

Round two's reads returned zero rows because UNWIND refused to create edges, so
the graph had vertices and one edge. A query that parses and returns nothing has
not been verified. Here every edge is created with the single-statement form that
round two proved works, then each read is checked against the rows it must return.
"""

import json
import os
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:18443/v1/graphs/default/query"
TOKEN = os.environ["HYDRA_TOKEN"]
NAMESPACE = "local"
CELL = "cell-0"
EV = "/root/evidence/probe3"

SESSION_1 = 5000000000001
MSG_1, MSG_2 = 4000000000001, 4000000000002
SPAN_1, SPAN_2, SPAN_3 = 3000000000001, 3000000000002, 3000000000003
CLAIM_1, CLAIM_2, CLAIM_3 = 2000000000001, 2000000000002, 2000000000003
ENTITY_LAUNCH, ENTITY_ATLAS = 1000000000001, 1000000000002
ENTITY_ABSENT = 1000000000099  # deliberately never written: the abstention case


def call(query, parameters=None, consistency=None, timeout_ms=None):
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
            ms = (time.perf_counter() - started) * 1000
            return resp.status, json.loads(raw), ms
    except urllib.error.HTTPError as e:
        return e.code, {"_error": e.read().decode("utf-8", "replace")}, \
            (time.perf_counter() - started) * 1000
    except Exception as e:
        return 0, {"_exception": "%s: %s" % (type(e).__name__, e)}, \
            (time.perf_counter() - started) * 1000


def plain(rows):
    """Strip the {type, value} tagging down to comparable Python values."""
    out = []
    for row in rows:
        vals = []
        for cell in row:
            t = cell.get("type")
            if t == "null":
                vals.append(None)
            elif t == "path":
                vals.append("<path>")
            else:
                vals.append(cell.get("value"))
            _ = t
        out.append(tuple(vals))
    return out


RESULTS = []
FAILED = []


def write(pid, what, query, parameters=None):
    status, body, ms = call(query, parameters)
    ok = status == 200 and "_error" not in body and "_exception" not in body
    detail = "ok" if ok else (body.get("_error") or body.get("_exception", ""))[:180]
    rec = {"probe": pid, "kind": "write", "what": what, "query": query,
           "parameters": parameters, "http_status": status, "accepted": ok,
           "verdict": "PASS" if ok else "FAIL", "elapsed_ms": round(ms, 1),
           "response": body}
    RESULTS.append(rec)
    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)
    if not ok:
        FAILED.append(pid)
    print("%-6s WRITE  %-4s %-52s %s" % (pid, rec["verdict"], what[:52], detail))
    return ok


def assert_rows(pid, what, query, expected, parameters=None, consistency=None,
                ordered=False):
    """Run a read and compare the rows to exactly what the design requires."""
    status, body, ms = call(query, parameters, consistency)
    if status != 200 or "_error" in body or "_exception" in body:
        msg = (body.get("_error") or body.get("_exception", ""))[:180]
        rec = {"probe": pid, "kind": "read", "what": what, "query": query,
               "parameters": parameters, "http_status": status, "accepted": False,
               "verdict": "FAIL", "expected": expected, "actual": None,
               "elapsed_ms": round(ms, 1), "response": body}
        RESULTS.append(rec)
        FAILED.append(pid)
        with open(os.path.join(EV, "%s.json" % pid), "w") as f:
            json.dump(rec, f, indent=2)
        print("%-6s READ   FAIL %-52s rejected: %s" % (pid, what[:52], msg))
        return False

    actual = plain(body.get("rows", []))
    exp = [tuple(e) for e in expected]
    match = (actual == exp) if ordered else (sorted(actual, key=repr) ==
                                             sorted(exp, key=repr))
    rec = {"probe": pid, "kind": "read", "what": what, "query": query,
           "parameters": parameters, "http_status": status, "accepted": True,
           "verdict": "PASS" if match else "WRONG-ROWS", "expected": exp,
           "actual": actual, "read_epoch": body.get("read_epoch"),
           "bookmark": body.get("bookmark"), "elapsed_ms": round(ms, 1),
           "response": body}
    RESULTS.append(rec)
    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)
    if not match:
        FAILED.append(pid)
        print("%-6s READ   WRONG %-52s" % (pid, what[:52]))
        print("           expected: %s" % (exp,))
        print("           actual  : %s" % (actual,))
    else:
        print("%-6s READ   PASS %-52s %d row(s) as required" %
              (pid, what[:52], len(actual)))
    return match


def main():
    os.makedirs(EV, exist_ok=True)

    print("=" * 112)
    print("SEED EDGES: one statement per edge, the form round two proved")
    print("=" * 112)

    edges = [
        ("E01", "SPAN_1 SUPPORTS CLAIM_1", SPAN_1, "SUPPORTS", CLAIM_1),
        ("E02", "SPAN_2 SUPPORTS CLAIM_2", SPAN_2, "SUPPORTS", CLAIM_2),
        ("E03", "SPAN_3 SUPPORTS CLAIM_3", SPAN_3, "SUPPORTS", CLAIM_3),
        ("E04", "CLAIM_1 ABOUT launch", CLAIM_1, "ABOUT", ENTITY_LAUNCH),
        ("E05", "CLAIM_2 ABOUT launch", CLAIM_2, "ABOUT", ENTITY_LAUNCH),
        ("E06", "CLAIM_3 ABOUT launch", CLAIM_3, "ABOUT", ENTITY_LAUNCH),
        ("E07", "CLAIM_1 MENTIONS atlas", CLAIM_1, "MENTIONS", ENTITY_ATLAS),
        ("E08", "CLAIM_2 MENTIONS atlas", CLAIM_2, "MENTIONS", ENTITY_ATLAS),
        ("E09", "SESSION CONTAINS MSG_1", SESSION_1, "CONTAINS", MSG_1),
        ("E10", "SESSION CONTAINS MSG_2", SESSION_1, "CONTAINS", MSG_2),
        ("E11", "MSG_1 HAS_SPAN SPAN_1", MSG_1, "HAS_SPAN", SPAN_1),
        ("E12", "MSG_2 HAS_SPAN SPAN_2", MSG_2, "HAS_SPAN", SPAN_2),
        ("E13", "MSG_2 HAS_SPAN SPAN_3", MSG_2, "HAS_SPAN", SPAN_3),
        ("E14", "CLAIM_3 CONTRADICTS CLAIM_2", CLAIM_3, "CONTRADICTS", CLAIM_2),
    ]
    for pid, what, src, rel, dst in edges:
        write(pid, what,
              "MERGE (a {id: %d})-[:%s]->(b {id: %d})" % (src, rel, dst))

    print()
    print("=" * 112)
    print("ASSERT: every read the design depends on, checked against required rows")
    print("=" * 112)

    assert_rows("A01", "all three claims about the launch entity",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
                "RETURN c.id AS id, c.object_text AS txt" % ENTITY_LAUNCH,
                [(CLAIM_1, "January"), (CLAIM_2, "March"), (CLAIM_3, "April")])

    assert_rows("A02", "count(*) over those claims",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN count(*) AS n"
                % ENTITY_LAUNCH, [(3,)])

    # The query the whole abstention story rests on.
    assert_rows("A03", "CURRENT CLAIM: superseded one names its superseder",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
                "OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c) "
                "RETURN c.id AS id, c.object_text AS txt, newer.id AS superseded_by"
                % ENTITY_LAUNCH,
                [(CLAIM_1, "January", CLAIM_2),
                 (CLAIM_2, "March", None),
                 (CLAIM_3, "April", None)])

    assert_rows("A04", "revision chain out of CLAIM_2, bounded *1..3",
                "MATCH (a {id: %d})-[:SUPERSEDES*1..3]->(b) RETURN b.id AS id"
                % CLAIM_2, [(CLAIM_1,)])

    assert_rows("A05", "two hop: launch entity to claim to mentioned entity",
                "MATCH (e {id: %d})<-[:ABOUT]-(c)-[:MENTIONS]->(o) "
                "RETURN c.id AS claim, o.id AS other" % ENTITY_LAUNCH,
                [(CLAIM_1, ENTITY_ATLAS), (CLAIM_2, ENTITY_ATLAS)])

    assert_rows("A06", "three hop: span to claim to entity",
                "MATCH (s:EvidenceSpan)-[:SUPPORTS]->(c)-[:ABOUT]->(e {id: %d}) "
                "RETURN s.id AS span, c.id AS claim" % ENTITY_LAUNCH,
                [(SPAN_1, CLAIM_1), (SPAN_2, CLAIM_2), (SPAN_3, CLAIM_3)])

    assert_rows("A07", "unresolved contradiction",
                "MATCH (a:Claim)-[:CONTRADICTS]->(b:Claim) "
                "RETURN a.id AS a, b.id AS b", [(CLAIM_3, CLAIM_2)])

    assert_rows("A08", "provenance: the span behind the March claim",
                "MATCH (s)-[:SUPPORTS]->(c {id: %d}) "
                "RETURN s.id AS span, s.text AS txt" % CLAIM_2,
                [(SPAN_2, "correction, launch moved to March")])

    assert_rows("A09", "latest by tx_time via ORDER BY DESC LIMIT 1",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
                "RETURN c.id AS id, c.tx_time AS tx ORDER BY c.tx_time DESC LIMIT 1"
                % ENTITY_LAUNCH, [(CLAIM_3, 20250215)], ordered=True)

    assert_rows("A10", "full ordering by tx_time ascending",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
                "RETURN c.id AS id, c.tx_time AS tx ORDER BY c.tx_time ASC"
                % ENTITY_LAUNCH,
                [(CLAIM_1, 20250110), (CLAIM_2, 20250210), (CLAIM_3, 20250215)],
                ordered=True)

    # NO_RELEVANT_MEMORY: the fact that was never stated.
    assert_rows("A11", "absent entity returns nothing, not a guess",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN c.id AS id"
                % ENTITY_ABSENT, [])

    assert_rows("A12", "session to message to span, three hops of structure",
                "MATCH (s:Session)-[:CONTAINS]->(m)-[:HAS_SPAN]->(sp) "
                "RETURN m.id AS msg, sp.id AS span",
                [(MSG_1, SPAN_1), (MSG_2, SPAN_2), (MSG_2, SPAN_3)])

    assert_rows("A13", "bitemporal window on tx_time",
                "MATCH (c:Claim) WHERE c.tx_time > 20250115 AND c.tx_time < 20250301 "
                "RETURN c.id AS id", [(CLAIM_2,), (CLAIM_3,)])

    assert_rows("A14", "valid_from identical while tx_time differs",
                "MATCH (c:Claim) WHERE c.valid_from = 20250101 "
                "RETURN c.id AS id, c.tx_time AS tx",
                [(CLAIM_1, 20250110), (CLAIM_2, 20250210), (CLAIM_3, 20250215)])

    assert_rows("A15", "strong consistency returns the same answer",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN count(*) AS n"
                % ENTITY_LAUNCH, [(3,)], consistency="strong")

    print()
    print("=" * 112)
    print("PATH PROCEDURES over a graph that now has the edges")
    print("=" * 112)

    for pid, what, query in [
        ("P01", "SPpaths span to entity",
         "CALL algo.SPpaths({sourceNode: %d, targetNode: %d, "
         "relTypes: ['SUPPORTS','ABOUT'], relDirection: 'outgoing', maxLen: 4, "
         "pathCount: 1}) YIELD path RETURN path" % (SPAN_2, ENTITY_LAUNCH)),
        ("P02", "SSpaths from CLAIM_2 over SUPERSEDES",
         "CALL algo.SSpaths({sourceNode: %d, relTypes: ['SUPERSEDES'], "
         "relDirection: 'outgoing', maxLen: 3, resultLimit: 10}) YIELD path "
         "RETURN path" % CLAIM_2),
        ("P03", "MSpaths by property values, the IN substitute",
         "CALL algo.MSpaths({sourceLabel: 'EvidenceSpan', sourceProperty: 'text_hash', "
         "sourceValues: ['a1','b2'], targetLabel: 'Entity', targetProperty: 'kind', "
         "targetValues: ['event'], relTypes: ['SUPPORTS','ABOUT'], "
         "relDirection: 'outgoing', maxLen: 4, pathCount: 1, resultLimit: 10}) "
         "YIELD path RETURN path"),
    ]:
        status, body, ms = call(query)
        ok = status == 200 and "_error" not in body
        n = len(body.get("rows", [])) if ok else 0
        verdict = "PASS" if (ok and n > 0) else ("EMPTY" if ok else "FAIL")
        if verdict != "PASS":
            FAILED.append(pid)
        rec = {"probe": pid, "kind": "path", "what": what, "query": query,
               "http_status": status, "accepted": ok, "verdict": verdict,
               "row_count": n, "elapsed_ms": round(ms, 1), "response": body}
        RESULTS.append(rec)
        with open(os.path.join(EV, "%s.json" % pid), "w") as f:
            json.dump(rec, f, indent=2)
        print("%-6s PATH   %-5s %-52s %d path(s)" % (pid, verdict, what[:52], n))
        if verdict == "PASS" and pid == "P01":
            with open(os.path.join(EV, "path-shape.json"), "w") as f:
                json.dump(body["rows"][0][0], f, indent=2)
            print("           path payload written to path-shape.json")

    print()
    print("=" * 112)
    print("IDEMPOTENCE: re-run every edge, then re-count")
    print("=" * 112)
    for pid, what, src, rel, dst in edges:
        call("MERGE (a {id: %d})-[:%s]->(b {id: %d})" % (src, rel, dst))
    assert_rows("I01", "edge count unchanged after re-running every MERGE",
                "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN count(*) AS n"
                % ENTITY_LAUNCH, [(3,)])
    assert_rows("I02", "supersedes chain unchanged after re-merge",
                "MATCH (a {id: %d})-[:SUPERSEDES*1..3]->(b) RETURN b.id AS id"
                % CLAIM_2, [(CLAIM_1,)])

    print()
    print("=" * 112)
    with open(os.path.join(EV, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)
    print("total probes : %d" % len(RESULTS))
    print("passed       : %d" % len([r for r in RESULTS if r["verdict"] == "PASS"]))
    print("failed       : %d  %s" % (len(FAILED), FAILED))
    print("ROUND3_FAILS=%d" % len(FAILED))
    print("=" * 112)


if __name__ == "__main__":
    main()
