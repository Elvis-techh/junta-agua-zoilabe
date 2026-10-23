/**
 * The nightly history log check (run by a systemd timer on the server).
 *
 * Recomputes the whole chain and files the result as the
 * `system.log_chain_check` setting, which Configuración shows under "Estado
 * del sistema". Exits with 1 when the chain is broken, so the timer's failure
 * shows in `systemctl --failed` too.
 */
import { createDb } from "../db/client.js";
import { requireEnv } from "../db/env.js";
import { settings } from "../db/schema.js";
import { verifyChain } from "../lib/audit.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../lib/time.js";

const { db, pool } = createDb(requireEnv("DATABASE_URL"), 1);

try {
  const result = await verifyChain(db);

  await db.insert(settings).values({
    key: "system.log_chain_check",
    value: { ...result, checkedAt: new Date().toISOString() },
    effectiveFrom: businessToday(HONDURAS_TIME_ZONE),
  });

  if (result.ok) {
    console.log(`History log intact: ${result.checked} entries checked.`);
  } else {
    console.error(`History log BROKEN at entry ${result.brokenAtId} (${result.checked} entries before it are intact).`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
