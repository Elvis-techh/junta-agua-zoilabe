/**
 * Creating the database and its two logins, and fixing what each may do.
 *
 * Two logins, so that the rule "nobody can change history" does not depend on
 * the app's code being right:
 *
 *  - The ADMIN login owns every table. Migrations, the seed and backups use
 *    it, and nothing else; its password is not in the running app's
 *    environment on the server.
 *  - The APP login is what the API connects as. It may read every table and
 *    add rows to every table, may update the tables whose records change
 *    (a user's status, a month's state), and may never update `audit_log` or
 *    `transactions`, nor delete or truncate anything anywhere.
 *
 * Both logins are named in their connection URLs (DATABASE_ADMIN_URL,
 * DATABASE_URL), so the names and passwords live in one place: the env file.
 */
import pg from "pg";

const { escapeIdentifier, escapeLiteral } = pg;

export interface Login {
  user: string;
  password: string;
  database: string;
}

export function parseLogin(url: string): Login {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (!parsed.username || !database) {
    throw new Error(`The connection URL must name a user and a database: ${parsed.origin}`);
  }

  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

/** Tables whose rows are only ever added: no UPDATE for the app, not even by mistake. */
export const APPEND_ONLY_TABLES = ["audit_log", "transactions"] as const;

/**
 * Create (or bring up to date) the two logins and the database, as a superuser.
 *
 * Safe to run again: existing logins get their password reset to what the URL
 * says, and an existing database is left as it is.
 */
export async function ensureDatabase(
  superuserUrl: string,
  adminUrl: string,
  appUrl: string,
): Promise<void> {
  const admin = parseLogin(adminUrl);
  const app = parseLogin(appUrl);

  if (admin.database !== app.database) {
    throw new Error("DATABASE_URL and DATABASE_ADMIN_URL must name the same database.");
  }
  if (admin.user === app.user) {
    throw new Error("The app and admin logins must be different users.");
  }

  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();

  try {
    for (const login of [admin, app]) {
      const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [login.user]);
      const verb = exists.rowCount ? "ALTER" : "CREATE";
      // Neither login may create databases, create logins or bypass row rules.
      await client.query(
        `${verb} ROLE ${escapeIdentifier(login.user)} LOGIN PASSWORD ${escapeLiteral(login.password)}
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    }

    const dbExists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      admin.database,
    ]);
    if (!dbExists.rowCount) {
      await client.query(
        `CREATE DATABASE ${escapeIdentifier(admin.database)} OWNER ${escapeIdentifier(admin.user)} ENCODING 'UTF8'`,
      );
    }

    // Only these two logins may connect to this database at all.
    const database = escapeIdentifier(admin.database);
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await client.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${database} TO ${escapeIdentifier(app.user)}`);
  } finally {
    await client.end();
  }
}

/**
 * Drop the database, as a superuser. Development and tests only.
 */
export async function dropDatabase(superuserUrl: string, database: string): Promise<void> {
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(database)} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/**
 * What the app login may do, applied as the admin login after every migration.
 *
 * Written as "take everything away, then give back exactly this", so a table
 * added by a later migration starts with nothing until it is listed here, and
 * a grant made by hand on the server does not survive the next deploy.
 */
export async function applyGrants(client: pg.ClientBase, appUser: string): Promise<void> {
  const appRole = escapeIdentifier(appUser);
  const appendOnly = APPEND_ONLY_TABLES.map((table) => escapeIdentifier(table)).join(", ");

  await client.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);

  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${appRole}`);
  await client.query(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${appRole}`);
  await client.query(`GRANT UPDATE ON ALL TABLES IN SCHEMA public TO ${appRole}`);
  await client.query(`REVOKE UPDATE ON ${appendOnly} FROM ${appRole}`);
  // Drizzle's own bookkeeping lives in the `drizzle` schema, which the app
  // login has no USAGE on, so it is out of reach without a line here.

  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${appRole}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`);
}
