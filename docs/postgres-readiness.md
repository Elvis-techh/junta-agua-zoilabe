# Moving to PostgreSQL: readiness map

The app runs on SQLite since 29 October 2026 (one file, like Lindero and
Báscula Central). This page is for the day that might change: what would
move as it is, what would have to be rewritten, and how to move the data
without losing a centavo or a line of history.

The first two sections are for the owner. The rest is for whoever does the
work. **Keep it current:** a change that adds something SQLite-only (a raw
SQL function, a new place that relies on one write at a time) adds its line
here in the same pull request (CLAUDE.md, "Database").

## In short

- **The data is ready.** On 30 October 2026 a test database was filled
  through the app (families with accents, edits, a deactivation, wrong
  PINs, payments with a reversal, a guest) and copied into the app's old
  PostgreSQL design. All 1,577 values came across identical. The old
  PostgreSQL code then found the history log intact, the same money totals
  and the same "last paid month" per house. Its census search found "José
  Pérez Núñez" from "perez nunez". Details at the end.
- **The work is in the code.** PostgreSQL is reached differently from
  JavaScript (every query waits for an answer), and the protections that
  SQLite gets from "one write at a time" have to come back as locks. It is
  about the size of the SQLite switch again (pull request #8), in reverse.
  Most of the PostgreSQL version is still in the project's history, ready to
  bring back.
- **No hurry.** Size is not the reason to move: a village's census and
  payments are thousands of rows a year, and SQLite handles millions.

## When it would be worth it

Any one of these, not the number of families:

1. **More than one program must save at the same time, all day:** a second
   copy of the API, or a background job that writes a lot. SQLite lets one
   program write at a time. Today each save takes a few thousandths of a
   second, so nobody waits.
2. **Saves start to wait.** The API's log shows `database is locked` (a save
   waited more than 5 seconds), or screens freeze while something big saves.
3. **Other tools need their own login to the data:** a reporting tool, an
   auditor, or another app reading the census live.
4. **The board wants the database itself to separate "can add history"
   from "can change anything".** PostgreSQL did that with two logins. SQLite
   does it with triggers, which someone with access to the droplet could
   switch off. The nightly check would still catch a changed history entry,
   but not a changed payment.
5. **All three apps move together:** a bigger droplet, or a managed
   database. Then one PostgreSQL server serves the three, and "a whole
   server for one app" no longer applies.

## What moves as it is

Checked in the 30 October trial: every value of every row came back the
same.

| Data | In SQLite | In PostgreSQL |
|---|---|---|
| IDs | UUID text | `uuid` |
| Instants (created, signed in…) | ISO-8601 UTC text, `2026-10-23T18:04:05.123Z` | `timestamptz`, to the millisecond |
| Calendar dates | `2026-10-23` text | `date` |
| Money | whole centavos, 64-bit integer | `bigint` (`integer` for fee amounts) |
| Yes/no | 0 or 1 | `boolean` |
| History before/after, settings | JSON text | `jsonb` |
| Guest permissions, months covered | JSON list | `text[]`, `date[]` |
| GPS | `real` | `double precision` |
| Counters (sectors, months, history…) | `AUTOINCREMENT` | `serial`, set past the highest copied number |
| **History log hash chain** | sorted-key JSON (`canonicalJson`) | the same: the chain does not depend on the database |
| The phone app (frontend) | talks only to the API | no change |

## What has to change

Sizes: **S** an afternoon, **M** a day or two, **L** several days. "History"
means the PostgreSQL version still in git at commit `c6aa10c` (`git show
c6aa10c:<path>`), the last `main` before the switch.

