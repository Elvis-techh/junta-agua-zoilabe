> Snapshot of the Claude Docs doc **"Zoilabe Water Board System: App Plan"**
> (https://claude.ai/artifact/NU7ygpQf7xeaRihKjqFsvf), revision 77, taken 2026-10-25.
> The doc is the source of truth; update this copy when the doc changes.

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

Eight roles cover the technical administrator and the board, and each user holds exactly one role.

- **Administrador**: technical administrator. Manages the system and users, and cannot see or touch money records in the app.
- **Presidente**: runs the board, approves each month close and manages users.
- **Vicepresidente/a**: acts when the president is away and has every permission the president has. Wherever this plan says president, the vice-president can act too.
- **Secretario/a**: keeps the census.
- **Tesorero/a**: records all income and expenses and prepares each month close.
- **Fiscal**: audits. Reads everything, changes nothing.
- **Primer vocal and Segundo vocal** (first and second board member): see the census and finances and change nothing.

| Action | Admin | President | Vice-president | Secretary | Treasurer | Fiscal | Board members |
|---|---|---|---|---|---|---|---|
| View census list and household files | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| See full ID number and phone | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Register and edit census records | Yes | Yes | Yes | Yes | No | No | No |
| Deactivate a census record (reason required) | Yes | Yes | Yes | Yes | No | No | No |
| Set a different fee for a house (reason required) | No | Yes | Yes | At registration | Yes | No | No |
| Record payments and expenses | No | No | No | No | Yes | No | No |
| Correct a money entry (reversal, reason required) | No | No | No | No | Yes | No | No |
| Close a month | No | Approves | Approves | No | Prepares | No | No |
| View finances | No | Yes | Yes | No | Yes | Yes | Yes |
| Manage users | Yes | Yes | Yes | No | No | No | No |
| Create and revoke guest invitations | Yes | Yes | Yes | No | No | No | No |
| Edit role permissions | Yes | View | View | No | No | No | No |
| Change settings (fees, late fee, reconnection fee, sectors, categories) | Yes | Yes | Yes | No | No | No | No |
| View the history log | Yes | Yes | Yes | No | No | Yes | No |
| Print and export | All | All | All | Census | Finances | All | Census and finances |

Five rules sit behind the matrix:

- **Separation of duties.** The person who records money cannot approve the month close, and nobody can change their own role.
- **Permissions are data.** The Permisos tab edits the matrix without new code, and every change is written to the history log.
- **The server decides.** Permissions are checked on every request. Hiding a button is a convenience, not security.
- **Board defaults.** The vice-president holds the president's permissions so the board can work when the president is away. The first and second board members can view but not change anything. The administrator can adjust any of this in the Permisos tab.
- **Guests are not roles.** People outside the board, such as municipal staff, get a temporary invitation with its own view-only permissions (see Module 3).

## Module 1: Census

The census registers each household once, links it to its owner, and collects every answer on its own screen.

It keeps every column of the Registros sheet template and adds the fields needed to charge fees and to find a house.

| Field | Type | Rule |
|---|---|---|
| Household code | Automatic | Format Z-0001, sequential, never reused |
| Paper date and form number | Date, text | Paper entry only: the date written on the paper form and its number, if it has one |
| Full name | Text | Required; capitalized automatically |
| Identity (ID number) | 13 digits | Required; checked against existing people before saving |
| Phone / WhatsApp | 8 digits | Required for the owner, unless the family has none or prefers not to give it; that reason is kept instead |
| Gender | Choice | List kept in Configuration |
| Sector | Choice | Required; list kept in Configuration |
| References | Text | Required; how to find the house |
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
2. Identity number, with a numeric keypad.
3. Phone number.
4. Gender.
5. Sector.
6. References, with an optional button to save the GPS pin.
7. Fee: the base price, or a different amount with the reason.
8. Relation to the house and water connection.
9. Review screen: "¿Está correcto?" with one large green button.
10. Saved screen: shows the household code and a "Compartir por WhatsApp" button.

**Rules**

- **Duplicates.** If the ID already exists, the app opens that person's file instead of creating a new one. One person can own several households, so it offers "Agregar otra vivienda".
- **Offline.** An entry is saved on the phone first and sent when signal returns. A visible counter shows how many entries are waiting.
- **No deletion.** A record is made inactive with a reason: moved away, duplicate or entered by mistake.
- **Ownership changes.** The old owner's period closes and the new owner starts on a stated date, so past payments stay with the person who made them.
- **Yearly verification.** Each household has a last-verified date. In December the app lists houses not verified that year, then freezes a census snapshot for the municipality.
- **Paper entry mode.** The current census exists only on paper. In this mode the first screen asks for the date and number on the paper form, and both are stored beside the date typed in, so every record can be checked against its paper original. The paper forms are kept after entry.
- **Fee choice.** The default is the base price. A different amount cannot be saved without a reason, and every such choice shows in the history log.
- **No phone.** A family with no phone, or that prefers not to give it, is registered with "No tiene teléfono" or "Prefiere no darlo" instead of a number, and that reason is kept. The app then offers no WhatsApp message for that house: the household code is written down for the family, and receipts and statements are given on paper. A number can be added later from the household file.
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
2. At month end the treasurer taps "Preparar cierre". The app shows opening balance, income, expenses and closing balance, and asks for the cash actually counted.
3. The president reviews the figures and any cash difference, then taps "Aprobar cierre".
4. The month locks. Nothing in it can be added or changed; a late item goes into the next month with a note.
5. The fiscal reviews the closed month and a guest sees the summary if their invitation allows it.

**Rules**

- **Paper receipts stay.** Residents keep receiving the paper receipt. The app stores its number so the receipt book and the app can be reconciled, and it creates a digital receipt only on request.
- **Base fee and different amounts.** The board decides how it charges. Configuration holds the base monthly fee, for example L 70, and the board can change it at any time. Each house uses the base price or a different monthly amount. A different amount is entered with its reason when the family is registered, and any later change needs a reason too. A new amount takes effect from a stated date and never rewrites past months.
- **Paying ahead.** A house can always pay months in advance or the whole year. The yearly price is the house's monthly price times 12, so there is no separate yearly price to maintain. A month that is already paid stays paid if the fee changes later.
- **Month-end deadline and late fee (mora).** A month's fee is due by the last day of that month. The app works that date out from the calendar, so months ending on the 28th, 29th, 30th or 31st, and leap years, are all handled. Partial payments are accepted, but a month counts as paid only when the full fee has arrived by its last day. Each month not paid in full on time gets its own late fee.
- **Late fee and reconnection fee amounts.** Both are set in Configuration with a start date and can change every year. When the treasurer records one, the amount is filled in from Configuration, and changing it needs a reason.
- **Corrections.** A reversal entry points to the original and needs a written reason. Both stay visible.
- **Arrears.** The app lists active, connected households with unpaid months and the late fee owed for each, calculated from the census, each house's fee and the last day of each month.
- **Whole numbers.** Money is stored in whole centavos so totals never drift from rounding.
- **Opening balance.** The treasurer enters it once at launch. It appears in the history log like any other entry.
- **Receipt photos.** Photos of expense receipts are kept in a private storage bucket and opened through short-lived links.

## Module 3: Users and access

Every person gets a personal account with one role and a login that works for someone who only uses WhatsApp.

Each account holds a name, WhatsApp number, role, status, who created it and when, and last login.

**How a director signs in**

1. An administrator creates the account and taps "Enviar invitación". The app prepares a WhatsApp message with a personal link, valid for 48 hours and usable once.
2. The person opens the link on their own phone, chooses a 6-digit PIN and adds the app to the home screen. The phone is remembered.
3. From then on they open the app and type the PIN. A 6-digit PIN matches the WhatsApp verification codes they already know.
4. Closing a month, correcting an entry and changing a role ask for the PIN again.
5. After 5 wrong PINs the account locks. An administrator unlocks it after confirming the person by phone call.
6. If a phone is lost, an administrator removes that device in one tap and sends a new invitation.

**Guest invitations** give an outsider, such as municipal staff, temporary view-only access without an account.

1. The administrator, president or vice-president taps "Invitar" and enters the guest's name and email.
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
- **Visible tabs follow the role.** A user sees only the tabs and buttons their role permits.
- **Guests are temporary and view-only.** A guest never sees the history log, users or settings, and an expired or revoked invitation ends the session at once.
- **Guest passwords** are generated by the app, shown once and stored only as a fingerprint.
- **Remembered phones expire** after 90 days without use.
- **Every account event** (create, role change, suspend, PIN reset, device removed) and every guest invitation created, used, revoked or expired is written to the history log.

## Module 4: History log

Every creation, change, approval and failed login is written to a log that nobody, including administrators, can edit or delete.

Each entry records who acted (name and role), when (date and time in Honduras time), what they did in plain words, which record it touched, the values before and after, the reason when one is required, and the device used.

| Area | Events recorded |
|---|---|
| Census | Household registered, field edited, record deactivated or reactivated, ownership changed, yearly snapshot created |
| Finances | Payment or expense recorded, reversal made, month prepared, month approved, opening balance entered |
| Users | Account created, role changed, suspended, PIN reset, device removed, guest invitation created, used, revoked or expired |
| Settings | Base fee, late fee or reconnection fee changed, different fee set for a house, category added, permission matrix edited |
| Security | Login, failed PIN, account locked |
| Exports | Report printed or exported, with the filters used |

Page views are not logged. Exports are, because they are how data leaves the system.

**How it is protected**

- **Append-only.** The app's database login can add entries but cannot change or remove them.
- **Tamper-evident.** Each entry stores a fingerprint of the one before it, so an altered entry breaks the chain. A nightly check reports the result in Configuration.
- **Backed up.** The log is part of every nightly backup and is kept permanently.
- **Yearly extract.** A PDF and CSV of the year's log is saved for the board's records.

**How it is read**

- Entries read as plain sentences, for example "12 de marzo, 3:40 pm: Ana (Tesorera) registró un pago de L 150 de Juan Pérez".
- Filters cover date range, person, module and household code.
- "Ver detalle" opens the before and after values.
- The president, fiscal and administrators can open the log; other roles cannot.

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

Every printout carries the board's logo, the date and time, the name of the person who generated it and a document number. Every export is logged.

## Data model

Seventeen tables hold everything, and people are kept apart from households so one person can own several houses.

| Table | Holds | Links to |
|---|---|---|
| users | Accounts: name, phone, status, PIN fingerprint, last login | roles |
| roles | The eight roles: administrator, president, vice-president, secretary, treasurer, fiscal, first and second board member | none |
| role_permissions | Which permission codes each role holds | roles |
| access_tokens | Invitation links for new staff accounts and remembered devices | users |
| guest_invitations | Guest name, email, password fingerprint, the permission codes it grants, expiry time, revoked date, last sign-in | users |
| people | One row per person: full name, ID number (unique), phone, gender | none |
| households | Code, references, GPS pin, water connection, status, paper date and form number, submission ID (unique), last verified date | sectors |
| household_owners | Which person owns which household, with start and end dates | households, people |
| household_fees | A different amount for a house: monthly amount, reason, start and end dates | households |
| sectors | Sector names used in the census | none |
| fee_rates | Base monthly fee, late fee and reconnection fee, each with a start date | none |
| transactions | Every income and expense: amount in centavos, paper receipt number, months covered, pointer to the entry it reverses | categories, households, months, users |
| categories | Income and expense categories | none |
| receipt_files | Keys of receipt photos in the storage bucket | transactions |
| months | Month, status (open, prepared, closed), who prepared and approved, cash counted | users |
| audit_log | The history log, each entry chained to the one before | users |
| settings | Configuration values with their start dates | users |

**Rules for the builders**

- **Append-only tables.** The app's database login can add rows to transactions and audit_log but cannot update or delete them. A closed month is locked in the database as well as in the app.
- **Unique keys.** ID number on people and submission ID on households each allow one row only. A repeated paper receipt number is flagged for review, not blocked, because receipt books can restart their numbering.
- **Phone-made IDs.** Census entries get their ID on the phone, so a retry after weak signal cannot create a second record.
- **Time.** Timestamps are stored in UTC and shown in Honduras time (UTC-6).
- **Every row** records who created it and when. Edits copy the before and after values into audit_log in the same database transaction.
- **Migrations.** Every schema change is a versioned script in the repository and is tried on a copy of the data first.

## Screens and navigation

The home screen shows a few large buttons chosen by the user's role, and every task runs one question per screen.

| Tab | Contains | Visible to |
|---|---|---|
| Inicio | Large action buttons and alerts, such as a month waiting for approval | Everyone |
| Censo | Register, search, list, household file | Everyone; read-only except Secretary, President, Admin |
| Finanzas | Payments, expenses, month close, statements | President, Treasurer, Fiscal, Board members; guests see what their invitation allows |
| Reportes | Printable reports | Everyone, limited by role |
| Usuarios | Staff accounts and guest invitations | Admin, President |
| Permisos | The role-by-permission matrix | Admin edits, President views |
| Historial | The history log | Admin, President, Fiscal |
| Configuración | Settings and system status | Admin, President |

On a phone the bottom bar shows at most four items plus "Más".

| Role | Home buttons |
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

One installable web app, one API and one PostgreSQL database run on the shared droplet, while receipt photos and backups go to Spaces. Use the same stack as Lindero and the weight station so one person can maintain all three.

*(Diagram in the original doc: architecture · 1 droplet, 1 storage bucket, 1 offsite copy)*

Phones and municipal computers reach one API. Lindero and the weight station share the droplet but not the database.

### Architecture

- **Front end:** a progressive web app, installed from a WhatsApp link, that updates itself.
- **API:** one service behind Nginx on its own subdomain, served over HTTPS.
- **Database:** its own PostgreSQL database and login, separate from Lindero and the weight station.
- **Separation from the other apps:** each app has its own database login that cannot open the others' databases, its own containers and env file, its own subdomain, its own storage key and bucket (or folder), and its own nightly dump, so one app can be restored without touching the others. Check this list before the first deployment.
- **Files:** receipt photos and backups in a private Spaces bucket.
- **Capacity:** the current shared droplet is enough for version 1. Set DigitalOcean alerts at 80% memory and disk.

### Security

- HTTPS only. PINs are stored as salted hashes, logins are rate-limited and an account locks after 5 wrong PINs.
- The server checks permissions on every request. ID numbers and phones are masked by the server for roles and invitations without access, not just hidden on screen.
- Secrets live in environment variables, never in the repository.
- Receipt photos open only through short-lived links.
- Database access outside the app uses a separate credential held only by the technical administrators.
- The board and the municipality agree in writing who may see what, and that note is kept with the runbook.

### Backups

- A nightly encrypted database dump goes to the Spaces bucket. Keep 30 daily and 12 monthly copies.
- A weekly second copy leaves DigitalOcean for a board-owned Google Drive or another provider, so one account problem cannot take everything.
- DigitalOcean's weekly droplet backups stay on as a third layer.
- A restore is tried on a fresh droplet before launch and every three months. The date shows in Configuration.
- The yearly census snapshot goes to the municipality and to the board's archive.

### Continuity

- During testing, the domain, hosting and repository are in the builder's name. Before launch they move to the board's accounts: a DigitalOcean team with two owners, the domain, the code repository and the Spaces keys, with the builder as a member.
- A one-page runbook covers where the data lives, who pays for hosting, who to call, how to install the app on a new phone and how to restore.
- Recovery credentials are sealed in an envelope held by two board members, for example the president and the fiscal. It is the way back in if the builder is unavailable.
- A second technical contact completes one restore from the runbook.
- If the server is down, phones keep accepting census entries and show the last loaded data, then catch up when it returns.

## Build phases and open decisions

Five phases take the app from foundation to handover, and each ends with a test that a real director can pass.

| Phase | Delivers | Done when |
|---|---|---|
| 0. Foundation | Repository, subdomain, database, invitation and PIN login, role and permission engine, history log writer, nightly backup, data separation from the other two apps | Two users with different roles sign in, a change appears in the log, a backup restores on a test server, and this app's login cannot open the other apps' databases |
| 1. Census | Registration flow with the fee question, paper entry mode, duplicate check, search and list, household file, offline queue, inactive status | The secretary types in 10 paper forms from a phone without help and each record matches its paper original |
| 2. Finances | Base fee and different amounts, paying ahead, month-end late fees, reconnection fee, payments with paper receipt numbers, expenses, receipt photos, digital receipts on request, household statements, arrears list | One full month runs alongside the paper receipt book and the balances match |
| 3. Close, reports and guests | Month close with approval, monthly statement, yearly snapshot, temporary guest invitations, print layouts | A municipal official signs in with a guest invitation, opens and prints the census with full ID numbers, and the fiscal reviews a closed month |
| 4. Handover | Restore test, runbook, board-owned accounts, training at a directive meeting, install on every director's phone | A second person restores from the runbook and the board runs a month without the builder |

**Local first**

Phases 1 to 3 are built and tested on the builder's computer before anything changes on the droplet (decided 2026-10-24). Each change merges to `main` only once its tests pass, so the droplet work at the end is one deployment, not five. Checks that need a phone, such as Phase 1's ten paper forms, run on the same Wi-Fi as the computer.

| Phase | Status | Built and tested locally | Waits for the droplet |
|---|---|---|---|
| 0. Foundation | Merged | Invitation and PIN login, roles and permissions, history log, backup and restore scripts (merged in PR #1 on 2026-10-24) | Subdomain, the data-separation check, backups to the storage bucket, a restore on a test server |
| 1. Census | Merged | Everything, including paper entry mode and the offline queue | Nothing |
| 2. Finances | Next | Everything; receipt photos stay on the computer until the bucket is connected | Receipt photos in the storage bucket |
| 3. Close, reports and guests | Not started | Everything, including print layouts and guest invitations | A guest signing in from a municipal phone at the real address |
| 4. Handover | Not started | A first draft of the runbook | The restore test, board-owned accounts, training and installing on every director's phone |

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

**Still open**

- [ ] Check the data separation on the droplet (own database login, storage key and backup for each app) before the first deployment. This has not been done yet and will be updated later.

