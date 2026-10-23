import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDb } from "./db/client.js";

/*
 * Migrations are NOT run here. The running app connects as the app login,
 * which cannot change the schema; `npm run db:migrate` (admin login) does
 * that as a deploy step before the service restarts.
 */
const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const app = await buildApp(config, db);

let stopping = false;

/**
 * Close in-flight work and exit. A stop that was asked for exits 0; a crash
 * exits 1, so systemd's `Restart=on-failure` restarts only after a crash.
 */
const shutdown = async (signal: string, exitCode = 0) => {
  if (stopping) {
    return;
  }
  stopping = true;
  app.log.info({ signal }, "Shutting down");

  const deadline = setTimeout(() => {
    app.log.error("Shutdown took longer than 10 s; exiting anyway");
    process.exit(1);
  }, 10_000);
  deadline.unref();

  await app.close();
  await pool.end();
  process.exit(exitCode);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  app.log.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  app.log.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
