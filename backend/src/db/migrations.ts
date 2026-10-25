import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./client.js";
import { applyGrants, parseLogin } from "./roles.js";

/** drizzle/ sits beside src/ and dist/, so the same path works from either. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Bring the schema up to date as the admin login, then re-apply the app
 * login's grants. Drizzle skips migrations already applied, so this is safe to
 * run on every deploy.
 */
export async function runMigrations(adminUrl: string, appUrl: string): Promise<void> {
  const { db, pool } = createDb(adminUrl, 1);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyGrants(client, parseLogin(appUrl).user);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
