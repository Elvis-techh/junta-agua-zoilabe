import { and, eq, sql } from "drizzle-orm";

import { SYSTEM_ACTOR, recordAudit } from "../lib/audit.js";
import { DEFAULT_MATRIX, PERMISSION_CODES, ROLES } from "../lib/permissions.js";
import { businessToday } from "../lib/time.js";
import type { Db, Tx } from "./client.js";
import { inTransaction } from "./client.js";
import { categories, rolePermissions, roles, settings } from "./schema.js";

/**
 * Income and expense categories named in the App Plan (Module 2). The board
 * adds its own later in Configuración.
 */
const DEFAULT_CATEGORIES = {
  income: ["Cuota mensual", "Mora", "Reconexión", "Conexión", "Donación", "Otro ingreso"],
  expense: [
    "Reparaciones y materiales",
    "Energía eléctrica",
    "Cloro",
    "Estipendio",
    "Transporte",
    "Otro gasto",
  ],
} as const;

/** A starting list for the census; the board can change it in Configuración. */
const DEFAULT_GENDERS = ["Mujer", "Hombre"];

/**
 * The `settings` key that says a database has had every permission granted
 * to every role once (board decision, 6 November 2026).
 */
export const EVERY_PERMISSION_KEY = "permissions_every_role";

/**
 * Bring a database seeded before 6 November 2026, with the old matrix, up to
 * the board's decision that every role holds every permission. It runs once:
 * the `settings` row it leaves behind stops it running again, so a
 * permission the Permisos tab takes away later stays taken away.
 *
 * Each role that gains something gets its own history entry, written by the
 * system, with the permissions before and after, as a Permisos edit would.
 * A new database already has every permission from the seed, so it only
 * gets the marker.
 */
function grantEveryPermissionOnce(tx: Tx, timeZone: string): void {
  const done = tx
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.key, EVERY_PERMISSION_KEY))
    .limit(1)
    .get();
  if (done) {
    return;
  }

  for (const role of ROLES) {
    const before = tx
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleCode, role.code), eq(rolePermissions.granted, true)))
      .all()
      .map((row) => row.permission)
      .sort();
    if (before.length === PERMISSION_CODES.length) {
      continue;
    }

    tx
      .update(rolePermissions)
      .set({ granted: true, updatedAt: new Date(), updatedBy: null })
      .where(and(eq(rolePermissions.roleCode, role.code), sql`NOT ${rolePermissions.granted}`))
      .run();

    recordAudit(tx, SYSTEM_ACTOR, {
      area: "settings",
      action: "permissions.updated",
      summary: `Sistema dio todos los permisos al cargo ${role.name}`,
      entityType: "role",
      entityId: role.code,
      before: { granted: before },
      after: { granted: [...PERMISSION_CODES].sort() },
      reason: "Decisión de la junta del 6 de noviembre de 2026: todos los cargos pueden hacer todo en la app.",
    });
  }

  tx.insert(settings).values({
    key: EVERY_PERMISSION_KEY,
    value: { decided: "2026-11-06" },
    effectiveFrom: businessToday(timeZone),
  }).run();
}

/**
 * Fill a new database with what the board starts from: the eight roles, the
 * permission matrix, the categories, the village profile and the census's
 * gender choices.
 *
 * Safe to run again: anything already there is left alone, so a permission
 * the Permisos tab changed is never put back to its default (the one-time
 * `grantEveryPermissionOnce` aside). Fees are not seeded — the board sets
 * them in Configuración.
 */
export function seedDatabase(db: Db, timeZone: string): void {
  inTransaction(db, (tx) => {
    tx
      .insert(roles)
      .values(ROLES.map((role, index) => ({ code: role.code, name: role.name, sortOrder: index })))
      .onConflictDoNothing()
      .run();

    tx
      .insert(rolePermissions)
      .values(
        ROLES.flatMap((role) =>
          PERMISSION_CODES.map((permission) => ({
            roleCode: role.code,
            permission,
            granted: DEFAULT_MATRIX[role.code].has(permission),
          })),
        ),
      )
      .onConflictDoNothing()
      .run();

    grantEveryPermissionOnce(tx, timeZone);

    tx
      .insert(categories)
      .values([
        ...DEFAULT_CATEGORIES.income.map((name) => ({ kind: "income" as const, name })),
        ...DEFAULT_CATEGORIES.expense.map((name) => ({ kind: "expense" as const, name })),
      ])
      .onConflictDoNothing()
      .run();

    const hasSetting = (key: string) =>
      tx.select({ id: settings.id }).from(settings).where(eq(settings.key, key)).limit(1).get() !== undefined;

    if (!hasSetting("village_profile")) {
      tx.insert(settings).values({
        key: "village_profile",
        value: {
          village: "Aldea Zoilabe",
          municipality: "Tela",
          department: "Atlántida",
          boardName: "Junta Administradora de Agua de Zoilabe",
          registrationNumber: null,
        },
        effectiveFrom: businessToday(timeZone),
      }).run();
    }

    // The census's gender choices (App Plan: "List kept in Configuration").
    if (!hasSetting("genders")) {
      tx.insert(settings).values({
        key: "genders",
        value: DEFAULT_GENDERS,
        effectiveFrom: businessToday(timeZone),
      }).run();
    }
  });
}
