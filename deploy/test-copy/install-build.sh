#!/usr/bin/env bash
#
# Put the build on `test-build` in place on the test copy (docs/test-copy.md).
# autodeploy.sh runs it when a new build appears; by hand:
#
#   cd /opt/zoilabe-test/source && sudo bash deploy/test-copy/install-build.sh
#
# It touches nothing of the real app (/opt/zoilabe), Lindero or Báscula
# Central: the test copy has its own user, folder, database file and port. A
# build that does not start leaves the test copy off until one that does
# arrives; the log below says why.

set -euo pipefail

ROOT=/opt/zoilabe-test
APP="$ROOT/app"
NODE_BIN=/opt/node22/bin
PORT=3003
UNIT=/etc/systemd/system/zoilabe-test-api.service

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/test-copy/install-build.sh" >&2
  exit 1
fi

as_test() { sudo -u zoilabe-test -H env "PATH=$NODE_BIN:$PATH" "$@"; }

cd "$ROOT/source"

echo "==> Unpacking the build"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
git archive refs/remotes/origin/test-build | tar -x -C "$BUILD"
grep -E '^(Branch|Commit):' "$BUILD/README.md" | sed 's/^/    /'

# First, so the stop below already uses the new file's settings. The
# droplet's own settings live in $ROOT/env, which this does not touch.
if ! cmp -s deploy/test-copy/zoilabe-test-api.service "$UNIT"; then
  install -m 644 deploy/test-copy/zoilabe-test-api.service "$UNIT"
  systemctl daemon-reload
  # Starts again by itself after the droplet restarts.
  systemctl enable --quiet zoilabe-test-api
  echo "    service file updated"
fi

echo "==> Stopping the test copy"
systemctl stop zoilabe-test-api

echo "==> Copying it into place"
install -d -o zoilabe-test -g zoilabe-test "$APP"
# node_modules and npm's cache (the user's home is $APP) stay between builds.
rsync -a --delete --chown=zoilabe-test:zoilabe-test \
  --exclude=/node_modules/ --exclude=/.npm/ "$BUILD/" "$APP/"

# Installing is the one heavy step, so it is skipped unless the package list
# or Node changed. Installed here, never copied up: better-sqlite3 is compiled
# for the machine it runs on.
echo "==> Runtime dependencies (Node 22)"
DEPS_ID="$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1) $("$NODE_BIN/node" -v)"
STAMP="$APP/node_modules/.zoilabe-test-deps"
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$DEPS_ID" ]]; then
  echo "    unchanged, not reinstalled"
else
  (cd "$APP" && as_test npm ci --omit=dev --no-audit --no-fund)
  echo "$DEPS_ID" | as_test tee "$STAMP" >/dev/null
fi

# Migrations would run on start anyway; the roles and permissions a branch
# adds need them in place first. Seeding never changes what is already there.
echo "==> Database: migrations, then the starting roles and permissions"
cd "$APP/backend"
as_test "$NODE_BIN/node" --env-file="$ROOT/env" dist/db/migrate.js
as_test "$NODE_BIN/node" --env-file="$ROOT/env" dist/db/seed.js

echo "==> Starting"
systemctl start zoilabe-test-api
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "==> Up: $(curl -fsS "http://127.0.0.1:$PORT/api/health")"
    exit 0
  fi
  sleep 1
done

echo "!! The test copy is not answering on port $PORT after 20 s. Recent log:" >&2
journalctl -u zoilabe-test-api -n 30 --no-pager >&2
exit 1
