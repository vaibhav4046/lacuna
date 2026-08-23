#!/usr/bin/env bash
#
# Start, stop or inspect the HydraDB node Lacuna talks to.
#
# This is upstream's step 7 block with three paths moved and one line removed.
# The three paths are the ones that decide whether the graph still exists
# tomorrow: LOCAL_PATH, GRAPH_AUTH_TOKEN_FILE and GRAPH_DATA_CACHE_DIR. Upstream
# points all of them at /tmp/sgk-local and says plainly that those paths are
# disposable, which is correct for a smoke test and useless for a demo corpus.
# The removed line is the `rm -rf` that upstream runs to reset the store, because
# resetting is the opposite of what this script is for.
#
# Nothing in the HydraDB repository is modified. The environment variables it
# already reads are simply pointed somewhere that lasts. See D-010 in
# DECISIONS.md.
#
# Usage:
#   scripts/hydra-node.sh start
#   scripts/hydra-node.sh stop
#   scripts/hydra-node.sh status
#
# Environment overrides, all optional:
#   HYDRA_REPO   checkout of hydradb            (default /opt/hydradb)
#   HYDRA_ROOT   persistent data directory      (default /var/lib/lacuna/hydradb)

set -euo pipefail

HYDRA_REPO="${HYDRA_REPO:-/opt/hydradb}"
HYDRA_ROOT="${HYDRA_ROOT:-/var/lib/lacuna/hydradb}"

BOLT_ADDR=127.0.0.1:17687
HTTP_ADDR=127.0.0.1:18443
ADMIN_ADDR=127.0.0.1:19091

BINARY="$HYDRA_REPO/target/debug/graph-node"
PID_FILE="$HYDRA_ROOT/node.pid"
LOG_FILE="$HYDRA_ROOT/node.log"
TOKEN_FILE="$HYDRA_ROOT/auth-token"

die() { printf 'hydra-node: %s\n' "$*" >&2; exit 1; }

# 48 hex characters from urandom. Upstream ships a documented placeholder token
# for its throwaway node; a node that lives for the length of a hackathon gets a
# real random one instead. It is written 0600 outside the repository and is never
# printed by this script.
mint_token() {
  ( set +o pipefail; LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 48 )
}

# `kill -0` is not enough on its own. A node started with nohup from a shell that
# is still alive leaves a zombie behind after it exits, and kill -0 answers yes to
# a zombie. Observed on this machine: pid 423 reported alive, state Z+, with
# nothing listening on any of the three ports.
running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid state
  pid="$(cat "$PID_FILE")"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ')"
  case "$state" in
    Z*|'') return 1 ;;
  esac
  printf '%s' "$pid"
}

ready() {
  curl -fsS "http://$ADMIN_ADDR/readyz" >/dev/null 2>&1
}

