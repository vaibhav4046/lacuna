#!/usr/bin/env python3
"""Two questions the adapter's shape depends on, executed rather than assumed.

One: MERGE edge patterns were only ever proven with integer literals. If a
parameter works there too, the client never concatenates an id into query text.
If it does not, ids get inlined behind an integer guard and that has to be
written down as a real constraint rather than a preference.

Two: D-012 has the client minting its own query_id. Every executed example so
far used a short one. A UUID is 43 characters with the prefix, and whether the
server accepts that, and still scopes a cursor to it, is untested.
"""
import json
import os
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:18443/v1/graphs/default/query"
TOKEN = os.environ["HYDRA_TOKEN"]
NAMESPACE = "local"
EV = "/root/evidence/probe6"
RESULTS = []
FAILED = []

A = 9100000000001
B = 9100000000002


def call(body):
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("X-Graph-Namespace", NAMESPACE)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8")), \
                (time.perf_counter() - started) * 1000
    except urllib.error.HTTPError as e:
        return e.code, {"_error": e.read().decode("utf-8", "replace")}, \
            (time.perf_counter() - started) * 1000


def message(body):
    raw = body.get("_error", "")
    try:
        return json.loads(raw)["error"]["message"]
    except Exception:
        return raw


def record(pid, what, body, status, resp, ms, ok, note=""):
    rec = {"probe": pid, "what": what, "request": body, "http_status": status,
           "verdict": "PASS" if ok else "FAIL", "note": note,
           "engine_message": message(resp) if status != 200 else None,
           "elapsed_ms": round(ms, 1), "response": resp}
    RESULTS.append(rec)
    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)
    if not ok:
        FAILED.append(pid)
    print("%-5s %-4s %-3d %-46s %s" % (pid, rec["verdict"], status, what[:46],
                                       note[:90]))
    return rec


def base(query, **extra):
    b = {"cell_id": "cell-0", "query": query, "consistency": "strong",
         "timeout_ms": 5000}
    b.update(extra)
    return b


def main():
    os.makedirs(EV, exist_ok=True)

    # --- Part one: can an id be a parameter inside a MERGE edge pattern -----
    b = base("UNWIND $rows AS row MERGE (n {id: row.id}) SET n:ProbeSix, "
             "n.tag = row.tag",
             parameters={"rows": [{"id": A, "tag": "a"}, {"id": B, "tag": "b"}]})
    s, r, ms = call(b)
    record("P01", "seed two ProbeSix vertices", b, s, r, ms, s == 200,
           "epoch=%s" % r.get("read_epoch"))

    b = base("MERGE (a {id: $src})-[:PROBE_EDGE]->(b {id: $dst})",
             parameters={"src": A, "dst": B})
    s, r, ms = call(b)
    param_edge_ok = s == 200
    record("P02", "MERGE edge with $src and $dst parameters", b, s, r, ms, True,
           "accepted" if param_edge_ok else message(r)[:90])

    b = base("MERGE (a {id: %d})-[:PROBE_EDGE_LIT]->(b {id: %d})" % (A, B))
    s, r, ms = call(b)
    record("P03", "MERGE edge with integer literals (control)", b, s, r, ms,
           s == 200, "accepted" if s == 200 else message(r)[:90])

    # Did the parameterised edge actually land, or was it accepted and ignored?
    b = base("MATCH (a {id: $src})-[:PROBE_EDGE]->(b) RETURN b.tag AS tag",
             parameters={"src": A})
    s, r, ms = call(b)
    rows = r.get("rows", []) if s == 200 else []
    landed = s == 200 and len(rows) == 1 and rows[0][0].get("value") == "b"
    record("P04", "read back the parameterised edge", b, s, r, ms,
           landed or not param_edge_ok,
           "edge present" if landed else "NOT present: %s" % json.dumps(rows)[:70])

    # --- Part two: is a UUID-length client query_id usable -----------------
    qid = "lacuna-3f2b9c1e-5d47-4a80-9e6c-1b2a7d4e8f01"
    b = base("MATCH (c:Claim) RETURN c.id AS id", query_id=qid, page_size=2)
    s, r, ms = call(b)
    first_ok = s == 200 and r.get("query_id") == qid
    cursor = r.get("next_cursor")
    record("P05", "43-char client query_id, page_size 2", b, s, r, ms, first_ok,
           "echoed=%s cursor=%s" % (r.get("query_id") == qid, cursor))

    if cursor is not None:
        b = base("MATCH (c:Claim) RETURN c.id AS id", query_id=qid,
                 cursor=cursor)
        s, r, ms = call(b)
        record("P06", "follow the cursor under the same long query_id", b, s, r,
               ms, s == 200,
               "rows=%d cursor=%s" % (len(r.get("rows", [])), r.get("next_cursor"))
               if s == 200 else message(r)[:90])
    else:
        record("P06", "follow the cursor under the same long query_id", {}, 0,
               {}, 0, False, "no cursor issued by P05")

    with open(os.path.join(EV, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)
    print("\nPROBE6_FAILS=%d %s" % (len(FAILED), ",".join(FAILED)))
    print("PARAM_EDGE_ACCEPTED=%s" % param_edge_ok)


main()
