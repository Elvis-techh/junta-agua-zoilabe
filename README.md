# Junta de Agua Zoilabe

One app and one database for the Aldea Zoilabe water board (Tela, Atlántida):
census of households and owners, monthly fees and expenses, personal accounts
with roles, and a permanent history log. The plan gives the Municipality of
Tela read-only access through temporary guest invitations, which are set
aside for now (owner, 25 November 2026).

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
  **It goes back to the screen the person was on, and is named after it**
  (owner, 20 November 2026): a house opened from Quién debe comes back to
  "‹ Quién debe", not to Censo, a page that person never visited. Each
  history entry remembers the screen it was opened from (`markFrom`,
  `previousOf` and `labelOf` in `frontend/src/home.ts`; `BackButton` reads
  it). Only a screen opened from outside the app, or a page reloaded on its
  first entry, has no previous screen, and keeps the button above ("‹ Inicio",
  "‹ Censo").
- **Every amount takes up to L 999,999,999.99** (owner, 19 November 2026),
  since nobody knows how much a payment, an expense or the board's money
  will one day be: Cobrar, Otro ingreso, Gasto, the fees in Configuración, a
  family's different amount in Registrar familia, and Saldo de la junta.
  Each field takes nine digits before the point and two after, on the phone
  and on the server (`MAX_AMOUNT_CENTAVOS` in `backend/src/lib/money.ts`,
  `AMOUNT_WHOLE_DIGITS` in `frontend/src/census.ts`; a test fails if the two
  differ). Until then most fields stopped at L 99,999.99, and a different
  amount at L 10,000.00. An amount longer than 9,999,999.99 is drawn a
  little smaller, so it still fits beside the field next to it.
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
    It does not know a name written surname first. The owner tried it on the
    test copy on 19 November 2026 and found it good.
