import { HONDURAS_TIME_ZONE } from "../lib/time.js";
import { createDb } from "./client.js";
import { requireEnv } from "./env.js";
import { seedDatabase } from "./seeding.js";

const { db, pool } = createDb(requireEnv("DATABASE_ADMIN_URL"), 1);
try {
  await seedDatabase(db, HONDURAS_TIME_ZONE);
  console.log("Roles, permissions, categories and village profile are in place.");
} finally {
  await pool.end();
}
