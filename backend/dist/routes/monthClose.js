/**
 * Cierre del mes (App Plan, Module 2, "Monthly cycle"; owner, 19 November
 * 2026): the months that can be closed, a month's figures, and preparing,
 * approving and sending back its close. The rules are in src/lib/monthClose.ts.
 *
 * Preparing, approving and sending back each read the month and write it in
 * one IMMEDIATE transaction, so two people cannot both prepare or both
 * approve the same month (docs/postgres-readiness.md).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { actorOf } from "../auth/plugin.js";
import { inTransaction } from "../db/client.js";
import { months } from "../db/schema.js";
import { recordAudit } from "../lib/audit.js";
import { openingBalance } from "../lib/balance.js";
import { formatLempiras } from "../lib/census.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { MAX_AMOUNT_CENTAVOS } from "../lib/money.js";
import { closableMonths, emptyRow, monthFigures, monthRows } from "../lib/monthClose.js";
import { addMonths } from "../lib/payments.js";
import { businessToday } from "../lib/time.js";
const monthParam = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Ese no es un mes."),
});
const prepareBody = z.object({
    cashCountedCentavos: z
        .number({ message: "Escriba el efectivo que se contó en caja, o 0 si no hay." })
        .int("Escriba el monto en lempiras, por ejemplo 2500 o 2500.50.")
        .min(0, "El monto no puede ser negativo.")
        .max(MAX_AMOUNT_CENTAVOS, "El monto es demasiado alto."),
    /** The cash the screen showed as expected: if the figures changed since, the count is refused. */
    expectedCashCentavos: z.number().int(),
    reason: z.string().trim().max(300, "El motivo es demasiado largo.").optional(),
});
const returnBody = z.object({
    reason: z
        .string({ message: "Escriba por qué se devuelve." })
        .trim()
        .min(5, "Escriba por qué se devuelve.")
        .max(300, "El motivo es demasiado largo."),
});
/** "faltan L 50.00", "sobran L 20.00", or null when the count matches. */
function differenceWords(differenceCentavos) {
    if (differenceCentavos === 0)
        return null;
    return differenceCentavos < 0 ? `faltan ${formatLempiras(-differenceCentavos)}` : `sobran ${formatLempiras(differenceCentavos)}`;
}
export const monthCloseRoutes = async (app, options) => {
    const view = { preHandler: app.requirePermission("finance:view") };
    const prepare = { preHandler: app.requirePermission("month:prepare") };
    const approve = { preHandler: app.requirePermission("month:approve") };
    const thisMonth = () => firstOfMonth(businessToday(options.timeZone));
    /** The month's row and figures, or why it cannot be looked at: before the opening balance, or not over yet. */
    const monthDetail = (db, month) => {
        const opening = openingBalance(db);
        if (!opening) {
            throw new HttpError(409, "no_opening_balance", "Primero anote el Saldo de la junta: el cierre cuenta desde ahí.");
        }
        if (month < opening.month) {
            throw new HttpError(400, "before_opening", `El dinero de la aplicación empieza en ${monthName(opening.month)}: ese mes no se cierra.`);
        }
        const current = thisMonth();
        if (month >= current) {
            throw new HttpError(409, "month_not_over", `El mes de ${monthName(month)} todavía no termina. Su cierre se prepara desde el 1 de ${monthName(addMonths(month, 1))}.`);
        }
        const row = monthRows(db, month, addMonths(month, 1)).get(month) ?? emptyRow(month);
        const figures = monthFigures(db, opening.month, { cashCentavos: opening.cashCentavos, bankCentavos: opening.bankCentavos, otherCentavos: 0 }, month);
        return { row, figures };
    };
    /** The oldest month not yet closed before `month`, if any: months close in order. */
    const earlierOpen = (db, month) => closableMonths(db, thisMonth()).find((row) => row.month < month && row.status !== "closed");
    app.get("/finance/months", view, async () => {
        const current = thisMonth();
        const opening = openingBalance(app.db);
        const list = closableMonths(app.db, current);
        const next = list.find((row) => row.status !== "closed") ?? null;
        return {
            thisMonth: current,
            openingMonth: opening?.month ?? null,
            // Newest first: the closes most often looked back at.
            months: [...list].reverse(),
            next: next ? monthDetail(app.db, next.month) : null,
        };
    });
    app.get("/finance/months/:month", view, async (request) => {
        const { month } = parse(monthParam, request.params);
        return monthDetail(app.db, month);
    });
    app.post("/finance/months/:month/prepare", prepare, async (request) => {
        const { month } = parse(monthParam, request.params);
        const body = parse(prepareBody, request.body);
        const actor = actorOf(request);
        return inTransaction(app.db, (tx) => {
            const { row, figures } = monthDetail(tx, month);
            if (row.status === "prepared") {
                throw new HttpError(409, "already_prepared", `El cierre de ${monthName(month)} ya está preparado: falta que otra persona lo apruebe.`);
            }
            if (row.status === "closed") {
                throw new HttpError(409, "month_closed", `El mes de ${monthName(month)} ya está cerrado.`);
            }
            const before = earlierOpen(tx, month);
            if (before) {
                throw new HttpError(409, "earlier_open", `Primero se cierra el mes de ${monthName(before.month)}: los meses se cierran en orden.`);
            }
            const expected = figures.expected.cashCentavos;
            if (body.expectedCashCentavos !== expected) {
                throw new HttpError(409, "figures_changed", `Las cifras de ${monthName(month)} cambiaron mientras tanto: ahora en caja debe haber ${formatLempiras(expected)}. Revise y vuelva a contar.`);
            }
            const difference = body.cashCountedCentavos - expected;
            const reason = difference === 0 ? null : body.reason || null;
            if (difference !== 0 && (!reason || reason.length < 5)) {
                throw new HttpError(400, "reason_required", `El efectivo contado no es el que la aplicación espera (${differenceWords(difference)}). Escriba por qué.`);
            }
            const values = {
                status: "prepared",
                cashCountedCentavos: body.cashCountedCentavos,
                expectedCashCentavos: expected,
                cashDifferenceReason: reason,
                preparedBy: actor.userId,
                preparedAt: new Date(),
                approvedBy: null,
                approvedAt: null,
            };
            const existing = tx.select({ id: months.id }).from(months).where(eq(months.month, month)).get();
            if (existing) {
                tx.update(months).set(values).where(eq(months.id, existing.id)).run();
            }
            else {
                tx.insert(months).values({ month, ...values }).run();
            }
            const words = differenceWords(difference);
            recordAudit(tx, actor, {
                area: "finances",
                action: "month.prepared",
                summary: `${actor.name} (${actor.role}) preparó el cierre de ${monthName(month)}: efectivo contado ${formatLempiras(body.cashCountedCentavos)}` +
                    (words ? `, la aplicación esperaba ${formatLempiras(expected)} (${words})` : ", el que la aplicación esperaba"),
                entityType: "month",
                entityId: month,
                after: { cashCountedCentavos: body.cashCountedCentavos, expectedCashCentavos: expected, differenceCentavos: difference },
                reason,
            });
            return monthDetail(tx, month);
        });
    });
    app.post("/finance/months/:month/approve", approve, async (request) => {
        const { month } = parse(monthParam, request.params);
        const actor = actorOf(request);
        return inTransaction(app.db, (tx) => {
            const { row, figures } = monthDetail(tx, month);
            if (row.status !== "prepared") {
                throw new HttpError(409, row.status === "closed" ? "month_closed" : "not_prepared", row.status === "closed" ? `El mes de ${monthName(month)} ya está cerrado.` : `El cierre de ${monthName(month)} todavía no está preparado.`);
            }
            // The database refuses it too (months_preparer_not_approver); here it gets a sentence.
            if (row.preparedById === actor.userId) {
                throw new HttpError(409, "same_person", "Usted preparó este cierre: lo debe aprobar otra persona.");
            }
            // Nothing can be entered in a prepared month, so this only guards against a mistake in the app.
            if (figures.expected.cashCentavos !== row.expectedCashCentavos) {
                throw new HttpError(409, "figures_changed", "Las cifras cambiaron desde que se preparó. Devuélvalo para que lo preparen de nuevo.");
            }
            tx.update(months).set({ status: "closed", approvedBy: actor.userId, approvedAt: new Date() }).where(eq(months.month, month)).run();
            recordAudit(tx, actor, {
                area: "finances",
                action: "month.closed",
                summary: `${actor.name} (${actor.role}) aprobó el cierre de ${monthName(month)}, que preparó ${row.preparedBy}. El mes queda cerrado.`,
                entityType: "month",
                entityId: month,
                before: { status: "prepared" },
                after: { status: "closed" },
            });
            return monthDetail(tx, month);
        });
    });
    app.post("/finance/months/:month/return", approve, async (request) => {
        const { month } = parse(monthParam, request.params);
        const { reason } = parse(returnBody, request.body);
        const actor = actorOf(request);
        return inTransaction(app.db, (tx) => {
            const { row } = monthDetail(tx, month);
            if (row.status !== "prepared") {
                throw new HttpError(409, row.status === "closed" ? "month_closed" : "not_prepared", row.status === "closed"
                    ? `El mes de ${monthName(month)} ya está cerrado: ya no se devuelve.`
                    : `El cierre de ${monthName(month)} no está preparado: no hay nada que devolver.`);
            }
            tx.update(months)
                .set({
                status: "open",
                cashCountedCentavos: null,
                expectedCashCentavos: null,
                cashDifferenceReason: null,
                preparedBy: null,
                preparedAt: null,
                returnedBy: actor.userId,
                returnedAt: new Date(),
                returnedReason: reason,
            })
                .where(eq(months.month, month))
                .run();
            recordAudit(tx, actor, {
                area: "finances",
                action: "month.returned",
                summary: `${actor.name} (${actor.role}) devolvió el cierre de ${monthName(month)}, que preparó ${row.preparedBy}. El mes queda abierto.`,
                entityType: "month",
                entityId: month,
                before: {
                    status: "prepared",
                    cashCountedCentavos: row.cashCountedCentavos,
                    expectedCashCentavos: row.expectedCashCentavos,
                    cashDifferenceReason: row.cashDifferenceReason,
                },
                after: { status: "open" },
                reason,
            });
            return monthDetail(tx, month);
        });
    });
};
//# sourceMappingURL=monthClose.js.map