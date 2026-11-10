/**
 * Every test gets a brand-new database of its own, in memory, made the way
 * production's is made (the same migrations and guards, then the seed), and
 * gone when it closes. Nothing a test does can leak into another test or
 * into your local data, and no server or setting is needed to run them.
 */
import assert from "node:assert/strict";

import type Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { SESSION_COOKIE, newId, openSession } from "../src/auth/session.js";
import type { AppConfig } from "../src/config/env.js";
import { loadConfig } from "../src/config/env.js";
import { createDb } from "../src/db/client.js";
import type { Db } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrations.js";
import { rolePermissions, users } from "../src/db/schema.js";
import { seedDatabase } from "../src/db/seeding.js";
import { hashPassword } from "../src/lib/password.js";
import type { Permission, RoleCode } from "../src/lib/permissions.js";
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

/**
 * Take permissions away from a role, as the Permisos tab can. Every role
 * holds every permission since 6 November 2026, so a test that proves the
 * server refuses a role without a permission first takes it away here.
 * Applies on the role's very next request.
 */
export function takeAway(t: TestDatabase, roleCode: RoleCode, ...permissions: Permission[]): void {
  for (const permission of permissions) {
    t.db
      .update(rolePermissions)
      .set({ granted: false })
      .where(and(eq(rolePermissions.roleCode, roleCode), eq(rolePermissions.permission, permission)))
      .run();
  }
}

let phoneCounter = 30000000;

/** A fresh, unused Honduran phone number, as the database keeps it. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+504${phoneCounter}`;
}

export const TEST_PASSWORD = "bamu4827";

/**
 * An active user of the given role, with TEST_PASSWORD, signed in on one phone.
 * Returns the cookie header to send with `app.inject`.
 */
export async function signedInUser(
  t: TestDatabase,
  roleCode: RoleCode,
  name = `Prueba ${roleCode}`,
): Promise<{ id: string; phone: string; cookie: string; sessionId: string }> {
  const id = newId();
  const phone = nextPhone();
  await t.db.insert(users).values({
    id,
    name,
    phone,
    roleCode,
    status: "active",
    passwordHash: await hashPassword(TEST_PASSWORD),
  });

  const session = openSession(t.db, id);

  return { id, phone, cookie: `${SESSION_COOKIE}=${session.token}`, sessionId: session.id };
}
