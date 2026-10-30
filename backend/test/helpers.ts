/**
 * Every test gets a brand-new database of its own, in memory, made the way
 * production's is made (the same migrations and guards, then the seed), and
 * gone when it closes. Nothing a test does can leak into another test or
 * into your local data, and no server or setting is needed to run them.
 */
import assert from "node:assert/strict";

import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import {
  DEVICE_COOKIE,
  DEVICE_IDLE_LIMIT_MS,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  issueToken,
  newId,
} from "../src/auth/session.js";
import type { AppConfig } from "../src/config/env.js";
import { loadConfig } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { users } from "../src/db/schema.js";
import { seedDatabase } from "../src/db/seeding.js";
import { hashPin } from "../src/lib/pin.js";
import type { RoleCode } from "../src/lib/permissions.js";
import { HONDURAS_TIME_ZONE } from "../src/lib/time.js";

export interface TestDatabase {
  db: Db;
  /** The raw connection, for what only someone outside the app could do: drop a guard on purpose. */
  sqlite: Database.Database;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const { db, sqlite } = createDb(":memory:");
  runMigrations(db, sqlite);
  seedDatabase(db, HONDURAS_TIME_ZONE);

  return {
    db,
    sqlite,
    close: async () => {
      sqlite.close();
    },
  };
}

/**
 * Assert that a statement is refused by the database with a message matching
 * `pattern`. Drizzle may wrap SQLite's own error, so the message that matters
 * can be on `cause`.
 */
export async function rejectsWithDbError(statement: PromiseLike<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(Promise.resolve(statement), (error: unknown) => {
    const cause = (error as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (error as Error).message;
    assert.match(message, pattern);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The API, and signed-in users of any role
// ---------------------------------------------------------------------------

export interface TestApp extends TestDatabase {
  app: FastifyInstance;
}

export async function buildTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const t = await createTestDatabase();
  const config: AppConfig = {
    ...loadConfig({ NODE_ENV: "test", APP_URL: "https://agua.example.hn" }),
    ...overrides,
  };
  const app = await buildApp(config, t.db);

  return {
    ...t,
    app,
    close: async () => {
      await app.close();
      await t.close();
    },
  };
}

let phoneCounter = 30000000;

/** A fresh, unused 8-digit phone number. */
export function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

export const TEST_PIN = "482913";

/**
 * An active user of the given role, signed in on one remembered phone.
 * Returns the cookie header to send with `app.inject`.
 */
export async function signedInUser(
  t: TestDatabase,
  roleCode: RoleCode,
  name = `Prueba ${roleCode}`,
): Promise<{ id: string; cookie: string; deviceCookie: string; sessionId: string }> {
  const id = newId();
  await t.db.insert(users).values({
    id,
    name,
    phone: nextPhone(),
    roleCode,
    status: "active",
    pinHash: await hashPin(TEST_PIN),
  });

  const device = issueToken(t.db, { userId: id, kind: "device", lifetimeMs: DEVICE_IDLE_LIMIT_MS });
  const session = issueToken(t.db, {
    userId: id,
    kind: "session",
    lifetimeMs: SESSION_LIFETIME_MS,
    deviceId: device.id,
  });

  return {
    id,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.token}`,
    deviceCookie: `${DEVICE_COOKIE}=${device.token}`,
    sessionId: session.id,
  };
}
