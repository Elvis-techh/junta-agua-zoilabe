import { eq } from "drizzle-orm";
import { DEFAULT_MATRIX, PERMISSION_CODES, ROLES } from "../lib/permissions.js";
import { businessToday } from "../lib/time.js";
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
};
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
export function seedDatabase(db, timeZone) {
    inTransaction(db, (tx) => {
        tx
            .insert(roles)
            .values(ROLES.map((role, index) => ({ code: role.code, name: role.name, sortOrder: index })))
            .onConflictDoNothing()
            .run();
        tx
            .insert(rolePermissions)
            .values(ROLES.flatMap((role) => PERMISSION_CODES.map((permission) => ({
            roleCode: role.code,
            permission,
            granted: DEFAULT_MATRIX[role.code].has(permission),
        }))))
            .onConflictDoNothing()
            .run();
        tx
            .insert(categories)
            .values([
            ...DEFAULT_CATEGORIES.income.map((name) => ({ kind: "income", name })),
            ...DEFAULT_CATEGORIES.expense.map((name) => ({ kind: "expense", name })),
        ])
            .onConflictDoNothing()
            .run();
        const hasSetting = (key) => tx.select({ id: settings.id }).from(settings).where(eq(settings.key, key)).limit(1).get() !== undefined;
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
//# sourceMappingURL=seeding.js.map