/**
 * Configuración → Cuotas: the base monthly fee, the late fee (mora) and the
 * reconnection fee, each from the month it starts.
 *
 * A rate is never changed or deleted. A new amount is a new row that starts
 * in a later month, so every month keeps the price it was charged at, and
 * the list shows every price the board has ever set.
 */
import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { inTransaction } from "../db/client.js";
import { feeRates, users } from "../db/schema.js";
import { formatLempiras } from "../lib/census.js";
import { recordAudit } from "../lib/audit.js";
import { earliestFeeStart } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import type { FeeKind } from "../lib/settings.js";
import { FEE_KINDS } from "../lib/settings.js";
import { businessToday } from "../lib/time.js";

/** How the history log names each fee. */
const FEE_NAMES: Record<FeeKind, string> = {
  base_monthly: "la cuota mensual base",
  late_fee: "la mora",
  reconnection: "la cuota de reconexión",
};

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2027-01-01" → "enero de 2027". */
function monthName(firstDay: string): string {
  return `${MONTH_NAMES[Number(firstDay.slice(5, 7)) - 1]} de ${firstDay.slice(0, 4)}`;
}

const createBody = z.object({
  kind: z.enum(FEE_KINDS, { message: "Elija qué cuota cambia." }),
  amountCentavos: z
    .number({ message: "Escriba el monto en lempiras." })
    .int("Escriba el monto en lempiras, por ejemplo 70 o 70.50.")
    .positive("El monto debe ser mayor que cero.")
    .max(9_999_999, "El monto es demasiado alto."),
  // A rate starts on the first day of a month: fees are charged by the month.
  startsOn: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija el mes en que empieza."),
});

export const feeRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const guard = { preHandler: app.requirePermission("settings:edit") };
  const today = () => businessToday(options.timeZone);

  app.get("/settings/fees", guard, async () => {
    const day = today();
    const rows = await app.db
      .select({
        id: feeRates.id,
        kind: feeRates.kind,
        amountCentavos: feeRates.amountCentavos,
        startsOn: feeRates.startsOn,
        createdAt: feeRates.createdAt,
        createdByName: users.name,
      })
      .from(feeRates)
      .leftJoin(users, eq(users.id, feeRates.createdBy))
      .orderBy(desc(feeRates.startsOn));

    const fees = FEE_KINDS.map((kind) => {
      const rates = rows.filter((row) => row.kind === kind);
      // Newest first, so the first one that has started is the one in force.
      const current = rates.find((rate) => rate.startsOn <= day) ?? null;
      return {
        kind,
        currentId: current?.id ?? null,
        earliestStart: earliestFeeStart(rates.length > 0, day),
        rates: rates.map(({ kind: _kind, ...rate }) => rate),
      };
    });
    return { today: day, fees };
  });

  app.post("/settings/fees", guard, async (request, reply) => {
    const body = parse(createBody, request.body);
    const actor = actorOf(request);
    const day = today();

    const rate = inTransaction(app.db, (tx) => {
      const existing = tx
        .select({ amountCentavos: feeRates.amountCentavos, startsOn: feeRates.startsOn })
        .from(feeRates)
        .where(eq(feeRates.kind, body.kind))
        .orderBy(desc(feeRates.startsOn))
        .all();

      const earliest = earliestFeeStart(existing.length > 0, day);
      if (earliest && body.startsOn < earliest) {
        throw new HttpError(
          409,
          "starts_too_early",
          `Un cambio empieza en ${monthName(earliest)} o después: los meses que ya empezaron se cobran con el monto que tenían.`,
          { earliestStart: earliest },
        );
      }
      if (existing.some((row) => row.startsOn === body.startsOn)) {
        throw new HttpError(409, "month_taken", `Ya hay un monto que empieza en ${monthName(body.startsOn)}.`);
      }

      // The amount this one replaces from its month on, for the history log.
      const replaced = existing.find((row) => row.startsOn < body.startsOn) ?? null;

      const created = tx
        .insert(feeRates)
        .values({
          kind: body.kind,
          amountCentavos: body.amountCentavos,
          startsOn: body.startsOn,
          createdBy: actor.userId,
        })
        .returning({ id: feeRates.id, kind: feeRates.kind, amountCentavos: feeRates.amountCentavos, startsOn: feeRates.startsOn })
        .get()!;

      recordAudit(tx, actor, {
        area: "settings",
        action: "fee_rate.created",
        summary:
          `${actor.name} (${actor.role}) fijó ${FEE_NAMES[body.kind]} en ${formatLempiras(body.amountCentavos)}` +
          ` desde ${monthName(body.startsOn)}` +
          (replaced ? ` (antes ${formatLempiras(replaced.amountCentavos)})` : ""),
        entityType: "fee_rate",
        entityId: String(created.id),
        before: replaced,
        after: { kind: body.kind, amountCentavos: body.amountCentavos, startsOn: body.startsOn },
      });
      return created;
    });

    return reply.code(201).send({ rate });
  });
};
