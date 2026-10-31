import { loadConfig } from "../config/env.js";
import { createDb } from "./client.js";
import { seedDatabase } from "./seeding.js";
const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
try {
    seedDatabase(db, config.timeZone);
    console.log("Roles, permissions, categories and village profile are in place.");
}
finally {
    sqlite.close();
}
//# sourceMappingURL=seed.js.map