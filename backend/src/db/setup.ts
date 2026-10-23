/**
 * Create the database and its two logins. Run once per server (and again
 * after changing a password in the env file).
 *
 * Needs DATABASE_SUPERUSER_URL. Locally that is the private server from
 * `npm run db:local -- start`; on the droplet, run it as the postgres user and
 * do not keep the superuser URL in the app's env file afterwards.
 */
import { requireEnv } from "./env.js";
import { ensureDatabase, parseLogin } from "./roles.js";

const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const appUrl = requireEnv("DATABASE_URL");

await ensureDatabase(requireEnv("DATABASE_SUPERUSER_URL"), adminUrl, appUrl);

const admin = parseLogin(adminUrl);
const app = parseLogin(appUrl);
console.log(`Database "${admin.database}" is ready, with logins "${admin.user}" and "${app.user}".`);
console.log("Next: npm run db:migrate && npm run db:seed");
