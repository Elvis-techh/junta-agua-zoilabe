import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it, mock } from "node:test";

import { and, eq, isNull } from "drizzle-orm";

import { auditLog, owedMonths, settings } from "../src/db/schema.js";
import { allocatePayment } from "../src/lib/payments.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

// 13 November 2026, midday in Honduras, the day the owner answered the last questions.
const now = new Date("2026-11-13T18:00:00.000Z");

/** A signed-in app with fees from the paper book's years, and a way to register houses. */
async function village() {
  const t = await buildTestApp();
  const president = await signedInUser(t, "presidente", "Ana Presidenta");
  const treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
  const secretary = await signedInUser(t, "secretario");
  const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  // L 70 from 2023, L 80 from 2025; a late fee of L 20 only from June 2023.
  for (const [kind, amountCentavos, startsOn] of [
    ["base_monthly", 7000, "2023-01-01"],
    ["base_monthly", 8000, "2025-01-01"],
    ["late_fee", 2000, "2023-06-01"],
  ] as const) {
    const saved = await call(president.cookie, "POST", "/api/settings/fees", { kind, amountCentavos, startsOn });
    assert.equal(saved.statusCode, 201, saved.body);
  }
  const sector = await call(president.cookie, "POST", "/api/settings/sectors", { name: "El Centro" });

  let idCounter = 801199200000;
  const register = async (fee: object = { kind: "base" }) => {
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "maría lópez", idNumber: String((idCounter += 1)).padStart(13, "0"), phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Junto al río", waterConnection: "connected", relation: "owner" },
      fee,
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };
  const enter = (householdId: string, months: Array<{ month: string; lateFee: boolean }>, cookie = treasurer.cookie) =>
    call(cookie, "POST", `/api/finance/households/${householdId}/owed`, { months });
  const entries = async (householdId: string) => {
    const response = await call(treasurer.cookie, "GET", `/api/finance/households/${householdId}/owed`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().entries as Array<{
      id: string;
      month: string;
      priceCentavos: number;
      lateFeeCentavos: number | null;
      paidCentavos: number;
    }>;
  };
  let receipt = 7000;
  const pay = (householdId: string, months: string[], amountCentavos: number) =>
    call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId,
      months,
      amountCentavos,
      occurredOn: "2026-11-13",
      paymentMethod: "cash",
      paperReceiptNumber: String((receipt += 1)),
    });

  return { t, president, treasurer, secretary, call, register, enter, entries, pay };
}

describe("Configuración → Mes de inicio", () => {
  let v: Awaited<ReturnType<typeof village>>;

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    v = await village();
  });
  after(async () => {
    await v.t.close();
    mock.timers.reset();
  });

  it("starts unsaved, and no old month can be entered until it is", async () => {
    const shown = await v.call(v.president.cookie, "GET", "/api/settings/start-month");
    assert.equal(shown.statusCode, 200, shown.body);
    assert.equal(shown.json().startMonth, null);

    const house = await v.register();
    const early = await v.enter(house.id, [{ month: "2024-03-01", lateFee: false }]);
    assert.equal(early.statusCode, 409);
    assert.equal(early.json().error, "no_start_month");
    assert.equal((await v.t.db.select().from(owedMonths)).length, 0);
  });

  it("is kept to roles with settings:edit: the server refuses anyone else", async () => {
    takeAway(v.t, "tesorero", "settings:edit");
    const refused = await v.call(v.treasurer.cookie, "POST", "/api/settings/start-month", { month: "2026-12-01" });
    assert.equal(refused.statusCode, 403);
  });

  it("refuses something that is not a month", async () => {
    for (const month of ["2026-12-15", "2026-13-01", "1999-12-01", "diciembre"]) {
      const response = await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month });
      assert.equal(response.statusCode, 400, month);
    }
  });

  it("is saved once, with who and when, and logged under Configuración", async () => {
    const saved = await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month: "2026-12-01" });
    assert.equal(saved.statusCode, 201, saved.body);
    assert.equal(saved.json().startMonth.month, "2026-12-01");
    assert.equal(saved.json().startMonth.savedBy, "Ana Presidenta");

    const [logged] = await v.t.db.select().from(auditLog).where(eq(auditLog.action, "start_month.set"));
    assert.equal(logged!.area, "settings");
    assert.equal(logged!.summary, "Ana Presidenta (Presidente) fijó el mes de inicio en diciembre de 2026");
  });

  it("cannot be changed afterwards (owner, 13 November 2026)", async () => {
    const again = await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month: "2027-01-01" });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error, "start_month_saved");
    assert.equal(again.json().message, "El mes de inicio ya se guardó: diciembre de 2026. No se puede cambiar.");
    const shown = await v.call(v.president.cookie, "GET", "/api/settings/start-month");
    assert.equal(shown.json().startMonth.month, "2026-12-01");
  });

  it("cannot be saved a second time even from outside the app: the database refuses it", async () => {
    await rejectsWithDbError(
      v.t.db.insert(settings).values({ key: "start_month", value: "2027-01-01", effectiveFrom: "2026-11-13" }),
      /UNIQUE constraint failed/,
    );
    const rows = await v.t.db.select().from(settings).where(eq(settings.key, "start_month"));
    assert.equal(rows.length, 1);
  });
});

