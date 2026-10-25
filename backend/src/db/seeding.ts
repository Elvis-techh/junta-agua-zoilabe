import { sql } from "drizzle-orm";

import { DEFAULT_MATRIX, PERMISSION_CODES, ROLES } from "../lib/permissions.js";
import { businessToday } from "../lib/time.js";
import type { Db } from "./client.js";
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
 * Fill a new database with what the board starts from: the eight roles, the
 * permission matrix, the categories, the village profile and the census's
 * gender choices.
 *
 * Safe to run again: anything already there is left alone, so a permission
 * the Permisos tab changed is never put back to its default. Fees are not
 * seeded — the board sets them in Configuración.
 */
export async function seedDatabase(db: Db, timeZone: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(roles)
      .values(ROLES.map((role, index) => ({ code: role.code, name: role.name, sortOrder: index })))
      .onConflictDoNothing();

    await tx
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
      .onConflictDoNothing();

    await tx
      .insert(categories)
      .values([
        ...DEFAULT_CATEGORIES.income.map((name) => ({ kind: "income" as const, name })),
        ...DEFAULT_CATEGORIES.expense.map((name) => ({ kind: "expense" as const, name })),
      ])
      .onConflictDoNothing();

    const profile = await tx.execute(sql`SELECT 1 FROM settings WHERE key = 'village_profile'`);
    if (profile.rowCount === 0) {
      await tx.insert(settings).values({
        key: "village_profile",
        value: {
          village: "Aldea Zoilabe",
          municipality: "Tela",
          department: "Atlántida",
          boardName: "Junta Administradora de Agua de Zoilabe",
          registrationNumber: null,
        },
        effectiveFrom: businessToday(timeZone),
      });
    }

    // The census's gender choices (App Plan: "List kept in Configuration").
    const genders = await tx.execute(sql`SELECT 1 FROM settings WHERE key = 'genders'`);
    if (genders.rowCount === 0) {
      await tx.insert(settings).values({
        key: "genders",
        value: DEFAULT_GENDERS,
        effectiveFrom: businessToday(timeZone),
      });
    }
  });
}
