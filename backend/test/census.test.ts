import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, feeRates, householdFees, households, people, rolePermissions } from "../src/db/schema.js";
import { verifyChain } from "../src/lib/audit.js";
import { capitalizeName, householdCode, maskDigits } from "../src/lib/census.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser } from "./helpers.js";

describe("census rules", () => {
  it("capitalizes names the way the village writes them", () => {
    assert.equal(capitalizeName("  juan  PÉREZ de la cruz "), "Juan Pérez de la Cruz");
    assert.equal(capitalizeName("maría josé gómez-rivera"), "María José Gómez-Rivera");
    assert.equal(capitalizeName("del carmen lópez"), "Del Carmen López");
  });

  it("masks all but the last digits", () => {
    assert.equal(maskDigits("0801199012345", 4), "•••••••••2345");
    assert.equal(maskDigits("99998888", 2), "••••••88");
    assert.equal(maskDigits(null, 4), null);
  });

  it("writes household codes as Z-0001", () => {
    assert.equal(householdCode(1), "Z-0001");
    assert.equal(householdCode(123), "Z-0123");
    assert.equal(householdCode(10000), "Z-10000");
  });
});

describe("census", () => {
  let t: TestApp;
  let admin: { cookie: string };
  let secretary: { cookie: string };
  let treasurer: { cookie: string };
  let vocal: { cookie: string };
  let sectorId: number;
  let idCounter = 801199000000;

  /** A fresh 13-digit ID number nobody has used yet. */
  const nextIdNumber = () => String((idCounter += 1)).padStart(13, "0");

  const call = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const registration = (overrides: Record<string, unknown> = {}) => ({
    submissionId: randomUUID(),
    person: { fullName: "juan pérez", idNumber: nextIdNumber(), phone: "99887766", gender: "Hombre" },
    household: {
      sectorId,
      references: "Frente a la iglesia, portón verde",
      waterConnection: "connected",
      relation: "owner",
    },
    fee: { kind: "base" },
    ...overrides,
  });

  before(async () => {
    t = await buildTestApp();
    admin = await signedInUser(t, "administrador", "Ana Admin");
    secretary = await signedInUser(t, "secretario", "Sara Secretaria");
    treasurer = await signedInUser(t, "tesorero");
    vocal = await signedInUser(t, "primer_vocal");

    const created = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "El Centro" });
    assert.equal(created.statusCode, 201);
    sectorId = created.json().sector.id;
  });
  after(async () => {
    await t.close();
  });

  it("registers a household with the next code and logs it in Census", async () => {
    const first = await call(secretary.cookie, "POST", "/api/census/households", registration());
    assert.equal(first.statusCode, 201, first.body);
    assert.match(first.json().household.code, /^Z-\d{4}$/);

    const second = await call(secretary.cookie, "POST", "/api/census/households", registration());
    const firstNumber = Number(first.json().household.code.slice(2));
    assert.equal(second.json().household.code, householdCode(firstNumber + 1));

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "household.registered"), eq(auditLog.entityId, first.json().household.id)));
    assert.ok(entry);
    assert.equal(entry.area, "census");
    assert.match(entry.summary, /Sara Secretaria \(Secretario\/a\) registró la vivienda Z-\d{4} de Juan Pérez$/);
    assert.equal((await verifyChain(t.db)).ok, true);
  });

  it("saves an entry sent twice on weak signal only once", async () => {
    const body = registration();
    const first = await call(secretary.cookie, "POST", "/api/census/households", body);
    const again = await call(secretary.cookie, "POST", "/api/census/households", body);
    assert.equal(first.statusCode, 201);
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().alreadySaved, true);
    assert.equal(again.json().household.code, first.json().household.code);

    const rows = await t.db.select().from(households).where(eq(households.submissionId, body.submissionId));
    assert.equal(rows.length, 1);
  });

  it("opens the existing person instead of registering the same ID twice", async () => {
    const body = registration();
    const idNumber = body.person.idNumber;
    assert.equal((await call(secretary.cookie, "POST", "/api/census/households", body)).statusCode, 201);

    const lookup = await call(secretary.cookie, "GET", `/api/census/people/lookup?idNumber=${idNumber}`);
    assert.equal(lookup.json().person.fullName, "Juan Pérez");
    assert.equal(lookup.json().person.households.length, 1);

    const repeat = registration({ person: { ...body.person, fullName: "Otro Nombre" } });
    const refused = await call(secretary.cookie, "POST", "/api/census/households", repeat);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "person_exists");
    // Enough for a phone that saved it without signal to offer "Agregar otra vivienda".
    assert.equal(refused.json().person.fullName, "Juan Pérez");
    assert.equal(refused.json().person.households.length, 1);

    // "Agregar otra vivienda": one person, two households.
    const added = await call(secretary.cookie, "POST", "/api/census/households", { ...repeat, addToExistingPerson: true });
    assert.equal(added.statusCode, 201);
    const after = await call(secretary.cookie, "GET", `/api/census/people/lookup?idNumber=${idNumber}`);
    assert.equal(after.json().person.households.length, 2);
    // The person's own record is not overwritten by what was typed the second time.
    assert.equal(after.json().person.fullName, "Juan Pérez");

    // Adding a house to them needs only their ID number, not their name and phone again.
    const third = await call(secretary.cookie, "POST", "/api/census/households", {
      ...registration(),
      person: { idNumber },
      addToExistingPerson: true,
    });
    assert.equal(third.statusCode, 201);
    assert.deepEqual(third.json().person, { fullName: "Juan Pérez", phone: "99887766" });

    // A new person still needs both.
    const unnamed = await call(secretary.cookie, "POST", "/api/census/households", {
      ...registration(),
      person: { idNumber: nextIdNumber(), phone: "99887766" },
    });
    assert.equal(unnamed.statusCode, 400);
    assert.match(unnamed.json().message, /nombre completo/);
  });

  it("stores the paper form's date and number beside the date typed in", async () => {
    const response = await call(
      secretary.cookie,
      "POST",
      "/api/census/households",
      registration({ paper: { date: "2026-03-03", formNumber: "17" } }),
    );
    assert.equal(response.statusCode, 201);
    const [row] = await t.db.select().from(households).where(eq(households.id, response.json().household.id));
    assert.equal(row?.paperDate, "2026-03-03");
    assert.equal(row?.paperFormNumber, "17");
    assert.ok(row?.createdAt);

    const future = await call(
      secretary.cookie,
      "POST",
      "/api/census/households",
      registration({ paper: { date: "2999-01-01" } }),
    );
    assert.equal(future.statusCode, 400);
  });

  it("needs a reason for a different fee, and logs it under Settings", async () => {
    const noReason = await call(
      secretary.cookie,
      "POST",
      "/api/census/households",
      registration({ fee: { kind: "different", monthlyAmountCentavos: 3500, reason: "" } }),
    );
    assert.equal(noReason.statusCode, 400);
    assert.match(noReason.json().message, /razón/);

    const ok = await call(
      secretary.cookie,
      "POST",
      "/api/census/households",
      registration({ fee: { kind: "different", monthlyAmountCentavos: 3500, reason: "Adulta mayor que vive sola" } }),
    );
    assert.equal(ok.statusCode, 201);
    const id = ok.json().household.id;

    const [fee] = await t.db.select().from(householdFees).where(eq(householdFees.householdId, id));
    assert.equal(fee?.monthlyAmountCentavos, 3500);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "household_fee.set"), eq(auditLog.entityId, id)));
    assert.equal(entry?.area, "settings");
    assert.equal(entry?.reason, "Adulta mayor que vive sola");
    assert.match(entry!.summary, /L 35\.00 al mes/);
  });

  it("refuses a different fee from a role that may not set one, even through the API", async () => {
    // The administrator registers census records but holds no fee permission (App Plan matrix).
    const refused = await call(
      admin.cookie,
      "POST",
      "/api/census/households",
      registration({ fee: { kind: "different", monthlyAmountCentavos: 0, reason: "Exonerada" } }),
    );
    assert.equal(refused.statusCode, 403);
    assert.equal((await call(admin.cookie, "POST", "/api/census/households", registration())).statusCode, 201);
  });

  it("lets only the census roles register", async () => {
    assert.equal((await call(treasurer.cookie, "POST", "/api/census/households", registration())).statusCode, 403);
    assert.equal((await call(vocal.cookie, "POST", "/api/census/households", registration())).statusCode, 403);
    assert.equal((await call(vocal.cookie, "GET", "/api/census/households")).statusCode, 200);
  });

  it("refuses a sector that is no longer in the list", async () => {
    const created = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "Sector Viejo" });
    const oldId = created.json().sector.id;
    await call(admin.cookie, "PATCH", `/api/settings/sectors/${oldId}`, { active: false });

    const response = await call(
      secretary.cookie,
      "POST",
      "/api/census/households",
      registration({ household: { ...registration().household, sectorId: oldId } }),
    );
    assert.equal(response.statusCode, 400);

    const options = await call(secretary.cookie, "GET", "/api/census/options");
    assert.ok(!options.json().sectors.some((s: { id: number }) => s.id === oldId));
  });

  it("finds a household by name without accents, by code and by ID number", async () => {
    const body = registration({ person: { fullName: "rosa martínez", idNumber: nextIdNumber(), phone: "98765432" } });
    const saved = await call(secretary.cookie, "POST", "/api/census/households", body);
    const code: string = saved.json().household.code;

    const byName = await call(secretary.cookie, "GET", "/api/census/households?q=martinez");
    assert.ok(byName.json().households.some((h: { code: string }) => h.code === code));

    const byCode = await call(secretary.cookie, "GET", `/api/census/households?q=${Number(code.slice(2))}`);
    assert.deepEqual(
      byCode.json().households.map((h: { code: string }) => h.code),
      [code],
    );

    const byId = await call(secretary.cookie, "GET", `/api/census/households?q=${body.person.idNumber}`);
    assert.equal(byId.json().households[0]?.code, code);
  });

  it("masks ID number and phone on the server for a role without that permission", async () => {
    const saved = await call(secretary.cookie, "POST", "/api/census/households", registration());
    const id = saved.json().household.id;

    const full = await call(vocal.cookie, "GET", `/api/census/households/${id}`);
    assert.match(full.json().household.owner.idNumber, /^\d{13}$/);

    await t.adminDb
      .update(rolePermissions)
      .set({ granted: false })
      .where(and(eq(rolePermissions.roleCode, "primer_vocal"), eq(rolePermissions.permission, "census:view_sensitive")));

    const masked = await call(vocal.cookie, "GET", `/api/census/households/${id}`);
    assert.equal(masked.json().sensitiveVisible, false);
    assert.match(masked.json().household.owner.idNumber, /^•{9}\d{4}$/);
    assert.equal(masked.json().household.owner.phone, "••••••66");

    // Nor can the ID number be guessed by searching for it.
    const [person] = await t.db.select().from(people).limit(1);
    const search = await call(vocal.cookie, "GET", `/api/census/households?q=${person!.idNumber}`);
    assert.equal(search.json().households.length, 0);

    await t.adminDb
      .update(rolePermissions)
      .set({ granted: true })
      .where(and(eq(rolePermissions.roleCode, "primer_vocal"), eq(rolePermissions.permission, "census:view_sensitive")));
  });

  it("masks them in the Historial's detail too, for a log reader without that permission", async () => {
    const fiscal = await signedInUser(t, "fiscal");
    const saved = await call(secretary.cookie, "POST", "/api/census/households", registration());
    const [entry] = await t.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, "household.registered"), eq(auditLog.entityId, saved.json().household.id)));
    const detail = () => call(fiscal.cookie, "GET", `/api/audit/${entry!.id}`);

    assert.match((await detail()).json().entry.after.person.idNumber, /^\d{13}$/);

    await t.adminDb
      .update(rolePermissions)
      .set({ granted: false })
      .where(and(eq(rolePermissions.roleCode, "fiscal"), eq(rolePermissions.permission, "census:view_sensitive")));

    const masked = (await detail()).json().entry.after.person;
    assert.match(masked.idNumber, /^•{9}\d{4}$/);
    assert.equal(masked.phone, "••••••66");
    assert.equal(masked.fullName, "Juan Pérez");
  });

  it("logs the values before and after an edit", async () => {
    const saved = await call(secretary.cookie, "POST", "/api/census/households", registration());
    const id = saved.json().household.id;

    const edited = await call(secretary.cookie, "PATCH", `/api/census/households/${id}`, {
      references: "Detrás de la escuela",
      waterConnection: "shared",
      relation: "renter",
    });
    assert.equal(edited.statusCode, 200);

    const file = await call(secretary.cookie, "GET", `/api/census/households/${id}`);
    assert.equal(file.json().household.references, "Detrás de la escuela");
    assert.equal(file.json().household.owner.relation, "renter");

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "household.edited"), eq(auditLog.entityId, id)));
    assert.deepEqual(entry?.before, {
      references: "Frente a la iglesia, portón verde",
      waterConnection: "connected",
      relation: "owner",
    });
    assert.match(entry!.summary, /referencias, conexión de agua y relación con la vivienda$/);

    const personId = file.json().household.owner.personId;
    const renamed = await call(secretary.cookie, "PATCH", `/api/census/people/${personId}`, { fullName: "JUAN PÉREZ LÓPEZ" });
    assert.equal(renamed.statusCode, 200);
    const again = await call(secretary.cookie, "GET", `/api/census/households/${id}`);
    assert.equal(again.json().household.owner.fullName, "Juan Pérez López");
  });

  it("makes a record inactive with a reason, never deletes it, and can make it active again", async () => {
    const saved = await call(secretary.cookie, "POST", "/api/census/households", registration());
    const id = saved.json().household.id;

    assert.equal((await call(secretary.cookie, "POST", `/api/census/households/${id}/deactivate`, {})).statusCode, 400);
    assert.equal(
      (await call(treasurer.cookie, "POST", `/api/census/households/${id}/deactivate`, { reason: "moved_away" })).statusCode,
      403,
    );

    const done = await call(secretary.cookie, "POST", `/api/census/households/${id}/deactivate`, {
      reason: "moved_away",
      note: "Se fue a San Pedro Sula",
    });
    assert.equal(done.statusCode, 200);

    const inactive = await call(secretary.cookie, "GET", "/api/census/households?status=inactive");
    assert.ok(inactive.json().households.some((h: { id: string }) => h.id === id));

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "household.deactivated"), eq(auditLog.entityId, id)));
    assert.equal(entry?.reason, "Se mudó. Se fue a San Pedro Sula");

    assert.equal((await call(secretary.cookie, "POST", `/api/census/households/${id}/reactivate`, {})).statusCode, 200);
    const file = await call(secretary.cookie, "GET", `/api/census/households/${id}`);
    assert.equal(file.json().household.status, "active");

    // And the database itself refuses a delete from the app's login.
    await rejectsWithDbError(t.db.delete(households).where(eq(households.id, id)), /permission denied/);
  });

  it("shows the base fee from Configuración once the board sets one", async () => {
    const before = await call(secretary.cookie, "GET", "/api/census/options");
    assert.equal(before.json().baseFeeCentavos, null);
    assert.equal(before.json().canSetDifferentFee, true);
    assert.deepEqual(before.json().genders, ["Mujer", "Hombre"]);

    await t.adminDb.insert(feeRates).values({ kind: "base_monthly", amountCentavos: 7000, startsOn: "2026-01-01" });
    const afterFee = await call(secretary.cookie, "GET", "/api/census/options");
    assert.equal(afterFee.json().baseFeeCentavos, 7000);

    const adminOptions = await call(admin.cookie, "GET", "/api/census/options");
    assert.equal(adminOptions.json().canSetDifferentFee, false);
  });

  it("keeps sector management to Configuración's roles, and logs it", async () => {
    assert.equal((await call(secretary.cookie, "POST", "/api/settings/sectors", { name: "La Playa" })).statusCode, 403);
    assert.equal((await call(admin.cookie, "POST", "/api/settings/sectors", { name: "el centro" })).statusCode, 409);

    const list = await call(admin.cookie, "GET", "/api/settings/sectors");
    assert.ok(list.json().sectors.some((s: { name: string; households: number }) => s.name === "El Centro" && s.households > 0));

    const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "sector.created"));
    assert.match(entry!.summary, /Ana Admin \(Administrador\) agregó el sector El Centro/);
  });
});