describe("Deuda anterior: the months a house already owed", () => {
  let v: Awaited<ReturnType<typeof village>>;
  let house: { id: string; code: string };

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    v = await village();
    const saved = await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month: "2026-12-01" });
    assert.equal(saved.statusCode, 201, saved.body);
    house = await v.register();
  });
  after(async () => {
    await v.t.close();
    mock.timers.reset();
  });

  it("enters the months the paper book shows, each at the fee for its month, with mora only where ticked, and logs it", async () => {
    const response = await v.enter(house.id, [
      { month: "2025-02-01", lateFee: false },
      { month: "2024-03-01", lateFee: true },
      { month: "2024-04-01", lateFee: false },
    ]);
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().created, 3);

    const list = await v.entries(house.id);
    assert.deepEqual(
      list.map(({ month, priceCentavos, lateFeeCentavos, paidCentavos }) => ({ month, priceCentavos, lateFeeCentavos, paidCentavos })),
      [
        { month: "2024-03-01", priceCentavos: 7000, lateFeeCentavos: 2000, paidCentavos: 0 },
        { month: "2024-04-01", priceCentavos: 7000, lateFeeCentavos: null, paidCentavos: 0 },
        { month: "2025-02-01", priceCentavos: 8000, lateFeeCentavos: null, paidCentavos: 0 },
      ],
    );

    const [logged] = await v.t.db.select().from(auditLog).where(eq(auditLog.action, "owed_months.entered"));
    assert.equal(logged!.area, "finances");
    assert.equal(
      logged!.summary,
      `Tina Tesorera (Tesorero/a) anotó deuda anterior de la vivienda ${house.code}: ` +
        "marzo, abril de 2024 y febrero de 2025 (L 220.00), con mora en marzo de 2024 (L 20.00)",
    );
  });

  it("takes a second tap or a retry on weak signal as done, not as a second entry", async () => {
    const logged = (await v.t.db.select().from(auditLog)).length;
    const again = await v.enter(house.id, [{ month: "2024-03-01", lateFee: true }]);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().created, 0);
    assert.equal((await v.entries(house.id)).length, 3);
    assert.equal((await v.t.db.select().from(auditLog)).length, logged);
  });

  it("refuses a month already entered the other way, and says how to change it", async () => {
    const response = await v.enter(house.id, [{ month: "2024-04-01", lateFee: true }]);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "already_entered");
    assert.equal(response.json().message, "Abril de 2024 ya está anotado sin mora. Para cambiarlo, quítelo y anótelo de nuevo.");
  });

  it("refuses the start month and later ones: those are charged in Cobrar", async () => {
    const response = await v.enter(house.id, [{ month: "2026-12-01", lateFee: false }]);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "not_before_start");
    assert.match(response.json().message, /^Solo se anotan meses de antes de diciembre de 2026, el mes de inicio\./);
  });

  it("refuses a month with no fee, and a late fee for a month with none, and saves nothing of that try", async () => {
    const count = (await v.t.db.select().from(owedMonths)).length;
    const noFee = await v.enter(house.id, [
      { month: "2024-05-01", lateFee: false },
      { month: "2022-05-01", lateFee: false },
    ]);
    assert.equal(noFee.statusCode, 409);
    assert.equal(noFee.json().error, "no_fee");
    assert.match(noFee.json().message, /^No hay cuota para mayo de 2022\./);

    const noLateFee = await v.enter(house.id, [{ month: "2023-02-01", lateFee: true }]);
    assert.equal(noLateFee.statusCode, 409);
    assert.equal(noLateFee.json().error, "no_late_fee");
    assert.equal((await v.t.db.select().from(owedMonths)).length, count);
  });

  it("charges a house with a different amount that amount, even before it was entered in the app (12 November)", async () => {
    // Registered today with L 90, so its amount starts in November 2026.
    const different = await v.register({ kind: "different", monthlyAmountCentavos: 9000, reason: "Dos familias" });
    const response = await v.enter(different.id, [{ month: "2024-03-01", lateFee: false }]);
    assert.equal(response.statusCode, 201, response.body);
    assert.equal((await v.entries(different.id))[0]!.priceCentavos, 9000);
  });

  it("is kept to roles with finance:record, and the list to those with finance:view", async () => {
    const vocal = await signedInUser(v.t, "primer_vocal");
    takeAway(v.t, "primer_vocal", "finance:record");
    const refused = await v.enter(house.id, [{ month: "2024-06-01", lateFee: false }], vocal.cookie);
    assert.equal(refused.statusCode, 403);
    takeAway(v.t, "secretario", "finance:view");
    const hidden = await v.call(v.secretary.cookie, "GET", `/api/finance/households/${house.id}/owed`);
    assert.equal(hidden.statusCode, 403);
  });

  it("shows a year's months before the start month for the grid, with what each would cost", async () => {
    const response = await v.call(v.treasurer.cookie, "GET", `/api/finance/households/${house.id}/owed/options?year=2024`);
    assert.equal(response.statusCode, 200, response.body);
    const months = new Map(
      (response.json().months as Array<{ month: string; priceCentavos: number; entered: boolean; enteredWithLateFee: boolean }>).map(
        (m) => [m.month, m],
      ),
    );
    assert.equal(months.size, 12);
    assert.deepEqual(months.get("2024-03-01"), {
      month: "2024-03-01",
      priceCentavos: 7000,
      lateFeeCentavos: 2000,
      entered: true,
      enteredWithLateFee: true,
      paidCentavos: 0,
    });
    assert.equal(months.get("2024-05-01")!.entered, false);

    const thisYear = await v.call(v.treasurer.cookie, "GET", `/api/finance/households/${house.id}/owed/options?year=2026`);
    assert.equal(thisYear.json().months.length, 11, "January to November: December is the start month");
    const later = await v.call(v.treasurer.cookie, "GET", `/api/finance/households/${house.id}/owed/options?year=2027`);
    assert.equal(later.json().months.length, 0);
  });
});

