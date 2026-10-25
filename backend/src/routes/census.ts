/**
 * The Censo tab (App Plan, Module 1): register a household, the duplicate
 * check, search and list, the household file, edits, and making a record
 * inactive. Nothing here deletes: a record that should not count is made
 * inactive with a reason, and can be made active again.
 *
 * ID numbers and phones leave the server masked unless the user holds
 * `census:view_sensitive`; hiding them on screen would not be enough.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { newId } from "../auth/session.js";
import type { DbOrTx, Tx } from "../db/client.js";
import { householdFees, householdOwners, households, people, sectors, users } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import {
  INACTIVE_REASONS,
  INACTIVE_REASON_CODES,
  RELATION_CODES,
  WATER_CONNECTION_CODES,
  capitalizeName,
  formatLempiras,
  householdCode,
  maskDigits,
} from "../lib/census.js";
import { differentFeeStart, lastPaidMonth } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { baseMonthlyFee, currentSetting } from "../lib/settings.js";
import { businessToday, formatCalendarDate } from "../lib/time.js";

/**
 * Puts household registrations in single file, so two entries saved at the
 * same moment cannot take the same code and a retried submission finds the
 * first one. Held until the transaction ends.
 */
const HOUSEHOLD_CODE_LOCK_KEY = 7_311_003;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escriba la fecha completa.");
const fullName = z
  .string()
  .trim()
  .min(3, "Escriba el nombre completo.")
  .max(120, "El nombre es demasiado largo.");
const idNumber = z
  .string()
  .trim()
  .regex(/^[0-9]{13}$/, "La identidad debe tener 13 números. Revise e intente de nuevo.");
const phone = z
  .string()
  .trim()
  .regex(/^[0-9]{8}$/, "El teléfono debe tener 8 números. Revise e intente de nuevo.");
const gender = z.string().trim().min(1).max(40);
const references = z
  .string()
  .trim()
  .min(3, "Escriba cómo encontrar la vivienda.")
  .max(500, "Las referencias son demasiado largas.");
const gps = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const sectorId = z.number({ message: "Elija un sector." }).int().positive("Elija un sector.");
const waterConnection = z.enum(WATER_CONNECTION_CODES, { message: "Elija el tipo de conexión de agua." });
const relation = z.enum(RELATION_CODES, { message: "Elija la relación con la vivienda." });
const formNumber = z.string().trim().max(40, "El número de la hoja es demasiado largo.");
const note = z.string().trim().max(500).optional();

const feeChoice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("base") }),
  z.object({
    kind: z.literal("different"),
    monthlyAmountCentavos: z
      .number({ message: "Escriba el monto mensual." })
      .int("El monto debe ser en lempiras y centavos.")
      .min(0, "El monto no puede ser negativo.")
      .max(1_000_000, "El monto es demasiado alto. Revise e intente de nuevo."),
    reason: z.string().trim().min(3, "Escriba la razón del monto diferente.").max(500),
  }),
]);

const registerBody = z.object({
  /** Made on the phone; the same entry sent twice is saved once. */
  submissionId: z.uuid(),
  /** Paper entry mode: the date and number written on the paper form. */
  paper: z.object({ date: isoDate, formNumber: formNumber.optional() }).optional(),
  /** Name and phone may be left out only when adding a house to a person already registered. */
  person: z.object({ fullName: fullName.optional(), idNumber, phone: phone.optional(), gender: gender.optional() }),
  /** "Agregar otra vivienda": the ID is already registered and this is another house of theirs. */
  addToExistingPerson: z.boolean().default(false),
  household: z.object({
    sectorId,
    references,
    gps: gps.optional(),
    waterConnection,
    relation,
  }),
  fee: feeChoice,
});

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sectorId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const householdPatch = z
  .object({
    sectorId,
    references,
    gps: gps.nullable(),
    waterConnection,
    relation,
    paperDate: isoDate.nullable(),
    paperFormNumber: formNumber.nullable(),
    reason: note,
  })
  .partial();

const personPatch = z
  .object({ fullName, idNumber, phone, gender: gender.nullable(), reason: note })
  .partial();

const deactivateBody = z.object({
  reason: z.enum(INACTIVE_REASON_CODES, { message: "Elija por qué se desactiva." }),
  note,
});

type Params = { Params: { id: string } };

const NOT_FOUND = new HttpError(404, "not_found", "No se encontró esa vivienda.");
const PERSON_NOT_FOUND = new HttpError(404, "not_found", "No se encontró esa persona.");

