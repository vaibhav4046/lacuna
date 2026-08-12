#!/usr/bin/env python3
"""Round two. Round one's rejections carried instructions; this executes them.

Each round-one failure had an error message that named the accepted form:
  "MERGE with following clauses is not executable"          -> MERGE alone
  "MERGE pattern matches only id; apply labels with SET"    -> SET c:Label
  "UNWIND vertex upsert requires exactly one SET label"     -> exactly one
  "only one-hop edge patterns are executable in MERGE"      -> MERGE (a)-[:R]->(b)
  "UNWIND MATCH must end in RETURN or DELETE"               -> not a write shape
  "RETURN currently supports <binding>.<property> or count(*)" -> count(*)
  "WITH must pass through every in-scope binding"           -> carry them all
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
EV = "/root/evidence/probe2"

SESSION_1 = 5000000000001
MSG_1, MSG_2 = 4000000000001, 4000000000002
SPAN_1, SPAN_2, SPAN_3 = 3000000000001, 3000000000002, 3000000000003
CLAIM_1, CLAIM_2, CLAIM_3 = 2000000000001, 2000000000002, 2000000000003
ENTITY_LAUNCH, ENTITY_ATLAS = 1000000000001, 1000000000002


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
            try:
                return resp.status, json.loads(raw), ms
            except json.JSONDecodeError:
                return resp.status, {"_unparsed": raw}, ms
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return e.code, {"_error": raw}, (time.perf_counter() - started) * 1000
    except Exception as e:
        return 0, {"_exception": "%s: %s" % (type(e).__name__, e)}, \
            (time.perf_counter() - started) * 1000


RESULTS = []


def probe(pid, category, what, query, parameters=None, consistency=None,
          timeout_ms=None, expect="accept", show_rows=False):
    status, body, ms = call(query, parameters, consistency, timeout_ms)
    accepted = status == 200 and "_error" not in body and "_exception" not in body
    verdict = ("PASS" if accepted else "FAIL") if expect == "accept" \
        else ("PASS" if not accepted else "UNEXPECTED-ACCEPT")

    if accepted:
        detail = "cols=%s rows=%d" % (body.get("columns"), len(body.get("rows", [])))
        if show_rows:
            detail += " " + json.dumps(body.get("rows"))[:300]
    else:
        msg = body.get("_error") or body.get("_exception") or ""
        detail = ("HTTP %s " % status) + msg.replace("\n", " ")[:200]

    rec = {"probe": pid, "category": category, "what": what, "query": query,
           "parameters": parameters, "expected": expect, "http_status": status,
           "accepted": accepted, "verdict": verdict, "elapsed_ms": round(ms, 1),
           "response": body}
    RESULTS.append(rec)
    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)
    print("%-6s %-10s %-4s %-50s %s" % (pid, category, verdict, what[:50], detail))
    return rec


def main():
    os.makedirs(EV, exist_ok=True)

    print("=" * 112)
    print("VALUE ENCODING: what a null, an integer and a list look like on the wire")
    print("=" * 112)
    probe("V01", "encoding", "OPTIONAL MATCH null encoding, absent side",
          "MATCH (c {id: %d}) OPTIONAL MATCH (c)-[:SUPERSEDES]->(old) "
          "RETURN c.id AS id, old.id AS superseded" % CLAIM_3, show_rows=True)
    probe("V02", "encoding", "parameter round trip",
          "MATCH (c {id: $cid}) RETURN c.object_text AS txt",
          parameters={"cid": CLAIM_2}, show_rows=True)
    probe("V03", "encoding", "collect() list encoding",
          "MATCH (c) RETURN collect(c.id) AS ids", show_rows=True)

    print()
    print("=" * 112)
    print("WRITE, ROUND TWO: the forms the round-one errors named")
    print("=" * 112)

    probe("W01", "write", "MERGE alone, no following clause",
          "MERGE (c {id: %d})" % CLAIM_1)

    probe("W02", "write", "MERGE alone with a label in the pattern",
          "MERGE (c:Claim {id: %d})" % 9000000000002)

    probe("W03", "write", "MATCH then SET as its own statement",
          "MATCH (c {id: %d}) SET c.predicate = 'launch_date'" % CLAIM_1)

    # The form the UNWIND errors described: match on id only, label via SET.
    claim_rows = [
        {"id": CLAIM_1, "predicate": "launch_date", "object_text": "January",
         "valid_from": 20250101, "tx_time": 20250110, "polarity": 1,
         "canonical_key": "claim|launch_date|January"},
        {"id": CLAIM_2, "predicate": "launch_date", "object_text": "March",
         "valid_from": 20250101, "tx_time": 20250210, "polarity": 1,
         "canonical_key": "claim|launch_date|March"},
        {"id": CLAIM_3, "predicate": "launch_date", "object_text": "April",
         "valid_from": 20250101, "tx_time": 20250215, "polarity": 1,
         "canonical_key": "claim|launch_date|April"},
    ]
    probe("W04", "write", "UNWIND upsert: MERGE on id, label via SET",
          "UNWIND $rows AS row MERGE (c {id: row.id}) SET c:Claim, "
          "c.predicate = row.predicate, c.object_text = row.object_text, "
          "c.valid_from = row.valid_from, c.tx_time = row.tx_time, "
          "c.polarity = row.polarity, c.canonical_key = row.canonical_key",
          parameters={"rows": claim_rows})

    span_rows = [
        {"id": SPAN_1, "message_id": MSG_1, "start": 0, "end": 42,
         "text_hash": "a1", "text": "the launch is in January"},
        {"id": SPAN_2, "message_id": MSG_2, "start": 0, "end": 38,
         "text_hash": "b2", "text": "correction, launch moved to March"},
        {"id": SPAN_3, "message_id": MSG_2, "start": 39, "end": 80,
         "text_hash": "c3", "text": "someone else said April"},
    ]
    probe("W05", "write", "UNWIND upsert, EvidenceSpan",
          "UNWIND $rows AS row MERGE (s {id: row.id}) SET s:EvidenceSpan, "
          "s.message_id = row.message_id, s.start = row.start, s.end = row.end, "
          "s.text_hash = row.text_hash, s.text = row.text",
          parameters={"rows": span_rows})

    probe("W06", "write", "UNWIND upsert, Entity",
          "UNWIND $rows AS row MERGE (e {id: row.id}) SET e:Entity, "
          "e.name = row.name, e.kind = row.kind",
          parameters={"rows": [
              {"id": ENTITY_LAUNCH, "name": "Project Atlas launch", "kind": "event"},
              {"id": ENTITY_ATLAS, "name": "Project Atlas", "kind": "project"},
          ]})

    probe("W07", "write", "UNWIND upsert, Session and Message",
          "UNWIND $rows AS row MERGE (m {id: row.id}) SET m:Message, "
          "m.session_id = row.session_id, m.role = row.role, m.ts = row.ts, "
          "m.seq = row.seq",
          parameters={"rows": [
              {"id": MSG_1, "session_id": SESSION_1, "role": "user",
               "ts": 20250110, "seq": 1},
              {"id": MSG_2, "session_id": SESSION_1, "role": "user",
               "ts": 20250210, "seq": 2},
          ]})

    probe("W08", "write", "UNWIND upsert, Session",
          "UNWIND $rows AS row MERGE (s {id: row.id}) SET s:Session, "
          "s.session_key = row.session_key, s.started_at = row.started_at, "
          "s.seq = row.seq",
          parameters={"rows": [
              {"id": SESSION_1, "session_key": "sess-1",
               "started_at": 20250110, "seq": 1},
          ]})

    # Edge creation: "only one-hop edge patterns are executable in MERGE".
    probe("W09", "write", "one-hop edge MERGE, literal ids",
          "MERGE (a {id: %d})-[:SUPERSEDES]->(b {id: %d})" % (CLAIM_2, CLAIM_1))

    probe("W10", "write", "UNWIND one-hop edge MERGE",
          "UNWIND $rows AS row MERGE (a {id: row.src})-[:SUPPORTS]->(b {id: row.dst})",
          parameters={"rows": [
              {"src": SPAN_1, "dst": CLAIM_1},
              {"src": SPAN_2, "dst": CLAIM_2},
              {"src": SPAN_3, "dst": CLAIM_3},
          ]})

    probe("W11", "write", "UNWIND one-hop edge MERGE, ABOUT",
          "UNWIND $rows AS row MERGE (c {id: row.src})-[:ABOUT]->(e {id: row.dst})",
          parameters={"rows": [
              {"src": CLAIM_1, "dst": ENTITY_LAUNCH},
              {"src": CLAIM_2, "dst": ENTITY_LAUNCH},
              {"src": CLAIM_3, "dst": ENTITY_LAUNCH},
          ]})

    probe("W12", "write", "UNWIND one-hop edge MERGE, MENTIONS",
          "UNWIND $rows AS row MERGE (c {id: row.src})-[:MENTIONS]->(e {id: row.dst})",
          parameters={"rows": [
              {"src": CLAIM_1, "dst": ENTITY_ATLAS},
              {"src": CLAIM_2, "dst": ENTITY_ATLAS},
          ]})

    probe("W13", "write", "UNWIND one-hop edge MERGE, CONTAINS",
          "UNWIND $rows AS row MERGE (s {id: row.src})-[:CONTAINS]->(m {id: row.dst})",
          parameters={"rows": [
              {"src": SESSION_1, "dst": MSG_1},
              {"src": SESSION_1, "dst": MSG_2},
          ]})

    probe("W14", "write", "UNWIND one-hop edge MERGE, HAS_SPAN",
          "UNWIND $rows AS row MERGE (m {id: row.src})-[:HAS_SPAN]->(s {id: row.dst})",
          parameters={"rows": [
              {"src": MSG_1, "dst": SPAN_1},
              {"src": MSG_2, "dst": SPAN_2},
              {"src": MSG_2, "dst": SPAN_3},
          ]})

    probe("W15", "write", "UNWIND one-hop edge MERGE, CONTRADICTS",
          "UNWIND $rows AS row MERGE (a {id: row.src})-[:CONTRADICTS]->(b {id: row.dst})",
          parameters={"rows": [{"src": CLAIM_3, "dst": CLAIM_2}]})

    probe("W16", "write", "re-running the same UNWIND upsert is idempotent",
          "UNWIND $rows AS row MERGE (c {id: row.id}) SET c:Claim, "
          "c.predicate = row.predicate, c.object_text = row.object_text, "
          "c.valid_from = row.valid_from, c.tx_time = row.tx_time, "
          "c.polarity = row.polarity, c.canonical_key = row.canonical_key",
          parameters={"rows": claim_rows})

    probe("W17", "write", "UNWIND batch SET on existing nodes",
          "UNWIND $rows AS row MATCH (c {id: row.id}) SET c.checked = row.checked",
          parameters={"rows": [{"id": CLAIM_1, "checked": 1}]},
          expect="reject")

    print()
    print("=" * 112)
    print("READ, ROUND TWO: against a graph that now has data in it")
    print("=" * 112)

    probe("Q01", "read", "all claims about the launch entity",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
          "RETURN c.id AS id, c.object_text AS txt, c.tx_time AS tx"
          % ENTITY_LAUNCH, show_rows=True)

    probe("Q02", "read", "count(*) instead of count(binding)",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN count(*) AS n"
          % ENTITY_LAUNCH, show_rows=True)

    probe("Q03", "substitute", "CURRENT CLAIM: OPTIONAL MATCH, superseder projected",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
          "OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c) "
          "RETURN c.id AS id, c.object_text AS txt, newer.id AS superseded_by"
          % ENTITY_LAUNCH, show_rows=True)

    probe("Q04", "substitute", "CURRENT CLAIM with count(*) in the aggregate",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
          "OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c) "
          "RETURN c.id AS id, count(*) AS n" % ENTITY_LAUNCH, show_rows=True)

    probe("Q05", "read", "the revision chain, bounded variable length",
          "MATCH (a {id: %d})-[:SUPERSEDES*1..3]->(b) RETURN b.id AS id"
          % CLAIM_2, show_rows=True)

    probe("Q06", "read", "two-hop: entity to claim to mentioned entity",
          "MATCH (e {id: %d})<-[:ABOUT]-(c)-[:MENTIONS]->(o) "
          "RETURN c.id AS claim, o.id AS other" % ENTITY_LAUNCH, show_rows=True)

    probe("Q07", "read", "three-hop: span to claim to entity",
          "MATCH (s:EvidenceSpan)-[:SUPPORTS]->(c)-[:ABOUT]->(e {id: %d}) "
          "RETURN s.id AS span, s.text AS txt, c.id AS claim"
          % ENTITY_LAUNCH, show_rows=True)

    probe("Q08", "read", "WITH carrying every in-scope binding",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) WITH c, e RETURN c.id AS id"
          % ENTITY_LAUNCH, show_rows=True)

    probe("Q09", "substitute", "ORDER BY tx_time DESC LIMIT 1 as max()",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) "
          "RETURN c.id AS id, c.tx_time AS tx ORDER BY c.tx_time DESC LIMIT 1"
          % ENTITY_LAUNCH, show_rows=True)

    probe("Q10", "read", "contradiction detection",
          "MATCH (a:Claim)-[:CONTRADICTS]->(b:Claim) "
          "RETURN a.id AS a, b.id AS b", show_rows=True)

    probe("Q11", "read", "provenance: every span supporting one claim",
          "MATCH (s)-[:SUPPORTS]->(c {id: %d}) RETURN s.id AS span, s.text AS txt"
          % CLAIM_2, show_rows=True)

    probe("Q12", "read", "STARTS WITH over real data",
          "MATCH (c:Claim) WHERE c.canonical_key STARTS WITH 'claim|launch_date' "
          "RETURN c.id AS id, c.object_text AS txt", show_rows=True)

    probe("Q13", "read", "bitemporal filter: tx_time window",
          "MATCH (c:Claim) WHERE c.tx_time > 20250115 AND c.tx_time < 20250301 "
          "RETURN c.id AS id, c.tx_time AS tx", show_rows=True)

    probe("Q14", "read", "algo.SPpaths over real data",
          "CALL algo.SPpaths({sourceNode: %d, targetNode: %d, "
          "relTypes: ['SUPPORTS','ABOUT'], relDirection: 'outgoing', maxLen: 4, "
          "pathCount: 1}) YIELD path RETURN path" % (SPAN_2, ENTITY_LAUNCH),
          show_rows=True)

    probe("Q15", "read", "algo.SSpaths over real data",
          "CALL algo.SSpaths({sourceNode: %d, relTypes: ['SUPERSEDES'], "
          "relDirection: 'outgoing', maxLen: 3, resultLimit: 10}) YIELD path RETURN path"
          % CLAIM_2, show_rows=True)

    probe("Q16", "substitute", "algo.MSpaths sourceValues as the IN substitute",
          "CALL algo.MSpaths({sourceLabel: 'EvidenceSpan', sourceProperty: 'text_hash', "
          "sourceValues: ['a1','b2'], targetLabel: 'Entity', targetProperty: 'kind', "
          "targetValues: ['event'], relTypes: ['SUPPORTS','ABOUT'], "
          "relDirection: 'outgoing', maxLen: 4, pathCount: 1, resultLimit: 10}) "
          "YIELD path RETURN path", show_rows=True)

    probe("Q17", "read", "path procedure yielding weight and cost",
          "CALL algo.SPpaths({sourceNode: %d, targetNode: %d, "
          "relTypes: ['SUPPORTS','ABOUT'], relDirection: 'outgoing', maxLen: 4, "
          "pathCount: 1}) YIELD path, pathWeight, pathCost "
          "RETURN path, pathWeight, pathCost" % (SPAN_2, ENTITY_LAUNCH),
          show_rows=True)

    probe("Q18", "read", "strong consistency over real data",
          "MATCH (c:Claim)-[:ABOUT]->(e {id: %d}) RETURN count(*) AS n"
          % ENTITY_LAUNCH, consistency="strong", show_rows=True)

    print()
    print("=" * 112)
    with open(os.path.join(EV, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)
    fails = [r for r in RESULTS if r["verdict"] != "PASS"]
    print("total probes : %d" % len(RESULTS))
    print("passed       : %d" % len([r for r in RESULTS if r["verdict"] == "PASS"]))
    print("failing      : %d" % len(fails))
    for r in fails:
        print("  FAIL %s  %s" % (r["probe"], r["what"]))
    print("ROUND2_FAILS=%d" % len(fails))
    print("=" * 112)


if __name__ == "__main__":
    main()
