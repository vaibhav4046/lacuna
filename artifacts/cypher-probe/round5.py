#!/usr/bin/env python3
"""Round five. Paging, and whether a cursor can be stolen.

Round four's L02 concluded that server-side paging does not work in v0.1.1,
because feeding next_cursor back produced "result cursor does not belong to this
query request". That conclusion was wrong. The request body carries a query_id
field, the cursor is scoped to it, and L02 omitted it. Part one establishes the
real contract by executing all three readings of that error.

Part two is the question that follows immediately: a cursor is a small integer,
so if a cursor alone were enough to fetch rows, paging would be a way around the
token and the namespace header. Those are executed too, because SECURITY.md is
not allowed to claim anything that has not been run.
"""

import json
import os
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:18443/v1/graphs/default/query"
TOKEN = os.environ["HYDRA_TOKEN"]
NAMESPACE = "local"
EV = "/root/evidence/probe5"
Q = "MATCH (c:Claim) RETURN c.id AS id"

RESULTS = []
FAILED = []


def call(extra, query=Q, token=TOKEN, namespace=NAMESPACE):
    body = {"cell_id": "cell-0", "query": query}
    body.update(extra)
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    if token is not None:
        req.add_header("Authorization", "Bearer " + token)
    if namespace is not None:
        req.add_header("X-Graph-Namespace", namespace)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8")), \
                (time.perf_counter() - started) * 1000
    except urllib.error.HTTPError as e:
        return e.code, {"_error": e.read().decode("utf-8", "replace")}, \
            (time.perf_counter() - started) * 1000


def message(body):
    """The engine's own words, unwrapped from the two layers it arrives in."""
    raw = body.get("_error", "")
    try:
        return json.loads(raw)["error"]["message"]
    except Exception:
        return raw


def record(pid, what, extra, status, body, ms, ok, note=""):
    ids = [c[0].get("value") for c in body.get("rows", [])] \
        if status == 200 else []
    rec = {"probe": pid, "what": what, "request_extra": extra,
           "http_status": status, "verdict": "PASS" if ok else "FAIL",
           "row_ids": ids, "note": note,
           "next_cursor": body.get("next_cursor") if status == 200 else None,
           "query_id": body.get("query_id") if status == 200 else None,
           "engine_message": message(body) if status != 200 else None,
           "elapsed_ms": round(ms, 1), "response": body}
    RESULTS.append(rec)
    with open(os.path.join(EV, "%s.json" % pid), "w") as f:
        json.dump(rec, f, indent=2)
    if not ok:
        FAILED.append(pid)
    print("%-5s %-4s %-3d %-40s %s" % (pid, rec["verdict"], status, what[:40],
                                       note[:80]))
    return rec


