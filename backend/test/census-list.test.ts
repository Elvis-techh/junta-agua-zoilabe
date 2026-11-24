import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, documents } from "../src/db/schema.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser, takeAway } from "./helpers.js";

describe("Lista del censo: the census list as a document", () => {
  let t: TestApp;
  let secretary: { id: string; cookie: string };
  let fiscal: { cookie: string };
  let vocal: { cookie: string };
  let otherVocal: { cookie: string };
  let sectorA: { id: number; name: string };
  let sectorB: { id: number; name: string };
  let idCounter = 801199500000;

  const today = businessToday(HONDURAS_TIME_ZONE);

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const register = async (name: string, sectorId: number, phone: string | null) => {
    const idNumber = String((idCounter += 1)).padStart(13, "0");
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: name, idNumber, ...(phone ? { phone } : { phoneMissing: "no_phone" }) },
      household: { sectorId, references: "Cerca de la iglesia", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(created.statusCode, 201, created.body);
    return { ...(created.json().household as { id: string; code: string }), idNumber };
  };

  const list = (cookie: string, payload: object) => call(cookie, "POST", "/api/census/list", payload);

  before(async () => {
    t = await buildTestApp();
    secretary = await signedInUser(t, "secretario", "Sara Secretaria");
    fiscal = await signedInUser(t, "fiscal", "Fabio Fiscal");
    vocal = await signedInUser(t, "primer_vocal");
    otherVocal = await signedInUser(t, "segundo_vocal");
    const admin = await signedInUser(t, "administrador");
    const sector = async (name: string) => {
      const response = await call(admin.cookie, "POST", "/api/settings/sectors", { name });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().sector as { id: number; name: string };
    };
    sectorA = await sector("El Centro");
    sectorB = await sector("La Loma");
  });

  after(async () => {
    await t.close();
  });

  it("hands out the filtered list with the next document number, and writes nothing to Historial", async () => {
    const ana = await register("Ana López", sectorA.id, "99887766");
    const beto = await register("Beto Díaz", sectorA.id, null);
    const carla = await register("Carla Mejía", sectorB.id, "98765432");
    const gone = await call(secretary.cookie, "POST", `/api/census/households/${beto.id}/deactivate`, { reason: "moved_away" });
    assert.equal(gone.statusCode, 200, gone.body);

    const first = await list(secretary.cookie, { sectorId: sectorA.id, status: "active", format: "print" });
    assert.equal(first.statusCode, 201, first.body);
    const handed = first.json();
    assert.deepEqual(handed.filters, { sectorName: "El Centro", status: "active" });
    assert.equal(handed.sensitive, true);
    assert.equal(handed.document.madeBy, "Sara Secretaria");
    assert.ok(!Number.isNaN(Date.parse(handed.document.madeAt)));
    assert.deepEqual(
      handed.households.map((row: { code: string }) => row.code),
      [ana.code],
    );
    assert.deepEqual(handed.households[0], {
      code: ana.code,
      ownerName: "Ana López",
      relation: "owner",
      idNumber: ana.idNumber,
      phone: "+50499887766",
      phoneMissing: null,
      sectorName: "El Centro",
      references: "Cerca de la iglesia",
      waterConnection: "connected",
      status: "active",
      inactiveReason: null,
      paperFormNumber: null,
      lastVerifiedOn: today,
    });

    // Every house, every sector, by code; an inactive one says why.
    const second = await list(fiscal.cookie, { status: "all", format: "csv" });
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(second.json().document.number, handed.document.number + 1);
    assert.deepEqual(second.json().filters, { sectorName: null, status: "all" });
    const codes = second.json().households.map((row: { code: string }) => row.code);
    assert.deepEqual(codes, [ana.code, beto.code, carla.code]);
    const betoRow = second.json().households[1];
    assert.equal(betoRow.status, "inactive");
    assert.equal(betoRow.inactiveReason, "moved_away");
    assert.equal(betoRow.phone, null);
    assert.equal(betoRow.phoneMissing, "no_phone");

    const [row] = await t.db.select().from(documents).where(eq(documents.id, handed.document.number));
    assert.equal(row!.kind, "census_list");
    assert.equal(row!.householdId, null);
    assert.equal(row!.createdBy, secretary.id);
    assert.deepEqual(row!.details, {
      sectorId: sectorA.id,
      sectorName: "El Centro",
      status: "active",
      format: "print",
      count: 1,
      sensitive: true,
      madeOn: today,
    });

    // The owner's decision of 24 November 2026: printing leaves no entry in Historial.
    assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.entityType, "document"))).length, 0);
    assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.area, "exports"))).length, 0);
  });

  it("masks ID numbers and phones for someone who may not see them whole, and says so", async () => {
    takeAway(t, "segundo_vocal", "census:view_sensitive");
    const response = await list(otherVocal.cookie, { sectorId: sectorB.id, status: "active", format: "print" });
    assert.equal(response.statusCode, 201, response.body);
    const [carla] = response.json().households;
    assert.equal(response.json().sensitive, false);
    assert.match(carla.idNumber, /^•{9}\d{4}$/);
    assert.equal(carla.phone, "••••••32");

    const [row] = await t.db.select().from(documents).where(eq(documents.id, response.json().document.number));
    assert.equal((row!.details as { sensitive: boolean }).sensitive, false);
  });

  it("is refused without the permission to print the census, or to see it, and takes no number", async () => {
    const before = (await t.db.select().from(documents)).length;
    takeAway(t, "primer_vocal", "export:census");
    assert.equal((await list(vocal.cookie, { status: "active", format: "print" })).statusCode, 403);

    const viewer = await signedInUser(t, "vicepresidente");
    takeAway(t, "vicepresidente", "census:view");
    assert.equal((await list(viewer.cookie, { status: "active", format: "print" })).statusCode, 403);

    assert.equal((await list(secretary.cookie, { status: "active", format: "pdf" })).statusCode, 400);
    assert.equal((await list(secretary.cookie, { sectorId: 99999, status: "active", format: "print" })).statusCode, 400);
    assert.equal((await t.db.select().from(documents)).length, before);
  });
});