| # | Area | SQLite today | PostgreSQL | Size |
|---|---|---|---|---|
| 1 | Queries | 70 synchronous `.get()` `.all()` `.run()` in `src/` | every one `await`ed; every helper and handler `async` again | L |
| 2 | One write at a time | `inTransaction` (22 call sites): synchronous IMMEDIATE, nothing else runs inside it | async transactions run side by side: the locks in the list below come back | M, and the riskiest |
| 3 | Nothing deleted, history unchanged | triggers (`src/db/guards.ts`), `recursive_triggers` on | two logins and their grants (history: `backend/src/db/roles.ts`). Triggers can stay as a second layer | M |
| 4 | Accent-blind search | `search_text()`, a JavaScript function on the connection | history: `translate(lower(x), 'áéíóúüñ', 'aeiouun')`, or the `unaccent` extension | S |
| 5 | Raw SQL | 16 fragments, list below | translations below | S |
| 6 | Schema | `sqliteTable` with helpers named after PostgreSQL types (`uuid`, `date`, `boolean`, `bigint`, `serial`, `json`, `instant`) | `pgTable` and the real types (history: `backend/src/db/schema.ts`). `instant` becomes `timestamp(…, { withTimezone: true })` | S |
| 7 | Migrations | the API applies them at start | a new PostgreSQL baseline migration in a fresh folder, applied by the admin login (the app login cannot create tables) | S |
| 8 | Backups and restore | `VACUUM INTO`, then encrypt (`src/lib/snapshot.ts`) | `pg_dump -Fc`, then the same encryption; restore with `pg_restore` (history: `backend/src/lib/pgTools.ts`, `docs/restore.md`) | M |
| 9 | Tests | a new in-memory database per test | a throwaway PostgreSQL database per test file, and a PostgreSQL service in CI (history: `backend/test/helpers.ts`, `.github/workflows/tests.yml`) | S |
| 10 | Droplet | nothing installed | install and tune PostgreSQL for the shared droplet, two logins, systemd `After=postgresql.service` (history: `docs/deployment-shared-droplet.md`, step 2) | M |

### The locks that come back (row 2)

Each of these is correct on SQLite only because nothing else can run
between its read and its write. On PostgreSQL each needs its lock, as the
history version had:

| Where | What could go wrong without it | Lock |
|---|---|---|
| `recordAudit` (`src/lib/audit.ts`) | two history entries chain to the same predecessor | advisory lock `7_311_002` |
| Registrar familia (`POST /census/households`) | two houses get the same Z-code; a retried send is saved twice | advisory lock `7_311_003` |
| `lockHousehold` (household edit, deactivate, reactivate) | two edits each log a "before" that is no longer true | `SELECT … FOR UPDATE` |
| Person edit (`PATCH /census/people/:id`) | the same | `FOR UPDATE` |
| `lockUser` (`src/routes/users.ts`: role, suspend, unlock…) | the same, on a user | `FOR UPDATE` |
| Sector edit (`PATCH /settings/sectors/:id`) | the same, on a sector | `FOR UPDATE` |
| Invitation accept (`POST /auth/invitation/accept`) | one link used twice at once | `FOR UPDATE` |

The wrong-PIN counter needs nothing: it counts inside the `UPDATE` itself.
**New code that relies on one write at a time adds its row here**: Phase 2's
receipt numbers and month close will.

