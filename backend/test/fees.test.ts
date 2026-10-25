import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { newId } from "../src/auth/session.js";
import { categories, households, months, sectors, transactions } from "../src/db/schema.js";
import { differentFeeStart, firstOfMonth, lastPaidMonth, monthAfter } from "../src/lib/fees.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser } from "./helpers.js";

describe("when a different fee starts", () => {
  it("is the month after the last payment, rolling over the year", () => {
    assert.equal(differentFeeStart("2026-09-01", "2026-10-25"), "2026-10-01");
    assert.equal(differentFeeStart("2026-12-01", "2026-10-25"), "2027-01-01");
    // Paid ahead: the new amount waits until the months already paid are over.
    assert.equal(differentFeeStart("2027-03-01", "2026-10-25"), "2027-04-01");
    assert.equal(monthAfter("2028-02-29"), "2028-03-01");
  });

  it("is this month when nothing has been paid yet", () => {
    assert.equal(differentFeeStart(null, "2026-10-25"), "2026-10-01");
    assert.equal(firstOfMonth("2026-10-25"), "2026-10-01");
  });
});

describe("a house's last payment", () => {
  let t: TestApp;
  let treasurerId: string;
  let householdId: string;
  let monthId: number;
  let categoryId: number;

  before(async () => {
    t = await buildTestApp();
    treasurerId = (await signedInUser(t, "tesorero")).id;

    const [sector] = await t.adminDb.insert(sectors).values({ name: "El Centro" }).returning();
    householdId = newId();
    await t.adminDb.insert(households).values({
      id: householdId,
      code: "Z-0001",
      sectorId: sector!.id,
      references: "Frente a la iglesia",
      waterConnection: "connected",
      status: "active",
      submissionId: newId(),
    });
    const [month] = await t.adminDb.insert(months).values({ month: "2026-10-01", status: "open" }).returning();
    monthId = month!.id;
    const [fee] = await t.adminDb.select().from(categories).where(eq(categories.name, "Cuota mensual"));
    categoryId = fee!.id;
  });
  after(async () => {
    await t.close();
  });

  const pay = async (monthsCovered: string[], amountCentavos: number, reversesId: string | null = null) => {
    const id = newId();
    await t.db.insert(transactions).values({
      id,
      kind: "income",
      categoryId,
      householdId,
      monthId,
      occurredOn: "2026-10-20",
      amountCentavos,
      monthsCovered,
      paymentMethod: "cash",
      reversesId,
      reason: reversesId ? "Registrado por error" : null,
      createdBy: treasurerId,
    });
    return id;
  };

  it("is none for a house that has not paid", async () => {
    assert.equal(await lastPaidMonth(t.db, householdId), null);
  });

  it("is the latest month any payment covers", async () => {
    await pay(["2026-08-01", "2026-09-01"], 14000);
    assert.equal(await lastPaidMonth(t.db, householdId), "2026-09-01");
  });

  it("ignores a payment that was reversed", async () => {
    const mistaken = await pay(["2026-12-01"], 7000);
    assert.equal(await lastPaidMonth(t.db, householdId), "2026-12-01");

    await pay(["2026-12-01"], -7000, mistaken);
    assert.equal(await lastPaidMonth(t.db, householdId), "2026-09-01");
  });
});
