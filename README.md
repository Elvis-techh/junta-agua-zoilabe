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

Requirements: Node.js 22+, npm, and PostgreSQL 16+ running locally.

```bash
sudo apt install postgresql        # once, on Ubuntu
npm install
cp backend/.env.example backend/.env
npm run db:setup                   # creates the database and its two logins (asks for sudo)
npm run db:migrate
npm run db:seed
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:3002/api/health`

## Checks before pushing

```bash
npm run typecheck
npm test
```
