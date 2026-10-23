import { requireEnv } from "./env.js";
import { runMigrations } from "./migrations.js";

await runMigrations(requireEnv("DATABASE_ADMIN_URL"), requireEnv("DATABASE_URL"));
console.log("Migrations applied and grants refreshed.");
