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
- **A way back on every screen** (owner, 19 November 2026). Every screen
  opens with a button at the top left named after where it goes: "‹ Inicio"
  on Censo, Registrar familia, Cobrar, Quién debe, Saldo de la junta,
  Usuarios, Historial and Configuración, as Vivienda, Gasto, Otro ingreso,
  Estado de cuenta and a payment already had ("‹ Censo", "‹ Cobrar"…). The
  phone's own back still works too; not everyone knows it is there.
- **Phase 1 (Census): merged.** Registrar familia (one question per screen,
  with the fee question), paper entry mode, duplicate check, search and
  list, household file, offline queue, inactive status, and Configuración →
  Sectores. Its "done when" test (the secretary types in 10 paper forms from
  a phone without help) has not been run yet. Owner decision of 4 November
  2026: phones carry a country code, chosen from a list of nine, with Honduras
  (+504) first. Owner decision of 19 November 2026: the **identity number and
  the references are optional**. A family may not want to give its ID, and
  whoever registers may not write easily; the president asks for them later
  where the board needs them. Both can be added from the household file
  (Corregir). With no ID there is nothing to check for a duplicate, so
  "Agregar otra vivienda" from a person's file adds the house to that person
  by who they are, not by their ID. An ID that is typed must still have 13
  numbers, and one ID still belongs to one person (the database refuses it
  twice). The App Plan's Census table now says both are optional.
  - **Name check: built.** Owner decision of 19 November 2026, because an ID
    is no longer always there to tell two families apart. In Registrar
    familia, once the name is typed, the app compares it with every person
    already registered, whether they have an ID or not. It ignores accents,
    capital letters, "de" and "la", and one wrong letter in a long word
    ("Maria Rodrigues" finds "María Rodríguez"); two names are alike when
    the first names match and the last word of the shorter name is in the
    longer one, so "Juan Pérez" finds "Juan Carlos Pérez López" but not
    "Juan Martínez", and brothers "Carlos Pérez Díaz" and "Luis Pérez Díaz"
    are not mixed up. It lists up to five (name, house code, sector and
    references) and the registrar either taps one ("Agregar otra vivienda" to
    that person) or taps **No, es otra familia**. It is a warning, never a
    block: the entry saves either way. Who the registrar said it is not is
    kept in Historial with the registration. It needs signal, like the
    check by ID: with none, the entry is saved on the phone without it.
    It does not know a name written surname first.