describe("Cobrar with a start month (owner, 13 November 2026)", () => {
  let v: Awaited<ReturnType<typeof village>>;
  let house: { id: string; code: string };

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    v = await village();
    await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month: "2026-12-01" });
    house = await v.register();
    const entered = await v.enter(house.id, [
      { month: "2024-03-01", lateFee: false },
      { month: "2024-04-01", lateFee: false },
    ]);
    assert.equal(entered.statusCode, 201, entered.body);
  });
  after(async () => {
    await v.t.close();
    mock.timers.reset();
  });

  it("offers a month before the start month only if it was entered as owed", async () => {
    const response = await v.call(v.treasurer.cookie, "GET", `/api/finance/households/${house.id}/months?from=2024-01-01&to=2024-12-01`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().startMonth, "2026-12-01");
    const months = new Map(
      (response.json().months as Array<{ month: string; beforeStart: boolean; owed: { id: string } | null; priceCentavos: number }>).map(
        (m) => [m.month, m],
      ),
    );
    assert.equal(months.get("2024-03-01")!.beforeStart, true);
    assert.ok(months.get("2024-03-01")!.owed);
    assert.equal(months.get("2024-03-01")!.priceCentavos, 7000);
    assert.equal(months.get("2024-05-01")!.owed, null);

    const notOwed = await v.pay(house.id, ["2026-10-01"], 8000);
    assert.equal(notOwed.statusCode, 409);
    assert.equal(notOwed.json().error, "not_owed");
    assert.equal(
      notOwed.json().message,
      "Octubre de 2026 es de antes del mes de inicio y no está anotado como deuda anterior. Quítelo de la lista.",
    );
  });

  it("charges an old month at the price it was entered at", async () => {
    const paid = await v.pay(house.id, ["2024-03-01"], 7000);
    assert.equal(paid.statusCode, 201, paid.body);
    assert.deepEqual(paid.json().payment.shares, [{ month: "2024-03-01", amountCentavos: 7000, priceCentavos: 7000 }]);
    assert.equal((await v.entries(house.id)).find((entry) => entry.month === "2024-03-01")!.paidCentavos, 7000);
  });

  it("lists the old months still owed above the recent ones, so they need no searching", async () => {
    const response = await v.call(v.treasurer.cookie, "GET", `/api/finance/households/${house.id}/months`);
    assert.equal(response.statusCode, 200, response.body);
    // March was paid in full above; April is still owed.
    assert.deepEqual(
      (response.json().owedBefore as Array<{ month: string }>).map((state) => state.month),
      ["2024-04-01"],
    );
    assert.equal(response.json().months[0].month, "2026-08-01");
  });

  it("charges the start month and later ones as before", async () => {
    const paid = await v.pay(house.id, ["2026-12-01"], 8000);
    assert.equal(paid.statusCode, 201, paid.body);
  });

  it("refuses a month not owed in the sharing rule itself, before any price", () => {
    const result = allocatePayment([{ month: "2026-10-01", priceCentavos: 8000, paidCentavos: 0, beforeStart: true, owed: null }], 8000);
    assert.equal("code" in result && result.code, "not_owed");
  });
});

