import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction handle; every helper that writes accepts either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * Opens a connection pool and wraps it in Drizzle.
 *
 * The pool is small on purpose: the droplet is shared with two other apps, and
 * a water board's traffic is a handful of people at a time.
 */
export function createDb(connectionString: string, max = 5) {
  // Every session works in UTC, whatever the server's own zone. Honduras time
  // is applied when a timestamp is shown, never when it is stored. Sent as a
  // startup option so it is in force before the first query, with no race.
  const pool = new pg.Pool({ connectionString, max, options: "-c TimeZone=UTC" });

  const db = drizzle(pool, { schema });

  return { db, pool };
}
