# The test copy

A second copy of the app on the droplet, at its own address and with made-up
data only, so every change can be tried from a phone before it is merged
(App Plan, decisions of 29 and 30 October 2026). It stays on when the
computer is off, and it has a real https address, so the things that need
one work there too: installing on the home screen, opening with no signal,
and the GPS button.

A purple strip on every screen says **Copia de prueba** and which version it
runs. Never type a real family into it.

## How a change gets there

```text
push to a pull request (or to main)
  → GitHub: "Test copy" workflow runs the tests and builds the app
  → GitHub: the built app goes to the test-build branch
  → droplet: every two minutes it looks at test-build, and installs a new build
  → GitHub: the workflow waits until the test copy runs that build, then turns green
```

The droplet never builds anything: building takes memory that Báscula
Central's scale stations need (Lindero's deploy works the same way). The
scripts it runs come from `main`, never from the branch being tried, so a
pull request cannot change what runs on the droplet until it is merged.

## Trying a change from a phone

1. Open the pull request on GitHub and wait for the **Test copy** check to
   turn green, about three to five minutes after the push. Its details name
   the address and the version.
2. Open the test copy's address. The strip shows the branch and the first
   seven characters of the commit; they match the pull request's.
3. If it still shows the old version, close the app (or the tab) and open it
   again: a new version is picked up on the next open.
4. Try the change with made-up names, numbers and amounts.

After a merge, the test copy switches to `main` by itself. To put another
branch back on it: **Actions → Test copy → Run workflow**, pick the branch,
**Run workflow**.

A red **Test copy** check means the tests failed (nothing was sent to the
droplet) or the droplet did not take the build within ten minutes. The
check's log says which; for the second, the droplet's side is in
`journalctl -u zoilabe-test-update -n 50`.

## What it is not

- **Not for real data.** It is open to the internet behind the same sign-in
  as the real app, but it has no backups and nobody looks after its history.
  Use a different PIN there from the real app's.
- **Not the real app.** Its own user (`zoilabe-test`), folder
  (`/opt/zoilabe-test`), database file and port (3003). It cannot read the
  real app's database, and the real app cannot read its.
- **Not a rehearsal of the real deployment.** That one is still the steps in
  [deployment-shared-droplet.md](deployment-shared-droplet.md).

## Setting it up, once

From the droplet's console (DigitalOcean → the droplet → **Console**, or SSH
from the computer), after the pull request that adds this page is merged.
Every command is safe to copy as it is, except the address in step 1.

**0. Check there is room.**

```bash
free -m                          # "available" on the Mem line: at least 300
ss -tlnp | grep 3003             # nothing: the port is free
/opt/node22/bin/node -v          # v22.something (Lindero installed it)
```

**1. Choose the address and point it at the droplet.** For example
`prueba-agua.basculacentral.com`. In Cloudflare's DNS for that domain, add an
`A` record with that name and the droplet's IP, set to **DNS only** (the grey
cloud), like Lindero's. Then, in the console:

```bash
SUB=prueba-agua.basculacentral.com     # the address you chose
```

The next steps use `$SUB`; if the console is closed in between, set it again.

**2. User, folders and the scripts.**

```bash
sudo useradd --system --home-dir /opt/zoilabe-test/app --shell /usr/sbin/nologin zoilabe-test
sudo install -d -m 755 /opt/zoilabe-test
sudo install -d -m 755 -o zoilabe-test -g zoilabe-test /opt/zoilabe-test/app
sudo install -d -m 700 -o zoilabe-test -g zoilabe-test /opt/zoilabe-test/data
sudo git clone --quiet https://github.com/Elvis-techh/junta-agua-zoilabe.git /opt/zoilabe-test/source
```

**3. Its settings.** No secret goes in this file.

```bash
sed "s/<TEST_SUBDOMAIN>/$SUB/" /opt/zoilabe-test/source/deploy/test-copy/env.example | sudo tee /opt/zoilabe-test/env >/dev/null
sudo chown root:zoilabe-test /opt/zoilabe-test/env && sudo chmod 640 /opt/zoilabe-test/env
```

**4. Nginx and the certificate.** First the plain-http half alone, which the
certificate check needs; then the whole site. If `nginx -t` reports an error,
stop there: the sites already running keep running, and nothing is reloaded.

```bash
EXAMPLE=/opt/zoilabe-test/source/deploy/test-copy/nginx-zoilabe-test.conf.example
sed -n '1,/^}/p' $EXAMPLE | sed "s/<TEST_SUBDOMAIN>/$SUB/g" | sudo tee /etc/nginx/sites-available/zoilabe-test >/dev/null
sudo ln -s /etc/nginx/sites-available/zoilabe-test /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d $SUB

sed "s/<TEST_SUBDOMAIN>/$SUB/g" $EXAMPLE | sudo tee /etc/nginx/sites-available/zoilabe-test >/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

**5. The first build, and checking for new ones every two minutes.**

```bash
cd /opt/zoilabe-test/source
sudo cp deploy/test-copy/zoilabe-test-update.service deploy/test-copy/zoilabe-test-update.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now zoilabe-test-update.timer
sudo systemctl start zoilabe-test-update       # the first build now, instead of in a minute
journalctl -u zoilabe-test-update -n 50 --no-pager
```

The last lines should end with `==> Up: {"status":"ok",…}`. Then
`curl -s https://$SUB/api/health` answers the same from outside.

**6. An administrator on the test copy.** It prints an invitation link: send
it to your phone (by WhatsApp, for example) and open it there.

```bash
cd /opt/zoilabe-test/app/backend
sudo -u zoilabe-test /opt/node22/bin/node --env-file=/opt/zoilabe-test/env dist/scripts/first-admin.js --name "Administrador Prueba" --phone 99998888
```

The phone number can be made up. Other test accounts (a secretary, a
treasurer) are made from **Usuarios** on the test copy, as on the real app.

**7. Tell GitHub the address**, so the **Test copy** check waits for each
build to go live. On GitHub: the repository → **Settings → Secrets and
variables → Actions → Variables → New repository variable**. Name
`TEST_COPY_URL`, value `https://` and the address, e.g.
`https://prueba-agua.basculacentral.com`. It is not a secret.

**8. Check the separation.**

```bash
ss -tlnp | grep 3003                                                  # 127.0.0.1:3003 only
sudo -u zoilabe-test cat /opt/lindero/backend/data/lindero.db > /dev/null   # Permission denied
sudo -u zoilabe-test ls /root/weight_software                         # Permission denied
systemctl show zoilabe-test-api -p MemoryCurrent                      # well under 180 MB
```

Once the real app is on the droplet, also
`sudo -u zoilabe-test cat /opt/zoilabe/backend/data/zoilabe.db > /dev/null`
must say *Permission denied*.

## Starting over with an empty test copy

A branch that changed the database can leave the test copy's file in a shape
`main` does not expect. Moving the file aside (never deleting it) and making
a fresh one fixes that:

```bash
sudo systemctl stop zoilabe-test-api
sudo mv /opt/zoilabe-test/data /opt/zoilabe-test/data.old-$(date +%Y%m%d-%H%M)
sudo install -d -m 700 -o zoilabe-test -g zoilabe-test /opt/zoilabe-test/data
cd /opt/zoilabe-test/source && sudo bash deploy/test-copy/install-build.sh
```

Then step 6 again, for a new administrator.

## Turning it off

```bash
sudo systemctl disable --now zoilabe-test-update.timer zoilabe-test-api
```

And delete the `TEST_COPY_URL` variable on GitHub, or every **Test copy**
check turns red after waiting ten minutes. To turn it back on, enable both
again and set the variable.
