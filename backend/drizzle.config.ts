import { defineConfig } from "drizzle-kit";

/**
 * Configuration for the `drizzle-kit` CLI, which turns schema.ts into SQL
 * migration files under drizzle/. A development tool only — production runs
 * the generated files through `npm run db:migrate`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_ADMIN_URL ?? "",
  },
});