- **Phase 2 (Finances): started.** Its pieces, in build order, are ticked off
  under "What comes next" in the [app plan](docs/app-plan.md).
  - **Fees in Configuración: built.** The base monthly fee, the late fee
    (mora), the reconnection fee and the connection fee (added by the owner
    on 14 November 2026), each from the month it starts. The
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
    keeps the price it had when its first money arrived. Owner decision of
    19 November 2026: Cobrar opens on every house in the census, by name, to
    scroll or search; tapping one asks **¿Qué está pagando?** (Cuota
    mensual, Mora, Reconexión, Conexión, Donación, Otro ingreso), and the
    monthly fee goes on to the months while the others go to Otro ingreso
    for that house, already answered. **Quién debe** stays on Cobrar, at the
    top; **Otro ingreso** left it for its own button on Inicio.
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
  - **Every screen on everyone's Inicio: built.** Owner decision of
    14 November 2026: the whole board sees the same screens, whatever its
    role, the administrator too. Inicio shows first the large buttons for
    what the role usually does (App Plan), then every other built screen
    under **Otras tareas**, so a president can open Cobrar and an
    administrator can register a family without going through a household's
    file. Owner decision of 19 November 2026: **Usuarios**, **Permisos** and
    **Configuración** come last, under **Administración**, for every role,
    because they are seldom needed; an administrator, whose own buttons are
    all setup ones, sees the day's tasks first.
  - **Corrections (Anular pago): built.** A payment recorded by mistake is
    undone from the household's file with a reason: a reversal
    entry with the opposite amount that points to the original. See step 8
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
  - **What each house owes: built.** Owner decision of 13 November 2026,
    replacing the start month of 7 November: there is no start month. Each
    family's history is typed in through Cobrar, each payment with its own
    date and months, from whatever date it begins. A family owes every month
    not paid in full from its first entered payment (or the month it was
    registered, if earlier, or while nothing is entered) once that month's
    payment deadline is over; a skipped month stays owed after a later one is
    paid. The deadline is set in Configuración → **Plazo de pago**: the day
    of each month by which it is paid, plus grace days (until set, the last
    day of the month, with no grace). The household's file shows it under
    **Lo que debe** ("Debe el mes de octubre de 2026", "Debe los meses de
    …"), and Cobrar lists owed months older than its usual list first, under
    **Debe de antes**. See "Trying Lo que debe" below. Owner decisions of the
    same day: late fees for months owed from before the app only where the
    paper book shows one (the late fee piece will do it); a different amount
    does not price months before it started, for now.
  - **Other income (Otro ingreso): built.** A late fee (mora) and the
    month it covers, a reconnection, a connection fee, a donation or other
    income, each with who paid, the amount, the date, how it was paid and
    the paper receipt's number, then "¿Está correcto?". A late fee is
    recorded under "Mora" with its month, a reconnection under "Reconexión"
    and a connection under "Conexión", so Configuración's checks see them: a
    fee amount with one paid in its months can no longer be corrected or
    removed. Their amount is Configuración's (the late fee of the month it
    covers, the reconnection or connection fee of the day it is paid);
    another amount needs a reason (App Plan, Module 2), and until
    Configuración has an amount for it the entry is refused. The app records
    a late fee only where the treasurer enters one, as the owner decided on
    13 November 2026 for months from the paper book. A house's late fee for a
    month is recorded once. A
    connection fee, a donation or other income may be from someone outside
    the census (entered from **Otro ingreso** on Inicio, under **Otras
    tareas**), and other income says what it is. An entry recorded by
    mistake is undone with **Anular**, as a payment is. A house's monthly fee
    and its late fee written on one receipt, the same day, do not count as a
    repeated receipt number. See "Trying Otro ingreso" below.
  - **Month-end late fees and Quién debe: built.** Owner decisions of
    14 November 2026: the app adds a late fee by itself only from a month
    set in Configuración → **Mora** (until it is set, none; earlier months
    have only the late fees typed in from the paper book); only active houses
    with water (connected or shared) build them up; and late fees are worked
    out each time from the payments, never written down, so an old payment
    typed in later corrects them by itself. As Module 2 says, a month counts
    as paid only when its full fee arrived by its deadline (Plazo de pago), so
    a month paid in full late still owes its late fee. A month's late fee is
    Configuración's late fee for that month, and it is paid by a "Mora" entry
    for that month in Otro ingreso. The household's file shows it under **Lo
    que debe** ("Debe la mora de octubre de 2026: L 50.00."), and **Quién
    debe** (the treasurer's home button, and Cobrar) lists the active houses
    with water that owe, the most owed first, each month with its fee left and
    its late fee. See "Trying Quién debe" below.
  - **Status history: built.** Owner decisions of 14 November 2026: each
    house keeps when it was active or inactive, and with or without water
    (**Estado y agua** on its file). **Desactivar**, **Reactivar** and a new
    water connection ask "¿Desde cuándo?", starting at today, so a family
    typed in from the paper book can say it was cut off since March 2025.
    The newest entry takes over from its date; nothing entered before it
    changes. A month is owed, and can owe a late fee, only if the house was
    active and with water ("Compartida" counts) on the day its deadline
    ended. So a house inactive since February owes nothing from then on, and
    still owes the months before. Houses registered before the history
    existed start active since they were registered, and those inactive now
    are inactive since their last "desactivó" in Historial. See "Trying the
    status history" below.
  - **Expenses (Gasto): built.** The treasurer's **Gasto** button: what kind
    of expense (the categories of Module 2), who was paid, the amount and
    date, how it was paid, and a photo of the receipt or invoice, then "¿Está
    correcto?". Owner decisions of 15 November 2026, where the plan did not
    say: the photo is asked for every time, and an expense with no paper is
    saved only with **No hay recibo** and a written reason, marked "Sin
    foto"; it asks how it was paid, as Cobrar does; the number on the
    supplier's invoice is optional, and the same number from the same
    supplier is flagged, not blocked. "Otro gasto" says what it is. A wrong
    expense is undone with **Anular**, as a payment is. Photos stay on the
    computer, in a folder beside the database file, until the storage bucket
    is connected (see "The database" below). See "Trying Gasto" below.
  - **Household statements (Estado de cuenta): built.** From a household's
    file, **Estado de cuenta** shows what the house paid from a month the
    treasurer chooses (January of this year to start with) and what it owes
    today: the same months and late fees as **Lo que debe**. Payments that
    were undone are left out. **Hacer para enviar** gives it a document
    number (one counter for every document the app hands out), puts it in
    Historial under Impresiones, and draws it as a picture with the board's
    name, the date and time and who made it. Owner decisions of 15 November
    2026: the statement is a picture, shared through the phone's own Share
    button, with a second button that opens the family's WhatsApp chat with
    the same statement as text; and the treasurer chooses the month its
    payments start from. See "Trying Estado de cuenta" below.
  - **Digital receipts (Recibo digital): built.** On a payment or other-income
    card in a household's file, **Recibo** opens the entry as a receipt and,
    with **Hacer y compartir**, draws it as a picture to send by WhatsApp,
    exactly like a statement and sharing its document number. Owner decision
    of 16 November 2026: receipts cover other income (late fees,
    reconnections, donations, other) as well as monthly fees, and one running
    count numbers every document. An expense has no resident receipt, and a
    payment that was undone has none. The paper receipt still stands; this is
    made only on request. See "Trying el recibo digital" below.
  - **Opening balance (Saldo de la junta): built.** A new **Saldo de la
    junta** button on Inicio. The treasurer enters, once, the cash in the box
    and the money in the bank on the first day of the month the app's money
    begins. The screen then shows **Dinero ahora**: the cash and the bank,
    plus everything that came in and went out from that month on, and a line
    "Pagado con «Otro»" only when something was paid that way. Owner
    decisions of 17 November 2026: two figures, cash and bank, with "Otro"
    on its own line so it is never mixed into the cash counted at month
    close; entries dated before the opening month (typed in from the paper
    book) are already inside the balance and count only for what each house
    owes; a wrong balance is fixed with **Corregir** and a written reason,
    which keeps the old one, until the first month is closed; it needs no
    approval of its own, because the first month close shows it and already
    takes a second person. See "Trying Saldo de la junta" below.
  - Next: the month close (Preparar cierre, Aprobar cierre), which starts
    from the opening balance.

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
   `1,250.5`. Identity numbers and phones never do. The other cards, **Mora**,
   **Reconexión** and **Conexión**, work the same way; what Otro ingreso
   charges for them comes from here.
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

With a base fee set in Configuración → Cuotas, and a family registered, tap
**Cobrar** on Inicio (among the treasurer's own buttons, and under **Otras
tareas** for every other role), or **Registrar pago** on a household's file. A payment needs signal: it is not kept on the phone.

1. Every house in the census is listed by name: scroll to it, or type part of
   the name or the code to narrow the list. Tap it.
2. **¿Qué está pagando?** Tap **Cuota mensual**. (Mora, Reconexión,
   Conexión, Donación and Otro ingreso go to Otro ingreso for that house,
   without asking again what it is; **Atrás** there comes back to Cobrar.
   See "Trying Otro ingreso".)
3. **¿Qué meses paga?** Each month shows what it still owes ("L 70.00",
   "Faltan L 40.00") or "Pagado". The list starts three months back and runs
   a year ahead; **Ver meses anteriores** adds older ones. Owed months older
   than that come first, under **Debe de antes**. Tap the months written on
   the paper receipt.
4. **¿Cuánto pagó?** starts on the full amount. Paying less fills the
   chosen months oldest first, so only the last one is left partly paid. More
   than they owe is refused, as is an amount that does not reach every month
   chosen: the screen says what to change. The date may be earlier than today
   (a receipt typed in later), never later, and never in a closed month.
5. **Recibo de papel**: cash, transfer (which asks for its reference) or
   other, and the receipt's number. **¿Quién pagó?** starts on the owner's
   name; a note is optional.
6. **¿Está correcto?** shows how much goes to each month. **Sí, guardar**.
   A receipt number already used asks first: if the receipt book started
   again, save it anyway, and both entries show "Número de recibo repetido:
   revisar".
7. The household's file lists its payments under **Pagos**, and each one is in
   **Historial** (Finanzas): "Tina (Tesorero/a) registró un pago de L 100.00
   de María López por noviembre y diciembre de 2026 …".
8. A payment recorded by mistake: on the household's file, tap **Anular
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

### Trying Lo que debe

With a base fee in Configuración → Cuotas from a past month (for example
January 2025):

1. In **Configuración** → **Plazo de pago**, type the day of the month by
   which a month is paid (say 25) and the grace days (say 5); the sentence
   under them says what that means this month. **Guardar plazo**. Each
   change is kept and in Historial (Configuración).
2. Register a family, or open one, and scroll to **Lo que debe** on its file.
   With nothing entered it owes from the month it was registered (the paper
   form's month, for a family typed in from paper), but only once a month's
   deadline and grace days are over: until then it says "Al día" and
   "Noviembre de 2026 se paga hasta el 25 de noviembre; si no, cuenta como
   debido desde el 1 de diciembre".
3. Type in its history in **Cobrar**: tap **Ver meses anteriores** until the
   old months show, pick a month written on an old receipt (say March 2025),
   and give the payment the receipt's date. Do the same for May 2025.
4. Back on the file: it now counts from March 2025, "su primer pago
   anotado". April 2025 is owed (skipped), and so is every month from June
   2025 to the last one past its deadline. More than four months are counted,
   not listed ("Debe 18 meses (L 1,260.00). El más antiguo es abril de
   2025."). A month paid in part says what is left.
5. Open **Cobrar** for that family: the owed months older than the usual list
   come first, under **Debe de antes**, ready to tap.
6. **Anular pago** on the March payment: the count then starts from May 2025,
   and April is no longer owed.

A month with no fee set, or one the board does not charge, is never owed.
Months paid ahead are not owed either. Only roles with "Ver finanzas" see
it, and only those with "Cambiar la configuración" may change the deadline;
the server works it out, whatever the screen shows. The newest deadline
applies to every month. A day past a short month's end (31 in February)
means its last day.

### Trying Otro ingreso

With a late fee, a reconnection fee and a connection fee in Configuración →
Cuotas from a past month (for example L 50, L 200 and L 1,500 from January
2025):

1. Open a family's file and tap **Otro ingreso: mora, reconexión…** (or open
   **Cobrar**, tap the family and pick **Mora**, which goes straight to the
   month; or tap **Otro ingreso** on Inicio, under **Otras tareas**, and
   pick the family).
2. Pick **Mora**, then the month written on the receipt or in the paper
   book. The next screen fills in L 50, the late fee of that month. Type
   another amount and it asks "¿Por qué es otro monto?".
3. Answer the receipt and who paid, check "¿Está correcto?" and **Sí,
   guardar**. The file now shows it under **Otros ingresos**.
4. Record the same month's late fee again: it is refused, with the date and
   receipt of the first. Record the month's fee in **Cobrar** with the same
   receipt number, the same day: no "número de recibo repetido".
5. Pick **Reconexión**, or **Conexión**: the amount is the reconnection or
   connection fee of the payment's date. With no connection fee set in
   Configuración, a connection is refused until one is.
6. From **Otro ingreso** on Inicio, pick **Donación**, then **No es de una
   vivienda del censo**, and type who gave it. It shows under **Últimos
   ingresos** on that first screen.
7. **Anular** an entry, with a reason: it stays, marked "Anulado", and its
   month's late fee can be recorded again.
8. In **Configuración → Cuotas**, try **Quitar** on the late fee from
   January 2025: it is refused, because a late fee was paid in its months.

Every entry and every Anular is in Historial (Finanzas). Only roles with
"Registrar pagos y gastos" may record, and only those with "Corregir un
registro de dinero" may undo; the server checks again whatever the screen
shows.

### Trying Gasto

1. On **Inicio**, tap **Gasto** (the treasurer's second button; under
   **Otras tareas** for the other roles).
2. Pick **Cloro**, then type who was paid ("Ferretería El Puente"), the
   amount and the date.
3. Pick **Efectivo**. The invoice number may be left empty.
4. On **Foto del recibo**, tap **Tomar foto** (the phone's camera opens) or
   **Elegir foto** (one already on the phone). The photo shows on the
   screen. **Siguiente** without a photo is refused.
5. Check "¿Está correcto?" and **Sí, guardar**. The expense is under
   **Últimos gastos** on Gasto's first screen; **Ver la foto** opens its
   photo.
6. Record one with **No hay recibo**: it asks why, and the expense shows
   "Sin foto" with that reason.
7. Record two expenses with the same invoice number from the same supplier:
   the second asks before saving, and both are then marked "Número de
   factura repetido: revisar". The same number from another supplier, or on
   one of the board's own receipts in Cobrar, is not a repeat.
8. Pick **Otro gasto**: it asks "¿De qué es el gasto?".
9. **Anular** an expense, with a reason: it stays, crossed out and marked
   "Anulado", with its photo.

Every expense and every Anular is in Historial (Finanzas). Only roles with
"Registrar pagos y gastos" may record, only those with "Corregir un registro
de dinero" may undo, and only those with "Ver finanzas" get a photo; the
server checks again whatever the screen shows. The phone makes each photo
small before sending it (about half a megabyte), so it goes through on weak
signal.

### Trying Estado de cuenta

With a family that has some payments and owes some months (see "Trying Lo
que debe"):

1. Open the family's file and tap **Estado de cuenta**, under Acciones.
2. The statement shows the payments from January of this year, each with
   its date and receipt number, then **Lo que debe hoy** with the same months
   and late fees as the file, and the total.
3. Change **Pagos desde** to an older or a later month: the list of payments
   changes, what is owed does not.
4. Tap **Hacer para enviar**. The statement gets its number ("Estado de
   cuenta nº 1") and shows as a picture.
5. **Compartir la imagen** opens the phone's share sheet: pick WhatsApp and
   the family's chat. On a computer, or a phone that cannot share a picture,
   it says so: use **Guardar la imagen** and attach it in WhatsApp.
6. **Enviar como texto** opens the family's WhatsApp chat with the same
   statement written out. It is there only for a family with a number, and
   for a user who may see the whole number.
7. In **Historial**, under Impresiones: "… hizo el estado de cuenta nº 1 de
   la vivienda Z-0001 (…), desde enero de 2026".
8. Undo one of the family's payments (**Anular pago**) and open the
   statement again: that payment is gone from it, and its month is owed.

Looking at a statement needs "Ver finanzas"; handing one out needs "Imprimir
y exportar finanzas". The server checks again whatever the screen shows.
Each **Hacer para enviar** takes a new number, also for the same house on
the same day.

### Trying el recibo digital

With a family that has at least one payment and one other-income entry (a
late fee, say):

1. Open the family's file and scroll to **Pagos**. On a payment's card, tap
   **Recibo**.
2. The receipt shows the house, who paid, the concept ("Cuota de … de 2026"),
   the amount, the date, how it was paid and the paper receipt number.
3. Tap **Hacer y compartir**: it gets its number ("Recibo nº 2", the next
   after any statement), and offers **Compartir la imagen**, **Enviar como
   texto** and **Guardar la imagen**, the same as a statement.
4. Do the same on an **Otros ingresos** card: a late fee reads "Mora de … de
   2026", a donation its note. From **Otro ingreso** on Inicio, a receipt can
   be made for a donation from outside the census too (no house, image only).
5. A reversed payment or income shows no **Recibo** button, and the server
   refuses a receipt for one.
6. In **Historial → Impresiones**: "… hizo el recibo nº 2 de una cuota
   mensual: … , recibo de papel nº …".

Looking needs "Ver finanzas"; making one needs "Imprimir y exportar
finanzas". The number is the same running count a statement uses, so a
statement and a receipt never share a number.

### Trying Saldo de la junta

1. On Inicio, tap **Saldo de la junta**. Before anything is entered it asks
   for **Mes en que empieza**, **Efectivo en caja** and **En el banco**.
   Type 0 where there is nothing. A month that has not come yet is refused.
2. **Guardar saldo inicial**. The screen shows **Dinero ahora**: the same
   two amounts, because nothing has come in since.
3. Record a payment in cash (Cobrar), a donation by transfer (Otro ingreso)
   and an expense in cash (Gasto), all dated today. Back in Saldo de la
   junta: the payment adds to the box, the transfer to the bank, the expense
   comes off the box. Something paid with "Otro" shows on its own line.
4. Record a payment dated in a month before the opening month, as when
   typing in the paper book: the money does not change. That house's
   **Lo que debe** does.
5. **Anular** the transfer donation: the bank goes back down. Anular the old
   payment from step 4: the money does not change, since it never counted.
6. Tap **Corregir**, change an amount or the month, and write why. The new
   balance shows, with "Antes: …" under it. In **Historial**, under
   Finanzas: "… anotó el saldo inicial: …" and "… corrigió el saldo inicial:
   … (antes …)", with the reason.

Looking needs "Ver finanzas"; entering needs "Registrar pagos y gastos";
correcting needs "Corregir un registro de dinero". Once a month is closed
(month close is not built yet), Corregir is gone and the server refuses it.

### Trying Quién debe

With a base fee and a late fee in Configuración → Cuotas from a past month
(for example L 70 and L 50 from January 2025), and a family whose history is
typed in through Cobrar:

1. Open **Quién debe** (on the treasurer's home screen, or at the top of
   **Cobrar**). It lists the houses that owe months, but no late fees yet:
   it says the month in Configuración → Mora is missing.
2. In **Configuración** → **Mora**, pick the month from which the app counts
   late fees by itself (say June 2025) and **Guardar mes**. It is in
   Historial (Configuración).
3. Back in **Quién debe**: each house now shows its months, each with the fee
   left and its late fee ("Octubre 2026: L 70.00 de cuota y L 50.00 de
   mora"). Months before June 2025 have no late fee. A month paid in full
   after its deadline shows "solo la mora". The most owed house is first;
   tap one to open its file.
4. On the file, **Lo que debe** says "Debe la mora de …".
5. In **Otro ingreso**, record the **Mora** of one of those months: it leaves
   the list. **Anular** it, and it comes back.
6. In **Configuración** → **Plazo de pago**, set an earlier day: a month paid
   after that day now owes its late fee.
7. Make a house inactive, or set its water to "Sin conexión": it leaves the
   list. Its months from that date are not charged (see "Trying the status
   history").

### Trying the status history

With a family whose history is typed in through Cobrar, owing some old
months, and the month in Configuración → Mora set before them:

1. On its file, **Estado y agua** shows "Desde el …: Activa, conectada",
   since the day it was registered.
2. **Desactivar**, pick why, and set **¿Desde cuándo?** to the first day of
   last month. **Lo que debe** now says "Está inactiva desde el …: no se
   cobran sus meses desde entonces, ni su mora", and last month is no longer
   owed. The months before still are, with their late fees.
3. **Reactivar**, and set **¿Desde cuándo?** to the 20th of last month (it
   may be earlier than today). Last month is owed again: the house was
   active when its deadline ended.
4. **Corregir datos de la vivienda**, change **Conexión de agua** to "Sin
   conexión": it asks since when. The months from that date drop out of **Lo
   que debe** and **Quién debe**.
5. Each change is in **Historial** with its date ("desactivó la vivienda …
   desde el 1 de octubre de 2026"), and the file keeps every entry: nothing
   is changed or deleted.

Only roles with "Ver finanzas" see the list, and only those with "Cambiar la
configuración" may set the month; the server checks again whatever the
screen shows.

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
   person instead, and offers "Agregar otra vivienda". Leave the identity
   empty and tap **Siguiente**, and leave **Referencias** empty too: the
   family is saved, and its file says "Identidad: No la dio" and
   "Referencias: Sin referencias". **Corregir datos de la persona** adds
   the ID later; on that file, **Agregar otra vivienda** works without one.
   **Name check:** register "Maria Rodriguez" (no ID) and then try "maria
   rodrigues": **Nombre parecido** lists her with her house and references.
   Tap her to add another house to her, or **No, es otra familia** to go on;
   going back and on with the same name does not ask again. "Maria Gómez"
   finds nobody. Both choices save. In **Historial**, the registration
   keeps the names told apart ("confirmedDifferentFrom").
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
months) or of a house's status history (`household_status_changes`) or of
the documents handed out (`documents`, whose number is never given twice):
triggers that `src/db/guards.ts` puts back after every
migration. That includes the delete hidden inside SQLite's `INSERT OR
REPLACE`. Taking one away would take a deliberate `DROP TRIGGER` with
other tools, and the history log's hash chain (`npm run db:verify-log`)
catches any entry changed that way.

`npm run db:backup` copies the file while the API keeps running
(`VACUUM INTO`), checks the copy, and encrypts it with
`BACKUP_ENCRYPTION_KEY` (`openssl rand -base64 32`). `npm run db:restore`
puts a backup into a new file and checks it: see
[docs/restore.md](docs/restore.md).

Photos of expense receipts are not in the database file. Until the storage
bucket is connected (App Plan, Phase 2) they stay on the computer, one JPEG
each, in the folder `receipts` beside the database file (set `RECEIPTS_PATH`
in `backend/.env` to put it elsewhere); the `receipt_files` table says which
expense each belongs to. They are read only through the API, by someone who
may see finances. **`npm run db:backup` does not copy them yet**: on the
droplet they must go to the bucket, or into the backup, before real expenses
are entered.

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

They pass on a Windows computer too, although GitHub runs them on Linux only.
Two things there differ, so a test that reads the repository's files allows
for both: Git for Windows checks files out with `\r\n` line endings, and a
`file:` URL's `.pathname` is `/C:/…`, a folder that does not exist
(`fileURLToPath` gives the real one).

On GitHub, every pull request runs two checks: **Tests** (the same two
commands, plus a build) and **Test copy** (the tests again, then the build
on the test copy). Do not merge while either is red.
