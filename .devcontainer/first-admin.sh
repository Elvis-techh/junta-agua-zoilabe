#!/usr/bin/env bash
# Create the codespace's test administrator and write their invitation link
# into TRY-IT.md, which the codespace opens. For a fresh link, start over:
#
#   npm run db:reset && bash .devcontainer/first-admin.sh
set -euo pipefail

out=$(npm run --silent user:first-admin -- --name "Administrador de Prueba" --phone 99990000)
echo "$out"
invitation=$(grep -oE 'https://[^ ]+/invitacion#[^ ]+' <<<"$out" | head -1)
app=$(grep -E '^APP_URL=' backend/.env | cut -d= -f2-)

cat > TRY-IT.md <<EOF
# Try this version

A private copy of the app on GitHub's machines, with made-up data. Nothing
done here reaches the real app.

1. **The first time**, tap [the invitation link]($invitation) and choose a
   6-digit PIN. It works once, for 48 hours.
2. **After that**, open [the app]($app) and type your PIN.

If the editor asks whether to open the website, tap **Open**. If the page
shows an error, wait until the terminal below says \`ready\`, then tap again.

The database starts empty: add a sector in **Configuración** before
**Registrar familia**.

When you are done, go back to the pull request on GitHub, then delete this
codespace: github.com/codespaces → ··· → Delete.
EOF
echo "Wrote TRY-IT.md"
