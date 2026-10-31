import { loadConfig } from "../config/env.js";
import { createDb } from "./client.js";
import { runMigrations } from "./migrations.js";
const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
try {
    runMigrations(db, sqlite);
}
finally {
    sqlite.close();
}
console.log(`Migrations applied and guards in place: ${config.databasePath}`);
//# sourceMappingURL=migrate.js.map