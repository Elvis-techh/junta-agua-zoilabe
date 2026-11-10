# The test copy

A second copy of the app on the droplet, at its own address and with made-up
data only, so every change can be tried from a phone before it is merged
(App Plan, decisions of 29 and 30 October 2026). It stays on when the
computer is off, and it has a real https address, so the things that need
one work there too: installing on the home screen, opening with no signal,
and the GPS button.

It has been running at <https://prueba-agua.basculacentral.com> since
1 November 2026. A purple strip on every screen says **Copia de prueba** and
which version it runs. Never type a real family into it.

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

## Every change, step by step

Until the real app is on the droplet, merging puts a change on `main` and on
the test copy and nowhere else, so no family is affected by a mistake here.

1. **Ask for one change, on its own branch.** A branch is a separate working
   copy of the code, so an unfinished change cannot disturb anything. Claude
   runs `npm run typecheck` and `npm test`, then opens a pull request whose
   description says what to try.
2. **Wait for the checks.** On the pull request page, **Tests** and **Test
   copy** turn green, about three to five minutes after the push. A green
   **Test copy** means the droplet is already running this version, and its
   details name the address.
3. **Check you have the right version.** Open
   <https://prueba-agua.basculacentral.com>. The strip says
   `Versión <branch> · <seven characters>`, which match the pull request's
   branch and latest commit. If it still shows the old version, close the app
   (or the tab) and open it again: a new version is picked up on the next open.
4. **Try it as the person who will use it.** Follow the description's "what to
   try", with made-up names, numbers and amounts. Sign in with that person's
   role, not only as the administrator. If the change decides who may see
   something, also try a role that may not see it. If it is for work in the
   field, try it with no signal too.
5. **Not right?** Tell Claude what you expected and what you saw. The fix goes
   on the same branch and the same pull request, and the test copy updates by
   itself. Back to step 2.
6. **Right?** With both checks green, press **Merge pull request**. The test
   copy switches to `main` by itself, and within a few minutes the strip says
   `main`.
7. **Broke after merging?** Press **Revert** on the merged pull request, then
   merge the pull request it makes. That undoes the change and keeps the record
   of it; `main`'s history is never rewritten.

Three things to know:

- **It holds one version at a time, and the last push wins.** With two pull
  requests open, look at the strip before testing. To put a branch back on it:
  **Actions → Test copy → Run workflow**, pick the branch, **Run workflow**.
- **A red check means do not merge.** A red **Test copy** means the tests failed
  (nothing was sent to the droplet) or the droplet did not take the build
  within ten minutes. Give Claude the pull request's number: it can read
  GitHub's log. For the second case the droplet's side is
  `journalctl -u zoilabe-test-update -n 50 --no-pager`, which holds no secrets
  and can be pasted to Claude.
- **A branch that changes the database leaves its mark.** The file keeps that
  branch's tables after the test copy goes back to `main`. If a later version
  will not start, or old test data gets in the way,
  [start over](#starting-over-with-an-empty-test-copy).

## Starting a new phase

The phases, and what "done" means for each, are in the table at the end of the
[App Plan](app-plan.md).

1. **Start from a clean place.** Every pull request of the last phase is merged
   or closed, and the strip says `main`.
2. **The board decides first.** Read the phase in the plan. Anything still open
   about money, or about who may see what, goes to the board before it is
   built: Claude lays out the options and the trade-off, and waits.
3. **Build it in small pieces.** Each piece is one pull request through the
   steps above, never the whole phase at once, so a piece that goes wrong can
   be reverted alone.
4. **Give the test copy what the phase needs.** Accounts for the roles involved,
   made from **Usuarios**, and made-up data.
5. **Finish with the phase's "done when" test,** done by the person it names,
   without help. The test copy takes only made-up data, so use made-up paper
   forms and receipts. A test that needs real data or the real address (Phase
   2's month beside the real receipt book, Phase 3's guest at the real address)
   cannot run here: ask the board how to run it before the phase ends.
6. **Mark it done.** A pull request updates `README.md`'s Status. The phase
   table changes in the board's plan, and its snapshot here is then refreshed.

## What it is not

- **Not for real data.** It is open to the internet behind the same sign-in
  as the real app, but it has no backups and nobody looks after its history.
  Use a different password there from the real app's.
- **Not the real app.** Its own user (`zoilabe-test`), folder
  (`/opt/zoilabe-test`), database file and port (3003). It cannot read the
  real app's database, and the real app cannot read its.
- **Not a rehearsal of the real deployment.** That one is still the steps in
  [deployment-shared-droplet.md](deployment-shared-droplet.md).

## Setting it up, once

Done on 1 November 2026. These steps stay here for setting it up again.

From the droplet's console (DigitalOcean → the droplet → **Console**, or SSH
from the computer). Every command is safe to copy as it is. Paste one block
at a time and read what it printed before the next: pasted together, the
later commands would still run after one that failed.

**0. Check there is room.**

```bash
free -m                          # "available" on the Mem line: at least 300
ss -tlnp | grep 3003             # nothing: the port is free
/opt/node22/bin/node -v          # v22.something (Lindero installed it)
```

