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
| Database | SQLite file | SQLite file | **PostgreSQL** database `zoilabe` |
| OS user | root (PM2) | `lindero` | `zoilabe` |
| Lives in | `/root/weight_software` | `/opt/lindero` | `/opt/zoilabe` |
| Listens on | `127.0.0.1:3000` | `127.0.0.1:3001` | `127.0.0.1:3002` |
| Subdomain | `api.basculacentral.com` | `lindero.basculacentral.com` | to be chosen |
| Backups | hourly → Spaces `weight-station-storage` | nightly 02:15 | nightly 02:45 → its own bucket or folder |

PostgreSQL itself is new on this droplet. It is the one sizeable addition:
tune it small (step 2) so the three apps still fit in 1 GB of memory plus the
2 GB of swap.

## Separation checklist — check every line before the first deployment

The App Plan's "Still open" item. Each line says how to prove it.

- [ ] **Own database login.** `zoilabe_app` (the API) and `zoilabe_admin`
  (migrations, backups) exist only for this database:
  `sudo -u postgres psql -c '\l zoilabe'` shows access only for
  `zoilabe_admin` and `zoilabe_app`.
- [ ] **This app cannot open the others' databases.** Lindero's and Báscula's
  are SQLite files, so the guard is file permissions:
  `sudo -u zoilabe cat /opt/lindero/backend/data/lindero.db > /dev/null` and
  `sudo -u zoilabe ls /root/weight_software/backend` must both say
  *Permission denied*. If Lindero's data folder is readable by others, fix
  that first: `chmod 700 /opt/lindero/backend/data`.
- [ ] **The others cannot open this one.** PostgreSQL only accepts the two
  logins above (`REVOKE ALL ON DATABASE zoilabe FROM PUBLIC` is applied by
  `db:setup`), and it listens on localhost only:
  `ss -tlnp | grep 5432` shows `127.0.0.1:5432`.
- [ ] **Own OS user, folder and env file.** `/opt/zoilabe` owned by `zoilabe`;
  `.env` mode 600. The API's `.env` holds `DATABASE_URL` (app login) only —
  the admin URL, the backup key and the Spaces key go in `.env.backup`,
  readable by root only (systemd reads it before dropping to `zoilabe`).
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

### 2. PostgreSQL, small

```bash
sudo apt install postgresql
# Tune for a shared 1 GB machine, in /etc/postgresql/<version>/main/conf.d/zoilabe.conf:
#   shared_buffers = 64MB
#   work_mem = 2MB
#   maintenance_work_mem = 32MB
#   max_connections = 20
#   listen_addresses = 'localhost'
sudo systemctl restart postgresql
```

### 3. User, folder, database

```bash
sudo useradd --system --home /opt/zoilabe --shell /usr/sbin/nologin zoilabe
sudo mkdir -p /opt/zoilabe/backend/backups && sudo chown -R zoilabe: /opt/zoilabe
```

Create `.env` (copy `backend/.env.example`) with strong passwords in
`DATABASE_URL` and `DATABASE_ADMIN_URL`, `NODE_ENV=production`, `PORT=3002`,
`HOST=127.0.0.1`, `TRUST_PROXY=127.0.0.1`, `APP_URL=https://<subdomain>`. Then
create the database and logins once, as the postgres superuser:

```bash
sudo -u postgres env DATABASE_URL=… DATABASE_ADMIN_URL=… \
  DATABASE_SUPERUSER_URL='postgres:///postgres?host=/var/run/postgresql' \
  /opt/node22/bin/node dist/db/setup.js
```

Do not leave `DATABASE_SUPERUSER_URL` in any env file afterwards.

### 4. Build on the laptop, copy up

`npm run build` on the laptop, then copy `backend/dist`, `backend/drizzle`,
`backend/package.json`, the root `package-lock.json` and `frontend/dist` with
`rsync`. On the droplet: `npm ci --omit=dev` in `/opt/zoilabe/backend` with
`PATH=/opt/node22/bin:$PATH`.

### 5. Migrate, seed, first administrator

```bash
cd /opt/zoilabe/backend
sudo -u zoilabe /opt/node22/bin/node --env-file=.env.backup dist/db/migrate.js
sudo -u zoilabe /opt/node22/bin/node --env-file=.env.backup dist/db/seed.js
sudo -u zoilabe /opt/node22/bin/node --env-file=.env dist/scripts/first-admin.js --name "…" --phone 9XXXXXXX
```

The last line prints the administrator's invitation link.

### 6. Services, Nginx, timers

Install `deploy/zoilabe-api.service`, `deploy/zoilabe-backup.*` and
`deploy/zoilabe-verify-log.*` into `/etc/systemd/system/`, then enable the
service and both timers. Nginx: `deploy/nginx-zoilabe.conf.example`. Then work
through the checklist above, line by line.

### 7. Verify all three

`curl -s https://<subdomain>/api/health`, Lindero's `/api/health`, and the
scale station's `/api/health` requests still arriving in Nginx's access log.
Run `systemctl start zoilabe-backup` once and read its log.
