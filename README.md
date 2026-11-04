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
  a phone without help) has not been run yet. Owner decision of 4 November
  2026: phones carry a country code, chosen from a list of nine, with Honduras
  (+504) first.
- **Phase 2 (Finances): started.** Its pieces, in build order, are ticked off
  under "What comes next" in the [app plan](docs/app-plan.md).
  - **Fees in Configuración: built.** The base monthly fee, the late fee
    (mora) and the reconnection fee, each from the month it starts. The
    census shows the base price's amount once one is set. See "Trying the
    fees" below. Owner decisions of 2 November 2026: a change may start in
    the current month; an amount typed wrong may be corrected with a reason
    until a payment is made at it; an amount may be zero; saving asks for
    the PIN.
  - Next: monthly fee payments.

  A different amount starts with the month after the house's last payment
  (board decision, 25 October 2026); a newly registered house has none yet,
  so its amount starts with the month it is registered in.
- **Database: SQLite** (decided 29 October 2026), one file like Lindero's and
  Báscula Central's, so the droplet needs no database server. The rules that
  PostgreSQL's two logins enforced are now triggers in the file itself (see
  "The database" below). If the apps outgrow it,
  [docs/postgres-readiness.md](docs/postgres-readiness.md) maps the move
  back; a trial copy of the data into PostgreSQL passed every check.
- **Test copy: running** at <https://prueba-agua.basculacentral.com> since
  1 November 2026, with made-up data only. GitHub puts every pull request on
  it and shows the version on a "Copia de prueba" strip. The steps for testing
  each change and starting each phase are in
  [docs/test-copy.md](docs/test-copy.md).

See the phase table at the end of the app plan.

Phases 1 to 3 are built and tested on a computer before anything changes on
the droplet. The parts of Phase 0 that need the droplet (the subdomain, the
data-separation check, backups to the storage bucket, a restore on a test
server) wait for that one deployment. The test copy is the one exception
(App Plan, 29 October 2026): made-up data, kept apart from the real app.

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

Digits alone are a Honduran number; another country's starts with its code,
as in `--phone +12025550123`.

It prints an invitation link. Open it, choose a 6-digit PIN, and you are in.
Every other account is created from Usuarios. The command refuses to run
once an administrator exists.

### Trying the fees

As the administrator or the president, open **Configuración** → **Cuotas**.
Saving any amount asks for the PIN again.
On a computer, month and date fields open the app's own calendar, in Spanish;
a phone keeps its own picker.

1. Tap **Poner monto** on "Cuota mensual base", type `70` and pick a month.
   The first amount of each fee may start in a past month, so what houses
   already owe from the paper book can be counted. `0` is allowed, for a
   fee the board does not charge.
   Amounts get their thousands commas as they are typed: `1250.5` shows as
   `1,250.5`. Identity numbers, phones and PINs never do.
2. Tap **Seguir**, read the summary, tap **Sí, guardar** and type the PIN.
   The card shows L 70.00 "en uso", and **Registrar familia** now says
   "Precio base: L 70.00 al mes".
3. Tap **Cambiar detalles**. The month picker starts at this month: a change
   may start now or later, never in a past month. An amount for a later
   month shows as "Todavía no empieza" until its month comes, then takes over
   by itself on that month's first day, Honduras time. A month that already
   has an amount is refused before the PIN is asked for.
4. Each saved amount sits in its own box. An amount typed wrong is fixed with
   the **Corregir** in its box, which asks for the right amount and the
   reason. Once a payment has been made at an amount, the button is gone:
   correcting it would change a month already paid.
5. Nothing here is deleted. Every change and correction is in
   **Historial**, with the amount it replaced and the reason.

The server refuses these changes from any other role, and without the PIN,
whatever the screen shows.

While a panel like these is open, the screen behind it stays still, on a
computer and on a phone, and it is back where it was when the panel closes.

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
5. On the phone step, the box beside the number holds the country: it starts
   on Honduras (+504), and tapping it opens the list. The length is checked for
   each country. "No tiene teléfono" and "Prefiere no darlo" register a family
   without a number. The saved screen then shows no WhatsApp button, and a
   number can be added later from the household file.
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

### Testing on a phone: the test copy

Every push to a pull request, and every merge to `main`, goes to the **test
copy**: a second copy of the app on the droplet, at its own address, with
made-up data only. It stays on when the computer is off. On the pull
request page, wait for the **Test copy** check to turn green (three to five
minutes), then open <https://prueba-agua.basculacentral.com> on the phone. A
purple "Copia de prueba" strip names the version it runs; it matches the pull
request's branch and commit. Never type real families into it.

While typing on a phone, the top and bottom bars step aside. On a form's last
field, the button that goes on stays just above the keyboard; before that, the
next field shows instead. Whenever something is below what can be
seen, on a screen or in a panel, a "Hay más abajo" pill says so; tapping it
closes the keyboard and brings the rest up (`src/viewport.ts`,
`src/components/MoreBelow.tsx`).

The steps for testing each change and starting each phase, how it works, how
to put another branch on it, how to start it over with empty data, and how it
was set up: [docs/test-copy.md](docs/test-copy.md).

On the same Wi-Fi as the computer, the local app can be opened from a phone
too: set `APP_URL=http://<the computer's address>:5173` in `backend/.env`
(`hostname -I`, the first number), restart `npm run dev`, and open an
invitation on the phone. Installing on the home screen, opening with no
signal and the GPS button need the https address only the test copy has.
Tailscale was tried and dropped (30 October 2026): it works only while the
computer is on.

## Checks before pushing

```bash
npm run typecheck
npm test
```

The tests need no database server or settings: each one makes its own
database in memory and throws it away.

On GitHub, every pull request runs two checks: **Tests** (the same two
commands, plus a build) and **Test copy** (the tests again, then the build
on the test copy). Do not merge while either is red.
