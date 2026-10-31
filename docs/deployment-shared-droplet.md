# Deploying beside Lindero and Báscula Central

The water board app goes on the droplet that already runs Báscula Central
(the scale stations, which depend on it every working day) and Lindero. This
document is the plan for that: what this app adds, and the **separation
checklist** the App Plan asks for before the first deployment. Nothing here has
been done on the droplet yet.

Read Lindero's `docs/deployment-shared-droplet.md` first. Its rules apply here
unchanged: never build on the droplet, reload Nginx (never restart it) after
`nginx -t`, and leave `/usr/bin/node` alone (this app uses Lindero's
`/opt/node22`).

## What this app adds to the droplet

| | Báscula Central | Lindero | Junta de Agua |
|---|---|---|---|
| Database | SQLite file | SQLite file | SQLite file `/opt/zoilabe/backend/data/zoilabe.db` |
| OS user | root (PM2) | `lindero` | `zoilabe` |
| Lives in | `/root/weight_software` | `/opt/lindero` | `/opt/zoilabe` |
| Listens on | `127.0.0.1:3000` | `127.0.0.1:3001` | `127.0.0.1:3002` |
| Subdomain | `api.basculacentral.com` | `lindero.basculacentral.com` | to be chosen |
| Backups | hourly → Spaces `weight-station-storage` | nightly 02:15 | nightly 02:45 → its own bucket or folder |

Nothing new is installed for the database: like the other two apps, it is
one SQLite file inside the app's own folder, opened by the app itself. The
API is a third Node process beside Lindero's, with a 128 MB heap, so the three
apps still fit in 1 GB of memory plus the 2 GB of swap.

The test copy ([test-copy.md](test-copy.md)) is a fourth process beside
them: user `zoilabe-test`, folder `/opt/zoilabe-test`, port 3003, its own
subdomain, made-up data, no backups, and capped at 180 MB of memory. It can
be set up before the real app, and turned off at any time without touching
it.

## Separation checklist — check every line before the first deployment

The App Plan's "Still open" item. Each line says how to prove it.

- [ ] **Own database file, readable by this app alone.**
  `/opt/zoilabe/backend/data` is owned by `zoilabe` with mode 700 and the
  file with mode 600 (the services' `UMask=0077` keeps new files that way):
  `sudo -u lindero cat /opt/zoilabe/backend/data/zoilabe.db > /dev/null`
  must say *Permission denied*.
- [ ] **This app cannot open the others' databases.** Lindero's and Báscula's
  are SQLite files, so the guard is file permissions:
  `sudo -u zoilabe cat /opt/lindero/backend/data/lindero.db > /dev/null` and
  `sudo -u zoilabe ls /root/weight_software/backend` must both say
  *Permission denied*. If Lindero's data folder is readable by others, fix
  that first: `chmod 700 /opt/lindero/backend/data`.
- [ ] **The guards are on.** The API puts them back on every start;
  `sqlite3 /opt/zoilabe/backend/data/zoilabe.db ".schema audit_log"` lists
  `audit_log_no_update` and `audit_log_no_delete` (src/db/guards.ts).
  (`sudo apt install sqlite3` if the command is missing.)
- [ ] **Own OS user, folder and env file.** `/opt/zoilabe` owned by `zoilabe`;
  `.env` mode 600. The API's `.env` holds no secret that opens a backup —
  the backup key and the Spaces key go in `.env.backup`, readable by root
  only (systemd reads it before dropping to `zoilabe`).
- [ ] **Own port, loopback only.** `ss -tlnp | grep 3002` shows `127.0.0.1:3002`.
- [ ] **Own subdomain and certificate.** A DNS-only `A` record, then
  `certbot certonly --webroot -w /var/www/certbot -d <subdomain>`.
- [ ] **Own storage key and bucket (or folder).** A Spaces key limited to this
  app's bucket, never the weight station's key. The backup script writes under
  `SPACES_PREFIX` only.
- [ ] **Own nightly backup.** `systemctl list-timers` shows
  `zoilabe-backup.timer` beside Lindero's, at a different time.
- [ ] **One app restores without touching the others.** A restore test on a
  fresh droplet (docs/restore.md) brings back this app alone.

## The steps

### 1. Back up both neighbours first

Báscula: `node scripts/backup-database.js` in its backend folder. Lindero:
`systemctl start lindero-backup`. Confirm both landed off the machine.

### 2. User and folders

```bash
sudo useradd --system --home /opt/zoilabe --shell /usr/sbin/nologin zoilabe
sudo mkdir -p /opt/zoilabe/backend/backups /opt/zoilabe/backend/data
sudo chown -R zoilabe: /opt/zoilabe && sudo chmod 700 /opt/zoilabe/backend/data
```

Create `.env` (copy `backend/.env.example`) with `NODE_ENV=production`,
`PORT=3002`, `HOST=127.0.0.1`, `TRUST_PROXY=127.0.0.1`,
`APP_URL=https://<subdomain>` and
`DATABASE_PATH=/opt/zoilabe/backend/data/zoilabe.db`. `.env.backup` holds
`BACKUP_ENCRYPTION_KEY` and the `SPACES_*` values.

### 3. Build on the laptop, copy up

`npm run build` on the laptop, then copy `backend/dist`, `backend/drizzle`,
`backend/package.json`, the root `package-lock.json` and `frontend/dist` with
`rsync`. On the droplet: `npm ci --omit=dev` in `/opt/zoilabe/backend` with
`PATH=/opt/node22/bin:$PATH`. Never copy `node_modules` up instead:
`better-sqlite3` is compiled for the machine it is installed on, as Lindero's
notes explain.

### 4. Database, seed, first administrator

```bash
cd /opt/zoilabe/backend
sudo -u zoilabe /opt/node22/bin/node --env-file=.env dist/db/migrate.js
sudo -u zoilabe /opt/node22/bin/node --env-file=.env dist/db/seed.js
sudo -u zoilabe /opt/node22/bin/node --env-file=.env dist/scripts/first-admin.js --name "…" --phone 9XXXXXXX
```

The first line creates the file; after that the API brings it up to date on
every start. The last line prints the administrator's invitation link.

### 5. Services, Nginx, timers

Install `deploy/zoilabe-api.service`, `deploy/zoilabe-backup.*` and
`deploy/zoilabe-verify-log.*` into `/etc/systemd/system/`, then enable the
service and both timers. Nginx: `deploy/nginx-zoilabe.conf.example`. Then work
through the checklist above, line by line.

### 6. Verify all three

`curl -s https://<subdomain>/api/health`, Lindero's `/api/health`, and the
scale station's `/api/health` requests still arriving in Nginx's access log.
Run `systemctl start zoilabe-backup` once and read its log.