**1. The address.** `prueba-agua.basculacentral.com`. Cloudflare's DNS for
that domain has an `A` record with that name and the droplet's IP, set to
**DNS only** (the grey cloud), like Lindero's. In the console:

```bash
SUB=prueba-agua.basculacentral.com
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

**4. Nginx and the certificate.** Three blocks. First the plain-http half of
the site alone, which the certificate check needs:

```bash
EXAMPLE=/opt/zoilabe-test/source/deploy/test-copy/nginx-zoilabe-test.conf.example
sed -n '1,/^}/p' $EXAMPLE | sed "s/<TEST_SUBDOMAIN>/$SUB/g" | sudo tee /etc/nginx/sites-available/zoilabe-test >/dev/null
sudo ln -sf /etc/nginx/sites-available/zoilabe-test /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx || sudo rm /etc/nginx/sites-enabled/zoilabe-test
```

It must print `test is successful`. If it prints `emerg` or `test failed`,
stop there. The last command has already taken the test copy's site out again,
and the sites already running were not touched. That last command matters: a
file nginx refuses does no harm until the droplet next restarts, and then
nginx does not start at all, which takes Lindero and Báscula Central down with
it. To try again later, start step 4 from the top.

Then the certificate. The reload is what makes nginx use each renewed
certificate, and the dry run proves renewal will work. It has to: browsers that
have seen this site refuse it outright once its certificate lapses.

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d $SUB --deploy-hook "systemctl reload nginx"
sudo certbot renew --dry-run --cert-name $SUB    # "all simulated renewals succeeded"
```

Then the whole site, only if both of those worked:

```bash
EXAMPLE=/opt/zoilabe-test/source/deploy/test-copy/nginx-zoilabe-test.conf.example
sed "s/<TEST_SUBDOMAIN>/$SUB/g" $EXAMPLE | sudo tee /etc/nginx/sites-available/zoilabe-test >/dev/null
sudo nginx -t && sudo systemctl reload nginx || sudo rm /etc/nginx/sites-enabled/zoilabe-test
```

Again it must print `test is successful`. The address shows an error page until
the first build arrives in the next step; that is expected.

**5. The first build, and checking for new ones every two minutes.**

```bash
cd /opt/zoilabe-test/source
sudo cp deploy/test-copy/zoilabe-test-update.service deploy/test-copy/zoilabe-test-update.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now zoilabe-test-update.timer
sudo systemctl start zoilabe-test-update       # the first build now, instead of in a minute
journalctl -u zoilabe-test-update -n 50 --no-pager
```

The last lines should end with `==> Up: {"status":"ok",…}`. Then from outside:

```bash
curl -s https://$SUB/api/health      # {"status":"ok",…}, the API answers
curl -s https://$SUB/version.json    # {"branch":"main","commit":"…"}, nginx can read the app
```

**6. An administrator on the test copy.** It prints a password, once: open
the test copy on your phone and sign in with that number and password.

```bash
cd /opt/zoilabe-test/app/backend
sudo -u zoilabe-test /opt/node22/bin/node --env-file=/opt/zoilabe-test/env dist/scripts/first-admin.js --name "Administrador Prueba" --phone 99998888
```

The phone number can be made up. Other test accounts (a secretary, a
treasurer) are made from **Usuarios** on the test copy, as on the real app.

An administrator made before 9 November 2026 signed in with a PIN, and has no
password since then. It refuses to make a second administrator, so give the
existing one a password instead (the same number it was made with):

```bash
cd /opt/zoilabe-test/app/backend
sudo -u zoilabe-test /opt/node22/bin/node --env-file=/opt/zoilabe-test/env dist/scripts/new-password.js --phone 99998888
```

It prints the new password once. Every other old test account then gets one
from **Usuarios** → the account → **Poner contraseña**.

**7. Tell GitHub the address**, so the **Test copy** check waits for each
build to go live. Only once step 6 worked: from this moment a droplet that
does not answer turns every check red. On GitHub: the repository → **Settings
→ Secrets and variables → Actions → Variables → New repository variable**.
Name `TEST_COPY_URL`, value `https://prueba-agua.basculacentral.com`. It is not
a secret, so it goes under **Variables**, not **Secrets**.

Then try the whole road once: **Actions → Test copy → Run workflow**, branch
`main`, **Run workflow**. It turns green in about five minutes, and its details
name the address.

**8. Check the separation, and that the other two apps did not notice.**

```bash
ss -tlnp | grep 3003                                                  # 127.0.0.1:3003 only
sudo -u zoilabe-test cat /opt/lindero/backend/data/lindero.db > /dev/null   # Permission denied
sudo -u zoilabe-test ls /root/weight_software                         # Permission denied
systemctl show zoilabe-test-api -p MemoryCurrent                      # well under 180 MB
curl -s -o /dev/null -w 'Lindero %{http_code}\n' https://lindero.basculacentral.com/api/health   # 200
curl -s -o /dev/null -w 'Bascula %{http_code}\n' https://api.basculacentral.com/api/health       # 200
free -m                                                               # "available" still above 150
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
