#!/usr/bin/env bash
#
# Clean-clone reproduction.
#
# Clones this repository into a directory that has never held it, installs from
# the lockfile, typechecks, runs the unit suite, then starts the server and asks
# it the four demo questions. Everything it prints is real command output.
#
#   artifacts/repro/repro.sh
#
# The one thing it cannot fetch for you is the config. The clone has no
# .env.local, because .env.local is git-ignored and always has been. If you have
# one already (see .env.example and README.md), the script copies it into the
# clone without reading it and goes on to the serve step. If you do not, the
# script stops after the tests and says so; steps 1 to 4 still prove the build.
#
# Requires a HydraDB node running for steps 6 and 7. See README.md.

set -u

SRC=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
DEST=${2:-$(mktemp -d)/lacuna-repro}
PORT=${PORT:-3016}
SERVE_LOG="$DEST.serve.log"
PAGE="$DEST.page.html"

# `npm run serve` is npm spawning node. Killing the npm process leaves the node
# process holding the port, which is how an earlier version of this script had
# a stale server answer a later run's questions. Kill the tree.
# Killing the shell job kills npm and leaves node holding the port, so go after
# whatever actually owns the listening socket. msys `ps` has no -o, so the pid
# comes from netstat there rather than from the process tree.
stop_server() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      for pid in $(netstat -ano 2>/dev/null \
          | grep -E ":$PORT[^0-9]" | grep -i listening | awk '{print $NF}' | sort -u); do
        taskkill //PID "$pid" //T //F > /dev/null 2>&1
      done
      ;;
    *)
      for pid in $(lsof -ti "tcp:$PORT" 2>/dev/null); do
        kill "$pid" 2>/dev/null
      done
      ;;
  esac
  if [ -n "${SERVE_PID:-}" ]; then
    kill "$SERVE_PID" 2>/dev/null
    wait "$SERVE_PID" 2>/dev/null
  fi
}

echo "=== 0. environment ==="
echo "date        $(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC"
echo "node        $(node -v)"
echo "npm         $(npm -v)"
echo "os          $(uname -s -r)"
echo "source      $SRC"
echo "clone into  $DEST"
echo

echo "=== 1. git clone into a path that has never held this project ==="
git clone --quiet "$SRC" "$DEST" || exit 1
echo "CLONE_EXIT=$?"
cd "$DEST" || exit 1
echo "HEAD        $(git rev-parse --short HEAD)"
echo "commits     $(git rev-list --count HEAD)"
echo "tracked     $(git ls-files | wc -l) files"
echo "untracked   $(git status --porcelain | wc -l) (expect 0)"
echo

echo "=== 2. npm ci ==="
npm ci 2>&1 | tail -4
echo "NPM_CI_EXIT=${PIPESTATUS[0]}"
echo

echo "=== 3. typecheck ==="
npx tsc --noEmit 2>&1 | tail -20
echo "TYPECHECK_EXIT=${PIPESTATUS[0]}"
echo

echo "=== 4. unit tests ==="
# Two lines on stderr here are expected. The error-path tests assert what the
# code does when the node refuses a connection and when an entity name is
# ambiguous, and those tests log the error they provoked. Read the counts.
npx vitest run tests/unit 2>&1 | tail -8
echo "UNIT_EXIT=${PIPESTATUS[0]}"
echo

echo "=== 5. config ==="
if [ ! -f "$SRC/.env.local" ]; then
  echo "No .env.local at $SRC, so there is nothing to copy in."
  echo "Steps 1 to 4 above stand on their own. To run the server too, write one"
  echo "from .env.example and re-run this script. Stopping here."
  exit 0
fi
cp "$SRC/.env.local" "$DEST/.env.local"
echo "COPY_EXIT=$?"
echo "keys present, values never printed:"
sed -E 's/=.*/=<redacted>/' "$DEST/.env.local" | grep -v '^$'
echo

echo "=== 6. serve, reading the live HydraDB node over HTTP ==="
# Refuse to run if something already answers on this port. A server left over
# from an earlier run will answer these requests perfectly well and the whole
# reproduction will pass without having started anything, which is worse than
# failing. This happened once; hence the check.
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then
  echo "ABORT: something is already listening on 127.0.0.1:$PORT."
  echo "Stop it, or re-run with PORT=<free port>. Refusing to let a server this"
  echo "script did not start answer the questions below."
  exit 1
fi
PORT=$PORT npm run serve > "$SERVE_LOG" 2>&1 &
SERVE_PID=$!
curl -s -o /dev/null --retry 30 --retry-delay 1 --retry-connrefused \
  --max-time 60 "http://127.0.0.1:$PORT/"
echo "SERVER_UP_EXIT=$?"
head -5 "$SERVE_LOG"
# And prove the thing answering is the thing we launched.
if ! grep -q "Lacuna on http://127.0.0.1:$PORT" "$SERVE_LOG"; then
  echo "ABORT: the server this script started never announced itself on $PORT."
  stop_server
  exit 1
fi
echo

echo "=== 7. the four demo questions, against the clone ==="
for q in "subject=Bellwether&predicate=beta_partner" \
         "subject=Junco&predicate=launch_date" \
         "subject=Meridian&predicate=migration_window" \
         "subject=replay-queue&predicate=contact&via=vendor"; do
  echo "--- /ask?$q"
  code=$(curl -s -o "$PAGE" -w '%{http_code}' --max-time 30 \
    "http://127.0.0.1:$PORT/ask?$q")
  echo "    HTTP $code, $(wc -c < "$PAGE") bytes"
  sed -E 's/<[^>]+>/\n/g' "$PAGE" \
    | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' | grep -v '^$' \
    | grep -E -i 'replaced [0-9]+ earlier|was retracted|Never stated\.|no claim about|reads, [0-9]+ rows' \
    | sed 's/^/    /' | head -3
done
echo

echo "=== 8. server request log ==="
grep -E '^GET' "$SERVE_LOG"
echo

stop_server
rm -f "$SERVE_LOG" "$PAGE"
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/"; then
  echo "WARNING: something still answers on $PORT. Stop it before re-running."
else
  echo "server stopped, port $PORT free again"
fi
echo
echo "The clone is at $DEST and still holds a copy of your .env.local."
echo "Delete it when you are done with it."
