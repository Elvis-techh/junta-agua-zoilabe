import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, sql } from "drizzle-orm";

import { newId } from "../src/auth/session.js";
import { APPEND_ONLY_TABLES, appTables } from "../src/db/guards.js";
import { runMigrations } from "../src/db/migrations.js";
import { categories, months, rolePermissions, roles, sectors, settings, transactions, users } from "../src/db/schema.js";
import type { TestDatabase } from "./helpers.js";
import { createTestDatabase, nextPhone, rejectsWithDbError } from "./helpers.js";

const triggers = (t: TestDatabase) =>
  (t.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>).map(
    (row) => row.name,
  );

describe("what the database itself refuses", () => {
  let t: TestDatabase;
  before(async () => {
    t = await createTestDatabase();
  });
  after(async () => {
    await t.close();
  });

  it("guards every table against deletes, and the two history tables against changes", () => {
    const tables = appTables(t.sqlite);
    assert.ok(tables.length >= 17, tables.join(", "));

    const present = triggers(t);
    for (const table of tables) {
      assert.ok(present.includes(`${table}_no_delete`), `${table} can be deleted from`);
    }
    for (const table of APPEND_ONLY_TABLES) {
      assert.ok(present.includes(`${table}_no_update`), `${table} can be changed`);
    }
  });

  it("refuses to delete a role, a permission, a setting or a user", async () => {
    await rejectsWithDbError(t.db.delete(roles), /nothing is deleted: roles/);
    await rejectsWithDbError(t.db.delete(rolePermissions), /nothing is deleted: role_permissions/);
    await rejectsWithDbError(t.db.delete(settings), /nothing is deleted: settings/);

    const id = newId();
    await t.db.insert(users).values({ id, name: "Ana Prueba", phone: nextPhone(), roleCode: "tesorero", status: "invited" });
    await rejectsWithDbError(t.db.delete(users).where(eq(users.id, id)), /nothing is deleted: users/);

    // A user's status still changes: only deletes are refused there.
    await t.db.update(users).set({ status: "active" }).where(eq(users.id, id));
    const [row] = await t.db.select({ status: users.status }).from(users).where(eq(users.id, id));
    assert.equal(row?.status, "active");
  });

  it("refuses to change or remove a money entry; a mistake gets a reversal instead", async () => {
    const treasurer = newId();
    await t.db.insert(users).values({ id: treasurer, name: "Tesorera", phone: nextPhone(), roleCode: "tesorero", status: "active" });
    const [category] = await t.db.select().from(categories).where(eq(categories.name, "Cuota mensual"));
    const [month] = await t.db.insert(months).values({ month: "2026-10-01", status: "open" }).returning();

    const id = newId();
    await t.db.insert(transactions).values({
      id,
      kind: "income",
      categoryId: category!.id,
      monthId: month!.id,
      occurredOn: "2026-10-20",
      amountCentavos: 7000,
      monthsCovered: ["2026-10-01"],
      paymentMethod: "cash",
      createdBy: treasurer,
    });

    await rejectsWithDbError(
      t.db.update(transactions).set({ amountCentavos: 70 }).where(eq(transactions.id, id)),
      /history is never changed: transactions/,
    );
    await rejectsWithDbError(t.db.delete(transactions).where(eq(transactions.id, id)), /nothing is deleted: transactions/);

    await t.db.insert(transactions).values({
      id: newId(),
      kind: "income",
      categoryId: category!.id,
      monthId: month!.id,
      occurredOn: "2026-10-21",
      amountCentavos: -7000,
      monthsCovered: ["2026-10-01"],
      paymentMethod: "cash",
      reversesId: id,
      reason: "Registrado dos veces",
      createdBy: treasurer,
    });
    const [total] = await t.db
      .select({ sum: sql<number>`sum(${transactions.amountCentavos})` })
      .from(transactions);
    assert.equal(total?.sum, 0);
  });

  it("refuses REPLACE, which deletes the row in its way instead of changing it", async () => {
    const treasurer = newId();
    await t.db.insert(users).values({ id: treasurer, name: "Tesorero", phone: nextPhone(), roleCode: "tesorero", status: "active" });
    const [category] = await t.db.select().from(categories).where(eq(categories.name, "Cuota mensual"));
    const [month] = await t.db.insert(months).values({ month: "2026-12-01", status: "open" }).returning();

    const id = newId();
    const entry = {
      id,
      kind: "income" as const,
      categoryId: category!.id,
      monthId: month!.id,
      occurredOn: "2026-12-05",
      amountCentavos: 7000,
      paymentMethod: "cash" as const,
      createdBy: treasurer,
    };
    await t.db.insert(transactions).values(entry);

    const replace = t.sqlite.prepare(
      `INSERT OR REPLACE INTO transactions (id, kind, category_id, month_id, occurred_on, amount_centavos, created_by)
       VALUES (?, 'income', ?, ?, '2026-12-05', 70, ?)`,
    );
    assert.throws(() => replace.run(id, category!.id, month!.id, treasurer), /nothing is deleted: transactions/);
    const [kept] = await t.db.select().from(transactions).where(eq(transactions.id, id));
    assert.equal(kept?.amountCentavos, 7000);

    const [first] = await t.db.insert(sectors).values({ name: "Reemplazo A" }).returning();
    await t.db.insert(sectors).values({ name: "Reemplazo B" });
    assert.throws(
      () => t.sqlite.prepare(`UPDATE OR REPLACE sectors SET name = 'Reemplazo B' WHERE id = ?`).run(first!.id),
      /nothing is deleted: sectors/,
    );
  });

  it("puts a guard back on the next start if a table lost it", () => {
    // SQLite changes a column by rebuilding the table, which drops its triggers.
    t.sqlite.exec("DROP TRIGGER users_no_delete; DROP TRIGGER audit_log_no_update");
    assert.equal(triggers(t).includes("users_no_delete"), false);

    runMigrations(t.db, t.sqlite);

    assert.ok(triggers(t).includes("users_no_delete"));
    assert.ok(triggers(t).includes("audit_log_no_update"));
  });

  it("keeps foreign keys and the plan's checks switched on", async () => {
    assert.equal(t.sqlite.pragma("foreign_keys", { simple: true }), 1);
    await rejectsWithDbError(
      t.db.insert(users).values({ id: newId(), name: "Sin cargo", phone: nextPhone(), roleCode: "no_existe", status: "invited" }),
      /FOREIGN KEY constraint failed/,
    );
    await rejectsWithDbError(
      t.db.insert(users).values({ id: newId(), name: "Teléfono corto", phone: "1234", roleCode: "fiscal", status: "invited" }),
      /users_phone_digits/,
    );
    await rejectsWithDbError(t.db.insert(months).values({ month: "2026-11-15", status: "open" }), /months_first_day/);
  });
});
