/**
 * Configuración → Cuotas: the base monthly fee, the late fee (mora) and the
 * reconnection fee, each from the month it starts.
 *
 * A rate is never deleted. A new amount is a new row from the month it
 * starts, covering the months up to the next amount, and the list shows every
 * price the board has ever set. A new amount may start in a past month, so the
 * fees of the years in the paper book can be entered, but not once a payment
 * falls in the months it would cover (owner, 12 November 2026). Until a
 * payment has been made in its months, an amount can be corrected if it was
 * typed wrong, or removed ("Quitar") if the board did not mean it or no longer
 * wants it: the row stays, marked removed, and the amount before it applies
 * again. Both need a written reason.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { actorOf } from "../auth/plugin.js";
import { inTransaction } from "../db/client.js";
import { feeRates, users } from "../db/schema.js";
import { formatLempiras } from "../lib/census.js";
import { recordAudit } from "../lib/audit.js";
import { firstOfMonth, monthAfter, monthName, paidMonthsAt } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { FEE_KINDS, feeOn } from "../lib/settings.js";
import { businessToday } from "../lib/time.js";
/** How the history log names each fee. */
const FEE_NAMES = {
    base_monthly: "la cuota mensual base",
    late_fee: "la mora",
    reconnection: "la cuota de reconexión",
};
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
const removeBody = z.object({
    reason: z
        .string({ message: "Escriba por qué se quita." })
        .trim()
        .min(5, "Escriba por qué se quita.")
        .max(300, "El motivo es demasiado largo."),
});
const NOT_FOUND = new HttpError(404, "not_found", "No se encontró ese monto.");
/** The rate an address names, if it exists and has not been removed. */
function liveRate(tx, idParam) {
    const id = Number(idParam);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw NOT_FOUND;
    }
    const rate = tx.select().from(feeRates).where(eq(feeRates.id, id)).get();
    if (!rate || rate.removedAt) {
        throw NOT_FOUND;
    }
    return rate;
}
export const feeRoutes = async (app, options) => {
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
            .where(isNull(feeRates.removedAt))
            .orderBy(desc(feeRates.startsOn));
        const fees = FEE_KINDS.map((kind) => {
            const rates = rows.filter((row) => row.kind === kind);
            // Newest first, so the first one that has started is the one in force.
            const current = rates.find((rate) => rate.startsOn <= day) ?? null;
            return {
                kind,
                currentId: current?.id ?? null,
                rates: rates.map(({ kind: _kind, ...rate }) => ({ ...rate, correctable: !paidMonthsAt(app.db, kind, rate.startsOn) })),
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
                .where(and(eq(feeRates.kind, body.kind), isNull(feeRates.removedAt)))
                .orderBy(desc(feeRates.startsOn))
                .all();
            if (existing.some((row) => row.startsOn === body.startsOn)) {
                throw new HttpError(409, "month_taken", `Ya hay un monto que empieza en ${monthName(body.startsOn)}. Si está mal, corríjalo.`);
            }
            // From this month on a change is always allowed: a paid month keeps the
            // price its first payment fixed (src/lib/payments.ts). A change that
            // starts in a past month is refused once its months hold a payment.
            const thisMonth = firstOfMonth(day);
            const paid = body.startsOn < thisMonth ? paidMonthsAt(tx, body.kind, body.startsOn) : null;
            if (paid) {
                // The earliest it could start instead: after the last paid month (or
                // this month, if sooner), unless the next amount begins by then.
                const after = monthAfter(paid.last) < thisMonth ? monthAfter(paid.last) : thisMonth;
                const earliestStart = existing.some((row) => row.startsOn > body.startsOn && row.startsOn <= after) ? null : after;
                const paidName = monthName(paid.first).replace(/^./, (letter) => letter.toUpperCase());
                throw new HttpError(409, "months_paid", earliestStart
                    ? `${paidName} ya tiene pagos. Lo más pronto que puede empezar es ${monthName(earliestStart)}.`
                    : `${paidName} ya tiene pagos, así que este cambio no puede empezar en ${monthName(body.startsOn)}.`, { firstPaidMonth: paid.first, earliestStart });
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
                .get();
            recordAudit(tx, actor, {
                area: "settings",
                action: "fee_rate.created",
                summary: `${actor.name} (${actor.role}) fijó ${FEE_NAMES[body.kind]} en ${formatLempiras(body.amountCentavos)}` +
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
    app.patch("/settings/fees/:id", guard, async (request) => {
        const body = parse(correctBody, request.body);
        const actor = actorOf(request);
        inTransaction(app.db, (tx) => {
            const rate = liveRate(tx, request.params.id);
            if (paidMonthsAt(tx, rate.kind, rate.startsOn)) {
                throw new HttpError(409, "already_paid", "Ya hay pagos de esos meses, así que este monto no se corrige. Ponga un monto nuevo desde este mes.");
            }
            if (body.amountCentavos === rate.amountCentavos) {
                return;
            }
            tx.update(feeRates).set({ amountCentavos: body.amountCentavos }).where(eq(feeRates.id, rate.id)).run();
            recordAudit(tx, actor, {
                area: "settings",
                action: "fee_rate.corrected",
                summary: `${actor.name} (${actor.role}) corrigió ${FEE_NAMES[rate.kind]} desde ${monthName(rate.startsOn)}:` +
                    ` ${formatLempiras(rate.amountCentavos)} → ${formatLempiras(body.amountCentavos)}`,
                entityType: "fee_rate",
                entityId: String(rate.id),
                before: { amountCentavos: rate.amountCentavos },
                after: { amountCentavos: body.amountCentavos },
                reason: body.reason,
            });
        });
        return { ok: true };
    });
    /**
     * "Quitar": an amount the board did not mean, or no longer wants. Nothing
     * is deleted: the row is marked removed, with who and why, and stops
     * counting, so its months go back to the amount before it. Refused once a
     * payment falls in its months, like a correction: a paid month keeps its price.
     */
    app.post("/settings/fees/:id/remove", guard, async (request) => {
        const body = parse(removeBody, request.body);
        const actor = actorOf(request);
        inTransaction(app.db, (tx) => {
            const rate = liveRate(tx, request.params.id);
            if (paidMonthsAt(tx, rate.kind, rate.startsOn)) {
                throw new HttpError(409, "already_paid", "Ya hay pagos de esos meses, así que este monto no se quita. Ponga un monto nuevo desde el mes que corresponda.");
            }
            tx
                .update(feeRates)
                .set({ removedAt: new Date(), removedBy: actor.userId, removedReason: body.reason })
                .where(eq(feeRates.id, rate.id))
                .run();
            // What its first month costs now, with this amount gone.
            const fallback = feeOn(tx, rate.kind, rate.startsOn);
            recordAudit(tx, actor, {
                area: "settings",
                action: "fee_rate.removed",
                summary: `${actor.name} (${actor.role}) quitó ${FEE_NAMES[rate.kind]} de ${formatLempiras(rate.amountCentavos)}` +
                    ` desde ${monthName(rate.startsOn)}` +
                    (fallback === null ? " (esos meses quedan sin monto)" : ` (esos meses vuelven a ${formatLempiras(fallback)})`),
                entityType: "fee_rate",
                entityId: String(rate.id),
                before: { kind: rate.kind, amountCentavos: rate.amountCentavos, startsOn: rate.startsOn },
                reason: body.reason,
            });
        });
        return { ok: true };
    });
};
//# sourceMappingURL=fees.js.map