- **Phase 2 (Finances): built**; its "done when" test waits for the board to
  say how to run it. Its pieces, in build order, are ticked off under "What
  comes next" in the [app plan](docs/app-plan.md).
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
    debe** (the treasurer's home button, and Cobrar) lists every house that
    owes, the most owed first, each month with its fee left and its late fee.
    Owner decision of 19 November 2026: a house that is inactive or "Sin
    conexión" today is listed too, marked "Inactiva" or "Sin conexión", for
    the months it owes from when it had service (until then only active
    houses with water were listed). See "Trying Quién debe" below.
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
    are inactive since their last "desactivó" in Historial. The owner tried
    it on the test copy on 19 November 2026 and found it good. See "Trying
    the status history" below.
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
    number (one counter for every document the app hands out) and draws it
    as a picture with the board's name, the date and time and who made it.
    It leaves nothing in Historial (owner decision of 24 November 2026:
    printing is not logged; until then it was). Owner decisions of 15 November
    2026: the statement is a picture, shared through the phone's own Share
    button, with a second button that opens the family's WhatsApp chat with
    the same statement as text; and the treasurer chooses the month its
    payments start from. See "Trying Estado de cuenta" below.
  - **Digital receipts (Recibo digital): built.** On a payment or other-income
    card in a household's file, **Recibo** opens the entry as a receipt and,
    with **Hacer y compartir**, draws it as a picture to send by WhatsApp,
    exactly like a statement and sharing its document number, and, like a
    statement, leaving nothing in Historial (owner decision of 24 November
    2026). Owner decision of 16 November 2026: receipts cover other income (late fees,
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
    which keeps the old one, until the first month's close is prepared; it
    needs no approval of its own, because the first month close shows it and
    already takes a second person. See "Trying Saldo de la junta" below.
  - **Month close (Cierre del mes): built.** Owner decisions of 19
    November 2026. Anyone on the board may prepare a close, approve it or
    send it back; the one rule is that whoever prepared a month cannot also
    approve it (the server and the database both refuse it). The same screen
    opens from the treasurer's **Preparar cierre**, the president's and
    vice-president's **Aprobar cierre**, and **Cierre del mes** under "Otras
    tareas" for everyone else. It shows the oldest month not yet closed,
    once it is over, starting with the opening balance's month; months
    close in order, and a month with no entries is closed too. Caja and
    Banco are side by side: at the start of the month, what came in, what
    went out, and what should be there ("Debe haber"), with what each
    category added up to under **Ver de qué es**. Only the cash is counted:
    whoever prepares it types **Efectivo contado en caja**; if it is not
    what the app expects, it asks **Por qué no cuadra**, and the month shows
    a **Faltante** or **Sobrante de caja**. From then on the cash counts
    from what was counted, in the next month's figures and in Saldo de la
    junta; the bank is checked against its statement by eye. Someone else
    then taps **Aprobar cierre**, or anyone, the preparer too, taps
    **Devolver** with a reason, and the month opens again with that reason
    shown. While a month is prepared or closed, an entry dated in it is
    refused ("Registre el pago con la fecha de hoy y escriba en la nota de
    qué fecha es"), and the opening balance cannot be corrected; a reversal
    is dated the day it is made, so an entry of a closed month can still be
    undone. Closed months are listed below, each with its figures. Each step
    is in Historial, under Finanzas. See "Trying Cierre del mes" below.
  - Next: Phase 2's "done when" test, once the board says how to run it.

  A different amount starts with the month after the house's last payment
  (board decision, 25 October 2026); a newly registered house has none yet,
  so its amount starts with the month it is registered in.
- **Phase 3 (Close, reports and guests): merged, except what waits or is set
  aside.** The month close above was its first piece; all of them are listed
  under "Phase 3 pieces" in the [app plan](docs/app-plan.md).
  - **Resumen del mes: built.** Asked for by the owner on 19 November 2026,
    so the board can check, month by month, who was charged, who paid, who
    still owes, what came in and what the money was spent on. It opens from
    **Resumen del mes** on Inicio (the treasurer's, the president's, the
    fiscal's and the vocales' own button; under "Otras tareas" for the
    rest) on the month in progress; tapping the month's name (**Cambiar**,
    always shown) lists every month from the opening balance's, or says
    why there is only this one while the opening balance is in this month. One phone screen shows
    the month's money (at the start, **Entró**, **Salió**, at the end, or
    "Hay ahora" for the month in progress), its close's status, and its fee
    ("Pagaron todo: 5 de 10 casas", "Falta cobrar: L 495.00 con mora").
    **Entró** and **Salió** open every entry of the month by category, each
    with who paid or who was paid, what for, the date, the receipt or
    invoice number and how it was paid; an expense shows **Ver la foto** or
    "Sin foto" with its reason, and an entry undone says when and why. The
    fee opens every house charged that month, by name: first those that
    still owe something of it (its fee or its late fee), then those that
    paid it all; tap one to open its file. Nothing is counted anew: the
    money is the month close's, the entries add up to its lines, and who
    owes is what "Lo que debe" and Quién debe say. Looking at it needs "Ver
    finanzas" and gives out no document number. See "Trying Resumen del
    mes" below.
  - **Estado financiero del mes: built.** The same month as a document
    (App Plan, Module 5: "Monthly financial statement"), asked for in the
    plan's Phase 3 list. **Hacer estado para enviar**, under the fee card on
    Resumen del mes (shown to whoever may export finances), opens it for
    the month on screen; **Hacer para enviar** gives it the next document
    number (the same count as statements and receipts) and draws it as a
    picture; nothing is written to Historial (owner decision of 24 November
    2026: printing is not logged). The picture has the board's
    name, the month and whether it is closed (a month not closed says its
    figures may still change), the money at the start, what came in and
    what was spent, what is left in the box and the bank, and the month's
    fee. **Compartir la imagen**, **Enviar como texto** (WhatsApp asks which
    chat) and **Guardar la imagen** work as on Estado de cuenta. What came
    in is by category, with how many entries; each expense is its own line
    with who was paid, the date and the invoice number. Under the fee it
    lists the houses that still owe something of the month (**Faltan de
    pagar**), each with the owner's name, what it owes and its code, as
    Resumen del mes does; owner decision of 24 November 2026, though the
    document is sent on by WhatsApp. It never carries an ID number or a
    phone. Nothing is counted anew. See "Trying Estado financiero del mes"
    below.
  - **Lista del censo: built.** The census list for the municipality and the
    board's papers (App Plan, "Reports": filtered by sector and status;
    screen, printout, CSV). On **Censo**, **Imprimir** opens it: choose the sector (or all) and active, inactive or all houses.
    **Imprimir** gives the list a document number and opens the phone's or
    computer's print window (on a phone, "Guardar como PDF" is there too).
    **Guardar para Excel** does the same and saves a CSV file instead.
    **Nothing is written to Historial** (owner decision of 24 November 2026:
    the board will not audit who printed what); the list itself says who
    made it and when. Both carry the same heading (board, number, filters, who made it and when)
    and the same columns: code, name, relation, identity, phone, sector,
    references, water, status (with why it is inactive), paper form number
    and last verified date (the board agreed on these columns on 24
    November 2026). A phone is written without its "+" ("504 9988-7766"), so
    Excel keeps it as text. Identity and phone are whole only for someone
    with "Ver identidad y teléfono completos"; otherwise the server masks
    them, and the list says so. It needs "Ver el censo" and "Imprimir y
    exportar el censo". See "Trying la lista del censo" below.
  - **Verificación del censo: built**, the first half of the yearly census
    snapshot (App Plan, Module 1, "Yearly verification": "In December the
    app lists houses not verified that year, then freezes a census snapshot
    for the municipality"). On a house's file, **Datos revisados** says
    someone went over its details with the family today and they are right:
    its "Verificada el" date becomes today, with one entry in Historial. A
    second tap the same day changes nothing. On **Censo**, **Verificar**
    lists the active houses not verified this year (Honduras's calendar
    year), under their sector, each with when it was last verified. A house
    gets its first date when it is registered (the paper form's date in
    paper entry mode), and an inactive house is not listed. It needs
    "Registrar y editar el censo" to mark a house, and "Ver el censo" to see
    the list. See "Trying la verificación del censo" below.
  - **Historial del año: built.** The history log extract for the fiscal, the
    president and the board's records (App Plan, Module 4, "Yearly
    extract"). On **Historial**, **Imprimir o guardar un año** opens it:
    choose the year (it starts on the last one that is over, or this one
    while there is no other), then **Imprimir** or **Guardar para Excel**, as
    on Lista del censo. It holds that calendar year in Honduras time, oldest
    entry first; the year in progress says it is not over. Each entry has its
    date and time, who made it and their role, what happened and the reason.
    **What "Ver detalle" shows is left out** (owner decision of 25 November
    2026): the values before and after include ID numbers and phones, and
    the file can be sent on to anyone. The server does not even read them
    for the extract. It takes the next document number and writes nothing to
    Historial. It needs "Ver el historial" and "Imprimir y exportar el
    historial". See "Trying el historial del año" below.
  - **Reportes: built.** One list of every report the app makes, each with a
    line saying what it is for: Lista del censo, Estado de cuenta de una
    familia, Estado financiero del mes, Quién debe and Historial del año. A
    tap opens the screen that makes it, whose way back reads "‹ Reportes".
    Nothing is made, numbered or logged on Reportes itself. Each report shows
    only to someone who holds every permission its screen needs, and the
    server checks them again; the **Reportes** button on Inicio shows when at
    least one does (owner, 26 November 2026). The frozen yearly census
    snapshot is not on it until it is built. See "Trying Reportes" below.
  - **Set aside for now** (owner, 25 November 2026): guest invitations and
    the print layout every printout shares. They may be taken up again later.
    Each printout already shows who made it and its document number, and all
    but the digital receipt also show when it was made.
  - **Not built: the frozen yearly census snapshot.** It waits for the board
    to answer four questions about it (see "Still open for the board" in the
    [app plan](docs/app-plan.md)).
- **Phase 4 (Handover): set aside for now** (owner, 25 November 2026), who is
  fully involved in the project. The restore tried before launch stays in
  the plan, under Backups and Phase 0.
- **Next: a first version for real use.** It records expenses and will be at
  a subdomain of basculacentral.com (owner, 25 November 2026). The real app is
  not set up on a droplet yet. Before real expenses are entered, receipt
  photos must be backed up: today the nightly backup copies the database file
  only.
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
7. **Historial** shows nothing for it: printing is not logged.
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
6. **Historial** shows nothing for it: printing is not logged.

Looking needs "Ver finanzas"; making one needs "Imprimir y exportar
finanzas". The number is the same running count a statement uses, so a
statement and a receipt never share a number.

### Trying Saldo de la junta

1. On Inicio, tap **Saldo de la junta**. Before anything is entered it asks
   for **Mes en que empieza**, **Efectivo en caja** and **En el banco**.
   Type 0 where there is nothing. A month that has not come yet is refused.
   Each amount takes up to nine digits before the point, as every amount
   field does: type 2500000 and it shows 2,500,000.
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
correcting needs "Corregir un registro de dinero". Once a month's close is
prepared (see "Trying Cierre del mes"), Corregir is gone and the server
refuses it.

### Trying Cierre del mes

With the opening balance entered for a month at least two months ago (say
August 2026, with L 2,500 in cash), and in that month a donation in cash
(L 1,200) and an expense in cash (L 350), signed in as the treasurer:

1. On Inicio, tap **Preparar cierre**. It opens on August 2026, marked
   "Cierre abierto": Al empezar 2,500.00, Entró 1,200.00, Salió 350.00,
   Debe haber 3,350.00 in the Caja column. **Ver de qué es** lists
   "Entró: Donación …" and "Salió: Cloro …".
2. Type 3300 in **Efectivo contado en caja**. It says "Faltante de caja:
   L 50.00" and asks **Por qué no cuadra**. **Preparar cierre** without a
   reason is refused; write one and tap it again. The month is now "Cierre
   por aprobar", with rows **Contado** and **Faltante** in the figures.
3. Try to record a payment dated in August: it is refused, "está esperando
   que aprueben su cierre". Saldo de la junta no longer offers Corregir.
4. **Aprobar cierre** is not offered to the treasurer ("Usted lo preparó: lo
   debe aprobar otra persona"). Sign in as the president and tap **Aprobar
   cierre** on Inicio: it shows the same figures, the reason, **Aprobar
   cierre** and **Devolver**.
5. Tap **Devolver**, write why: the month is open again, and the treasurer
   sees "Lo devolvió …" with the reason. Prepare it again, and approve it as
   the president: "Mes de agosto de 2026 cerrado." It is listed under
   **Meses cerrados**; tap it to see its figures and who prepared and
   approved it.
6. The next month (September) opens with Al empezar 3,300.00 in Caja: the
   cash counted, not the 3,350.00 the app expected. Saldo de la junta shows
   the same.
7. Undo August's donation (Anular, from Otro ingreso): it is allowed, dated
   today, and comes off the money now; August's figures do not move.
8. In **Historial**, under Finanzas: "… preparó el cierre de agosto de
   2026: efectivo contado L 3,300.00, la aplicación esperaba L 3,350.00
   (faltan L 50.00)", "… devolvió el cierre …" and "… aprobó el cierre …".

Looking needs "Ver finanzas"; preparing needs "Preparar el cierre del mes";
approving and sending back need "Aprobar el cierre del mes".

### Trying Resumen del mes

With the opening balance entered for a month at least two months ago (say
September 2026), a base fee and a late fee in Configuración → Cuotas (L 70
and L 50), late fees counted from September (Configuración → Mora), a few
families registered from paper forms dated before September, and in
October some fee payments, a donation and two expenses:

1. On Inicio, tap **Resumen del mes**. It opens on this month, marked "Mes
   en curso", with "Hay ahora" at the foot of the money, and the whole
   month fits on the screen without scrolling.
2. Tap the month's name (**Cambiar**) and choose October. (If the opening
   balance is in this month there is no other month yet: the list says so.) It is marked "Sin
   cerrar" (or "Cierre por aprobar", or "Cerrado", as Cierre del mes says).
   The money matches Cierre del mes for October: at the start, what came
   in, what went out, at the end.
3. Tap **Entró**: "Entradas de octubre", by category, the largest first,
   each with its total. Each payment shows the family, its house code,
   "Cuota de octubre de 2026", the date, the receipt number and how it was
   paid. Tap **‹ Resumen**, then **Salió**: each expense shows who was paid
   and **Ver la foto** or "Sin foto".
4. Undo an October payment (Anular, from the household's file). In
   October it now says "Anulado el … Se descuenta en noviembre"; in this
   month the same amount appears again with "Se anuló lo anotado el …",
   taken off. Each month's categories still add up to its money.
5. Back on October, tap the fee card ("Ver quién pagó y quién falta"):
   every house charged October's fee, first **Faltan de pagar**, then
   **Pagaron todo**. A house that paid part shows "Pagó L 30.00 de
   L 70.00 y debe L 50.00 de mora"; one that paid in full late, "Pagó la
   cuota tarde: falta la mora". A house made inactive before October's
   deadline is not there. Tap a house to open its file.
6. This month's fee says "Se paga hasta el …": until then, nobody is late.

Looking needs "Ver finanzas". It shows names and amounts only, never an ID
number or a phone.

### Trying Estado financiero del mes

With the data of "Trying Resumen del mes" (or the made-up data):

1. On Inicio, tap **Resumen del mes**, choose October with **Cambiar**, and
   tap **Hacer estado para enviar** under the fee card. The month is on the
   screen as a document: "Estado financiero del mes", the month, whether
   it is closed ("Sin cerrar: las cifras pueden cambiar"), the money, what
   came in by category, each expense, and the fee. Nothing has a number
   yet: looking is not making.
2. Check it against Resumen del mes: the money at the start, **Entró**,
   **Salió** and the end are the same; each income category's total is the
   one under **Entró**; each expense is the one under **Salió**.
3. Tap **Hacer para enviar**. It says "Estado financiero nº …, listo para
   enviar", and shows the picture. Tap **Compartir la imagen** (on a phone),
   **Enviar como texto** (WhatsApp asks which chat) and **Guardar la
   imagen**; the text says the same as the picture.
4. Historial shows nothing for it. Make a house's Estado de cuenta now:
   its number is the next one, because every document shares one count.
5. Close October (Cierre del mes) and make the statement again: it says
   "Cerrado: las cifras ya no cambian."
6. Under the fee, **Faltan de pagar** lists each house that still owes
   something of October, with its owner's name, what it owes and its code;
   the same houses and amounts as under "Faltan de pagar" on Resumen del
   mes. A house that paid everything is not listed. No ID number or phone
   is on the document.

Making one needs "Imprimir y exportar finanzas"; someone without it sees Resumen del
mes but not the button.

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
   tap one to open its file. Its button at the top left says
   **‹ Quién debe** and brings you back to the list (not to Censo).
4. On the file, **Lo que debe** says "Debe la mora de …".
5. In **Otro ingreso**, record the **Mora** of one of those months: it leaves
   the list. **Anular** it, and it comes back.
6. In **Configuración** → **Plazo de pago**, set an earlier day: a month paid
   after that day now owes its late fee.
7. Make a house that owes old months inactive, or set its water to "Sin
   conexión", from the first day of this month: it stays on the list, marked
   **Inactiva** or **Sin conexión**, with the months it owes from before.
   Its months from that date are not charged (see "Trying the status
   history"). A house that owes nothing is not listed, whatever its status.

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
   que debe** and **Quién debe** (where the house stays, marked, while it
   owes older months).
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

### Trying la lista del censo

1. Open **Censo** and tap **Imprimir** (it is there for someone with
   "Imprimir y exportar el censo").
2. Choose a **Sector** and **Viviendas** (Activas, Inactivas or Todas): the
   count under them says how many houses the list will have.
3. Tap **Imprimir**. It says "Lista del censo nº 1, lista para imprimir", the
   print window opens, and the list shows under the buttons. On paper it is
   one table across the page, with nothing else of the screen.
4. Tap **Hacer otra**, then **Guardar para Excel**: a file
   `lista-del-censo-n2.csv` is saved. Open it in Excel: the accents are right
   and the phones show as text, written without the "+" ("504 9988-7766").
5. **Historial** shows nothing for either list: printing is not logged.
6. Every role holds every permission today, so every list has identity and
   phone whole. A list made without "Ver identidad y teléfono completos"
   (a guest's, later) shows only their last digits and says they are
   hidden; the tests check it until a Permisos screen can take it away.

Choosing changes nothing; each **Imprimir** or **Guardar para Excel** takes a
new number, as an Estado de cuenta does. **Imprimir otra vez** prints the
same list again, with the same number.

### Trying la verificación del censo

1. Open **Censo** and tap **Verificar**. It says how many active houses are
   left to verify this year, out of all of them, and lists them under their
   sector. With the made-up data (`npm run db:demo`) that is Marta Reyes,
   whose paper form is from last November; from January to March the
   others' forms, three months back, are from last year too. To make one
   yourself, register a family with **Copiar una hoja de papel** and a date
   from last year.
2. Tap a house: its file opens. Tap **Datos revisados**; the window asks
   whether its details were gone over with the family today. Tap **Sí,
   están bien**: "Verificada el" shows today, and the button is gone until
   tomorrow.
3. Tap **‹ Verificación**: the house is no longer on the list.
4. **Historial** has one entry: "… revisó con la familia los datos de la
   vivienda Z-…". A house registered today is already verified this year,
   and a deactivated house is not on the list.

### Trying el historial del año

1. Open **Historial** and tap **Imprimir o guardar un año** (it is there for
   someone with "Imprimir y exportar el historial").
2. **Año** lists the years that have entries, newest first, and under it is
   how many the chosen one has. A new database, or the test copy, has only
   this year, marked "(no ha terminado)".
3. Tap **Imprimir**. It says "Historial de 2026, documento nº …, listo para
   imprimir", the print window opens ("Guardar como PDF" is there too), and
   the extract shows under the buttons, where the table scrolls sideways on a
   phone. On paper it is one table across the page, with the column titles on
   every page and nothing else of the screen. About a dozen entries fit on a
   page, so look at the page count before printing on paper.
4. Tap **Hacer otro**, then **Guardar para Excel**: a file such as
   `historial-2026-n2.csv` is saved. Its columns are Fecha y hora, Quién,
   Cargo, Qué pasó and Motivo.
5. Check what is left out: change a family's phone from its file
   (**Corregir**), and make the extract again. It says that the data was
   corrected, with no phone or ID number. **Historial → Ver detalle** still
   shows what changed.
6. **Historial** gains no entry for either: printing is not logged.

### Trying Reportes

1. On **Inicio**, tap **Reportes** (the fiscal and the two vocales have it
   among their first buttons; everyone else under "Otras tareas").
2. It lists five reports, each with a line saying what it is for and, for
   Estado de cuenta and Estado financiero del mes, the step that makes it.
3. Tap **Historial del año**: its way back reads **‹ Reportes** and brings
   you back to the list. Try the others the same way.
4. A report shows only to someone who holds every permission its screen
   needs. Every role holds them all today, so the list is the same for
   everyone until a role loses one (the tests check this, since Permisos has
   no screen yet).
5. **Historial** gains no entry: opening Reportes changes nothing.

### Starting over

`npm run db:reset` empties the local database (it refuses to run in
production). Run `user:first-admin` again afterwards.

### Made-up data to try things with

After `npm run db:reset` and `user:first-admin`, `ALLOW_MADE_UP_DATA=yes npm run db:demo`
fills the database with made-up data from three months ago until today:
eleven families (on time, late, in part, ahead, never, moved away, one from last year's paper form), the fee and
the deadline, donations, expenses with and without a photo, and two entries
undone. Nothing is closed, so every month can still be changed. It acts as
the administrator, goes in through the same rules as the screens, and
refuses a database that already has any family or money, so it cannot spoil
real data. The test copy takes it too:
[docs/test-copy.md](docs/test-copy.md), "Made-up data on the test copy".

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
