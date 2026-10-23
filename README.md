# Junta de Agua Zoilabe

One app and one database for the Aldea Zoilabe water board (Tela, Atlántida):
census of households and owners, monthly fees and expenses, personal accounts
with roles, and a permanent history log. The Municipality of Tela gets
read-only access through temporary guest invitations.

The full specification is [docs/app-plan.md](docs/app-plan.md). Read it before
changing how money, permissions or the history log work.

## Repository layout

```text
.
├── frontend/   Installable web app (PWA) for phones and computers — React + Vite
├── backend/    HTTP API, business rules and database migrations — Fastify + PostgreSQL
└── docs/       The app plan, deployment notes and the runbook
```

## Status

Phase 0 (Foundation) is in progress: invitation and PIN login, roles and
permissions, the history log, and nightly backups. The census (Phase 1) and
finances (Phase 2) come after it. See the phase table at the end of the app
plan.

## Local development

Requirements: Node.js 22+, npm, and PostgreSQL 16+ installed
(`sudo apt install postgresql` on Ubuntu). The app does not use the system
server; it runs its own private one, owned by you, so no `sudo` is needed
after the install.

```bash
npm install
cp backend/.env.example backend/.env
npm run db:local --workspace @zoilabe/backend -- start   # private server on localhost:54329
npm run db:setup                   # creates the database and its two logins
npm run db:migrate
npm run db:seed
npm run dev
```

After a restart of the computer, run the `db:local -- start` line again.

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:3002/api/health`

## Checks before pushing

```bash
npm run typecheck
npm test
```