describe("Quitar a month entered as owed by mistake (owner, 13 November 2026)", () => {
  let v: Awaited<ReturnType<typeof village>>;
  let house: { id: string; code: string };
  const remove = (id: string, payload: object, cookie = v.treasurer.cookie) => v.call(cookie, "POST", `/api/finance/owed/${id}/remove`, payload);

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    v = await village();
    await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month: "2026-12-01" });
    house = await v.register();
    const entered = await v.enter(house.id, [
      { month: "2024-03-01", lateFee: false },
      { month: "2024-07-01", lateFee: true },
    ]);
    assert.equal(entered.statusCode, 201, entered.body);
  });
  after(async () => {
    await v.t.close();
    mock.timers.reset();
  });

  it("asks why, and is kept to roles with finance:reverse", async () => {
    const [march] = await v.entries(house.id);
    const noReason = await remove(march!.id, { reason: "" });
    assert.equal(noReason.statusCode, 400);
    const vocal = await signedInUser(v.t, "segundo_vocal");
    takeAway(v.t, "segundo_vocal", "finance:reverse");
    const refused = await remove(march!.id, { reason: "Se anotó en la vivienda equivocada" }, vocal.cookie);
    assert.equal(refused.statusCode, 403);
  });

  it("removes it: it stops counting, stays in the database with who and why, and the month can be entered again", async () => {
    const july = (await v.entries(house.id)).find((entry) => entry.month === "2024-07-01")!;
    const response = await remove(july.id, { reason: "El libro dice que sí pagó" });
    assert.equal(response.statusCode, 200, response.body);

    assert.deepEqual(
      (await v.entries(house.id)).map((entry) => entry.month),
      ["2024-03-01"],
    );
    const [kept] = await v.t.db.select().from(owedMonths).where(eq(owedMonths.id, july.id));
    assert.ok(kept!.removedAt);
    assert.equal(kept!.removedReason, "El libro dice que sí pagó");
    assert.equal(kept!.removedBy, v.treasurer.id);

    const [logged] = await v.t.db.select().from(auditLog).where(eq(auditLog.action, "owed_month.removed"));
    assert.equal(
      logged!.summary,
      `Tina Tesorera (Tesorero/a) quitó la deuda anterior de julio de 2024 (L 70.00, con mora de L 20.00) de la vivienda ${house.code}`,
    );
    assert.equal(logged!.reason, "El libro dice que sí pagó");

    const again = await remove(july.id, { reason: "Otra vez" });
    assert.equal(again.statusCode, 404);
    const reentered = await v.enter(house.id, [{ month: "2024-07-01", lateFee: false }]);
    assert.equal(reentered.statusCode, 201, reentered.body);
  });

  it("is refused once a payment covers the month, and allowed again once that payment is reversed", async () => {
    const [march] = await v.entries(house.id);
    const paid = await v.pay(house.id, ["2024-03-01"], 3000);
    assert.equal(paid.statusCode, 201, paid.body);
    const refused = await remove(march!.id, { reason: "Se anotó por error" });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "already_paid");

    const reversed = await v.call(v.treasurer.cookie, "POST", `/api/finance/payments/${paid.json().payment.id}/reverse`, {
      reason: "Se registró en la vivienda equivocada",
    });
    assert.equal(reversed.statusCode, 200, reversed.body);
    const removed = await remove(march!.id, { reason: "Se anotó por error" });
    assert.equal(removed.statusCode, 200, removed.body);
  });

  it("is never deleted, and never removed without a reason, even from outside the app", async () => {
    await rejectsWithDbError(v.t.db.delete(owedMonths), /nothing is deleted: owed_months/);
    const [entry] = await v.t.db
      .select()
      .from(owedMonths)
      .where(and(eq(owedMonths.householdId, house.id), isNull(owedMonths.removedAt)));
    await rejectsWithDbError(
      v.t.db.update(owedMonths).set({ removedAt: new Date(), removedReason: null }).where(eq(owedMonths.id, entry!.id)),
      /CHECK constraint failed: owed_months_removed_reason/,
    );
  });
});

