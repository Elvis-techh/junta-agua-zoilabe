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
- **Trying a branch from a phone: ready.** Every pull request opens in a
  GitHub Codespace, a private copy with made-up data, before it is merged
  (see "Trying a branch from a phone" below).

See the phase table at the end of the app plan.

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
npm run db:migrate                 # after updating the code: applies any new database changes
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

### Trying a branch from a phone

No computer needed. A GitHub Codespace is a private copy of the app on
GitHub's machines, with its own empty database: nothing done there reaches the
real data. Each pull request description starts with a link like this one:

```text
https://codespaces.new/Elvis-techh/junta-agua-zoilabe/tree/<branch>?quickstart=1
```

1. Open it in the phone's browser, signed in to GitHub, and tap **Create
   codespace** (or **Resume** if one already exists for that branch). The first
   time takes a few minutes: it installs PostgreSQL and the app, and builds the
   database (`.devcontainer/setup.sh`).
2. It opens `TRY-IT.md`, with an invitation link for a test administrator.
   Tap it and choose a PIN. Later visits use the app link on the same page
   and the PIN.
3. Try what the pull request description asks you to try. If something is
   wrong, tell Claude before merging.
4. Delete the codespace when you are done: github.com/codespaces → ··· →
   **Delete**. It stops by itself after 30 minutes unused, but a stopped one
   is kept for 30 days and its storage counts against GitHub's free monthly
   allowance (which also covers about 60 hours of use a month).

Its address is `https://`, so the GPS button works there. It runs the
development server, so installing on the home screen and opening with no
signal still need the droplet. If the invitation has expired (48 hours), start
the database over from the codespace's terminal:
`npm run db:reset && bash .devcontainer/first-admin.sh`.

## Checks before pushing

```bash
npm run typecheck
npm test
```
