import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { auditLog, households } from "../src/db/schema.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, signedInUser, takeAway } from "./helpers.js";

describe("Verificación del censo: the yearly check of each house with its family", () => {
  let t: TestApp;
  let secretary: { cookie: string };
  let fiscal: { cookie: string };
  let vocal: { cookie: string };
  let sectorLoma: number;
  let sectorAnimas: number;

  const today = businessToday(HONDURAS_TIME_ZONE);
  const year = Number(today.slice(0, 4));
  /** A paper form filled in last year: the house was last checked then. */
  const lastYear = `${year - 1}-11-20`;

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const register = async (name: string, sectorId: number, paperDate?: string) => {
    const created = await call(secretary.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      ...(paperDate ? { paper: { date: paperDate, formNumber: "12" } } : {}),
      person: { fullName: name, phoneMissing: "no_phone" },
      household: { sectorId, waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().household as { id: string; code: string };
  };

  const verification = async (cookie = secretary.cookie) => {
    const response = await call(cookie, "GET", "/api/census/verification");
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as {
      today: string;
      year: number;
      activeCount: number;
      verifiedCount: number;
      unverified: Array<{ id: string; code: string; ownerName: string; sectorName: string; lastVerifiedOn: string | null }>;
    };
  };

  const verifiedEntries = (id: string) =>
    t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "household.verified"), eq(auditLog.entityId, id)))
      .all();

  before(async () => {
    t = await buildTestApp();
    secretary = await signedInUser(t, "secretario", "Sara Secretaria");
    fiscal = await signedInUser(t, "fiscal");
    vocal = await signedInUser(t, "primer_vocal");
    const admin = await signedInUser(t, "administrador");
    const sector = async (name: string) => {
      const response = await call(admin.cookie, "POST", "/api/settings/sectors", { name });
      assert.equal(response.statusCode, 201, response.body);
      return (response.json().sector as { id: number }).id;
    };
    sectorLoma = await sector("La Loma");
    sectorAnimas = await sector("Ánimas");
  });

  after(async () => {
    await t.close();
  });

  it("lists the active houses not checked this year, by sector in Spanish order, then by code", async () => {
    const old1 = await register("Olga Paz", sectorLoma, lastYear);
    const fresh = await register("Fredy Ruiz", sectorLoma);
    const old2 = await register("Ana Mejía", sectorAnimas, lastYear);
    const gone = await register("Gilberto Cruz", sectorAnimas, lastYear);
    const off = await call(secretary.cookie, "POST", `/api/census/households/${gone.id}/deactivate`, { reason: "moved_away" });
    assert.equal(off.statusCode, 200, off.body);

    const list = await verification(fiscal.cookie);
    assert.equal(list.today, today);
    assert.equal(list.year, year);
    assert.equal(list.activeCount, 3);
    assert.equal(list.verifiedCount, 1);
    // "Ánimas" comes before "La Loma"; SQLite alone would put it last. The inactive house is not counted.
    assert.deepEqual(
      list.unverified.map((house) => [house.code, house.sectorName, house.ownerName, house.lastVerifiedOn]),
      [
        [old2.code, "Ánimas", "Ana Mejía", lastYear],
        [old1.code, "La Loma", "Olga Paz", lastYear],
      ],
    );
    assert.ok(!list.unverified.some((house) => house.id === fresh.id));
  });

  it("marks a house checked today, once, with one entry in Historial, and takes it off the list", async () => {
    const house = await register("Rosa Díaz", sectorLoma, lastYear);
    const before = await verification();

    const first = await call(secretary.cookie, "POST", `/api/census/households/${house.id}/verify`);
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), { verifiedOn: today, alreadyVerified: false });

    const [row] = await t.db.select().from(households).where(eq(households.id, house.id));
    assert.equal(row!.lastVerifiedOn, today);
    const [entry] = verifiedEntries(house.id);
    assert.equal(entry!.area, "census");
    assert.equal(entry!.summary, `Sara Secretaria (Secretario/a) revisó con la familia los datos de la vivienda ${house.code}`);
    assert.deepEqual(entry!.before, { lastVerifiedOn: lastYear });
    assert.deepEqual(entry!.after, { lastVerifiedOn: today });

    const after = await verification();
    assert.equal(after.verifiedCount, before.verifiedCount + 1);
    assert.ok(!after.unverified.some((h) => h.id === house.id));

    // A second tap, or a retry on weak signal, changes nothing.
    const again = await call(secretary.cookie, "POST", `/api/census/households/${house.id}/verify`);
    assert.equal(again.statusCode, 200, again.body);
    assert.deepEqual(again.json(), { verifiedOn: today, alreadyVerified: true });
    assert.equal(verifiedEntries(house.id).length, 1);
  });

  it("is refused without the permission to edit the census, or to see it, and for a house that does not exist", async () => {
    const house = await register("Tomás Reyes", sectorLoma, lastYear);
    takeAway(t, "primer_vocal", "census:edit");
    const refused = await call(vocal.cookie, "POST", `/api/census/households/${house.id}/verify`);
    assert.equal(refused.statusCode, 403, refused.body);
    const [row] = await t.db.select().from(households).where(eq(households.id, house.id));
    assert.equal(row!.lastVerifiedOn, lastYear);
    assert.equal(verifiedEntries(house.id).length, 0);

    takeAway(t, "primer_vocal", "census:view");
    assert.equal((await call(vocal.cookie, "GET", "/api/census/verification")).statusCode, 403);

    const missing = await call(secretary.cookie, "POST", `/api/census/households/${randomUUID()}/verify`);
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal((await call(secretary.cookie, "POST", "/api/census/households/not-a-uuid/verify")).statusCode, 404);
  });
});
