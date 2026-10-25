# Restoring a backup

Every backup is an encrypted PostgreSQL dump (`zoilabe-<time>.dump.enc`). To
open one you need `BACKUP_ENCRYPTION_KEY` — the copy sealed in the board's
envelope, or the one in `.env.backup`. Without the key no backup can be
opened by anyone, including us.

The restore script never touches the live database. It restores into a **new**
database, checks it, and prints what it holds:

```bash
cd backend
npm run db:restore -- --from-spaces latest --into zoilabe_restored
# or a file you have:
npm run db:restore -- --file backups/zoilabe-2026-10-23T08-45-00Z.dump.enc --into zoilabe_restored
```

On the server use `node --env-file=.env.backup dist/scripts/restore.js …`
with `DATABASE_SUPERUSER_URL` set for that one command.

It ends with the row counts and the history log check:

```text
Restored into "zoilabe_restored".
  users         9
  households    412
  …
  History log chain intact (5210 entries).
```

## The restore test (before launch, then every three months)

The App Plan asks for a restore on a **fresh droplet**, to prove the backup
works without the original machine.

1. Create a small droplet; install PostgreSQL and Node 22.
2. Copy `.env.backup`'s values there (Spaces key, encryption key, database URLs).
3. `db:restore --from-spaces latest --into zoilabe_restored`.
4. Compare the counts with Configuración's figures on the live app, and
   confirm the chain is intact.
5. Record the date: it shows in Configuración as "última prueba de
   restauración" (Phase 3 adds the screen; until then, note it in the runbook).
6. Destroy the test droplet.

## A real recovery

1. Stop the API: `systemctl stop zoilabe-api`. Phones keep census entries
   queued and send them when it is back (Phase 1).
2. Restore into `zoilabe_restored` as above and read the counts.
3. Swap the databases, as the postgres superuser:

   ```sql
   ALTER DATABASE zoilabe RENAME TO zoilabe_broken_2026_10_23;
   ALTER DATABASE zoilabe_restored RENAME TO zoilabe;
   ```

4. `systemctl start zoilabe-api`, then check `/api/health` and sign in.
5. Keep the broken copy until the board agrees nothing in it is needed.
