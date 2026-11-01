#!/usr/bin/env bash
#
# Put a new build on the test copy when one appears on `test-build`.
#
# Run every two minutes, as root, by zoilabe-test-update.timer. The droplet
# reaches out to GitHub rather than GitHub reaching in, so no key or secret is
# kept anywhere (the repository is public). These scripts are first brought up
# to date from main, never from the branch being tried, so only a merged pull
# request can change what runs here as root.
#
# Each build is tried once, so one that fails is not retried every two minutes.
# Push again, or run the Test copy workflow again, to try once more.
#
#   journalctl -u zoilabe-test-update -n 50    # what it last did
#
# Wrapped in a block so bash has read all of it before the merge below can
# replace this file underneath it.
{
  set -euo pipefail

  ROOT=/opt/zoilabe-test
  STATE="$ROOT/last-build"

  cd "$ROOT/source"
  git fetch --quiet origin \
    +refs/heads/main:refs/remotes/origin/main \
    +refs/heads/test-build:refs/remotes/origin/test-build
  NEW=$(git rev-parse refs/remotes/origin/test-build)
  OLD=$(cat "$STATE" 2>/dev/null || true)

  if [[ "$NEW" == "$OLD" ]]; then
    exit 0
  fi

  echo "$NEW" > "$STATE"
  echo "New build $NEW on test-build."
  git merge --ff-only --quiet refs/remotes/origin/main
  exec bash deploy/test-copy/install-build.sh
}