cmd_start() {
  if pid="$(running_pid)"; then
    echo "already running, pid $pid"
    cmd_status
    return 0
  fi

  # No build here on purpose. Upstream's step 6 builds this binary and knows how;
  # duplicating a cargo invocation is exactly the kind of invented build command
  # AGENTS.md forbids.
  [ -x "$BINARY" ] || die "no binary at $BINARY. Build it with upstream's step 6 first."

  mkdir -p "$HYDRA_ROOT/store" "$HYDRA_ROOT/cache"
  if [ ! -s "$TOKEN_FILE" ]; then
    umask 077
    mint_token >"$TOKEN_FILE"
    printf '\n' >>"$TOKEN_FILE"
    echo "minted a new auth token at $TOKEN_FILE"
    echo "put its contents in HYDRA_TOKEN in .env.local"
  fi
  chmod 600 "$TOKEN_FILE"

  export CLOUD_PROVIDER=local LOCAL_PATH="$HYDRA_ROOT/store"
  export GRAPH_NAMESPACE=local GRAPH_ID=default
  export GRAPH_CELL_ID=cell-0 GRAPH_CELLS=cell-0 GRAPH_DATA_PATH=data
  export GRAPH_ALLOW_PLAINTEXT=true GRAPH_AUTH_TOKEN_FILE="$TOKEN_FILE"
  export GRAPH_DATA_CACHE_BYTES=67108864 GRAPH_DATA_CACHE_DIR="$HYDRA_ROOT/cache"
  export GRAPH_NODE_ID=node-0
  export GRAPH_BOLT_ADDR="$BOLT_ADDR" GRAPH_ADVERTISED_BOLT_ADDR="$BOLT_ADDR"
  export GRAPH_BOLT_NODE_ADDRESSES="node-0=$BOLT_ADDR"
  export GRAPH_HTTP_ADDR="$HTTP_ADDR" GRAPH_ADMIN_ADDR="$ADMIN_ADDR"
  # The query engine recurses deeply enough to overflow the default 8 MiB thread
  # stack on real query shapes, so the minimum is raised rather than tuned.
  # RUST_LOG stays overridable so a node can be restarted louder. Worth knowing
  # before you try it: the engine answers a failed query with a bare "internal
  # query execution error" over HTTP, and on the one incident where that
  # mattered, restarting at debug added nothing to the log. The binary keeps its
  # own filter. See DECISIONS.md D-054.
  export RUST_MIN_STACK=33554432
  export RUST_LOG="${RUST_LOG:-info}"

  cd "$HYDRA_REPO"
  nohup "$BINARY" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$PID_FILE"

  local waited=0
  until ready; do
    kill -0 "$pid" 2>/dev/null || { echo "node died on startup:"; tail -20 "$LOG_FILE"; exit 1; }
    [ "$waited" -lt 60 ] || { echo "not ready after ${waited}s:"; tail -20 "$LOG_FILE"; exit 1; }
    sleep 1
    waited=$((waited + 1))
  done

  echo "ready after ${waited}s, pid $pid"
  cmd_status
}

cmd_stop() {
  if pid="$(running_pid)"; then
    kill "$pid"
    # Shutdown is not instant. Measured on this machine: SIGTERM to first node,
    # then roughly 30 seconds of slatedb work (garbage collector shutdown, db
    # close, checkpoint delete) before "graph node stopped" reaches the log. A
    # 30 second timeout was tight enough to fire on a shutdown that was working.
    local waited=0
    while running_pid >/dev/null; do
      [ "$waited" -lt 120 ] || die "pid $pid did not exit after ${waited}s"
      sleep 1
      waited=$((waited + 1))
    done
    rm -f "$PID_FILE"
    echo "stopped pid $pid after ${waited}s"
  else
    echo "not running"
  fi
}

cmd_status() {
  local pid
  if pid="$(running_pid)"; then
    echo "pid       $pid"
  else
    echo "pid       not running"
  fi
  echo "root      $HYDRA_ROOT"
  echo "store     $(du -sh "$HYDRA_ROOT/store" 2>/dev/null | cut -f1 || echo absent)"
  echo "bolt      $BOLT_ADDR"
  echo "http      $HTTP_ADDR"
  echo "admin     $ADMIN_ADDR"
  if ready; then
    echo "readyz    ok"
  else
    echo "readyz    no answer"
  fi
}


# Rebuild the object store, because it is derived data.
#
# SlateDB's local-filesystem backend does not implement a conditional put
# (`put_opts` with `PutMode::Update`), and once the store has been restarted
# onto a checkpoint that needs one, every write fails with a 500 while reads
# keep working. That reads like a Lacuna bug and is not one; the node's own log
# names it. Upstream limitation, no configuration on this side clears it.
#
# The recovery is cheap because ingest is a pure function of a seed: the store
# holds nothing that the corpus generator cannot produce again. So the broken
# store is moved aside rather than deleted, a fresh one takes its place, and
# the caller re-ingests. Nothing is lost and the previous store stays on disk
# for anyone who wants to look at it.
cmd_heal() {
  echo "rotating the store; ingest rebuilds it from the seed"
  cmd_stop || true
  local aside="$HYDRA_ROOT/store.broken-$(date +%s)"
  if [ -d "$HYDRA_ROOT/store" ]; then
    mv "$HYDRA_ROOT/store" "$aside"
    echo "moved     $aside"
  fi
  mkdir -p "$HYDRA_ROOT/store"
  cmd_start
  echo
  echo "now run:  npm run ingest && npm run census"
}

case "${1:-}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  heal)   cmd_heal ;;
  *)      die "usage: $0 start|stop|status|heal" ;;
esac