def main():
    os.makedirs(EV, exist_ok=True)

    print("=" * 116)
    print("PART ONE. What the cursor is actually scoped to.")
    print("=" * 116)

    s, b, ms = call({})
    full = [c[0].get("value") for c in b.get("rows", [])] if s == 200 else []
    record("C01", "unpaged, so the whole result is known", {}, s, b, ms,
           s == 200 and len(full) == 3, "ids=%s" % full)

    e = {"page_size": 2}
    s, b, ms = call(e)
    p1 = record("H1a", "page one, no query_id sent", e, s, b, ms,
                s == 200 and len(p1_ids(b)) == 2 and b.get("next_cursor")
                is not None,
                "ids=%s next_cursor=%s query_id=%s"
                % (p1_ids(b), b.get("next_cursor"), b.get("query_id")))

    e = {"page_size": 2, "cursor": p1["next_cursor"]}
    s, b, ms = call(e)
    record("H1b", "page two, cursor WITHOUT query_id", e, s, b, ms,
           s != 200, "refused: %s" % message(b) if s != 200
           else "ACCEPTED, ids=%s" % p1_ids(b))

    e = {"page_size": 2, "cursor": p1["next_cursor"],
         "query_id": p1["query_id"]}
    s, b, ms = call(e)
    record("H1c", "page two, cursor WITH server query_id", e, s, b, ms,
           s == 200 and p1_ids(b) == [full[2]] and b.get("next_cursor") is None,
           "ids=%s next_cursor=%s" % (p1_ids(b), b.get("next_cursor")))

    e = {"page_size": 2, "query_id": "lacuna-r5-client-chosen"}
    s, b, ms = call(e)
    p2 = record("H2a", "page one, client-chosen query_id", e, s, b, ms,
                s == 200 and len(p1_ids(b)) == 2,
                "ids=%s next_cursor=%s query_id=%s"
                % (p1_ids(b), b.get("next_cursor"), b.get("query_id")))

    e = {"page_size": 2, "cursor": p2["next_cursor"],
         "query_id": "lacuna-r5-client-chosen"}
    s, b, ms = call(e)
    record("H2b", "page two, same client query_id", e, s, b, ms,
           s == 200 and p1_ids(b) == [full[2]],
           "ids=%s" % p1_ids(b))

    e = {"page_size": 2, "query_id": "lacuna-r5-epoch"}
    s, b, ms = call(e)
    p3 = record("H3a", "page one, before pinning read_epoch", e, s, b, ms,
                s == 200, "next_cursor=%s" % b.get("next_cursor"))
    e = {"page_size": 2, "cursor": p3["next_cursor"],
         "query_id": "lacuna-r5-epoch",
         "read_epoch": p3["response"].get("read_epoch")}
    s, b, ms = call(e)
    record("H3b", "page two, echoing read_epoch back", e, s, b, ms, True,
           ("refused: %s" % message(b)) if s != 200 else "accepted")

    e = {"page_size": 2, "query_id": "lacuna-r5-bookmark"}
    s, b, ms = call(e)
    p4 = record("H4a", "page one, before pinning bookmark", e, s, b, ms,
                s == 200, "next_cursor=%s" % b.get("next_cursor"))
    e = {"page_size": 2, "cursor": p4["next_cursor"],
         "query_id": "lacuna-r5-bookmark",
         "bookmark": p4["response"].get("bookmark")}
    s, b, ms = call(e)
    record("H4b", "page two, echoing bookmark back", e, s, b, ms, True,
           ("refused: %s" % message(b)) if s != 200 else "accepted")

    print()
    print("=" * 116)
    print("PART TWO. A cursor is a small integer. Can it be used as a way in?")
    print("=" * 116)

    e = {"page_size": 2, "query_id": "lacuna-r5-theft"}
    s, b, ms = call(e)
    victim = record("X10", "page one, the cursor about to be stolen", e,
                    s, b, ms, s == 200,
                    "next_cursor=%s" % b.get("next_cursor"))

    e = {"page_size": 2, "cursor": victim["next_cursor"],
         "query_id": "lacuna-r5-theft"}
    s, b, ms = call(e, namespace="other-tenant")
    leaked = s == 200 and len(b.get("rows", [])) > 0
    record("X11", "same cursor and query_id, other namespace", e, s, b, ms,
           not leaked,
           ("LEAK ids=%s" % p1_ids(b)) if leaked
           else "no data: %s" % (message(b) or "empty 200"))

    s, b, ms = call(e, token="wrong-token-32-characters-long-x")
    leaked = s == 200 and len(b.get("rows", [])) > 0
    record("X12", "same cursor and query_id, wrong bearer token", e, s, b, ms,
           not leaked,
           ("LEAK ids=%s" % p1_ids(b)) if leaked
           else "refused status=%d" % s)

    s, b, ms = call(e, token=None)
    leaked = s == 200 and len(b.get("rows", [])) > 0
    record("X13", "same cursor and query_id, no Authorization", e, s, b, ms,
           not leaked,
           ("LEAK ids=%s" % p1_ids(b)) if leaked
           else "refused status=%d" % s)

    e = {"page_size": 2, "cursor": 1, "query_id": "lacuna-r5-guess"}
    s, b, ms = call(e)
    leaked = s == 200 and len(b.get("rows", [])) > 0
    record("X14", "guessed cursor under a fresh query_id", e, s, b, ms,
           not leaked,
           ("LEAK ids=%s" % p1_ids(b)) if leaked
           else "refused: %s" % (message(b) or "empty 200"))

    e = {"page_size": 2, "query_id": "lacuna-r5-swap"}
    s, b, ms = call(e)
    swap = record("X15", "page one over :Claim", e, s, b, ms, s == 200,
                  "next_cursor=%s" % b.get("next_cursor"))
    e = {"page_size": 2, "cursor": swap["next_cursor"],
         "query_id": "lacuna-r5-swap"}
    s, b, ms = call(e, query="MATCH (s:Session) RETURN s.id AS id")
    record("X16", "same query_id and cursor, DIFFERENT query text", e, s, b, ms,
           True,
           ("rows=%s, so the cursor drives the result not the query text"
            % p1_ids(b)) if s == 200
           else "refused: %s" % message(b))

    e = {"page_size": 2, "query_id": "lacuna-r5-live-a"}
    s, b, ms = call(e)
    live = record("X17a", "page one under query_id A", e, s, b, ms, s == 200,
                  "next_cursor=%s" % b.get("next_cursor"))
    e = {"page_size": 2, "cursor": live["next_cursor"],
         "query_id": "lacuna-r5-live-b"}
    s, b, ms = call(e)
    took = s == 200 and len(b.get("rows", [])) > 0
    record("X17b", "A's live cursor replayed under query_id B, same text",
           e, s, b, ms, not took,
           ("BOUND TO TEXT ONLY, ids=%s" % p1_ids(b)) if took
           else "refused: %s" % (message(b) or "empty 200"))

    print()
    print("=" * 116)
    print("PART THREE. bookmark, which the engine named as the causal-read"
          " selector.")
    print("=" * 116)

    s, b, ms = call({}, query=(
        "UNWIND $rows AS row MERGE (p {id: row.id}) SET p:Probe, "
        "p.note = row.note"))
    record("B00", "write with no parameters, to see the failure shape", {},
           s, b, ms, True,
           ("refused: %s" % message(b)) if s != 200 else "accepted")

    body = {"cell_id": "cell-0",
            "query": "UNWIND $rows AS row MERGE (p {id: row.id}) SET p:Probe, "
                     "p.note = row.note",
            "parameters": {"rows": [{"id": 9100000000002,
                                     "note": "bookmark probe"}]}}
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("X-Graph-Namespace", NAMESPACE)
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as resp:
        wb = json.loads(resp.read().decode("utf-8"))
        ws = resp.status
    wms = (time.perf_counter() - started) * 1000
    record("B01", "does a WRITE hand back a bookmark", {"write": True},
           ws, wb, wms, ws == 200,
           "bookmark=%r read_epoch=%r"
           % (wb.get("bookmark"), wb.get("read_epoch")))

    e = {"bookmark": wb.get("bookmark")}
    s, b, ms = call(e, query="MATCH (p:Probe {id: 9100000000002}) "
                             "RETURN p.note AS note")
    seen = p1_ids(b) if s == 200 else []
    record("B02", "read back passing the write's bookmark", e, s, b, ms,
           s == 200 and len(b.get("rows", [])) == 1,
           "rows=%s" % json.dumps(b.get("rows"))[:70] if s == 200
           else "refused: %s" % message(b))

    e = {"bookmark": "sgk:1:deadbeef:deadbeef:deadbeef:999999"}
    s, b, ms = call(e, query="MATCH (p:Probe {id: 9100000000002}) "
                             "RETURN p.note AS note")
    record("B03", "a malformed bookmark is rejected", e, s, b, ms,
           True, ("refused: %s" % message(b)) if s != 200
           else "ACCEPTED, rows=%s" % json.dumps(b.get("rows"))[:50])

    # B03 only proves the bookmark is parsed, because "deadbeef" is not valid
    # UTF-8 once unhexed. A bookmark naming a different namespace, but otherwise
    # well formed, is the question that actually matters.
    foreign = "sgk:1:%s:%s:%s:66" % (
        "other-tenant".encode("utf-8").hex(),
        "default".encode("utf-8").hex(),
        "cell-0".encode("utf-8").hex())
    e = {"bookmark": foreign}
    s, b, ms = call(e, query="MATCH (p:Probe {id: 9100000000002}) "
                             "RETURN p.note AS note")
    leaked = s == 200 and len(b.get("rows", [])) > 0
    record("B04", "a well-formed bookmark naming another namespace",
           e, s, b, ms, not leaked,
           ("SERVED status=%d rows=%s" % (s, json.dumps(b.get("rows"))[:50]))
           if leaked else "refused: %s" % (message(b) or "empty 200"))

    print()
    print("=" * 116)
    with open(os.path.join(EV, "results.json"), "w") as f:
        json.dump(RESULTS, f, indent=2)
    print("total probes : %d" % len(RESULTS))
    print("passed       : %d" % (len(RESULTS) - len(FAILED)))
    print("failed       : %d  %s" % (len(FAILED), FAILED))
    print("ROUND5_FAILS=%d" % len(FAILED))
    print("=" * 116)


def p1_ids(body):
    return [c[0].get("value") for c in body.get("rows", [])]


if __name__ == "__main__":
    main()
