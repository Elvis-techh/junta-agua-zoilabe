# Working on Junta de Agua Zoilabe

## Who you are working with

The owner is new to programming and often works from a phone. Explain git,
GitHub and deploy concepts (branch, commit, push, pull request, merge, build,
deploy) in plain language the first time they come up in a session, briefly
and without jargon, and say why a step is needed, not just what to type.
Never ask for secrets in the chat.

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
  refuses DELETE, and `audit_log` and `transactions` one that refuses UPDATE.
  It runs after every migration and on every start, so a new table is
  guarded without a line there. `createDb` switches on `recursive_triggers`,
  so `INSERT OR REPLACE` and `UPDATE OR REPLACE` (which delete the row in
  their way) are refused too; never switch it off. No code may drop a
  trigger; a migration that must change rows of those two tables is a
  decision for the owner first.
- **Every write runs in `inTransaction`** (`backend/src/db/client.ts`): a
  synchronous IMMEDIATE transaction, so inside it every query ends in
  `.get()`, `.all()` or `.run()`, never `await`. That is what keeps the
  history log chain and household codes in single file, with no locks of our
  own. Slow work (hashing a PIN, reading a file) happens before it starts.
- **Instants are ISO-8601 UTC text, read back as `Date`** (the `instant`
  column type in `schema.ts`); calendar dates are `"YYYY-MM-DD"` text; JSON is
  text. Compare instants with a `Date` (`gt(col, new Date())`), never `now()`.
- **Text comparisons that must understand Spanish** happen in JavaScript or
  through `search_text()`. SQLite's `lower()` and `LIKE` only know A to Z.
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
   purpose, e.g. `feat/census-paper-mode` or `fix/pin-lockout-count`.
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

## Checks before pushing

`npm run typecheck` and `npm test` from the repository root. The **Tests** workflow
(`.github/workflows/tests.yml`) runs them, plus a build, on every pull
request; do not merge one whose check is red.

The **Test copy** workflow (`.github/workflows/test-copy.yml`) puts every
pull request on the droplet's test copy (docs/test-copy.md), where the
owner tries it from a phone, so each pull request's description says what
to try there. Only made-up data goes on the test copy. The droplet runs the
scripts in `deploy/test-copy/` as root, from `main` only, and never builds;
keep it that way.

Do not run a code formatter over whole files. Edit by hand, in the
surrounding style.
