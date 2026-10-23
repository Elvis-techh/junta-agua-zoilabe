/**
 * Every test file gets a brand-new database of its own on the development
 * server, made the way production's is made (two logins, migrations, grants,
 * seed), and dropped at the end. Nothing a test does can leak into another
 * file or into your local data.
 *
 * Needs DATABASE_SUPERUSER_URL, DATABASE_ADMIN_URL and DATABASE_URL (from
 * backend/.env locally, from the workflow in CI). Only their logins and
 * server are used; the database name is replaced by a throwaway one.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { createDb } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { requireEnv } from "../src/db/env.js";
import { runMigrations } from "../src/db/migrations.js";
import { dropDatabase, ensureDatabase } from "../src/db/roles.js";
import { seedDatabase } from "../src/db/seeding.js";
import { HONDURAS_TIME_ZONE } from "../src/lib/time.js";

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export interface TestDatabase {
  /** Connected as the app login, like the running API. */
  db: Db;
  /** Connected as the admin login, for setting up cases and for tampering on purpose. */
  adminDb: Db;
  appUrl: string;
  adminUrl: string;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const superuserUrl = requireEnv("DATABASE_SUPERUSER_URL");
  const name = `zoilabe_test_${randomBytes(6).toString("hex")}`;
  const adminUrl = withDatabase(requireEnv("DATABASE_ADMIN_URL"), name);
  const appUrl = withDatabase(requireEnv("DATABASE_URL"), name);

  await ensureDatabase(superuserUrl, adminUrl, appUrl);
  await runMigrations(adminUrl, appUrl);

  const admin = createDb(adminUrl, 2);
  await seedDatabase(admin.db, HONDURAS_TIME_ZONE);
  const app = createDb(appUrl, 5);

  return {
    db: app.db,
    adminDb: admin.db,
    appUrl,
    adminUrl,
    close: async () => {
      await app.pool.end();
      await admin.pool.end();
      await dropDatabase(superuserUrl, name);
    },
  };
}

/**
 * Assert that a query is refused by PostgreSQL with a message matching
 * `pattern`. Drizzle wraps the database's own error, so the message that
 * matters is on `cause`.
 */
export async function rejectsWithDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const cause = (error as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (error as Error).message;
    assert.match(message, pattern);
    return true;
  });
}
