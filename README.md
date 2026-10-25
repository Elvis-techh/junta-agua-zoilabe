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

Phase 0 (Foundation) is merged: invitation and PIN login, roles and
permissions, the history log, and backup and restore scripts. Phase 1
(Census) is next, then Phase 2 (Finances). See the phase table at the end of
the app plan.

Phases 1 to 3 are built and tested on a computer before anything changes on
the droplet. The parts of Phase 0 that need the droplet (the subdomain, the
data-separation check, backups to the storage bucket, a restore on a test
server) wait for that one deployment.

## Local development

Requirements: Node.js 22+, npm, and PostgreSQL 16+ installed
(`sudo apt install postgresql` on Ubuntu). The app does not use the system
server; it runs its own private one, owned by you, so no `sudo` is needed
after the install.

The first time:

```bash
npm install
cp backend/.env.example backend/.env
npm run db:local -- start          # private server on localhost:54329
npm run db:setup                   # creates the database and its two logins
npm run db:migrate
npm run db:seed
```

Every time:

```bash
npm run db:local -- start          # after a restart of the computer
npm run dev                        # leave this terminal open; Ctrl+C stops it
```

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:3002/api/health`

### Signing in for the first time

Nobody can sign in until an administrator exists. In a second terminal:

```bash
npm run user:first-admin -- --name "Nombre Apellido" --phone 99998888
```

It prints an invitation link. Open it, choose a 6-digit PIN, and you are in.
Every other account is created from Usuarios. The command refuses to run
once an administrator exists.

### Starting over

`npm run db:reset` empties the local database (it refuses to run in
production). Run `user:first-admin` again afterwards.

### Testing on a phone

The phone must be on the same Wi-Fi as the computer.

1. Find the computer's address on the Wi-Fi: `hostname -I` (the first
   number, e.g. `192.168.1.37`).
2. In `backend/.env`, set `APP_URL=http://192.168.1.37:5173`, so invitation
   links point at the computer instead of `localhost`.
3. Restart `npm run dev`, create an invitation, and open it on the phone.

Screens and sign-in work this way. Three things need the secure (https)
address that only the droplet gives: working with no signal after a cold
start, installing the app properly on the home screen, and the GPS button.

## Checks before pushing

```bash
npm run typecheck
npm test
```
