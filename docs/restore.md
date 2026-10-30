# Restoring a backup

Every backup is an encrypted copy of the database file
(`zoilabe-<time>.db.enc`). To open one you need `BACKUP_ENCRYPTION_KEY` — the
copy sealed in the board's envelope, or the one in `.env.backup`. Without the
key no backup can be opened by anyone, including us.

The restore script never touches the live database. It restores into a **new**
file, checks it, and prints what it holds:

```bash
cd backend
npm run db:restore -- --from-spaces latest --into data/restored.db
# or a file you have:
npm run db:restore -- --file backups/zoilabe-2026-10-23T08-45-00Z.db.enc --into data/restored.db
```

On the server, as root (only root can read `.env.backup`), use
`node --env-file=.env --env-file=.env.backup dist/scripts/restore.js …`.

It ends with the row counts and the history log check:

```text
Restored into /opt/zoilabe/backend/data/restored.db.
  users         9
  households    412
  …
  History log chain intact (5210 entries).
```

## The restore test (before launch, then every three months)

The App Plan asks for a restore on a **fresh droplet**, to prove the backup
works without the original machine.

1. Create a small droplet; install Node 22.
2. Copy the app there and `npm ci --omit=dev`; copy `.env.backup`'s values
   (Spaces key, encryption key).
3. `db:restore --from-spaces latest --into data/restored.db`.
4. Compare the counts with Configuración's figures on the live app, and
   confirm the chain is intact.
5. Record the date: it shows in Configuración as "última prueba de
   restauración" (Phase 3 adds the screen; until then, note it in the runbook).
6. Destroy the test droplet.

## A real recovery

1. Stop the API: `systemctl stop zoilabe-api`. Phones keep census entries
   queued and send them when it is back (Phase 1).
2. Restore into `data/restored.db` as above and read the counts.
3. Swap the files. The restore ran as root, so first give the restored file
   to the `zoilabe` user: the API runs as `zoilabe` and could only read a
   file root owns, and every save would fail. The live file's `-wal` and
   `-shm` companions go aside with it:

   ```bash
   cd /opt/zoilabe/backend/data
   chown zoilabe: restored.db && chmod 600 restored.db
   mkdir broken-2026-10-23
   mv zoilabe.db zoilabe.db-wal zoilabe.db-shm broken-2026-10-23/ 2>/dev/null
   mv restored.db zoilabe.db
   ```

4. `systemctl start zoilabe-api`, then check `/api/health` and sign in.
5. Keep the broken copy until the board agrees nothing in it is needed.
