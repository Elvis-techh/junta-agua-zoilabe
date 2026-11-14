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

- **Phase 0 (Foundation): merged.** Signing in, roles and permissions, the
  history log, and backup and restore scripts.
- **Signing in: phone number and password** (owner decision of 9 November
  2026). The invitation link and the 6-digit PIN were too much for the
  board's older members, so they are gone, along with the PIN asked again
  before sensitive actions and the lock after 5 wrong PINs. An administrator
  creates each account with a password; the person types their WhatsApp
  number and that password once, and the phone stays signed in until
  **Salir**, or for 90 days without use. See "Accounts and passwords" below.
- **Historial keeps changes, not visits** (owner decision of 9 November
  2026). Signing in and wrong passwords leave no entry there (Usuarios shows
  each account's "Último ingreso", replaced each time), and new entries no
  longer save the phone's description. Entries already saved stay as they
  are: the history log is never changed.
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
    the current month (since 12 November 2026, also a past month: see below);
    an amount typed wrong may be corrected with a reason
    until a payment is made at it; an amount may be zero. Owner decision of
    6 November 2026: until a payment is made at
    it, an amount may also be removed ("Quitar"), with a reason; it stays in
    the database, marked removed, and its months go back to the amount
    before it.
  - **Monthly fee payments (Cobrar): built.** The treasurer picks the
    house, the months, the amount and date, how it was paid and the paper
    receipt's number, then "¿Está correcto?". See "Trying Cobrar" below.
    Owner decisions of 6 November 2026: the money fills the chosen months
    oldest first; a payment larger than those months owe is refused; a month
    keeps the price it had when its first money arrived.
  - **Removing a fee amount (Quitar): built.** Until a payment covers its
    month, with a reason (owner decision of 6 November 2026).
  - **Every role holds every permission: built.** Owner decision of
    6 November 2026: the board does not always meet in full, and a task only
    one or two people could do would wait for them. Roles stay, so Historial
    shows who did what, and a permission can still be taken from a role
    through the Permisos route (its screen is not built yet). A database
    seeded before that day gets every permission once, the next time the
    seed runs (the test copy runs it on every update), with a history entry for each role that gained something. A
    month close still takes two different people: the database refuses an
    approval by whoever prepared it.
  - **Corrections (Anular pago): built.** A payment recorded by mistake is
    undone from the household's file with a reason: a reversal
    entry with the opposite amount that points to the original. See step 7
    of "Trying Cobrar" below. Owner decisions of 7 November 2026: only a
    whole payment is reversed (a wrong amount or month is reversed and
    recorded again); the reversal is dated the day it is made and counts in
    that month; it can be made at any time, even after the original's month
    is closed; and a reversal is final.
  - **Past fee changes: built.** Owner decision of 12 November 2026: a fee
    may also take a change that starts in a past month, so the fees of the
    years in the paper book can be entered before what houses already owe
    is counted. It is refused once a payment of that fee falls in the months
    it would cover (from its month up to the next amount). The same months
    decide whether an amount may still be corrected or removed, so an old
    amount stays correctable while its own months hold no payment. See steps
    3 and 4 of "Trying the fees" below.
  - Next: what each house already owes, entered month by month.

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

It prints the administrator's password, once. Open the app and sign in with
that number and password. Every other account is created from Usuarios. The
command refuses to run once an administrator exists.

### Accounts and passwords

In **Usuarios**, **Nueva cuenta** asks for the name, the WhatsApp number, the
cargo and a password. The app offers an easy one to read aloud (two syllables
and four digits, such as `bamu4827`); keep it or type another of at least 6
letters or numbers, and give it to the person. The account can sign in at
once: there is no link to send.

- **Signing in.** "Su número de WhatsApp" and "Su contraseña", once on each
  phone. **Ver** shows what was typed. The phone then stays signed in until
  **Salir**, or for 90 days without use; using the app pushes the 90 days
  forward (`src/auth/session.ts`).
- **A forgotten password, or a lost phone.** Open the account in Usuarios and
  tap **Cambiar contraseña**. Every phone signed in to that account signs out;
  the person signs in again with the new one. Changing your own keeps you
  signed in on the phone you changed it on.
- **Wrong passwords.** Nothing locks. Sign-in tries are limited per minute
  for each address (`LOGIN_ATTEMPTS_PER_MINUTE`, 10 by default). A wrong
  password is noted in the server's own log, which the droplet clears over
  time, not in Historial, so nobody outside can fill Historial by guessing.
- **Accounts from before 9 November 2026** have no password and show "Sin
  contraseña": tap **Poner contraseña**. If nobody can sign in at all (the
  only administrator forgot theirs, or every account is from before), give
  one a password from the server's console:

  ```bash
  npm run user:password -- --phone 99998888
  ```

  It prints a new password once and signs that account out everywhere.

No action asks for a PIN or a password again: Quitar and Anular pago ask for
a written reason, and a month close still takes two different people.

### Trying the fees

As the administrator or the president, open **Configuración** → **Cuotas**.
On a computer, month and date fields open the app's own calendar, in Spanish;
a phone keeps its own picker.

