#!/usr/bin/env python3
"""Round four. Value encodings the adapter must decode, and the access controls
the threat model claims.

Rounds one to three settled which queries execute. They left four things unknown
that the client cannot be written correctly without: how a list comes back, how
booleans and floats come back, whether paging works, and whether the per-request
timeout is enforced. Two more are security claims rather than curiosities:
whether a wrong token is refused, and whether a different namespace can read this
namespace's data.
"""

import json
import os
import time
import urllib.error
import urllib.request

HOST = "http://127.0.0.1:18443"
URL = HOST + "/v1/graphs/default/query"
TOKEN = os.environ["HYDRA_TOKEN"]
NAMESPACE = "local"
CELL = "cell-0"
EV = "/root/evidence/probe4"

CLAIM_1 = 2000000000001
PROBE_V = 9100000000001

RESULTS = []
FAILED = []


def call(query, parameters=None, token=TOKEN, namespace=NAMESPACE, extra=None,
         url=URL):
    body = {"cell_id": CELL, "query": query}
    if parameters is not None:
        body["parameters"] = parameters
    if extra:
        body.update(extra)
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    if token is not None:
        req.add_header("Authorization", "Bearer " + token)
    if namespace is not None:
        req.add_header("X-Graph-Namespace", namespace)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw), (time.perf_counter() - started) * 1000
    except urllib.error.HTTPError as e:
        return e.code, {"_error": e.read().decode("utf-8", "replace")}, \
            (time.perf_counter() - started) * 1000
    except Exception as e:
        return 0, {"_exception": "%s: %s" % (type(e).__name__, e)}, \
            (time.perf_counter() - started) * 1000


def record(pid, what, expectation, status, body, ms, ok, note=""):
    rec = {"probe": pid, "what": what, "expectation": expectation,
           "http_status": status, "verdict": "PASS" if ok else "FAIL",
           "note": note, "elapsed_ms": round(ms, 1), "response": body}
    RESULTS.append(rec)
    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)
    if not ok:
        FAILED.append(pid)
    print("%-5s %-4s %-46s %s" % (pid, rec["verdict"], what[:46], note[:70]))