While converting, add a lint check for promises nobody waits for
(typescript-eslint's `no-floating-promises`): on PostgreSQL a query someone
forgot to `await` runs outside its transaction, or after the response, and
the tests may not notice.

### Raw SQL to translate (row 5)

| SQLite (where) | PostgreSQL |
|---|---|
| `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` (`schema.ts`, every `created_at`) | `now()` (`.defaultNow()`) |
| `max(CAST(substr(code, 3) AS INTEGER))` (household code) | `max(substring(code from 3)::int)` |
| `json_each(t.months_covered)` (`lastPaidMonth`, `src/lib/fees.ts`) | `unnest(t.months_covered)` |
| `NOT GLOB '*[^0-9]*'` (phone and ID checks) | `~ '^[0-9]{8}$'`, `~ '^[0-9]{13}$'` |
| `IS NOT 'transfer'` (transfer needs a bank reference) | `IS DISTINCT FROM 'transfer'` |
| `substr(month, 9, 2) = '01'` (months start on day 1) | `extract(day from month) = 1` |
| `search_text(col)` (census search) | row 4 |
| `LIKE … ESCAPE '\'` | same. PostgreSQL's `LIKE` cares about upper/lower case and SQLite's does not (for A to Z), so both sides stay lowercased as today |
| `sqlite_master`, `PRAGMA`, `VACUUM INTO` (`guards.ts`, `migrations.ts`, `snapshot.ts`) | go away with rows 3, 7 and 8 |

## Keeping it ready while on SQLite

These cost nothing now and keep the move a copy rather than a cleanup:

- Instants only through the `instant` column type, dates as `YYYY-MM-DD`,
  IDs from `newId()`. Never a hand-made time string.
- No `INSERT OR REPLACE`, no `REPLACE`, no new SQLite-only functions
  without a row in the table above. Prefer Drizzle's builders to raw SQL.
- Lists stay JSON lists of one kind (all text, or all dates), so they can
  become PostgreSQL arrays.
- The history hash stays over `canonicalJson`, never over text as the
  database returns it.
- No NUL characters in text, and JSON only through Drizzle's `json` columns.
  PostgreSQL refuses both kinds of bad value; the pre-flight check below
  finds them.
- A fee amount stays under L 21,474,836.47: `fee_rates` and
  `household_fees` are `integer` in PostgreSQL. Transactions are `bigint`.

## Move day

1. **Decide.** Moving the database is the owner's decision, and the
   board's where it touches how money is kept.
2. **Branch `refactor/postgres`.** Bring back the history pieces named
   above, convert the code (rows 1–10), and add concurrency tests for each
   lock: two at the same instant, then check the result. All tests pass on
   PostgreSQL.
3. **Copy script**, as in the trial below: export every row as stored;
   pre-flight every value against its PostgreSQL column; load everything in
   one transaction, parents before children, keeping IDs
   (`OVERRIDING SYSTEM VALUE`); set each counter past the highest copied
   number.
4. **Rehearse on the latest backup**, restored into a new file and copied
   into a test PostgreSQL. All checks must pass: row counts, every value,
   money per month, the history chain with the same last hash, the last paid
   month per house, and the old screens (search, household file,
   Historial).
5. **On the droplet:** install PostgreSQL, tune it small, create the
   database and its two logins, migrate as admin, apply the grants.
6. **The move:** tell the board; stop the API (phones keep census entries
   queued); take a final encrypted backup and confirm it reached Spaces; copy;
   run every check; deploy the PostgreSQL build with `DATABASE_URL`; start;
   check `/api/health`, sign in, and see that a new history entry chains on.
7. **Keep the last SQLite file and its backup unchanged** for at least three
   months. Going back is "stop, deploy the SQLite build, start" until new
   payments are entered on PostgreSQL. After that, anything entered since
   has to be carried back.
8. **Docs, same pull request:** README, CLAUDE.md (Database), the droplet
   guide, the restore guide, and this page (mark it done).

## The trial, 30 October 2026

Done on a laptop to prove the data side, before any of this was needed.
The scripts were not kept: they would go stale as the schema grows. This
is enough to rebuild them.

1. **Fill a SQLite file through the API** (pull request #8's code with
   `recursive_triggers`): 2 sectors (one deactivated), 4 families: accents,
   `Ñ`, quotes, no phone, declined phone, a paper form, GPS, a different fee.
   Also a household edit, a deactivation and reactivation, a permission
   change, 3 wrong PINs, a base fee, a month, 3 payments (two months covered
   in one), a reversal of a transfer, an expense of L 1,250.50, and a guest
   invitation. 17 tables, 232 rows, 15 history entries.
2. **Pre-flight**, every value against its PostgreSQL column, using
   `information_schema.columns`:

   | PostgreSQL type | Accepted from SQLite |
   |---|---|
   | `uuid` | text in UUID form |
   | `timestamptz` | text exactly `YYYY-MM-DDTHH:MM:SS.mmmZ`, a real instant |
   | `date` | text `YYYY-MM-DD`, a real day |
   | `boolean` | 0 or 1 |
   | `integer` / `bigint` | whole numbers (32-bit for `integer`) |
   | `jsonb` | valid JSON text, sent as text |
   | `text[]` / `date[]` | a JSON list of text or of days |
   | `text` | text without a NUL character |

3. **Load** into a fresh database with the history schema (`backend/drizzle`
   at `c6aa10c`), one transaction, parents first, counters reset.
4. **Check with the history code** (`main` at `c6aa10c`, `pg` driver):
   `verifyChain` passed with the same last hash; `lastPaidMonth` gave the
   same answer for all 4 houses; the sum of all money entries was the same
   (146,050 centavos);
   all 1,577 values matched in canonical form; the old API returned the
   census search, a household file with its different fee, and the
   Historial; a new history entry chained onto the moved log.
5. **Proof the checks can fail:** in a second copy, one payment was changed
   from L 140.00 to L 14.00 and one history summary gained a full stop. The
   chain check stopped at that entry, the sum was off by L 126.00,
   and the value comparison named both fields.

## Lindero and Báscula Central

Not assessed here. They are separate projects, each with its own SQLite
file. If all three move, the plan is the same for each (map, copy, checks),
and one PostgreSQL server holds three databases with two logins each. The
old tuning in the droplet guide (`shared_buffers = 64MB`) was for one app on
1 GB of memory; three would need a bigger droplet or a managed database.
