#!/usr/bin/env bash
# One-time setup for a new codespace. See devcontainer.json.
set -euo pipefail

# The server programs only; `db:local` runs its own private server with them.
if ! ls /usr/lib/postgresql/*/bin/pg_ctl >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null
fi

# Development settings, with invitation links pointing at this codespace's own
# address instead of localhost. An existing .env is left alone.
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  url="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  sed -i -e "s|^APP_URL=.*|APP_URL=$url|" -e "s|^FRONTEND_ORIGINS=.*|FRONTEND_ORIGINS=$url|" backend/.env
fi

npm ci
npm run db:local -- start
npm run db:setup
npm run db:migrate
npm run db:seed
bash .devcontainer/first-admin.sh
