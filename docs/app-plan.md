> The water board's App Plan: the full specification and the board's decisions.
> It began as a snapshot of the Claude Docs doc **"Zoilabe Water Board System: App Plan"**
> (https://claude.ai/artifact/NU7ygpQf7xeaRihKjqFsvf), revision 288, taken 2026-11-19.
> That doc is now a short to-do list, so the full plan is kept here: update this
> file in the same pull request as the change it describes.
> Last updated 2026-11-25.

# Zoilabe Water Board System: App Plan

2026-10-23 · Elvis

## Purpose and scope

One app and one database will run the Aldea Zoilabe water board's census, money records, users and history, with read-only access for the Municipality of Tela.

The directive needs a single source of truth that links each house to its owner and to what that owner pays each month. The municipality needs a trustworthy yearly census it can open and print without asking anyone. Neither should depend on one person or one spreadsheet.

**Principles**

- Nothing is deleted. Records are deactivated and money mistakes are fixed with a correcting entry.
- One write path. Data enters only through the app, never by typing into a spreadsheet.
- Simple first. Every screen must work for someone who only uses WhatsApp.
- Works with weak signal. Census entries are saved on the phone and sent when signal returns.
- The board owns it. Accounts, domain, code and backups belong to the water board, not to one person.

**Version 1 includes**

- Census: register households and owners, search, print.
- Finances: monthly fees, other income, expenses, receipts, month close.
- Users and access: personal accounts, roles, permissions and temporary guest invitations.
- History log: a permanent record of who did what and when.
- Configuration: fees, sectors, categories and village details, changed without new code.

**Version 1 leaves out**

- Online payments and bank integration.
- Replacing the paper receipt book. Paper receipts continue and the app records their numbers.
- Meter readings and billing by consumption.
- A public website or a login for residents.
- Automatic WhatsApp or SMS sending. The app prepares the message and opens WhatsApp for the user to press send.

## Roles and permissions

Eight roles cover the technical administrator and the board, and each user holds exactly one role. Since 6 November 2026 every role can do everything in the app: the board does not always meet in full, and a task only one or two people could do would wait for them. The role still says who each person is, so every history entry shows who acted and in which role.

- **Administrador**: technical administrator. Looks after the system and the accounts.
- **Presidente**: runs the board.
- **Vicepresidente/a**: acts when the president is away.
- **Secretario/a**: usually keeps the census.
- **Tesorero/a**: usually records income and expenses and prepares each month close.
- **Fiscal**: audits.
- **Primer vocal and Segundo vocal** (first and second board member).

Every role holds every permission: viewing the census with full ID numbers and phones, registering and deactivating records, setting fees and different amounts, recording and correcting money, preparing and approving a month close, viewing finances, managing users and guest invitations, editing role permissions, changing settings, viewing the history log, and printing and exporting.

Six rules sit behind this:

- **Two people close a month.** Anyone can prepare a month close and anyone else can approve it, but never the same person for the same month. Nobody can change their own role, or the permissions of their own role.
- **Every change says who.** Each history entry names the person and their role, which is why roles stay although they no longer limit anyone.
- **Permissions are data.** The Permisos tab can still narrow a role later without new code, and every change is written to the history log.
- **A permission turns off with the one it needs** (25 November 2026). Without "Ver finanzas", nothing that records, corrects, closes or prints money; without "Ver el censo", nothing that shows full identities, registers, deactivates, sets a different fee or prints the census; without "Ver el historial", no printing it; without "Ver los permisos", no editing them. A different fee also needs "Registrar y editar el censo". "Ver finanzas" includes the names of those who owe. The Administrador always keeps managing users, and viewing and editing permissions.
- **The server decides.** Permissions are checked on every request. Hiding a button is a convenience, not security.
- **Guests are not roles.** People outside the board, such as municipal staff, get a temporary invitation with its own view-only permissions (see Module 3).

## Module 1: Census

The census registers each household once, links it to its owner, and collects every answer on its own screen.

It keeps every column of the Registros sheet template and adds the fields needed to charge fees and to find a house.

| Field | Type | Rule |
|---|---|---|
| Household code | Automatic | Format Z-0001, sequential, never reused |
| Paper date and form number | Date, text | Paper entry only: the date written on the paper form and its number, if it has one |
| Full name | Text | Required; capitalized automatically |
| Identity (ID number) | 13 digits | Optional (decided on 19 November): a family may not want to give it. When given, it must have 13 digits, belongs to one person, and is checked against existing people before saving |
| Phone / WhatsApp | Country code and number | Required for the owner, unless the family has none or prefers not to give it; that reason is kept instead. The country starts on Honduras (+504), and the length is checked for each country |
| Gender | Choice | List kept in Configuration |
| Sector | Choice | Required; list kept in Configuration |
| References | Text | Optional (decided on 19 November); how to find the house |
| GPS pin | Optional | Taken from the phone when the registrar stands at the house; can be added later |
| Fee | Choice | Base price (the default) or a different amount; the base prices come from Configuration |
| Different amount and reason | Number, text | Required when the fee is not the base price: the monthly amount and the reason in the board's words |
| Relation to the house | Choice | Owner, renter, caretaker or other; the fee is charged to the person registered |
| Water connection | Choice | Connected, not connected or shared |
| Status | Choice | Active or Inactive; inactive needs a reason |
| Registered by and entered on | Automatic | The logged-in user and the date typed in, kept separate from the paper date |
| Submission ID | Automatic | Created on the phone; stops duplicates when signal is weak |

**Registration flow, one question per screen**

1. Full name.
2. Identity number, with a numeric keypad. It can be left empty.
3. Phone number.
4. Gender.
5. Sector.
6. References, which can be left empty, with an optional button to save the GPS pin.
7. Fee: the base price, or a different amount with the reason.
8. Relation to the house and water connection.
9. Review screen: "¿Está correcto?" with one large green button.
10. Saved screen: shows the household code and a "Compartir por WhatsApp" button.

**Rules**

- **Duplicates.** If the ID already exists, the app opens that person's file instead of creating a new one. One person can own several households, so it offers "Agregar otra vivienda". A family registered without an ID has nothing to check by ID, so the app compares the first name and last name with the families already registered, warns about similar ones, and lets the registrar save anyway (see the decisions of 19 November).
- **Offline.** An entry is saved on the phone first and sent when signal returns. A visible counter shows how many entries are waiting.
- **No deletion.** A record is made inactive with a reason: moved away, duplicate or entered by mistake.
- **Ownership changes.** The old owner's period closes and the new owner starts on a stated date, so past payments stay with the person who made them.
- **Yearly verification.** Each household has a last-verified date. In December the app lists houses not verified that year, then freezes a census snapshot for the municipality. Built so far (PR #62): a house's first date is the day it is registered (the paper form's date in paper entry mode); "Datos revisados" on its file makes it today, once someone has gone over its details with the family; and "Verificación del censo" lists the active houses not verified in the current calendar year, by sector. The frozen snapshot waits for the board (see Still open).
- **Paper entry mode.** The current census exists only on paper. In this mode the first screen asks for the date and number on the paper form, and both are stored beside the date typed in, so every record can be checked against its paper original. The paper forms are kept after entry.
- **Fee choice.** The default is the base price. A different amount cannot be saved without a reason, and every such choice shows in the history log.
- **No phone.** A family with no phone, or that prefers not to give it, is registered with "No tiene teléfono" or "Prefiere no darlo" instead of a number, and that reason is kept. The app then offers no WhatsApp message for that house: the household code is written down for the family, and receipts and statements are given on paper. A number can be added later from the household file.
- **No ID number or references.** A family that does not want to give its ID, or a registrar who cannot get it or write the references, saves the entry without them. The president asks for them where the board really needs them, and either can be added later from the household file.
- **Not collected in version 1.** Photos of ID cards, birth dates and anything the board cannot justify. A short consent line appears on the review screen.

## Module 2: Finances

Finances record money in and out as permanent entries, and a mistake is fixed with a correcting entry, never by editing. Amounts are in lempiras (L).

| Entry | Required details |
|---|---|
| Income: monthly fee | Household, months covered (a past month, the current month, months in advance or the whole year), amount, payment method, number printed on the paper receipt |
| Income: other | Type (late fee or mora and the month it covers, reconnection fee, connection fee, donation, other), who paid, amount, number printed on the paper receipt |
| Expense | Category (repairs and materials, electricity, chlorine, stipend, transport, other), supplier, amount, photo of the receipt or invoice |

Every entry also carries a date, an optional note and the name of the person who recorded it. A bank transfer needs its reference number. Categories live in Configuration.

**Monthly cycle**

1. The treasurer records entries during the month, each with the number of the paper receipt handed to the payer. A digital receipt with a "Compartir por WhatsApp" button is created only when someone asks for one.
2. At month end a board member, usually the treasurer, taps "Preparar cierre". The app shows opening balance, income, expenses and closing balance, and asks for the cash actually counted. A month can be prepared once it is over, oldest first. A difference in the cash needs a written reason, shows as "Faltante de caja" or "Sobrante de caja", and the next month starts from the cash counted (decided 19 November).
3. Another board member, usually the president, never the one who prepared it, reviews the figures and any cash difference, then taps "Aprobar cierre", or "Devolver" with a reason so it can be fixed and prepared again.
4. The month locks. Nothing in it can be added or changed; a late item goes into the next month with a note.
5. The fiscal reviews the closed month and a guest sees the summary if their invitation allows it.

**Rules**

- **Paper receipts stay.** Residents keep receiving the paper receipt. The app stores its number so the receipt book and the app can be reconciled, and it creates a digital receipt only on request.
- **Base fee and different amounts.** The board decides how it charges. Configuration holds the base monthly fee, for example L 70, and the board can change it at any time. Each house uses the base price or a different monthly amount. A different amount is entered with its reason when the family is registered, and any later change needs a reason too. A new amount takes effect from a stated date and never rewrites past months.
- **Paying ahead.** A house can always pay months in advance or the whole year. The yearly price is the house's monthly price times 12, so there is no separate yearly price to maintain. A month that is already paid stays paid if the fee changes later.
- **Month-end deadline and late fee (mora).** A month's fee is due by the last day of that month. The app works that date out from the calendar, so months ending on the 28th, 29th, 30th or 31st, and leap years, are all handled. Partial payments are accepted, but a month counts as paid only when the full fee has arrived by its last day. Each month not paid in full on time gets its own late fee.
- **Late fee and reconnection fee amounts.** Both are set in Configuration with a start date and can change every year. When the treasurer records one, the amount is filled in from Configuration, and changing it needs a reason.
- **Corrections.** A reversal entry points to the original and needs a written reason. Both stay visible.
- **Arrears.** The app lists every household that owes money, with its unpaid months and the late fee owed for each, calculated from the census, each house's fee, its status history and each month's deadline. A house that is inactive or without connection today is still listed, marked, when it owes from before (decided 19 November).
- **Whole numbers.** Money is stored in whole centavos so totals never drift from rounding.
- **Opening balance.** The treasurer enters it once at launch, as two figures: the cash in the box and the money in the bank, at the start of the month the app's money begins. Entries dated before that month count only for what each house owes, never in the money totals. A wrong figure is corrected by a new entry that points to the old one with a reason, until the first month is closed; the first close shows it, so a second person approves it there (decided 17 November). It appears in the history log like any other entry.
- **Receipt photos.** Photos of expense receipts are kept in a private storage bucket and opened through short-lived links.

## Module 3: Users and access

Every person gets a personal account with one role and a login that works for someone who only uses WhatsApp.

Each account holds a name, WhatsApp number, role, status, who created it and when, and last login.

**How a director signs in**

1. A board member creates the account in Usuarios with a password. The app offers one that is easy to read aloud, such as "bamu4827"; the board member keeps it or types another of at least 6 letters or numbers, and gives it to the person.
2. The person opens the app's address on their own phone, types their WhatsApp number and that password, and adds the app to the home screen. There is no link to open.
3. The phone stays signed in until they tap "Salir", or for 90 days without use. Using the app pushes the 90 days forward.
4. No action asks for the password again. Corrections and removals ask for a written reason, and a month close takes two different people.
5. No account locks after wrong passwords. Sign-in attempts are limited per minute; a wrong password is noted only in the server's own log, which is cleared over time.
6. If a password is forgotten or a phone is lost, a board member sets a new password in Usuarios. Every phone signed in to that account signs out.

**Guest invitations** give an outsider, such as municipal staff, temporary view-only access without an account.

1. A board member taps "Invitar" and enters the guest's name and email.
2. They tick what the guest may see (below) and choose how long the invitation lasts, up to 24 hours.
3. The app creates a temporary password and shows it once, with a button to share the email and password by WhatsApp.
4. The guest opens the app's web address in any browser and signs in with the email and password. Nothing needs to be installed.
5. Access ends when the time runs out, or the moment the invitation is revoked.

**What an invitation sets**

- **Screens:** any of the census, finances and reports.
- **Census detail:** without ID number and phone, or with the full ID number and phone.
- **Finance level:** none, monthly totals only, or detail.
- **Reports:** which printable reports the guest can open, print and export.
- **Duration:** required, and never more than 24 hours.

The history log, users and settings can never be included in an invitation.

**Account lifecycle:** invited, active, suspended, deactivated. Accounts are never deleted, because history entries point to them.

**Rules**

- **One person, one account.** Shared logins are not allowed, because the log must show who acted.
- **Visible tabs follow the role.** A user sees the tabs and buttons their role permits: since 6 November, all of them.
- **Guests are temporary and view-only.** A guest never sees the history log, users or settings, and an expired or revoked invitation ends the session at once.
- **Guest passwords** are generated by the app, shown once and stored only as a fingerprint.
- **A signed-in phone signs out** after 90 days without use.
- **Every account event** (create, role change, suspend, password changed) and every guest invitation created, used, revoked or expired is written to the history log.

## Module 4: History log

Every creation, change and approval is written to a log that nobody, including administrators, can edit or delete.

Each entry records who acted (name and role), when (date and time in Honduras time), what they did in plain words, which record it touched, the values before and after, and the reason when one is required.

| Area | Events recorded |
|---|---|
| Census | Household registered, field edited, details checked with the family ("Datos revisados"), record deactivated or reactivated, ownership changed, yearly snapshot created |
| Finances | Payment or expense recorded, reversal made, month prepared, month approved, opening balance entered |
| Users | Account created, role changed, suspended, password changed, guest invitation created, used, revoked or expired |
| Settings | Base fee, late fee or reconnection fee changed or corrected, different fee set for a house, category added, permission matrix edited |
| Security | Nothing since 9 November 2026: signing in and wrong passwords leave no entry, and each account keeps only its last sign-in |
| Exports | Nothing since 24 November 2026: printing is not logged. Statements and receipts left an entry until then, and those entries stay |

Page views are not logged. Since 24 November 2026 printouts and exports are not logged either: the board will not audit who printed what. Each document still keeps its number, who made it and what it was made for.

**How it is protected**

- **Append-only.** The database itself accepts new entries but refuses to change or remove any.
- **Tamper-evident.** Each entry stores a fingerprint of the one before it, so an altered entry breaks the chain. A nightly check reports the result in Configuration.
- **Backed up.** The log is part of every nightly backup and is kept permanently.
- **Yearly extract.** A PDF and CSV of the year's log is saved for the board's records. Built in PR #63: on Historial, "Imprimir o guardar un año" opens a year (Honduras's calendar year), to print or to save for Excel, oldest entry first, with a document number. Each entry carries its date and time, who made it and their role, what happened and the reason. What "Ver detalle" shows (the values before and after, which include ID numbers and phones) stays in the app (decided 25 November). The year in progress can be taken too, and says it is not over. It takes "Ver el historial" and "Imprimir y exportar el historial", and the app makes it only when someone asks.

**How it is read**

- Entries read as plain sentences, for example "12 de marzo, 3:40 pm: Ana (Tesorera) registró un pago de L 150 de Juan Pérez".
- Filters cover date range, person, module and household code.
- "Ver detalle" opens the before and after values.
- Every board member can open the log.

## Configuration and reports

Configuration holds everything that changes without new code, and reports give the board and the municipality printable views.

| Setting | What it holds | Who changes it |
|---|---|---|
| Village and board profile | Aldea Zoilabe, Tela, Atlántida; board name, logo, registration number | Admin, President |
| Sectors | The list used when registering a household | Admin, President |
| Fees | Base monthly fee, late fee (mora) and reconnection fee, each with a start date and reviewed every year | Admin, President |
| Categories | Income and expense lists used in finances | Admin, President |
| Month close rules | The day by which each month should be closed | Admin, President |
| Guest invitation rules | The choices a new invitation offers within the 24-hour limit, such as which finance summary is shown | Admin, President |
| Text size | Normal, Large or Extra large, set in each person's own profile | Each user |
| System status | Last backup, last restore test, log chain check, app version; display only | Nobody |

Every change is written to the history log, and money settings take effect from a stated date.

| Report | Used by | Output |
|---|---|---|
| Census list, filtered by sector and status | Secretary, guests with census access | Screen, PDF, CSV |
| Household statement (estado de cuenta) | Treasurer; sent to the owner by WhatsApp | PDF or image |
| Monthly financial statement | President, fiscal; guests see what their invitation allows | PDF, CSV |
| Arrears list | Treasurer, president | Screen, PDF |
| Yearly census snapshot | Municipality and the board's archive | PDF and CSV, frozen at year end |
| History log extract | Fiscal, president | PDF, CSV |

Every printout carries the date and time, the name of the person who generated it and a document number. The board's logo is left out for now, and no printout or export is written to the history log (both 24 November 2026).

## Data model

Twenty-one tables hold everything, and people are kept apart from households so one person can own several houses.

| Table | Holds | Links to |
|---|---|---|
| users | Accounts: name, phone, status, password fingerprint, last login | roles |
| roles | The eight roles: administrator, president, vice-president, secretary, treasurer, fiscal, first and second board member | none |
| role_permissions | Which permission codes each role holds | roles |
| access_tokens | Sign-in sessions, one per phone (and, as history, the invitation links and remembered phones used until 9 November 2026) | users |
| guest_invitations | Guest name, email, password fingerprint, the permission codes it grants, expiry time, revoked date, last sign-in | users |
| people | One row per person: full name, ID number (unique), phone, gender | none |
| households | Code, references, GPS pin, water connection, status, paper date and form number, submission ID (unique), last verified date | sectors |
| household_status_changes | A house's status and water connection over time, each from a date, never changed once written | households, users |
| household_owners | Which person owns which household, with start and end dates | households, people |
| household_fees | A different amount for a house: monthly amount, reason, start and end dates | households |
| sectors | Sector names used in the census | none |
| fee_rates | Base monthly fee, late fee, reconnection fee and connection fee, each with a start date | none |
| transactions | Every income and expense: amount in centavos, paper receipt number, months covered, pointer to the entry it reverses | categories, households, months, users |
| payment_months | How much of a monthly fee payment went to each month it covers | transactions, households |
| categories | Income and expense categories | none |
| receipt_files | Keys of receipt photos in the storage bucket | transactions |
| months | Month, status (open, prepared, closed), who prepared and approved, the cash counted and the cash the app expected, the reason for a difference, and who sent it back and why | users |
| opening_balances | The cash and bank figures the app's money starts from, with the month; a correction points to the entry it replaces | users |
| documents | One numbered row per document handed out (household statements, receipts, monthly statements, census lists, history log extracts): what it was made for, not its contents | users |
| audit_log | The history log, each entry chained to the one before | users |
| settings | Configuration values with their start dates | users |

**Rules for the builders**

- **Append-only tables.** The database itself lets rows be added to transactions and audit_log but never changed or deleted, and refuses to delete a row from any table. A closed month is locked in the database as well as in the app.
- **Unique keys.** ID number on people and submission ID on households each allow one row only. A repeated paper receipt number is flagged for review, not blocked, because receipt books can restart their numbering.
- **Phone-made IDs.** Census entries get their ID on the phone, so a retry after weak signal cannot create a second record.
- **Time.** Timestamps are stored in UTC and shown in Honduras time (UTC-6).
- **Every row** records who created it and when. Edits copy the before and after values into audit_log in the same database transaction.
- **Migrations.** Every schema change is a versioned script in the repository and is tried on a copy of the data first.

## Screens and navigation

The home screen shows first the large buttons for what the user's role usually does, then the other tasks below them, under "Otras tareas", and last, under "Administración", the setup screens: Usuarios, Permisos and Configuración (decided on 19 November), and every task runs one question per screen.

| Tab | Contains | Visible to |
|---|---|---|
| Inicio | Large action buttons and alerts, such as a month waiting for approval | Everyone |
| Censo | Register, search, list, household file | Everyone |
| Finanzas | Payments, expenses, month close, statements | Everyone; guests see what their invitation allows |
| Reportes | Printable reports | Everyone |
| Usuarios | Staff accounts and guest invitations | Everyone |
| Permisos | The role-by-permission matrix | Everyone |
| Historial | The history log | Everyone |
| Configuración | Settings and system status | Everyone |

On a phone the bottom bar shows at most four items plus "Más".

| Role | First home buttons |
|---|---|
| Secretario/a | Registrar familia, Buscar, Lista |
| Tesorero/a | Cobrar, Gasto, Resumen del mes, Quién debe |
| Presidente and Vicepresidente/a | Aprobar cierre, Resumen del mes, Historial, Usuarios |
| Fiscal | Resumen del mes, Historial, Reportes |
| Primer and Segundo vocal | Censo, Resumen del mes, Reportes |
| Administrador | Usuarios, Permisos, Configuración |
| Invitado (guest) | Only the screens the invitation allows |

**Design rules for older users**

- Text is at least 18 px on phones, with three sizes to choose from.
- Buttons are at least 56 px tall with space between them.
- Every button has an icon and a word. Status shows word, icon and color together, never color alone.
- Numbers (ID, phone, amounts) use a numeric keypad.
- Words come from the village, not from software: "Registrar familia", not "Crear registro".
- A confirmation screen comes before every save, and the result is a full sentence: "Guardado. Se enviará cuando haya señal."
- Errors say what to do: "La identidad debe tener 13 números. Revise e intente de nuevo."
- On computers the same app shows wide tables with filters and print buttons for the municipality and the treasurer.
- Before each phase is called done, two or three directive members use it without help while the builder watches.

## Architecture, security and continuity

One installable web app, one API and one SQLite database file run on the shared droplet, while receipt photos and backups go to Spaces. Use the same stack as Lindero and the weight station so one person can maintain all three.

*(Diagram in the original doc: architecture · 1 droplet, 1 storage bucket, 1 offsite copy)*

Phones and municipal computers reach one API. Lindero and the weight station share the droplet but not the database.

### Architecture

- **Front end:** a progressive web app, installed from a WhatsApp link, that updates itself.
- **API:** one service behind Nginx on its own subdomain, served over HTTPS.
- **Database:** one SQLite file of its own, the same kind Lindero and the weight station use, so the droplet runs no database server. The file itself refuses to delete any row of any table, and to change any entry of the history log or of the money records (decided 29 October 2026).
- **Separation from the other apps:** each app has its own database file that only its own system user on the droplet can open, its own containers and env file, its own subdomain, its own storage key and bucket (or folder), and its own nightly backup, so one app can be restored without touching the others. Check this list before the first deployment.
- **Files:** receipt photos and backups in a private Spaces bucket.
- **Capacity:** the current shared droplet is enough for version 1. Set DigitalOcean alerts at 80% memory and disk.

### Security

- HTTPS only. Passwords are stored as salted hashes and sign-in attempts are limited per minute; no account locks.
- The server checks permissions on every request. ID numbers and phones are masked by the server for roles and invitations without access, not just hidden on screen.
- Secrets live in environment variables, never in the repository.
- Receipt photos open only through short-lived links.
- Only the app's own system user can open the database file; reaching it outside the app takes the technical administrator's server login. A history entry changed that way breaks the log's hash chain, which is checked every night.
- The board and the municipality agree in writing who may see what, and that note is kept with the runbook.

### Backups

- A nightly encrypted copy of the database file goes to the Spaces bucket. Keep 30 daily and 12 monthly copies.
- A weekly second copy leaves DigitalOcean for a board-owned Google Drive or another provider, so one account problem cannot take everything.
- DigitalOcean's weekly droplet backups stay on as a third layer.
- A restore is tried on a fresh droplet before launch and every three months. The date shows in Configuration.
- The yearly census snapshot goes to the municipality and to the board's archive.

### Continuity

Set aside for now with Phase 4 (decided 25 November 2026), except the last point, which is how the app already works.

- During testing, the domain, hosting and repository are in the builder's name. Before launch they move to the board's accounts: a DigitalOcean team with two owners, the domain, the code repository and the Spaces keys, with the builder as a member.
- A one-page runbook covers where the data lives, who pays for hosting, who to call, how to install the app on a new phone and how to restore.
- Recovery credentials are sealed in an envelope held by two board members, for example the president and the fiscal. It is the way back in if the builder is unavailable.
- A second technical contact completes one restore from the runbook.
- If the server is down, phones keep accepting census entries and show the last loaded data, then catch up when it returns.

## Build phases and open decisions

Five phases take the app from foundation to handover, and each ends with a test that a real director can pass.

| Phase | Delivers | Done when |
|---|---|---|
| 0. Foundation | Repository, subdomain, database, sign-in, role and permission engine, history log writer, nightly backup, data separation from the other two apps | Two users with different roles sign in, a change appears in the log, a backup restores on a test server, and this app's login cannot open the other apps' databases |
| 1. Census | Registration flow with the fee question, paper entry mode, duplicate check, search and list, household file, offline queue, inactive status | The secretary types in 10 paper forms from a phone without help and each record matches its paper original |
| 2. Finances | Base fee and different amounts, paying ahead, month-end late fees, reconnection fee, payments with paper receipt numbers, expenses, receipt photos, digital receipts on request, household statements, arrears list | One full month runs alongside the paper receipt book and the balances match |
| 3. Close, reports and guests | Month close with approval, monthly statement, yearly snapshot, temporary guest invitations, print layouts | A municipal official signs in with a guest invitation, opens and prints the census with full ID numbers, and the fiscal reviews a closed month |
| 4. Handover | Restore test, runbook, board-owned accounts, training at a directive meeting, install on every director's phone | A second person restores from the runbook and the board runs a month without the builder |

**Local first**

Phases 1 to 3 are built and tested on the builder's computer before anything changes on the droplet (decided 2026-10-24). Each change merges to `main` only once its tests pass, so the droplet work at the end is one deployment, not five. Checks that need a phone, such as Phase 1's ten paper forms, run on the droplet's test copy (running since 1 November 2026, with made-up data only).

| Phase | Status | Built and tested locally | Waits for the droplet |
|---|---|---|---|
| 0. Foundation | Merged | Sign-in (phone and password since 9 November 2026), roles and permissions, history log, backup and restore scripts (merged in PR #1 on 2026-10-24) | Subdomain, the data-separation check, backups to the storage bucket, a restore on a test server |
| 1. Census | Merged | Everything, including paper entry mode and the offline queue (merged in PRs #3 to #5 on 2026-10-25). Its "done when" test, the secretary typing in ten paper forms from a phone, has not been run yet; the test copy is ready for it, using made-up forms | Nothing |
| 2. Finances | Merged | Everything, merged by 19 November 2026; receipt photos stay on the computer until the bucket is connected. Its "done when" test waits for the board to say how to run it | Receipt photos in the storage bucket |
| 3. Close, reports and guests | Merged, except what waits or is set aside | The month close (PR #55), Resumen del mes (PR #56), the census list (PR #58) and the monthly statement (PR #59), merged from 19 to 24 November 2026; the yearly verification list (PR #62) and the history log extract (PR #63), merged on 25 November 2026. Temporary guest invitations and the shared print layout are set aside for now (25 November 2026). The frozen yearly census snapshot is not built and waits for the board. Without guest invitations, the guest part of the "done when" test cannot be run | Nothing while guest invitations are set aside |
| 4. Handover | Set aside for now (25 November 2026) | Nothing yet (a first draft of the runbook was planned here) | The restore test by a second person, board-owned accounts, training and installing on every director's phone |

**Done so far (as of 25 November 2026)**

Phases 0 and 1 are merged and the test copy is running. From Phase 3, the month close, Resumen del mes, the census list, the monthly statement, the yearly verification list and the history log extract are merged. Every Phase 2 piece is merged, the month close last (19 November 2026): fees can be set and removed in Configuración, including changes that start in a past month, monthly fee payments can be recorded, a payment recorded by mistake can be reversed, and each house shows what it owes once a month's payment deadline is over. Board members sign in with their phone number and a password.

- [x] Test copy running at [prueba-agua.basculacentral.com](https://prueba-agua.basculacentral.com) with made-up data only, set up on 1 November 2026 (PRs #11 to #13). Every pull request now goes there for a phone check. Its own separation check passed; the real app's is still open below.
- [x] Database moved to SQLite (PR #8).
- [x] Phase 2's tables are in the database: fee rates, transactions, categories, months and receipt files. Transactions can only be added, never changed or deleted.
- [x] Finance permissions are set for each role: view, record and reverse.
- [x] Income and expense categories from Module 2 are loaded.
- [x] A house's different amount and its reason are entered at registration, and start with the month after its last payment (PRs #3 and #4).
- [x] Board rules for Phase 2 are written down: the decisions of 25 and 29 October and of 2 and 3 November below.
- [x] Fees can be set in Configuración, and the census shows the base price's amount (PR #15, merged on 3 November 2026).
- [x] Cuotas is clearer: each saved amount has its own box, "Cambiar monto" became "Cambiar detalles", and a test proves a later fee takes over when its month arrives (PR #17, merged on 4 November 2026).
- [x] The screen behind an open panel stays still, on a computer and on a phone (PR #18, merged on 4 November 2026).
- [x] Money amounts show thousands commas while they are typed. ID numbers, phones, PINs and paper form numbers stay plain (PR #19, merged on 4 November 2026).
- [x] On a computer, month and date fields open the app's own calendar, in Spanish. A phone keeps its own picker (PR #20, merged on 4 November 2026).
- [x] Nothing stays hidden on a phone: on a form's last field the button that goes on stays above the keyboard, and "Hay más abajo" says when something is further down (PR #21, merged on 4 November 2026).
- [x] Every certificate on the droplet now reloads nginx when it renews, so no site keeps serving an old one (set up on 4 November 2026). Its first real use is Báscula Central's renewal, around 25 November.
- [x] On a phone, the keyboard stays down until a field is tapped (PR #22, merged on 5 November 2026).
- [x] Every phone number carries its country code, chosen from a list of nine with Honduras first (PR #23, merged on 5 November 2026).
- [x] Monthly fee payments, "Cobrar": the treasurer records a house's payment for the months on the paper receipt, shared oldest month first, with the receipt's number (PR #24, merged on 6 November 2026).
- [x] Removing a fee amount, "Quitar": until a payment covers its month, with a written reason and the PIN (PR #25, merged on 6 November 2026).
- [x] Every role holds every permission; a month close still takes two different people, and the database refuses an approval by whoever prepared the month (PR #26, merged on 6 November 2026).
- [x] Corrections, "Anular pago": a whole payment is reversed from the household's file with a reason and the PIN, dated the day it is made; the original stays, marked "Anulado", and can be recorded again with its details filled in (PR #27, merged on 7 November 2026).
- [x] Signing in with phone number and password, replacing the invitation link and the PIN (PR #28, merged on 9 November 2026).
- [x] The history log keeps changes, not visits: signing in and wrong passwords leave no entry, and new entries no longer save the phone's description (PR #29, merged on 12 November 2026).
- [x] Past fee changes in Configuración: a fee can take a change that starts in a past month, so the fees of the years in the paper book can be entered, unless a payment of that fee falls in the months it would cover. Corregir and Quitar now look only at payments in an amount's own months (PR #30, merged on 13 November 2026).
- [x] What each house owes: a household's file shows "Debe el mes de …" or "Debe los meses de …", counted from its first entered payment (or its registration month, if earlier), once a month's payment deadline and grace days are over. Configuración → Plazo de pago sets the day of the month and the grace days. Cobrar lists older owed months first, under "Debe de antes" (PR #33, merged on 13 November 2026). The owner tried it on the test copy.
- [x] Other income, "Otro ingreso": a late fee (with the month it covers), a reconnection, a connection fee, a donation or other income, each with who paid, the amount, the date, how it was paid and the paper receipt's number. A late fee is recorded under "Mora" and a reconnection under "Reconexión", so Configuración's checks see them. A wrong entry is undone with "Anular" (PR #36, merged on 14 November 2026).
- [x] Connection fee in Configuración, added by the owner on 14 November 2026, and charged from Otro ingreso (PR #37, merged on 14 November 2026).
- [x] Month-end late fees and "Quién debe": the app adds a late fee by itself only from a month set in Configuración → Mora. Only active houses with water build them up. They are worked out each time from the payments and never written down. The household's file shows them under "Lo que debe", and "Quién debe" lists who owes, the most owed first (PR #38, merged on 14 November 2026).
- [x] The same home screen for every role: Inicio shows the role's usual buttons first, then every other built screen under "Otras tareas" (PR #39, merged on 14 November 2026).
- [x] A status history for each house: a month is owed, and owes a late fee, only if on the day its deadline and grace days end the house was active and had water. Desactivar, Reactivar and a change of water ask "¿Desde cuándo?", and the household's file shows each entry under "Estado y agua" (PR #40, merged on 15 November 2026).
- [x] Expenses, "Gasto": the treasurer records what was paid, to whom, the amount and date, and how it was paid, with a photo of the receipt or "No hay recibo" and a written reason. A wrong expense is undone with "Anular" (PR #41, merged on 15 November 2026).
- [x] Household statements, "Estado de cuenta": from a household's file, what the house paid from a month the treasurer chooses and what it owes today, as a picture with a document number, shared through the phone's own Share button or as text for the family's WhatsApp chat (PR #42, merged on 15 November 2026).
- [x] Digital receipts, "Recibo digital": a monthly fee payment or other income as a picture to send by WhatsApp, numbered in the same count as statements (PR #43, merged on 17 November 2026).
- [x] The opening balance, "Saldo de la junta": entered once, as the cash in the box and the money in the bank at the start of the month the app's money begins, and shown with the board's money now. An entry paid by "Otro" has its own line. A wrong balance is corrected with a new entry and a reason until the first month is closed (PR #45, merged on 19 November 2026).
- [x] Inicio puts Usuarios, Permisos and Configuración last, under "Administración", for every role (PR #46, merged on 19 November 2026).
- [x] Cobrar opens on every family in the census, by name, to scroll or search. Tapping one asks "¿Qué está pagando?" (monthly fee, late fee, reconnection, connection, donation or other income) and then the details. "Otro ingreso" has its own button on Inicio for money from outside the census (PR #47, merged on 19 November 2026).
- [x] The ID number and the references are optional in Registrar familia, and can be added later from the household file; "Agregar otra vivienda" from a person's file works without an ID (PR #48, merged on 19 November 2026).
- [x] The name check in Registrar familia: a warning about names like one already registered, which the registrar can override. The owner tried it on the test copy and found it good (PR #49, merged on 19 November 2026).
- [x] Saldo de la junta takes cash and bank above L 99,999.99 (PR #51, merged on 19 November 2026).
- [x] A way back at the top of every screen, "‹ Inicio" or the screen it came from, for those who do not know the phone's own back button (PR #52, merged on 19 November 2026).
- [x] Every amount field takes up to L 999,999,999.99, on the phone and on the server (PR #53, merged on 19 November 2026).
- [x] "Quién debe" lists every house that owes, marked "Inactiva" or "Sin conexión" when it has no service today (PR #54, merged on 19 November 2026).
- [x] The month close, "Cierre del mes": once a month is over, someone counts the cash and taps "Preparar cierre"; another person taps "Aprobar cierre", or "Devolver" with a reason. A difference in the cash shows as "Faltante" or "Sobrante de caja", and nothing can be entered in a closed month (PR #55, merged on 19 November 2026).
- [x] "Resumen del mes": for any month from the opening balance's, the money at its start and end, every entry that came in or went out, and who was charged the month's fee, who paid it and who still owes. `npm run db:demo` fills an empty database with made-up data for it (PR #56, merged on 20 November 2026).
- [x] The way back goes to the screen the person came from and is named after it, such as "‹ Quién debe" (PR #57, merged on 22 November 2026).
- [x] The census list, "Lista del censo": filtered by sector and status, printed or saved for Excel (CSV), with a document number (PR #58, merged on 24 November 2026).
- [x] The monthly statement, "Estado financiero del mes": Resumen del mes as a numbered picture to share or save, or text to send by WhatsApp, naming the houses that still owe (PR #59, merged on 24 November 2026).
- [x] "Estado de cuenta" and "Recibo digital" no longer leave an entry in Historial (PR #60, merged on 24 November 2026).
- [x] "Verificación del censo": the active houses not verified this year, by sector, and "Datos revisados" on a house's file (PR #62, merged on 25 November 2026). The owner tried it on the test copy.
- [x] "Historial del año": a year of the history log, printed or saved for Excel, with a document number and without what "Ver detalle" shows (PR #63, merged on 25 November 2026). The owner tried it on the test copy.
- [x] The Permisos screen: each cargo's permissions, turned off or on and confirmed before saving, with a permission turning off together with the one it needs. Nobody can change their own cargo's. Built on 25 November 2026.

**What comes next**

Phase 2 is built: the app sets fees, records monthly fee payments and other income, shows what each house owes with its late fees, and reverses a payment recorded by mistake. Expenses (category, supplier, amount and receipt photo) are built (PR #41, merged on 15 November 2026). The opening balance ("Saldo de la junta", PR #45) was merged on 19 November 2026. The month close ("Preparar cierre", "Aprobar cierre" and "Devolver"), the last Phase 2 piece, was merged in PR #55 on 19 November 2026. Nothing in Phase 2 waits for a board answer now, except how to run its "done when" test. In Phase 3, the month close, "Resumen del mes", the census list, the monthly statement, the December verification list and the history log extract are merged; what is left is set aside or waits for the board (see the list below).

The history log extract (PR #63) and the yearly verification list (PR #62) were merged on 25 November 2026. "Estado de cuenta" and "Recibo digital" leaving nothing in Historial (PR #60), the monthly statement (PR #59) and the census list (PR #58) were merged on 24 November 2026, the way back to the previous screen (PR #57) on 22 November 2026, and "Resumen del mes" (PR #56) on 20 November 2026. The month close (PR #55), every amount up to L 999,999,999.99 (PR #53), Quién debe listing every house that owes (PR #54), the name check (PR #49), Saldo de la junta above L 99,999.99 (PR #51), a way back on every screen (PR #52), Registrar familia without an ID or references (PR #48), Cobrar's list of families (PR #47), the Inicio order (PR #46) and the opening balance (PR #45) were merged on 19 November 2026. Digital receipts ("Recibo digital", PR #43) were merged on 17 November 2026. Household statements ("Estado de cuenta", PR #42) were merged on 15 November 2026. Expenses ("Gasto", PR #41) were merged on 15 November 2026. The status history (PR #40) was merged on 15 November 2026, after PR #36 to #39 on 14 November 2026. The start month (PR #32) was closed without merging.

**Where to pick up next (25 November 2026)**

- **Next:** a first version ready for real use. It records expenses, so receipt photos must be backed up first (see "Before real use"). Guest invitations, the shared print layout and Phase 4 are set aside for now. The frozen yearly census snapshot waits for the board to answer the questions under Still open. Phase 2's "done when" test follows when the board says how to run it.
- **To try on the test copy** (steps in the README): every amount up to L 999,999,999.99 (PR #53), Quién debe listing every house that owes (PR #54), the month close (PR #55), Resumen del mes (PR #56), the way back (PR #57), the census list (PR #58), the monthly statement (PR #59), and Estado de cuenta and Recibo leaving nothing in Historial (PR #60). The owner tried Verificación del censo (PR #62) and Historial del año (PR #63) on 25 November. The Permisos screen, built on 25 November, is also to be tried.
- **In this plan, but in no phase's list, and not built:** the Reportes screen, the rest of Configuración (categories, village and board profile, month close rules, system status, and the guest invitation rules, which wait with guest invitations), text size, and a change of a house's owner.
- **Before real use:** receipt photos stay on the computer, beside the database file, and are not in the nightly backup, so they must go to the bucket or into the backup before real expenses are entered on the droplet. The weekly second backup copy outside DigitalOcean is not built.
- **Still open for the board:** how to run Phase 2's "done when" test, and the data-separation check on the droplet before the first deployment. For the frozen yearly census snapshot, which is not built: (1) whether a board member freezes it once the December list is done, or the app freezes it by itself on 31 December; (2) whether it can be frozen while houses are still not verified, and if so whether the snapshot marks them; (3) whether the municipality's copy carries full ID numbers and phones (the plan gives the municipality full ID numbers), and who on the board may open it whole; (4) whether a mistake found after freezing is put right by a corrected snapshot for the same year that keeps the first one, or not at all.
- **How work goes:** one branch and one pull request per piece, tried on the test copy at prueba-agua.basculacentral.com before merging. This file is updated in the same pull request.

Needs people, not code:

- [ ] Phase 1's "done when" test: the secretary types in ten made-up paper forms on the test copy, without help. Postponed by the owner on 6 November until most of the app is built.
- [x] The board decides how the treasurer enters what each house already owes. Decided on 6 November: month by month.
- [ ] The board decides how to run Phase 2's "done when" test (see Still open).

Phase 2 pieces in suggested build order. Each is one pull request, tried on the test copy before it is merged:

- [x] Fees in Configuración: base monthly fee, late fee (mora) and reconnection fee, each with a start date. The census then shows the base price's amount.
- [x] Monthly fee payments: household, the months the treasurer selects, amount, payment method and paper receipt number, with a reference for a bank transfer. This includes partial payments and paying ahead. A repeated receipt number is flagged, not blocked. Merged in PR #24 on 6 November 2026.
- [x] Removing a fee amount ("Quitar") until a payment covers its month, with a written reason (decided 6 November). Merged in PR #25 on 6 November 2026.
- [x] Every role gets every permission, and a month close still takes two different people (decided 6 November). Merged in PR #26 on 6 November 2026.
- [x] Corrections: a reversal entry that points to the original and needs a written reason. Merged in PR #27 on 7 November 2026.
- [x] Past fee changes in Configuración: a fee can take a change that starts in a past month, so the fees of the years in the paper book can be entered, unless a payment falls in the months it would cover (decided 12 November). Merged in PR #30 on 13 November 2026.
- [x] What each house owes: every month not paid in full from its first entered payment (or the month it was registered, if earlier) once its payment deadline and grace days in Configuración are over, with its history typed in through Cobrar (decided 13 November, replacing the start month of 7 November). Merged in PR #33 on 13 November 2026.
- [x] Other income: late fee, reconnection fee, connection fee, donation and other. Merged in PR #36 and PR #37 on 14 November 2026.
- [x] Month-end late fees and the arrears list: active, connected households with unpaid months and the late fee owed for each. Merged in PR #38 on 14 November 2026.
- [x] A status history for each house: a month is charged only if the house was active and had water on its deadline day (decided 14 November). Merged in PR #40 on 15 November 2026.
- [x] Expenses: category, supplier, amount and receipt photo. Photos stay on the computer until the bucket is connected. With no paper, "No hay recibo" and a written reason; how it was paid; an optional invoice number (decided 15 November). Merged in PR #41 on 15 November 2026.
- [x] Opening balance, entered once: cash and bank at the start of the month the app's money begins, with "Otro" on its own line (decided 17 November). The phase table does not name it, but Phase 2's test compares balances. Merged in PR #45 on 19 November 2026.
- [x] Household statements: what a house paid from a month the treasurer chooses and what it owes today, as a picture with a document number, shared from the phone, and as text for the family's WhatsApp chat (decided 15 November). Merged in PR #42 on 15 November 2026.
- [x] Digital receipts on request, with "Compartir por WhatsApp": a payment or other-income entry as a picture to send, sharing the document count (receipts cover other income too, decided 16 November). Merged in PR #43 on 17 November 2026.
- [x] "Quién debe" lists every house that owes, whatever its status today (decided 19 November). Merged in PR #54 on 19 November 2026.
- [x] Month close: "Preparar cierre" with the cash counted, then "Aprobar cierre" or "Devolver" by another person (decided 19 November). Merged in PR #55 on 19 November 2026.

Phase 3 pieces in suggested build order (proposed on 19 November 2026; the board may reorder them). Each is one pull request, tried on the test copy before it is merged:

- [x] Month close with approval: built with Phase 2 and merged in PR #55 on 19 November 2026.
- [x] Monthly breakdown on the screen, "Resumen del mes": for any month, the money at its start and end, what came in and from whom, what was spent and on what, and the month's fee: who was charged, who paid and who still owes. Asked for by the owner on 19 November 2026. Merged in PR #56 on 20 November 2026.
- [x] The monthly statement as a document: the same breakdown as a picture with a document number, to share or save, or as text to send by WhatsApp. Merged in PR #59 on 24 November 2026.
- [x] The census list, filtered by sector and status: printed, or saved as a CSV file. Merged in PR #58 on 24 November 2026.
- [x] The December list of houses not yet verified that year, "Verificación del censo", and "Datos revisados" on a house's file to verify it. Merged in PR #62 on 25 November 2026.
- [ ] The yearly census snapshot for the municipality, frozen at year end. Not built; waits for the board's answers under Still open.
- [x] The history log extract, "Historial del año", for the fiscal and the president: a year of the log, printed or saved for Excel. Merged in PR #63 on 25 November 2026.
- [ ] Temporary guest invitations, and the print layout every printout shares: date and time, who made it and its document number. The logo is left out for now (24 November 2026). Set aside for now (25 November 2026). Each printout already shows who made it and its document number, and all but the digital receipt also show when it was made.

**Decisions made on 23 October 2026**

- The number of households is not known yet; the census will establish it.
- The board decides the fees. Configuration holds the base monthly fee (for example L 70), and the census asks whether a family uses the base price or a different amount, with the reason.
- The yearly price is the monthly price times 12, and a house can always pay months in advance.
- A month's fee is due by its last calendar day. A month not paid in full by then gets a late fee (mora) for that month. The late fee and the reconnection fee are set in Configuration and can change every year.
- The board roles are president, vice-president, secretary, treasurer, fiscal, first board member and second board member, plus the technical administrator.
- There are no profiles for outside entities. Anyone from outside gets a temporary invitation with an email and password that lasts at most 24 hours and sets which screens and information they can see. The municipality gets full ID numbers this way.
- Paper receipts continue. The app records each paper receipt number and creates digital receipts on request.
- The current census exists on paper and will be typed in through a paper entry mode.
- There is one administrator for now, and a second one is not planned yet. Domain, hosting and repository stay in the builder's name during testing.

**Decisions made on 25 October 2026**

- A different monthly amount starts with the month after the house's last payment. Months already paid keep the price they were paid at. A house with no payment recorded yet, such as one being registered, starts with the month the amount is set.
- The gender choices are Mujer and Hombre, and the question can be skipped.
- The consent line on the review screen reads: "Al guardar, la familia acepta que la Junta de Agua guarde estos datos solo para el servicio de agua."
- A family can be registered without a phone, with "No tiene teléfono" or "Prefiere no darlo" (see Module 1).

**Decisions made on 29 October 2026**

- A payment goes to the month or months the treasurer selects when recording it, as written on the paper receipt. The app does not move money to the oldest unpaid month by itself.
- Before the first payment is recorded in the app, the treasurer enters what each house already owes, copied from the paper receipt book.
- If the paper book shows late fees already owed, the treasurer enters them separately from the unpaid monthly fees.
- The base monthly fee, the late fee (mora) and the reconnection fee are set in Configuración. The board can raise or lower them at any time; a change starts from its date and never rewrites months already charged or paid.
- Phone testing runs against the builder's computer over Tailscale (dropped on 30 October). GitHub Codespaces were tried and set aside as too slow.
- The database is SQLite, one file like Lindero's and the weight station's, instead of PostgreSQL. The rules PostgreSQL's two logins enforced (nothing deleted, history never changed) are kept by the database file itself.
- A test copy of the app will run on the droplet, at its own address and with made-up data only, so a change can be tried from a phone before it is merged. It is built after the switch to SQLite.

**Decisions made on 30 October 2026**

- Tailscale is dropped: it reaches the builder's computer only while that computer is on, so a phone away from it cannot test anything. Phone checks move to the droplet's test copy (29 October), which stays on.
- Pull request #7 (the Tailscale phone steps) is closed without merging.

**Decisions made on 2 November 2026**

- A change to a fee may start in the current month, not only the next one. Past months keep the price they were charged at.
- An amount typed wrong can be corrected with a written reason, until a payment recorded in the app covers one of its months.
- A fee amount can be zero, for a fee the board does not charge.
- Saving or correcting a fee amount asks for the PIN again (until 9 November, when the PIN was removed).

**Decisions made on 3 November 2026**

- The first amount of each fee may start in a past month, so what houses already owe from the paper book can be counted.

**Decisions made on 4 November 2026**

- On a phone, no screen brings up the keyboard by itself. It comes up when the person taps a field, so the screen can be read first.
- A phone number carries its country code, chosen beside the number. The list is Honduras (+504, the default), Estados Unidos y Canadá (+1), España (+34), México (+52), Guatemala (+502), El Salvador (+503), Nicaragua (+505), Costa Rica (+506) and Panamá (+507).
- Each country's length is checked: 8 digits for Honduras, Guatemala, El Salvador, Nicaragua and Costa Rica, 10 for Estados Unidos y Canadá and México, and 9 for España. Panamá takes 7 or 8, because its landlines have 7; the owner confirmed this on 6 November.
- Numbers already saved gain +504, since until now only Honduran numbers could be saved. Who may see a full number does not change: a masked number still shows only its last two digits, and not its country.

**Decisions made on 6 November 2026**

- The treasurer enters what each house already owes month by month, so each unpaid month can carry its own late fee.
- Panamá keeps 7 or 8 digits: its mobiles have 8 and its landlines 7.
- Phase 1's "done when" test with the secretary waits until most of the app is built.
- A payment's money fills the months the treasurer selects oldest first, so only the last one can be left partly paid.
- A payment larger than what the selected months owe is refused: the treasurer selects more months or fixes the amount. No money sits unassigned.
- A month keeps the price it had when its first money arrived. If the fee changes after a house paid part of a month, that month still costs the earlier price.
- Until a payment covers its month, a fee amount can be removed ("Quitar") with a written reason (and the PIN, until 9 November). It stays in the database, marked removed, and its months go back to the amount before it.
- Every role can do everything in the app, including accounts, guest invitations and the Permisos tab. The board does not always meet in full, and a task only one or two people could do would wait for them. Roles stay, so the history shows who did what.
- A month close still takes two different people: anyone prepares it, and someone else approves it.
- The administrator can record and correct money too.

**Decisions made on 7 November 2026**

- A payment recorded by mistake is corrected by reversing the whole payment ("Anular pago"). A wrong amount or month is reversed, then recorded again.
- A reversal is dated the day it is made and counts in that month's totals. The original stays in its own month.
- A payment can be reversed at any time, even after its month is closed.
- A reversal is final and cannot itself be reversed. If the wrong payment was reversed, it is recorded again.
- The app takes over from the paper book at one start month, the same for every house, set in Configuración. From that month on, every month counts as owed until it is paid. The month itself is still to be chosen. Replaced on 13 November: there is no start month (see below).
- Before the start month, a house owes only the months the treasurer enters from the paper book: a month grid, as in Cobrar, where each unpaid month is tapped. Each costs the fee in Configuración for that month, or the house's different amount. Replaced on 13 November: nothing is entered by hand; unpaid months count from each family's first payment (see below).
- A late fee (mora) for an old month is charged only where the paper book shows one: the treasurer ticks it beside that month, and its amount is the late fee in Configuración for that month. How late fees apply under the 13 November rule is still open (see Still open).

**Decisions made on 9 November 2026**

- The invitation link and the 6-digit PIN are removed: they were too much for the board's older members. A board member signs in with their WhatsApp number and a password.
- An administrator creates each account with a password and gives it to the person. The app offers one that is easy to read aloud; any of at least 6 letters or numbers can be typed instead.
- A phone stays signed in until "Salir", or for 90 days without use.
- No action asks for the PIN or the password again. Quitar and Anular pago keep their written reason, and a month close still takes two different people.
- No account locks after wrong passwords; sign-in attempts are limited per minute instead. Changing a password signs every phone of that account out, which is also what to do when a phone is lost.
- Guest invitations for outsiders (Phase 3) do not change: they were planned with an email and a temporary password, not a link.
- The history log keeps changes, not visits. Signing in and wrong passwords leave no entry: each account keeps only its last sign-in, replaced each time, and a wrong password is noted only in the server's own log, so nobody outside can fill the history log by guessing.
- New history entries no longer save the phone's description. Entries already saved keep theirs, because the history log is never changed.

**Decisions made on 12 November 2026**

- A fee in Configuración can also take an earlier change that starts in a past month, so the fees of the years in the paper book can be entered. It is refused once a payment or an entered old month falls in the months it would cover, so nothing already counted is rewritten. Since 13 November no old months are entered by hand, so only payments count.
- A house with a different amount owes that amount for its old unpaid months too, even for months before the amount was entered in the app. Set aside for now on 13 November.

**Decisions made on 13 November 2026**

- There is no start month (it replaces the decision of 7 November). Each family's history is typed in through Cobrar, each payment with its own date and months, at the fees in Configuración for those months. Families can start from different dates.
- A family owes every month not paid in full from its first entered payment on, up to the current month. A skipped month stays owed after a later month is paid.
- A family with no payment entered yet owes from the month it was registered in the census. Once its history is typed in, its first entered payment decides, if it is earlier.
- A month counts as owed only once its payment deadline is over: a day of the month by which it is paid (for example the 25th) plus a number of grace days, both set in Configuración by whoever may change the settings. Until they are set, the last day of the month with no grace. After that the household shows "Debe el mes de …" or "Debe los meses de …".
- Late fees for the months a family owes from before the app are charged only where the paper book shows one.
- For now, a house's different amount does not price months before it started (the 12 November decision is set aside): an old receipt at the old full price must still be accepted.

**Decisions made on 15 November 2026**

- The photo of an expense's receipt or invoice is asked for every time. An expense with no paper, such as a day's work paid by hand, is saved only with "No hay recibo" and a written reason. It shows as "Sin foto" so it can be reviewed.
- Gasto asks how the expense was paid (Efectivo, Transferencia, Otro), as Cobrar and Otro ingreso do. A transfer needs its reference number.
- The number on the supplier's invoice or receipt is optional. The same number from the same supplier is flagged, not blocked.

- A household statement (estado de cuenta) is a picture the app draws, with the board's name, the date and time, who made it and a document number. The treasurer shares it through the phone's own Share button. A second button opens the family's WhatsApp chat with the same statement as text.
- The treasurer chooses the month a statement's payments start from, January of the current year to begin with. What the house owes today is always shown in full.
- A digital receipt is made for a monthly fee payment or for any other income (a late fee, a reconnection, a connection, a donation, other), on request. One running count numbers every document the app hands out, so statements and receipts share it. An expense has no resident receipt, and a payment that was undone has none.

**Decisions made on 17 November 2026**

- The digital receipt of PR #43 is enough for the first version.
- The opening balance is two figures: the cash in the box (caja) and the money in the bank (banco). Month close compares the cash counted with the cash figure only; the bank is checked against its statement. An entry paid by "Otro" counts on its own line, "Otro", shown only when there is one, so it is never mixed into the cash that is counted.
- The opening balance is the money on hand at the start of a month the board chooses, when the app's money begins. Entries dated before that month count only for what each house owes and for statements, never in the money totals.
- A wrong opening balance is corrected with a new entry that points to the old one and gives a written reason, until the first month is closed. After that it is locked.
- No separate approval: the first month close shows the opening balance, and that close already needs a second person to approve it.

**Decisions made on 19 November 2026**

- Inicio shows the buttons for the user's role first, then "Otras tareas", and last "Administración": Usuarios, Permisos and Configuración. This is the same for every role, because those screens are seldom needed and the day's work should be quick to find.
- Cobrar opens on every family in the census, listed by name, to scroll through or search. After tapping a family it asks what is being paid: Cuota mensual, Mora, Reconexión, Conexión, Donación or Otro ingreso. A monthly fee then asks for the months, the others for the month (a late fee) and the amount. "Quién debe" stays on Cobrar.
- "Otro ingreso" is no longer on Cobrar. Money from someone outside the census (a donation, a connection fee before the family is registered) is recorded from its own button on Inicio, which also lists the latest entries so one can be undone with "Anular".
- The ID number and the references are optional in Registrar familia. A family may not want to share its ID, and whoever registers may not type quickly or write well enough to be understood. The president, not the app, asks for them where the board needs them. An ID that is typed still needs 13 digits and belongs to one person, and it can be added later from the household file.
- A family registered without an ID is checked by name instead: the app compares the first name and last name with the families already registered, warns about similar ones, and lets the registrar save anyway when they say it is a different family. It ignores accents, capital letters and one wrong letter in a long word. Two names are alike when the first names match and the last word of the shorter name is in the longer one, so "Juan Pérez" finds "Juan Carlos Pérez López" but not "Juan Martínez". It was built in PR #49, merged on 19 November 2026, and the owner tried it on the test copy and found it good.
- The owner tried the status history (PR #40) and the name check (PR #49) on the test copy and found both good.
- Every amount field takes up to L 999,999,999.99: a payment, other income, an expense, a fee in Configuración, a family's different amount and the opening balance. Nobody knows how much the board's money will one day be. Built in PR #53.
- "Quién debe" lists every house that owes money, whatever its status today. A house that is inactive or without connection now still appears, marked as such, with the months it owes from when it was active with water. This replaces the 14 November rule that listed only active, connected houses.
- A month can be prepared for closing ("Preparar cierre") once it is over, oldest first, starting with the opening balance's month. A month with no entries is closed too, so no month is skipped.
- Only the cash is counted at month close. If it differs from the app's figure, a written reason is needed; the month shows the difference as "Faltante de caja" or "Sobrante de caja", and the next month starts from the cash counted. The bank is checked against its statement by eye.
- Anyone on the board may prepare a close, approve it ("Aprobar cierre") or send it back ("Devolver") with a written reason, the person who prepared it too. The one rule is that whoever prepared a month cannot also approve it. A month sent back opens again, to be fixed and prepared again. Entries dated in a month waiting for approval are refused, as in a closed one.

**Decisions made on 24 November 2026**

- Printing is not logged. The board will not audit who printed what, so the census list, the monthly statement, "Estado de cuenta" and "Recibo digital" leave nothing in Historial, and a new report does not either. The last two did until that day; the entries already made stay.
- The monthly statement names the houses that still owe something of the month, each with its owner's name, what it owes and its code. It never carries an ID number or a phone. It is sent on by WhatsApp, so whoever receives it reads those names.
- The census list's columns are: code, name, relation, identity, phone, sector, references, water connection, status (with the reason when inactive), paper form number and last-verified date.
- The census list writes phone numbers without the "+".
- Printouts leave the board's logo out for now.

**Decisions made on 25 November 2026**

- The history log extract carries each entry's date and time, who made it and their role, what happened and the reason. It does not carry what "Ver detalle" shows, the values before and after, because they include families' ID numbers and phones and the file can be sent on to anyone. Those stay in the app and its backups.
- Temporary guest invitations and the print layout every printout shares are set aside for now; they may be taken up again later. Until then the municipality has no sign-in of its own.
- Phase 4 (handover) is set aside for now, because the owner is fully involved in the project. The restore tried before launch stays in the plan, under Backups and Phase 0.
- The first version records expenses.
- The real app's address will be a subdomain of basculacentral.com. The name is not chosen yet.
- A permission turns off together with the one it needs, on the Permisos screen and in the server (see "Roles and permissions"), so that "off" really means hidden and no button leads nowhere. Until then the server would still print finances for a role without "Ver finanzas"; no role had lost it.
- Nobody can change the permissions of their own role, even with "Editar los permisos".
- For now every role has the same features and permissions, so the role shown for each person changes nothing in what they can do. The administrator can set what each role may or may not do.

**Still open**

- [ ] Check the data separation on the droplet (own database file and system user, storage key and backup for each app) before the first deployment. This has not been done yet and will be updated later.
- [x] How the treasurer enters what each house already owes: month by month (so each unpaid month can carry its own late fee), or one total per house. Decided on 6 November: month by month.
- [ ] How to run Phase 2's "done when" test: it compares a real month with the real paper receipt book, but the test copy takes only made-up data. The options are a made-up receipt book on the test copy, or a real month after the real app is deployed.
- [x] How late fees apply to the months a family owes from before the app (13 November rule): one for every month not paid in full by its last day (Module 2), or only where the paper book shows one (7 November). Decided on 13 November: only where the paper book shows one.
