/**
 * Configuración → Cuotas: the base monthly fee, the late fee (mora) and the
 * reconnection fee, each from the month it starts.
 *
 * A rate is never deleted. A new amount is a new row from the month it
 * starts, so every month keeps the price it was charged at, and the list
 * shows every price the board has ever set. An amount typed wrong can be
 * corrected, with a written reason, until a payment has been made at it.
 * Both ask for the PIN again.
 */
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { actorOf } from "../auth/plugin.js";
import { inTransaction } from "../db/client.js";
import { feeRates, users } from "../db/schema.js";
import { formatLempiras } from "../lib/census.js";
import { recordAudit } from "../lib/audit.js";
import { earliestFeeStart, paidFrom } from "../lib/fees.js";
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

// Zero is allowed (owner, 2026-11-02): the board may decide not to charge a fee.
const amountCentavos = z
  .number({ message: "Escriba el monto en lempiras." })
  .int("Escriba el monto en lempiras, por ejemplo 70 o 70.50.")
  .min(0, "El monto no puede ser negativo.")
  .max(9_999_999, "El monto es demasiado alto.");

const createBody = z.object({
  kind: z.enum(FEE_KINDS, { message: "Elija qué cuota cambia." }),
  amountCentavos,
  // A rate starts on the first day of a month: fees are charged by the month.
  startsOn: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Elija el mes en que empieza."),
});

const correctBody = z.object({
  amountCentavos,
  reason: z
    .string({ message: "Escriba por qué se corrige." })
    .trim()
    .min(5, "Escriba por qué se corrige.")
    .max(300, "El motivo es demasiado largo."),
});

const NOT_FOUND = new HttpError(404, "not_found", "No se encontró ese monto.");

export const feeRoutes: FastifyPluginAsync<{ timeZone: string }> = async (app, options) => {
  const guard = { preHandler: app.requirePermission("settings:edit") };
  const guardWithPin = { preHandler: [app.requirePermission("settings:edit"), app.requireRecentPin] };
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
        rates: rates.map(({ kind: _kind, ...rate }) => ({ ...rate, correctable: !paidFrom(app.db, rate.startsOn) })),
      };
    });
    return { today: day, fees };
  });

  app.post("/settings/fees", guardWithPin, async (request, reply) => {
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
          `Un cambio empieza en ${monthName(earliest)} o después: los meses pasados se cobran con el monto que tenían.`,
          { earliestStart: earliest },
        );
      }
      if (existing.some((row) => row.startsOn === body.startsOn)) {
        throw new HttpError(
          409,
          "month_taken",
          `Ya hay un monto que empieza en ${monthName(body.startsOn)}. Si está mal, corríjalo.`,
        );
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

  app.patch<{ Params: { id: string } }>("/settings/fees/:id", guardWithPin, async (request) => {
    const body = parse(correctBody, request.body);
    const actor = actorOf(request);
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw NOT_FOUND;
    }

    inTransaction(app.db, (tx) => {
      const rate = tx.select().from(feeRates).where(eq(feeRates.id, id)).get();
      if (!rate) {
        throw NOT_FOUND;
      }
      if (paidFrom(tx, rate.startsOn)) {
        throw new HttpError(
          409,
          "already_paid",
          "Ya hay pagos de esos meses, así que este monto no se corrige. Ponga un monto nuevo desde este mes.",
        );
      }
      if (body.amountCentavos === rate.amountCentavos) {
        return;
      }

      tx.update(feeRates).set({ amountCentavos: body.amountCentavos }).where(eq(feeRates.id, id)).run();
      recordAudit(tx, actor, {
        area: "settings",
        action: "fee_rate.corrected",
        summary:
          `${actor.name} (${actor.role}) corrigió ${FEE_NAMES[rate.kind]} desde ${monthName(rate.startsOn)}:` +
          ` ${formatLempiras(rate.amountCentavos)} → ${formatLempiras(body.amountCentavos)}`,
        entityType: "fee_rate",
        entityId: String(id),
        before: { amountCentavos: rate.amountCentavos },
        after: { amountCentavos: body.amountCentavos },
        reason: body.reason,
      });
    });

    return { ok: true };
  });
};
