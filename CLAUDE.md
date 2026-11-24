# Working on Junta de Agua Zoilabe

## Who you are working with

The owner is new to programming and often works from a phone. They
can paste commands into the droplet console but cannot easily copy text out of
it; they share screenshots instead. Never ask for secrets in the chat.

The same owner maintains Lindero (`Elvis-techh/land-management`) and Báscula
Central (`Elvis-techh/weight_software`). This app deliberately uses Lindero's
stack and conventions so one person can look after all three; when in doubt
about how something is done here, look at how Lindero does it.

## The specification

[docs/app-plan.md](docs/app-plan.md) is a snapshot of the board's App Plan.
Build what it says. Anything that decides how money is counted (fees, late
fees, what is owed, month close) or who may see what is the board's decision,
never Claude's: lay out the options and the trade-off, then wait.

The rules that must never be broken:

- **Nothing is deleted.** Records are deactivated with a reason; money
  mistakes are fixed with a reversal entry that points to the original.
- **The server decides.** Every route checks its permission code. Hiding a
  button is a convenience, not security. ID numbers and phones are masked by
  the server.
- **Every change is logged** in `audit_log`, in the same database transaction
  as the change itself.
- **Money is whole centavos** (integers), shown as lempiras (L).
- **Time is stored in UTC** and shown in Honduras time (UTC-6).
- Screen text is Spanish in the village's own words ("Registrar familia",
  not "Crear registro"); code, comments and commit messages are English.

## Database

SQLite, one file (`backend/data/zoilabe.db`, or `DATABASE_PATH`), opened with
`better-sqlite3` through Drizzle, as in Lindero. Decided 29 October 2026:
the droplet already runs two SQLite apps, and a PostgreSQL server would be
one more thing to run and back up there.

- **Nothing is deleted, and history never changes, in the file itself.**
  `applyGuards` (`backend/src/db/guards.ts`) gives every table a trigger that
  refuses DELETE, and `audit_log`, `transactions`, `payment_months`,
  `household_status_changes` and `documents` one that refuses UPDATE. It runs after every
  migration and on every start, so
  a new table is guarded without a line there (an append-only one is added
  to `APPEND_ONLY_TABLES`). `createDb` switches on `recursive_triggers`,
  so `INSERT OR REPLACE` and `UPDATE OR REPLACE` (which delete the row in
  their way) are refused too; never switch it off. No code may drop a
  trigger; a migration that must change rows of those tables is a
  decision for the owner first.
- **A house's status and water connection change only through
  `recordStatus`** (`backend/src/lib/householdStatus.ts`), which adds a dated
  entry to its history and updates `households` in the same transaction.
  What a house owes, and its late fees, read that history, not today's
  status.
- **Every write runs in `inTransaction`** (`backend/src/db/client.ts`): a
  synchronous IMMEDIATE transaction, so inside it every query ends in
  `.get()`, `.all()` or `.run()`, never `await`. That is what keeps the
  history log chain and household codes in single file, with no locks of our
  own. Slow work (hashing a password, reading a file) happens before it starts.
- **Instants are ISO-8601 UTC text, read back as `Date`** (the `instant`
  column type in `schema.ts`); calendar dates are `"YYYY-MM-DD"` text; JSON is
  text. Compare instants with a `Date` (`gt(col, new Date())`), never `now()`.
- **Phones are stored whole**, as `+50499998888`, on accounts and on people.
  The countries and their lengths are in `backend/src/lib/phone.ts` and again
  in `frontend/src/phone.ts`, because a phone with no signal checks a number by
  itself; a test fails if the two differ. Adding a country means both files and
  no migration. A masked phone is always `••••••` and its last two digits, so
  its length does not give the country away.
- **Text comparisons that must understand Spanish** happen in JavaScript or
  through `search_text()`. SQLite's `lower()` and `LIKE` only know A to Z.