1. Tap **Poner monto** on "Cuota mensual base", type `70` and pick a month.
   It may be a past month, so what houses already owe from the paper book
   can be counted. `0` is allowed, for a fee the board does not charge.
   Amounts get their thousands commas as they are typed: `1250.5` shows as
   `1,250.5`. Identity numbers and phones never do.
2. Tap **Seguir**, read the summary and tap **Sí, guardar**.
   The card shows L 70.00 "en uso", and **Registrar familia** now says
   "Precio base: L 70.00 al mes".
3. Tap **Cambiar detalles**. The month picker starts at this month. An
   amount for a later month shows as "Todavía no empieza" until its month
   comes, then takes over by itself on that month's first day, Honduras
   time. A month that already has an amount is refused before the summary.
   A change may also start in a past month, for an older fee from the paper
   book: each amount counts from its month until the next one starts, and
   the summary says which unpaid months it prices ("desde marzo de 2024
   hasta diciembre de 2024"). Once a payment of that fee falls in those
   months, the change is refused, and the message names the earliest month
   it could start instead. From this month on a change is always accepted:
   a month already paid keeps the price it was paid at.
4. Each saved amount sits in its own box. An amount typed wrong is fixed with
   the **Corregir** in its box, which asks for the right amount and the
   reason. Once a payment falls in that amount's months, the button is gone:
   correcting it would change a month already paid. An older amount whose
   own months hold no payment keeps it, even when later months are paid.
5. An amount the board did not mean, or no longer wants, goes with the
   **Quitar** in its box. The panel says what its months go back to (the
   amount before it, or none) and asks why. The box
   disappears, and its month is free for another amount. Like **Corregir**,
   it is gone once a payment falls in the amount's months.
6. Nothing here is deleted, not even a removed amount: the database keeps it,
   marked removed. Every change, correction and removal is in
   **Historial**, with the amount and the reason.

Every role may do this now (6 November 2026), but the server still checks the
"Cambiar la configuración" permission on every change, whatever the screen
shows.

While a panel like these is open, the screen behind it stays still, on a
computer and on a phone, and it is back where it was when the panel closes.

### Trying Cobrar

As the treasurer (with a base fee set in Configuración → Cuotas, and a
family registered), tap **Cobrar** on Inicio, or **Registrar pago** on a
household's file. A payment needs signal: it is not kept on the phone.

1. Search for the house by name or code and tap it.
2. **¿Qué meses paga?** Each month shows what it still owes ("L 70.00",
   "Faltan L 40.00") or "Pagado". The list starts three months back and runs
   a year ahead; **Ver meses anteriores** adds older ones. Tap the months
   written on the paper receipt.
3. **¿Cuánto pagó?** starts on the full amount. Paying less fills the
   chosen months oldest first, so only the last one is left partly paid. More
   than they owe is refused, as is an amount that does not reach every month
   chosen: the screen says what to change. The date may be earlier than today
   (a receipt typed in later), never later, and never in a closed month.
4. **Recibo de papel**: cash, transfer (which asks for its reference) or
   other, and the receipt's number. **¿Quién pagó?** starts on the owner's
   name; a note is optional.
5. **¿Está correcto?** shows how much goes to each month. **Sí, guardar**.
   A receipt number already used asks first: if the receipt book started
   again, save it anyway, and both entries show "Número de recibo repetido:
   revisar".
6. The household's file lists its payments under **Pagos**, and each one is in
   **Historial** (Finanzas): "Tina (Tesorero/a) registró un pago de L 100.00
   de María López por noviembre y diciembre de 2026 …".
7. A payment recorded by mistake: on the household's file, tap **Anular
   pago** on its card, write why and tap **Anular pago**. The
   whole payment is undone with today's date, and its months go back to how
   they were before it (a month whose only money it was costs today's price
   again). The card stays, crossed out and marked "Anulado", with when, who
   and why. **Registrar el pago de nuevo** opens Cobrar with every answer
   filled in, to change what was wrong; the same receipt number is accepted
   without the "repetido" warning. Historial (Finanzas) shows "… anuló el
   pago de L 100.00 de María López por …" with the reason. A reversal cannot
   itself be undone: record the payment again instead.

A month keeps the price it had when its first money arrived: if the board
raises the fee after a house paid half of a month ahead, that month still
costs the old price. Nothing is changed or deleted: each payment's share of
each month is kept in `payment_months`, which, like `transactions`, the
database only adds to. A retry on weak signal sends the same submission, so
it is never saved twice. Only roles with "Registrar pagos y gastos" may
save, only those with "Ver finanzas" see the months and payments, and only
those with "Corregir un registro de dinero" may anular; the server checks
all three.

### Trying the census

1. As the administrator, open **Configuración** and add the village's
   sectors. Registration cannot start without at least one.
2. In **Usuarios**, create an account for the secretary, note the password
   the app offers, and sign in with that number and password in a private
   browser window (or on a phone).
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
(`transactions`, and `payment_months`, how each payment was shared among
months): triggers that `src/db/guards.ts` puts back after every
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

On a phone, no screen brings up the keyboard by itself: it comes up when the
person taps a field, so the whole screen can be read first. On a computer the
first field is ready for typing, as before (`src/viewport.ts`; a test reads
every screen for this).

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
(`hostname -I`, the first number), restart `npm run dev`, and sign in on the
phone. Installing on the home screen, opening with no
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
