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
├── backend/    HTTP API, business rules and database migrations — Fastify + SQLite
└── docs/       The app plan, deployment notes and the runbook
```

## Status

- **Phase 0 (Foundation): merged.** Invitation and PIN login, roles and
  permissions, the history log, and backup and restore scripts.
- **Phase 1 (Census): merged.** Registrar familia (one question per screen,
  with the fee question), paper entry mode, duplicate check, search and
  list, household file, offline queue, inactive status, and Configuración →
  Sectores. Its "done when" test (the secretary types in 10 paper forms from
  a phone without help) has not been run yet.
- **Phase 2 (Finances): next.** Setting the base fee in Configuración comes
  with it; until then the census shows "Precio base" without an amount.
  A different amount starts with the month after the house's last payment
  (board decision, 25 October 2026); a newly registered house has none yet,
  so its amount starts with the month it is registered in.
- **Database: SQLite** (decided 29 October 2026), one file like Lindero's and
  Báscula Central's, so the droplet needs no database server. The rules that
  PostgreSQL's two logins enforced are now triggers in the file itself (see
  "The database" below). If the apps outgrow it,
  [docs/postgres-readiness.md](docs/postgres-readiness.md) maps the move
  back; a trial copy of the data into PostgreSQL passed every check.

See the phase table at the end of the app plan.

Phases 1 to 3 are built and tested on a computer before anything changes on
the droplet. The parts of Phase 0 that need the droplet (the subdomain, the
data-separation check, backups to the storage bucket, a restore on a test
server) wait for that one deployment.

## Local development

Requirements: Node.js 22+ and npm. Nothing else: the database is a file
the app creates itself.

The first time:

```bash
npm install
cp backend/.env.example backend/.env
npm run db:migrate                 # creates backend/data/zoilabe.db
npm run db:seed
```

Every time:

```bash
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

### Trying the census

1. As the administrator, open **Configuración** and add the village's
   sectors. Registration cannot start without at least one.
2. In **Usuarios**, create an account for the secretary and open its
   invitation in a private browser window (or on a phone).
3. As the secretary, tap **Registrar familia**. "Estoy en la vivienda" is the
   normal flow; "Copiar una hoja de papel" is paper entry mode, which asks
   first for the date and number written on the paper form.
4. Type the same identity number twice: the second time the app opens that
   person instead, and offers "Agregar otra vivienda".
5. On the phone step, "No tiene teléfono" and "Prefiere no darlo" register a
   family without a number. The saved screen then shows no WhatsApp button,
   and a number can be added later from the household file.
6. To try the offline queue, turn off the Wi-Fi (or, in Chrome, DevTools →
   Network → Offline) while the app is open, register a family, and turn it
   back on. The "por enviar" counter in the top bar goes back to zero by
   itself.
7. Open a household from **Censo** to correct it, deactivate it with a
   reason, or reactivate it. Every step shows up in **Historial**.

Opening the app from scratch with no signal needs the installed app (its
service worker). To try that on the computer: `npm run build`, then
`npx --workspace @zoilabe/frontend vite preview`, and open
`http://localhost:4173` with `npm run dev:backend` running.

### Starting over

`npm run db:reset` empties the local database (it refuses to run in
production). Run `user:first-admin` again afterwards.

### The database

One SQLite file, `backend/data/zoilabe.db` (set `DATABASE_PATH` in
`backend/.env` to put it elsewhere), with its `-wal` and `-shm` companions
beside it. Git ignores the folder. The API applies new migrations every time
it starts, so `npm run db:migrate` is only needed to update the file without
starting the API.

The file refuses, by itself, to delete any row of any table, and to change
any row of the history log (`audit_log`) or of the money entries
(`transactions`): triggers that `src/db/guards.ts` puts back after every
migration. That includes the delete hidden inside SQLite's `INSERT OR
REPLACE`. Taking one away would take a deliberate `DROP TRIGGER` with
other tools, and the history log's hash chain (`npm run db:verify-log`)
catches any entry changed that way.

`npm run db:backup` copies the file while the API keeps running
(`VACUUM INTO`), checks the copy, and encrypts it with
`BACKUP_ENCRYPTION_KEY` (`openssl rand -base64 32`). `npm run db:restore`
puts a backup into a new file and checks it: see
[docs/restore.md](docs/restore.md).

Moving to PostgreSQL one day: [docs/postgres-readiness.md](docs/postgres-readiness.md)
says when it would be worth it, what changes, and how to move the data
with checks.

### Testing on a phone

The phone must be on the same Wi-Fi as the computer.

1. Find the computer's address on the Wi-Fi: `hostname -I` (the first
   number, e.g. `192.168.1.37`).
2. In `backend/.env`, set `APP_URL=http://192.168.1.37:5173`, so invitation
   links point at the computer instead of `localhost`.
3. Restart `npm run dev`, create an invitation, and open it on the phone.

Screens, sign-in and the offline queue (signal lost while the app is open)
work this way. Three things need the secure (https) address that only the
droplet gives: opening the app from scratch with no signal, installing it
properly on the home screen, and the GPS button.

## Checks before pushing

```bash
npm run typecheck
npm test
```

The tests need no database server or settings: each one makes its own
database in memory and throws it away.