def main():
    os.makedirs(EV, exist_ok=True)

    print("=" * 104)
    print("VALUE ENCODINGS the client has to decode")
    print("=" * 104)

    # Seed one scratch vertex carrying a bool, a float and a negative integer.
    status, body, ms = call(
        "UNWIND $rows AS row MERGE (p {id: row.id}) SET p:Probe, "
        "p.flag = row.flag, p.ratio = row.ratio, p.offset = row.offset, "
        "p.label = row.label",
        {"rows": [{"id": PROBE_V, "flag": True, "ratio": 0.75,
                   "offset": -42, "label": "scratch"}]})
    record("S01", "seed a vertex with bool, float, negative int",
           "accepted", status, body, ms,
           status == 200 and "_error" not in body,
           (body.get("_error", "")[:70] if "_error" in body else "ok"))

    status, body, ms = call(
        "MATCH (p:Probe {id: %d}) RETURN p.flag AS f, p.ratio AS r, "
        "p.offset AS o, p.label AS l" % PROBE_V)
    tags = []
    if status == 200 and body.get("rows"):
        tags = [c.get("type") for c in body["rows"][0]]
    record("V10", "boolean, float, negative int, string tags",
           "each value carries a type tag", status, body, ms,
           status == 200 and len(tags) == 4, "tags=%s" % tags)

    status, body, ms = call("MATCH (c:Claim) RETURN collect(c.id) AS ids")
    ok = status == 200
    note = "rows=%s" % json.dumps(body.get("rows"))[:70] if ok \
        else body.get("_error", "")[:70]
    record("V11", "collect() in RETURN over a labelled match",
           "settles the list encoding, or names the refusal", status, body, ms,
           True, note)

    status, body, ms = call("MATCH (c:Claim) RETURN count(*) AS n, c.id AS i")
    record("V12", "count(*) beside a property in one RETURN",
           "either works or names the refusal", status, body, ms, True,
           ("rows=%s" % json.dumps(body.get("rows"))[:60]) if status == 200
           else body.get("_error", "")[:70])

    print()
    print("=" * 104)
    print("PAGING AND TIMEOUT, the result-limit controls THREAT_MODEL T4 claims")
    print("=" * 104)

    status, body, ms = call("MATCH (c:Claim) RETURN c.id AS id",
                            extra={"page_size": 2})
    n = len(body.get("rows", [])) if status == 200 else -1
    cur = body.get("next_cursor") if status == 200 else None
    record("L01", "page_size caps rows and returns a cursor",
           "2 rows of 3, next_cursor present", status, body, ms,
           status == 200 and n == 2 and cur is not None,
           "rows=%d next_cursor=%s" % (n, "set" if cur else "null"))

    if cur:
        status2, body2, ms2 = call("MATCH (c:Claim) RETURN c.id AS id",
                                   extra={"page_size": 2, "cursor": cur})
        n2 = len(body2.get("rows", [])) if status2 == 200 else -1
        record("L02", "cursor returns the remainder",
               "the third row", status2, body2, ms2,
               status2 == 200 and n2 == 1, "rows=%d" % n2)

    status, body, ms = call("MATCH (c:Claim) RETURN c.id AS id",
                            extra={"timeout_ms": 1})
    record("T01", "timeout_ms=1 is honoured or the query simply wins",
           "no hang, no 500", status, body, ms,
           status in (200, 400, 408, 504),
           "status=%d in %.1fms" % (status, ms))

    print()
    print("=" * 104)
    print("ACCESS CONTROL. These are claims in SECURITY.md, so they get executed.")
    print("=" * 104)

    q = "MATCH (c:Claim {id: %d}) RETURN c.object_text AS t" % CLAIM_1
    status, body, ms = call(q)
    baseline = len(body.get("rows", [])) if status == 200 else -1
    record("X01", "baseline: correct token and namespace reads the claim",
           "1 row", status, body, ms, status == 200 and baseline == 1,
           "rows=%d" % baseline)

    status, body, ms = call(q, token="wrong-token-32-characters-long-x")
    record("X02", "wrong bearer token is refused",
           "401 or 403, never 200", status, body, ms,
           status in (401, 403), "status=%d" % status)

    status, body, ms = call(q, token=None)
    record("X03", "missing Authorization header is refused",
           "401 or 403, never 200", status, body, ms,
           status in (401, 403), "status=%d" % status)

    status, body, ms = call(q, namespace="other-tenant")
    leaked = status == 200 and len(body.get("rows", [])) > 0
    record("X04", "another namespace cannot read this one's data",
           "0 rows or an error, never the claim text", status, body, ms,
           not leaked,
           "LEAK status=%d rows=%s" % (status, json.dumps(body.get("rows"))[:50])
           if leaked else "status=%d, no data" % status)

    status, body, ms = call(q, namespace=None)
    record("X05", "absent namespace header does not default into 'local'",
           "0 rows or an error, never the claim text", status, body, ms,
           not (status == 200 and len(body.get("rows", [])) > 0),
           "status=%d rows=%s" % (status, json.dumps(body.get("rows"))[:40]))

    status, body, ms = call(
        "MATCH (c:Claim {id: %d}) RETURN c.object_text AS t; "
        "MATCH (x:Claim) RETURN x.id AS i" % CLAIM_1)
    record("X06", "two statements in one request are refused",
           "rejected, so statement injection has no second statement",
           status, body, ms, status != 200,
           (body.get("_error", "")[:70]) if status != 200 else "ACCEPTED, BAD")

    print()
    print("=" * 104)
    with open(os.path.join(EV, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)
    print("total probes : %d" % len(RESULTS))
    print("failed       : %d  %s" % (len(FAILED), FAILED))
    print("ROUND4_FAILS=%d" % len(FAILED))
    print("=" * 104)


if __name__ == "__main__":
    main()
