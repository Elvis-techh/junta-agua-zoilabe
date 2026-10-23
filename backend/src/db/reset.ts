/**
 * Start the local database over: drop it, create it, migrate and seed.
 * Development only — it refuses to run with NODE_ENV=production.
 */
import { HONDURAS_TIME_ZONE } from "../lib/time.js";
import { createDb } from "./client.js";
import { requireEnv } from "./env.js";
import { runMigrations } from "./migrations.js";
import { dropDatabase, ensureDatabase, parseLogin } from "./roles.js";
import { seedDatabase } from "./seeding.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("db:reset never runs in production.");
}

const superuserUrl = requireEnv("DATABASE_SUPERUSER_URL");
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const appUrl = requireEnv("DATABASE_URL");

await dropDatabase(superuserUrl, parseLogin(adminUrl).database);
await ensureDatabase(superuserUrl, adminUrl, appUrl);
await runMigrations(adminUrl, appUrl);

const { db, pool } = createDb(adminUrl, 1);
try {
  await seedDatabase(db, HONDURAS_TIME_ZONE);
} finally {
  await pool.end();
}
console.log("Local database reset: empty, migrated and seeded.");
