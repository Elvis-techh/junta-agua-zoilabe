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

PostgreSQL, with two logins:

- `zoilabe_admin` owns the tables and runs migrations. The app never uses it.
- `zoilabe_app` is what the running app connects as. It can only `INSERT`
  and `SELECT` on `audit_log` and `transactions`, so even a bug cannot change
  history.

Every schema change is a new migration under `backend/drizzle/`, generated
with `npm run db:generate --workspace @zoilabe/backend` from
`backend/src/db/schema.ts`. Grants live in `backend/src/db/grants.sql` and are
re-applied by `npm run db:migrate`. Never edit a migration that is already on
`main`.

## Fixing things, one at a time

1. **One change per branch, started from the latest `main`**, named after its
   purpose, e.g. `feat/census-paper-mode` or `fix/pin-lockout-count`.
2. **Prove it before merging.** A test that fails without the change and
   passes with it, plus `npm run typecheck` and `npm test`.
3. **One pull request per change.** The description says what was wrong or
   missing, what changed, how it was checked, and what the owner should look
   at. It is the permanent record of why the change exists.
4. **If something broke, revert the pull request** with GitHub's Revert
   button. Never rewrite `main`'s history.

## Checks before pushing

`npm run typecheck` and `npm test` from the repository root. Tests need a
local PostgreSQL (see README). The **Tests** workflow
(`.github/workflows/tests.yml`) runs them, plus a build, on every pull
request; do not merge one whose check is red.

Do not run a code formatter over whole files. Edit by hand, in the
surrounding style.
