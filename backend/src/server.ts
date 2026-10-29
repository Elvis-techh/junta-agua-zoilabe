import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrations.js";

/*
 * Migrations run here, before the API listens, as in Lindero: a deploy is
 * "copy the files, restart the service", with no step to forget. Each start
 * also puts the guards back (src/db/guards.ts). A migration that fails stops
 * the start, so the old data is never served by code that expects new.
 */
const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
runMigrations(db, sqlite);
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
  sqlite.close();
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