describe("a fee change over months entered as owed (12 November 2026)", () => {
  let v: Awaited<ReturnType<typeof village>>;
  let house: { id: string; code: string };
  const rates = async (kind: string) => {
    const list = await v.call(v.president.cookie, "GET", "/api/settings/fees");
    return list.json().fees.find((fee: { kind: string }) => fee.kind === kind).rates as Array<{
      id: number;
      startsOn: string;
      correctable: boolean;
    }>;
  };

  before(async () => {
    mock.timers.enable({ apis: ["Date"], now });
    v = await village();
    await v.call(v.president.cookie, "POST", "/api/settings/start-month", { month: "2026-12-01" });
    house = await v.register();
    const entered = await v.enter(house.id, [{ month: "2023-08-01", lateFee: false }]);
    assert.equal(entered.statusCode, 201, entered.body);
  });
  after(async () => {
    await v.t.close();
    mock.timers.reset();
  });

  it("is refused when it would start before an entered month, and says so", async () => {
    const response = await v.call(v.president.cookie, "POST", "/api/settings/fees", {
      kind: "base_monthly",
      amountCentavos: 7500,
      startsOn: "2023-07-01",
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "months_paid");
    assert.equal(response.json().message, "Agosto de 2023 ya tiene deuda anterior anotada. Lo más pronto que puede empezar es septiembre de 2023.");
  });

  it("does not let the amount that priced an entered month be corrected or removed", async () => {
    const first = (await rates("base_monthly")).find((rate) => rate.startsOn === "2023-01-01")!;
    assert.equal(first.correctable, false);
    const corrected = await v.call(v.president.cookie, "PATCH", `/api/settings/fees/${first.id}`, {
      amountCentavos: 7100,
      reason: "Se escribió mal",
    });
    assert.equal(corrected.statusCode, 409);
    assert.match(corrected.json().message, /^Ya hay deuda anterior anotada en esos meses, así que este monto no se corrige\./);
  });

  it("counts an entered month for the late fee only when it was entered with its mora", async () => {
    const before = await v.call(v.president.cookie, "POST", "/api/settings/fees", {
      kind: "late_fee",
      amountCentavos: 2500,
      startsOn: "2023-07-01",
    });
    assert.equal(before.statusCode, 201, before.body);

    const withMora = await v.enter(house.id, [{ month: "2023-09-01", lateFee: true }]);
    assert.equal(withMora.statusCode, 201, withMora.body);
    assert.equal((await v.entries(house.id)).find((entry) => entry.month === "2023-09-01")!.lateFeeCentavos, 2500);
    const refused = await v.call(v.president.cookie, "POST", "/api/settings/fees", {
      kind: "late_fee",
      amountCentavos: 3000,
      startsOn: "2023-08-01",
    });
    assert.equal(refused.statusCode, 409);
    assert.match(refused.json().message, /^Septiembre de 2023 ya tiene deuda anterior anotada/);
  });

  it("is free again once the entered months are removed", async () => {
    for (const entry of await v.entries(house.id)) {
      const removed = await v.call(v.treasurer.cookie, "POST", `/api/finance/owed/${entry.id}/remove`, { reason: "Estaba pagado" });
      assert.equal(removed.statusCode, 200, removed.body);
    }
    const response = await v.call(v.president.cookie, "POST", "/api/settings/fees", {
      kind: "base_monthly",
      amountCentavos: 7500,
      startsOn: "2023-07-01",
    });
    assert.equal(response.statusCode, 201, response.body);
  });
});