- **Every document the app hands out takes its number from `documents`**
  (a statement, a receipt, the month's statement and the census list today; more reports later): one row per document.
  **None of them writes a history entry, and a new report does not
  either**: the owner decided on 24 November 2026 that the board will not
  audit who printed what, so printing leaves nothing in Historial (a
  statement and a receipt did, under "exports", until then; those old
  entries stay). The row keeps what it was made for and who made it, not its
  contents. Looking
  at something on the screen is not a document; sending, saving or printing
  it is.
- **Receipt photos are files, not rows.** `backend/src/lib/receiptPhotos.ts`
  writes each one into the `receipts` folder beside the database file (inside
  the one folder the API may write on the droplet) before the transaction
  starts, and `receipt_files` points to it by the name it will have in the
  bucket. A photo is served only by the API, to someone with `finance:view`.
  The phone shrinks it first (`frontend/src/photo.ts`): a request must stay
  under Nginx's 1 MB, so never send a photo as it comes from the camera, and
  never raise that limit on the droplet for it.
- **Who can open the file** is the operating system's job: the `zoilabe` user
  alone (docs/deployment-shared-droplet.md, separation checklist).
- **Keep a move to PostgreSQL possible.** `docs/postgres-readiness.md` lists
  every SQLite-only piece and every place that relies on one write at a
  time. A change that adds either (a raw SQL function, a number handed out
  in order, a read-then-write) adds its row there in the same pull request.

Every schema change is a new migration under `backend/drizzle/`, generated
with `npm run db:generate --workspace @zoilabe/backend` from
`backend/src/db/schema.ts`. The API applies pending migrations when it
starts (`runMigrations`, `backend/src/db/migrations.ts`). Never edit a
migration that is already on `main`. (The switch to SQLite replaced the two
PostgreSQL migrations with a new `0000_init.sql` once, before any real data
existed.)

Locally there is nothing to install or start: `npm run db:migrate` creates
the file. Tests make their own database in memory.

## Fixing things, one at a time

1. **One change per branch, started from the latest `main`**, named after its
   purpose, e.g. `feat/census-paper-mode` or `fix/login-attempt-limit`.
2. **Prove it before merging.** A test that fails without the change and
   passes with it, plus `npm run typecheck` and `npm test`.
3. **One pull request per change.** The description says what was wrong or
   missing, what changed, how it was checked, and what the owner should look
   at. It is the permanent record of why the change exists.
4. **Keep the docs current, in the same pull request.** The owner asked for
   this standing rule: every fix or feature updates `README.md` (how to run,
   test and use what changed, and its Status section), and this file when it
   changes how work is done here. A pull request whose docs are out of date
   is not finished.
5. **If something broke, revert the pull request** with GitHub's Revert
   button. Never rewrite `main`'s history.

## Screens on a phone

Someone who has only used WhatsApp will not scroll to look for an answer, or
close the keyboard to look for a button. When a screen is built or changed:

- **Every screen opens with its way back**, top left, always `BackButton`
  (never a hand-made button). It goes to **the screen the person came from**
  and is named after it ("‹ Quién debe"), because the Shell writes the screen
  being left into each history entry (`markFrom`, `previousOf`, `labelOf` in
  `src/home.ts`); the `label` and `onClick` a screen gives are only for when
  it was opened with nothing before it (a reload, a link). A new screen needs
  a name in `labelOf`. A step of a form has "‹ Atrás" instead, and its
  first step the way out. Nobody should need the phone's own back button.
- **The button that goes on** is `.btn.go` or `.btn.primary`, directly inside the
  `.screen`, `.dialog` or `.card` (or in a `.row` there), so `src/viewport.ts`
  and `styles.css` can keep it above the keyboard on a form's last field.
- **"Hay más abajo"** (`MoreBelow`) is already on every screen and dialog, and
  measures for itself. Do not add another, and do not rely on it to excuse a
  screen that could simply fit: put short answers side by side first.
- **A document is drawn from lines** (`frontend/src/statement.ts`): the
  screen, the picture (`statementImage.ts`) and the WhatsApp text all read
  the same list, so they cannot say different things. No PDF library.
- **A photo is taken through the two hidden file inputs of Gasto's photo
  screen** (camera, or one already on the phone) and `shrinkPhoto`.
- **Money is typed through `AmountInput`**, months and dates through `MonthField`
  and `DateField`. A dialog is always `Dialog`, which holds the screen behind it.
- **Look at it** at phone size with the height cut to about 380 px, which is
  roughly what a keyboard leaves, and press the buttons by touch. A layout that
  moves while a button is being pressed loses the press.

## Checks before pushing

`npm run typecheck` and `npm test` from the repository root. The **Tests** workflow
(`.github/workflows/tests.yml`) runs them, plus a build, on every pull
request; do not merge one whose check is red. The owner also runs them on
a Windows computer, which GitHub does not: a test that reads files finds them
with `fileURLToPath`, never a URL's `.pathname`, and does not assume a line
ends in `\n` alone (Git for Windows checks files out with `\r\n`).

The **Test copy** workflow (`.github/workflows/test-copy.yml`) puts every
pull request on the droplet's test copy (docs/test-copy.md), where the
owner tries it from a phone, so each pull request's description says what
to try there. Only made-up data goes on the test copy. `npm run db:demo` (`backend/src/lib/demoData.ts`, docs/test-copy.md) fills an empty
database with three months of it; when a feature adds something a screen shows,
add it there too. The droplet runs the
scripts in `deploy/test-copy/` as root, from `main` only, and never builds;
keep it that way. The owner's steps for trying each change and starting each
phase are in that page; work the same way.

Claude's only way onto the droplet is the locked key: `ssh lindero-ops status`
or `nginx` (Lindero's `docs/claude-ops-key.md`) read the health of Lindero and
Báscula Central and Lindero's nginx site, and nothing else. It cannot see the
test copy's files or change anything for this app (from outside,
`curl https://prueba-agua.basculacentral.com/version.json` shows which build
runs), so droplet steps are the owner's,
pasted into the console, and must be safe to paste: the droplet has nginx 1.24,
and a site `nginx -t` refuses must never stay in `sites-enabled`, because nginx
then does not start after the next restart, and every app's site is down.

Do not run a code formatter over whole files. Edit by hand, in the
surrounding style.
