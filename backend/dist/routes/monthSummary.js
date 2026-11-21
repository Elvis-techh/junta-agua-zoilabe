/**
 * Resumen del mes (owner, 19 November 2026): a month's money, what came in
 * and from whom, what was spent and on what, and who was charged its fee,
 * who paid and who still owes. How each part is counted is in
 * src/lib/monthSummary.ts.
 *
 * Any month from the opening balance's to the month in progress can be
 * looked at, closed or not: the board checks a month before closing it too.
 * Like Quién debe, it is for whoever holds `finance:view`; it shows names
 * and amounts, never an ID number or a phone.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { months } from "../db/schema.js";
import { openingBalance } from "../lib/balance.js";
import { firstOfMonth, monthName } from "../lib/fees.js";
import { HttpError, parse } from "../lib/http.js";
import { monthFigures } from "../lib/monthClose.js";
import { monthEntries, monthFee } from "../lib/monthSummary.js";
import { businessToday } from "../lib/time.js";
const monthParam = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Ese no es un mes."),
});
export const monthSummaryRoutes = async (app, options) => {
    const view = { preHandler: app.requirePermission("finance:view") };
    const summaryOf = (month) => {
        const today = businessToday(options.timeZone);
        const thisMonth = firstOfMonth(today);
        const opening = openingBalance(app.db);
        if (!opening) {
            throw new HttpError(409, "no_opening_balance", "Primero anote el Saldo de la junta: el resumen cuenta el dinero desde ahí.");
        }
        const chosen = month ?? thisMonth;
        if (chosen < opening.month) {
            throw new HttpError(400, "before_opening", `El dinero de la aplicación empieza en ${monthName(opening.month)}.`);
        }
        if (chosen > thisMonth) {
            throw new HttpError(400, "month_not_started", `El mes de ${monthName(chosen)} todavía no empieza.`);
        }
        const row = app.db.select({ status: months.status }).from(months).where(eq(months.month, chosen)).get();
        return {
            month: chosen,
            today,
            thisMonth,
            openingMonth: opening.month,
            /** The month close's status; "open" while nobody has prepared it. */
            status: row?.status ?? "open",
            figures: monthFigures(app.db, opening.month, { cashCentavos: opening.cashCentavos, bankCentavos: opening.bankCentavos, otherCentavos: 0 }, chosen),
            entries: monthEntries(app.db, opening.month, chosen),
            fee: monthFee(app.db, chosen, today, options.timeZone),
        };
    };
    /** The month in progress. */
    app.get("/finance/summary", view, async () => summaryOf(null));
    app.get("/finance/summary/:month", view, async (request) => {
        const { month } = parse(monthParam, request.params);
        return summaryOf(month);
    });
};
//# sourceMappingURL=monthSummary.js.map