function requireUuid(id: string, error: HttpError): void {
  if (!z.uuid().safeParse(id).success) {
    throw error;
  }
}

/** Lowercase without accents, so "perez" finds "Pérez". Same rule as `searchable()` below. */
function normalize(value: string): string {
  return value.toLocaleLowerCase("es-HN").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function searchable(column: SQLWrapper): SQL {
  return sql`translate(lower(${column}), 'áéíóúüñ', 'aeiouun')`;
}

/** The person registered for a household now: the ownership row with no end date. */
const currentOwner = and(eq(householdOwners.householdId, households.id), isNull(householdOwners.endsOn));

export const censusRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const today = () => businessToday(options.timeZone);
  const canSeeSensitive = (request: FastifyRequest) =>
    request.user!.permissions.has("census:view_sensitive");
  const canSetFeeAtRegistration = (request: FastifyRequest) =>
    request.user!.permissions.has("household_fee:set_at_registration") ||
    request.user!.permissions.has("household_fee:set");

  const view = { preHandler: app.requirePermission("census:view") };
  const edit = { preHandler: app.requirePermission("census:edit") };
  const deactivate = { preHandler: app.requirePermission("census:deactivate") };

  /** A person's households, newest code last: for the duplicate check and the file. */
  const householdsOf = async (db: DbOrTx, personId: string) =>
    db
      .select({ id: households.id, code: households.code, status: households.status, sectorName: sectors.name })
      .from(householdOwners)
      .innerJoin(households, eq(households.id, householdOwners.householdId))
      .innerJoin(sectors, eq(sectors.id, households.sectorId))
      .where(and(eq(householdOwners.personId, personId), isNull(householdOwners.endsOn)))
      .orderBy(asc(households.code));

  const lockHousehold = async (tx: Tx, id: string) => {
    requireUuid(id, NOT_FOUND);
    const [household] = await tx.select().from(households).where(eq(households.id, id)).for("update");
    if (!household) {
      throw NOT_FOUND;
    }
    return household;
  };

  // -------------------------------------------------------------------------

  /** What the registration screens need, also kept on the phone for working without signal. */
  app.get("/census/options", view, async (request) => {
    const day = today();
    const sectorRows = await app.db
      .select({ id: sectors.id, name: sectors.name })
      .from(sectors)
      .where(eq(sectors.active, true))
      .orderBy(asc(sectors.name));

    return {
      sectors: sectorRows,
      genders: (await currentSetting<string[]>(app.db, "genders", day)) ?? [],
      baseFeeCentavos: await baseMonthlyFee(app.db, day),
      canSetDifferentFee: canSetFeeAtRegistration(request),
      today: day,
    };
  });

  /** The duplicate check, asked as soon as the ID number is typed. */
  app.get("/census/people/lookup", edit, async (request) => {
    const { idNumber: wanted } = parse(z.object({ idNumber }), request.query);
    const [person] = await app.db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(eq(people.idNumber, wanted));

    if (!person) {
      return { person: null };
    }
    return { person: { ...person, households: await householdsOf(app.db, person.id) } };
  });

  app.post("/census/households", edit, async (request, reply) => {
    const body = parse(registerBody, request.body);
    const actor = actorOf(request);
    const day = today();

    if (body.paper && body.paper.date > day) {
      throw new HttpError(400, "invalid_request", "La fecha de la hoja no puede ser después de hoy.");
    }
    if (body.fee.kind === "different" && !canSetFeeAtRegistration(request)) {
      throw new HttpError(403, "forbidden", "Su cargo no puede fijar un monto diferente. Elija el precio base.");
    }

    const result = await app.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${HOUSEHOLD_CODE_LOCK_KEY})`);

      // Sent again after weak signal: it is already saved, so answer as the first time did.
      const [already] = await tx
        .select({ id: households.id, code: households.code })
        .from(households)
        .where(eq(households.submissionId, body.submissionId));
      if (already) {
        return { household: already, created: false };
      }

      const [sector] = await tx
        .select()
        .from(sectors)
        .where(and(eq(sectors.id, body.household.sectorId), eq(sectors.active, true)));
      if (!sector) {
        throw new HttpError(400, "invalid_request", "Ese sector ya no está en la lista. Elija otro.");
      }

      const genders = (await currentSetting<string[]>(tx, "genders", day)) ?? [];
      if (body.person.gender && !genders.includes(body.person.gender)) {
        throw new HttpError(400, "invalid_request", "Elija un género de la lista.");
      }

      // One person, one row: an ID already registered opens that person's file instead.
      const [existing] = await tx.select().from(people).where(eq(people.idNumber, body.person.idNumber));
      if (existing && !body.addToExistingPerson) {
        throw new HttpError(409, "person_exists", `Esta identidad ya está registrada a nombre de ${existing.fullName}.`, {
          person: { id: existing.id, fullName: existing.fullName, households: await householdsOf(tx, existing.id) },
        });
      }

      let person = existing;
      if (!person) {
        if (!body.person.fullName) {
          throw new HttpError(400, "invalid_request", "Escriba el nombre completo.");
        }
        if (!body.person.phone) {
          throw new HttpError(400, "invalid_request", "El teléfono debe tener 8 números. Revise e intente de nuevo.");
        }
        person = {
          id: newId(),
          fullName: capitalizeName(body.person.fullName),
          idNumber: body.person.idNumber,
          phone: body.person.phone,
          gender: body.person.gender ?? null,
          createdAt: new Date(),
          createdBy: actor.userId,
        };
        await tx.insert(people).values(person);
      }

      const [last] = await tx
        .select({ max: sql<number | null>`max(substring(${households.code} from 3)::int)` })
        .from(households);
      const code = householdCode((last?.max ?? 0) + 1);

      // The day the registrar stood at the house: the paper form's date when typed from paper.
      const startsOn = body.paper?.date ?? day;
      const household = {
        id: newId(),
        code,
        sectorId: sector.id,
        references: body.household.references,
        gpsLat: body.household.gps?.lat ?? null,
        gpsLng: body.household.gps?.lng ?? null,
        waterConnection: body.household.waterConnection,
        status: "active" as const,
        paperDate: body.paper?.date ?? null,
        paperFormNumber: body.paper?.formNumber || null,
        submissionId: body.submissionId,
        lastVerifiedOn: startsOn,
        createdBy: actor.userId,
      };
      await tx.insert(households).values(household);
      await tx.insert(householdOwners).values({
        id: newId(),
        householdId: household.id,
        personId: person.id,
        relation: body.household.relation,
        startsOn,
        createdBy: actor.userId,
      });

      const paperNote = body.paper
        ? ` desde la hoja de papel${body.paper.formNumber ? ` nº ${body.paper.formNumber}` : ""} del ${formatCalendarDate(body.paper.date)}`
        : "";
      await recordAudit(tx, actor, {
        area: "census",
        action: "household.registered",
        summary: `${actor.name} (${actor.role}) registró la vivienda ${code} de ${person.fullName}${paperNote}`,
        entityType: "household",
        entityId: household.id,
        after: {
          code,
          person: { fullName: person.fullName, idNumber: person.idNumber, phone: person.phone, gender: person.gender },
          addedToExistingPerson: Boolean(existing),
          sector: sector.name,
          references: household.references,
          gps: body.household.gps ?? null,
          waterConnection: household.waterConnection,
          relation: body.household.relation,
          paperDate: household.paperDate,
          paperFormNumber: household.paperFormNumber,
          fee: body.fee.kind,
        },
      });

      if (body.fee.kind === "different") {
        // From the month after the house's last payment; a new house has none, so this month.
        const feeStartsOn = differentFeeStart(await lastPaidMonth(tx, household.id), day);
        await tx.insert(householdFees).values({
          id: newId(),
          householdId: household.id,
          monthlyAmountCentavos: body.fee.monthlyAmountCentavos,
          reason: body.fee.reason,
          startsOn: feeStartsOn,
          createdBy: actor.userId,
        });
        // App Plan: "every such choice shows in the history log", under Settings.
        await recordAudit(tx, actor, {
          area: "settings",
          action: "household_fee.set",
          summary: `${actor.name} (${actor.role}) fijó un monto diferente de ${formatLempiras(body.fee.monthlyAmountCentavos)} al mes para la vivienda ${code}`,
          entityType: "household",
          entityId: household.id,
          after: { monthlyAmountCentavos: body.fee.monthlyAmountCentavos, startsOn: feeStartsOn },
          reason: body.fee.reason,
        });
      }

      return { household: { id: household.id, code }, created: true };
    });

    // Who it was saved for, so the saved screen can offer "Compartir por WhatsApp".
    const [owner] = await app.db
      .select({ fullName: people.fullName, phone: people.phone })
      .from(householdOwners)
      .innerJoin(people, eq(people.id, householdOwners.personId))
      .where(and(eq(householdOwners.householdId, result.household.id), isNull(householdOwners.endsOn)));

    return reply.code(result.created ? 201 : 200).send({
      household: result.household,
      person: { fullName: owner?.fullName ?? null, phone: canSeeSensitive(request) ? owner?.phone ?? null : null },
      alreadySaved: !result.created,
    });
  });

  app.get("/census/households", view, async (request) => {
    const query = parse(listQuery, request.query);
    const sensitive = canSeeSensitive(request);

    const conditions: SQL[] = [];
    if (query.sectorId) conditions.push(eq(households.sectorId, query.sectorId));
    if (query.status) conditions.push(eq(households.status, query.status));
    if (query.q) {
      const words = `%${normalize(query.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const digits = query.q.replace(/\D/g, "");
      const matches: SQL[] = [
        sql`${searchable(people.fullName)} LIKE ${words}`,
        sql`${searchable(households.references)} LIKE ${words}`,
        sql`lower(${households.code}) LIKE ${words}`,
      ];
      // Searching by ID number or phone would tell someone who may not see them whether they match.
      if (sensitive && digits.length >= 4) {
        matches.push(sql`${people.idNumber} LIKE ${`%${digits}%`}`, sql`${people.phone} LIKE ${`%${digits}%`}`);
      }
      // A bare number is a household code: "12" finds Z-0012.
      if (/^\d{1,5}$/.test(query.q)) {
        matches.push(eq(households.code, householdCode(Number(query.q))));
      }
      conditions.push(sql`(${sql.join(matches, sql` OR `)})`);
    }

    const rows = await app.db
      .select({
        id: households.id,
        code: households.code,
        status: households.status,
        ownerName: people.fullName,
        sectorName: sectors.name,
        references: households.references,
        waterConnection: households.waterConnection,
        paperFormNumber: households.paperFormNumber,
      })
      .from(households)
      .innerJoin(sectors, eq(sectors.id, households.sectorId))
      .innerJoin(householdOwners, currentOwner)
      .innerJoin(people, eq(people.id, householdOwners.personId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(households.code))
      .limit(2000);

    return { households: rows };
  });

  /** The household file (ficha de vivienda). */
  app.get<Params>("/census/households/:id", view, async (request) => {
    requireUuid(request.params.id, NOT_FOUND);
    const sensitive = canSeeSensitive(request);

    const [row] = await app.db
      .select({
        household: households,
        sectorName: sectors.name,
        registeredBy: users.name,
        owner: {
          personId: people.id,
          fullName: people.fullName,
          idNumber: people.idNumber,
          phone: people.phone,
          gender: people.gender,
          relation: householdOwners.relation,
          startsOn: householdOwners.startsOn,
        },
      })
      .from(households)
      .innerJoin(sectors, eq(sectors.id, households.sectorId))
      .innerJoin(householdOwners, currentOwner)
      .innerJoin(people, eq(people.id, householdOwners.personId))
      .leftJoin(users, eq(users.id, households.createdBy))
      .where(eq(households.id, request.params.id));
    if (!row) {
      throw NOT_FOUND;
    }

    const [different] = await app.db
      .select({
        monthlyAmountCentavos: householdFees.monthlyAmountCentavos,
        reason: householdFees.reason,
        startsOn: householdFees.startsOn,
      })
      .from(householdFees)
      .where(and(eq(householdFees.householdId, row.household.id), isNull(householdFees.endsOn)));

    const { household, owner } = row;
    return {
      household: {
        id: household.id,
        code: household.code,
        status: household.status,
        inactiveReason: household.inactiveReason,
        sector: { id: household.sectorId, name: row.sectorName },
        references: household.references,
        gps: household.gpsLat !== null && household.gpsLng !== null ? { lat: household.gpsLat, lng: household.gpsLng } : null,
        waterConnection: household.waterConnection,
        paperDate: household.paperDate,
        paperFormNumber: household.paperFormNumber,
        lastVerifiedOn: household.lastVerifiedOn,
        registeredBy: row.registeredBy ?? "Sistema",
        createdAt: household.createdAt,
        owner: {
          ...owner,
          idNumber: sensitive ? owner.idNumber : maskDigits(owner.idNumber, 4),
          phone: sensitive ? owner.phone : maskDigits(owner.phone, 2),
        },
        fee: different
          ? { kind: "different" as const, ...different }
          : { kind: "base" as const, baseFeeCentavos: await baseMonthlyFee(app.db, today()) },
        otherHouseholds: (await householdsOf(app.db, owner.personId)).filter((h) => h.id !== household.id),
      },
      sensitiveVisible: sensitive,
    };
  });

  app.patch<Params>("/census/households/:id", edit, async (request) => {
    const body = parse(householdPatch, request.body);
    const actor = actorOf(request);
    if (body.paperDate && body.paperDate > today()) {
      throw new HttpError(400, "invalid_request", "La fecha de la hoja no puede ser después de hoy.");
    }

    await app.db.transaction(async (tx) => {
      const household = await lockHousehold(tx, request.params.id);
      const [owner] = await tx
        .select()
        .from(householdOwners)
        .where(and(eq(householdOwners.householdId, household.id), isNull(householdOwners.endsOn)));

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const changes: Partial<typeof households.$inferInsert> = {};
      const note = (field: string, from: unknown, to: unknown) => {
        before[field] = from;
        after[field] = to;
      };

      if (body.sectorId !== undefined && body.sectorId !== household.sectorId) {
        const [sector] = await tx
          .select()
          .from(sectors)
          .where(and(eq(sectors.id, body.sectorId), eq(sectors.active, true)));
        if (!sector) {
          throw new HttpError(400, "invalid_request", "Ese sector ya no está en la lista. Elija otro.");
        }
        const [old] = await tx.select({ name: sectors.name }).from(sectors).where(eq(sectors.id, household.sectorId));
        changes.sectorId = sector.id;
        note("sector", old?.name ?? null, sector.name);
      }
      if (body.references !== undefined && body.references !== household.references) {
        changes.references = body.references;
        note("references", household.references, body.references);
      }
      if (body.gps !== undefined) {
        const oldGps = household.gpsLat !== null ? { lat: household.gpsLat, lng: household.gpsLng } : null;
        if (JSON.stringify(oldGps) !== JSON.stringify(body.gps)) {
          changes.gpsLat = body.gps?.lat ?? null;
          changes.gpsLng = body.gps?.lng ?? null;
          note("gps", oldGps, body.gps);
        }
      }
      if (body.waterConnection !== undefined && body.waterConnection !== household.waterConnection) {
        changes.waterConnection = body.waterConnection;
        note("waterConnection", household.waterConnection, body.waterConnection);
      }
      if (body.paperDate !== undefined && body.paperDate !== household.paperDate) {
        changes.paperDate = body.paperDate;
        note("paperDate", household.paperDate, body.paperDate);
      }
      if (body.paperFormNumber !== undefined && (body.paperFormNumber || null) !== household.paperFormNumber) {
        changes.paperFormNumber = body.paperFormNumber || null;
        note("paperFormNumber", household.paperFormNumber, changes.paperFormNumber);
      }
      const relationChanged = body.relation !== undefined && owner && body.relation !== owner.relation;
      if (relationChanged) {
        note("relation", owner!.relation, body.relation);
      }

      if (Object.keys(after).length === 0) {
        return;
      }

      if (Object.keys(changes).length > 0) {
        await tx.update(households).set(changes).where(eq(households.id, household.id));
      }
      if (relationChanged) {
        await tx.update(householdOwners).set({ relation: body.relation! }).where(eq(householdOwners.id, owner!.id));
      }

      await recordAudit(tx, actor, {
        area: "census",
        action: "household.edited",
        summary: `${actor.name} (${actor.role}) corrigió la vivienda ${household.code}: ${describeFields(Object.keys(after))}`,
        entityType: "household",
        entityId: household.id,
        before,
        after,
        reason: body.reason || null,
      });
    });

    return { ok: true };
  });

  app.patch<Params>("/census/people/:id", edit, async (request) => {
    const body = parse(personPatch, request.body);
    const actor = actorOf(request);
    if ((body.idNumber !== undefined || body.phone !== undefined) && !canSeeSensitive(request)) {
      throw new HttpError(403, "forbidden", "Su cargo no puede ver ni cambiar la identidad o el teléfono.");
    }

    await app.db.transaction(async (tx) => {
      requireUuid(request.params.id, PERSON_NOT_FOUND);
      const [person] = await tx.select().from(people).where(eq(people.id, request.params.id)).for("update");
      if (!person) {
        throw PERSON_NOT_FOUND;
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const changes: Partial<typeof people.$inferInsert> = {};

      const name = body.fullName !== undefined ? capitalizeName(body.fullName) : undefined;
      if (name !== undefined && name !== person.fullName) {
        before.fullName = person.fullName;
        changes.fullName = after.fullName = name;
      }
      if (body.idNumber !== undefined && body.idNumber !== person.idNumber) {
        const [taken] = await tx.select({ id: people.id }).from(people).where(eq(people.idNumber, body.idNumber));
        if (taken) {
          throw new HttpError(409, "id_taken", "Esa identidad ya es de otra persona registrada.");
        }
        before.idNumber = person.idNumber;
        changes.idNumber = after.idNumber = body.idNumber;
      }
      if (body.phone !== undefined && body.phone !== person.phone) {
        before.phone = person.phone;
        changes.phone = after.phone = body.phone;
      }
      if (body.gender !== undefined && body.gender !== person.gender) {
        const genders = (await currentSetting<string[]>(tx, "genders", today())) ?? [];
        if (body.gender !== null && !genders.includes(body.gender)) {
          throw new HttpError(400, "invalid_request", "Elija un género de la lista.");
        }
        before.gender = person.gender;
        changes.gender = after.gender = body.gender;
      }

      if (Object.keys(changes).length === 0) {
        return;
      }

      await tx.update(people).set(changes).where(eq(people.id, person.id));
      await recordAudit(tx, actor, {
        area: "census",
        action: "person.edited",
        summary: `${actor.name} (${actor.role}) corrigió los datos de ${changes.fullName ?? person.fullName}: ${describeFields(Object.keys(after))}`,
        entityType: "person",
        entityId: person.id,
        before,
        after,
        reason: body.reason || null,
      });
    });

    return { ok: true };
  });

  app.post<Params>("/census/households/:id/deactivate", deactivate, async (request) => {
    const body = parse(deactivateBody, request.body);
    const actor = actorOf(request);

    await app.db.transaction(async (tx) => {
      const household = await lockHousehold(tx, request.params.id);
      if (household.status === "inactive") {
        throw new HttpError(409, "not_allowed", "Esa vivienda ya está inactiva.");
      }

      await tx
        .update(households)
        .set({ status: "inactive", inactiveReason: body.reason })
        .where(eq(households.id, household.id));
      await recordAudit(tx, actor, {
        area: "census",
        action: "household.deactivated",
        summary: `${actor.name} (${actor.role}) desactivó la vivienda ${household.code}: ${INACTIVE_REASONS[body.reason]}`,
        entityType: "household",
        entityId: household.id,
        before: { status: household.status },
        after: { status: "inactive", inactiveReason: body.reason },
        reason: body.note ? `${INACTIVE_REASONS[body.reason]}. ${body.note}` : INACTIVE_REASONS[body.reason],
      });
    });

    return { ok: true };
  });

  app.post<Params>("/census/households/:id/reactivate", deactivate, async (request) => {
    const body = parse(z.object({ note }).default({}), request.body ?? {});
    const actor = actorOf(request);

    await app.db.transaction(async (tx) => {
      const household = await lockHousehold(tx, request.params.id);
      if (household.status === "active") {
        throw new HttpError(409, "not_allowed", "Esa vivienda ya está activa.");
      }

      await tx.update(households).set({ status: "active", inactiveReason: null }).where(eq(households.id, household.id));
      await recordAudit(tx, actor, {
        area: "census",
        action: "household.reactivated",
        summary: `${actor.name} (${actor.role}) reactivó la vivienda ${household.code}`,
        entityType: "household",
        entityId: household.id,
        before: { status: household.status, inactiveReason: household.inactiveReason },
        after: { status: "active" },
        reason: body.note || null,
      });
    });

    return { ok: true };
  });

};

const FIELD_NAMES: Record<string, string> = {
  sector: "sector",
  references: "referencias",
  gps: "ubicación GPS",
  waterConnection: "conexión de agua",
  relation: "relación con la vivienda",
  paperDate: "fecha de la hoja",
  paperFormNumber: "número de la hoja",
  fullName: "nombre",
  idNumber: "identidad",
  phone: "teléfono",
  gender: "género",
};

/** "sector y referencias" — which fields an edit touched, for the Historial sentence. */
function describeFields(fields: string[]): string {
  const names = fields.map((field) => FIELD_NAMES[field] ?? field);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

