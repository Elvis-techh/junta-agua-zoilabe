#!/usr/bin/env bash
#
# A private PostgreSQL server for development and tests, owned by you.
#
# The system PostgreSQL needs `sudo -u postgres` before it lets anyone create
# databases and logins. This one does not: it keeps its files in
# backend/.pgdata (ignored by git), listens only on localhost:54329, and its
# superuser is `postgres` with the password `postgres`. It never touches the
# system server on 5432.
#
#   npm run db:local -- start    # create on first run, then start
#   npm run db:local -- stop
#   npm run db:local -- status
set -euo pipefail

cd "$(dirname "$0")/.."
DATA="$PWD/.pgdata"
PORT=54329

# Ubuntu installs the server programs outside PATH; use the newest one there.
if command -v pg_ctl >/dev/null 2>&1; then
  BIN="$(dirname "$(command -v pg_ctl)")"
else
  BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$BIN" ] || [ ! -x "$BIN/pg_ctl" ]; then
  echo "PostgreSQL is not installed. On Ubuntu: sudo apt install postgresql" >&2
  exit 1
fi

case "${1:-start}" in
  start)
    if [ ! -f "$DATA/PG_VERSION" ]; then
      pwfile="$(mktemp)"
      echo postgres > "$pwfile"
      "$BIN/initdb" -D "$DATA" -U postgres --pwfile="$pwfile" \
        --auth-local=scram-sha-256 --auth-host=scram-sha-256 --encoding=UTF8 >/dev/null
      rm -f "$pwfile"
      echo "Created a new database server in $DATA"
    fi
    if "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      echo "Already running on localhost:$PORT"
    else
      "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w \
        -o "-p $PORT -k $DATA -c listen_addresses=localhost" start >/dev/null
      echo "Running on localhost:$PORT"
    fi
    ;;
  stop)
    "$BIN/pg_ctl" -D "$DATA" -m fast stop
    ;;
  status)
    "$BIN/pg_ctl" -D "$DATA" status
    ;;
  *)
    echo "Usage: npm run db:local -- start|stop|status" >&2
    exit 1
    ;;
esac
