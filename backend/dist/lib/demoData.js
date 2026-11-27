/**
 * Made-up data for the test copy (docs/test-copy.md): three months back and
 * this one, so every screen has something to show: families that pay on time,
 * late, in part, ahead or never, a family that moved away, donations, expenses
 * with and without a photo, and entries that were undone.
 *
 * Everything goes in through the API, as a person's taps would, so each rule
 * (the history log, receipt numbers, the fee in force) applies as it does on
 * a phone. The caller decides when it is safe to run: see
 * src/scripts/demo-data.ts, which refuses a database that has any data.
 *
 * Dates are counted back from today, so the data always ends this month.
 * Amounts follow the fee set here (L 70.00 a month, L 50.00 late fee); the
 * deadline set here (day 15, 3 days of grace) is made up, like the rest.
 */
import { randomUUID } from "node:crypto";
import { firstOfMonth } from "./fees.js";
import { addMonths } from "./payments.js";
/** A 120 × 80 picture that says "RECIBO DE PRUEBA": what a receipt photo looks like on the screen. */
const RECEIPT_PHOTO = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCABQAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDrKKKKkAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigArE1SPdd3b+VGwS2jJkY/NEN0nzLx1HXqOlbdFAHPI0XlXIVLYSfaJN7I/77Z5p3cYz93PerUv2Tym+xbdnnW+fLx5efNHTHGfX8K16KAOXkI34iji3C6m814X/AHuze27cAM4xnv121r2n2f7f/oHl+R5R8zysbd2Rt6cZxu/T2rRooA5g/Z/7Di+x+X5n2JvtHl46eUfvY77sdff3rQmaBtF1DyEtU/cPkW7hh909cAVr0UAYlxZMk9uTbWwWScAW4P7viOTk/L159OwquGWOzvY2IV5rUxxpnq++UFF9cFgPpiujooAyIWgGsXYkS1MnnrtZ3AkH7tOgx/X1rOsXH2WBLeOBXltBFuhk6sxUfPgcHGT36NXUUUAU9M3Jbtbuqq0DlNqnIA6qAcDsQPwq5RRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/9k=";
const FEE = 7000;
const LATE_FEE = 5000;
const SECTORS = ["El Centro", "La Ceiba", "Los Pinos"];
const FAMILIES = [
    // Always on time.
    { name: "Ana López", sector: 0, payments: [3, 2, 1, 0].map((paidIn) => ({ paidIn, day: 5, covers: [paidIn] })) },
    // Paid the first month, part of the second, nothing since.
    { name: "Bruno Díaz", sector: 0, payments: [{ paidIn: 3, day: 8, covers: [3] }, { paidIn: 2, day: 10, covers: [2], centavos: 3000 }] },
    // Has never paid.
    { name: "Carla Ruiz", sector: 1, payments: [] },
    // Paid two months at once, ahead.
    { name: "Diego Paz", sector: 1, payments: [{ paidIn: 3, day: 20, covers: [3, 2], centavos: FEE * 2 }, { paidIn: 1, day: 8, covers: [1] }, { paidIn: 0, day: 3, covers: [0] }] },
    // Pays after the deadline each time.
    { name: "Gloria Mejía", sector: 2, payments: [{ paidIn: 2, day: 22, covers: [3] }, { paidIn: 1, day: 24, covers: [2] }, { paidIn: 0, day: 20, covers: [1] }] },
    // Paid three months in one go.
    { name: "Héctor Flores", sector: 2, payments: [{ paidIn: 1, day: 12, covers: [3, 2, 1], centavos: FEE * 3 }, { paidIn: 0, day: 2, covers: [0] }] },
    // On time, then stopped.
    { name: "Irma Castro", sector: 0, payments: [{ paidIn: 3, day: 6, covers: [3] }, { paidIn: 2, day: 7, covers: [2] }] },
    // Registered today: owes from this month only.
    { name: "Julio Mena", sector: 1, payments: [], new: true },
    // Paid the first month, then moved away.
    { name: "Karla Ortiz", sector: 2, payments: [{ paidIn: 3, day: 9, covers: [3] }], movedAwayIn: 2 },
    // On time, but one of the payments is undone later.
    { name: "Luis Pineda", sector: 0, payments: [3, 2, 1].map((paidIn) => ({ paidIn, day: 4, covers: [paidIn] })) },
    // Its paper form is from last year, and it pays on time.
    { name: "Marta Reyes", sector: 2, payments: [3, 2, 1, 0].map((paidIn) => ({ paidIn, day: 6, covers: [paidIn] })), paperLastYear: true },
];
/**
 * Fill an empty database. `cookie` is the header of a signed-in user who
 * holds every permission (the administrator); `today` is the business day.
 */
export async function fillWithMadeUpData(app, cookie, today) {
    const thisMonth = firstOfMonth(today);
    const m = (back) => addMonths(thisMonth, -back);
    /** A day of a month, never after today and never past the 28th, so every month has it. */
    const dayOf = (month, day) => {
        const date = `${month.slice(0, 8)}${String(Math.min(day, 28)).padStart(2, "0")}`;
        return date > today ? today : date;
    };
    let receipt = 7000;
    const call = async (method, url, payload) => {
        const response = await app.inject({ method, url: `/api${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });
        if (response.statusCode >= 300) {
            throw new Error(`${method} ${url} answered ${response.statusCode}: ${response.body}`);
        }
        return response.json();
    };
    // What the board sets before anything else.
    await call("POST", "/settings/fees", { kind: "base_monthly", amountCentavos: FEE, startsOn: m(3) });
    await call("POST", "/settings/fees", { kind: "late_fee", amountCentavos: LATE_FEE, startsOn: m(3) });
    await call("POST", "/settings/deadline", { dueDay: 15, graceDays: 3 });
    await call("POST", "/settings/late-fees", { month: m(3) });
    const sectorIds = [];
    for (const name of SECTORS) {
        sectorIds.push((await call("POST", "/settings/sectors", { name })).sector.id);
    }
    await call("POST", "/finance/opening-balance", { month: m(3), cashCentavos: 500000, bankCentavos: 800000 });
    // The census: paper forms dated at the start of the first month, so the fee counts from then.
    let idNumber = 801199500000;
    const houses = new Map();
    for (const [index, family] of FAMILIES.entries()) {
        const created = await call("POST", "/census/households", {
            submissionId: randomUUID(),
            person: { fullName: family.name, idNumber: String((idNumber += 1)).padStart(13, "0"), phone: `9900${String(1000 + index)}` },
            household: { sectorId: sectorIds[family.sector], references: "Casa de prueba", waterConnection: "connected", relation: "owner" },
            fee: { kind: "base" },
            ...(family.new
                ? {}
                : { paper: { date: family.paperLastYear ? `${Number(today.slice(0, 4)) - 1}-11-20` : dayOf(m(3), 1), formNumber: String(100 + index) } }),
        });
        houses.set(family.name, created.household.id);
    }
    const payments = new Map();
    let paymentCount = 0;
    for (const family of FAMILIES) {
        for (const payment of family.payments) {
            const result = await call("POST", "/finance/payments", {
                submissionId: randomUUID(),
                householdId: houses.get(family.name),
                months: payment.covers.map(m).sort(),
                amountCentavos: payment.centavos ?? FEE,
                occurredOn: dayOf(m(payment.paidIn), payment.day),
                paymentMethod: "cash",
                paperReceiptNumber: String((receipt += 1)),
            });
            payments.set(`${family.name}/${payment.paidIn}`, result.payment?.id ?? result.entry?.id);
            paymentCount += 1;
        }
        if (family.movedAwayIn !== undefined) {
            await call("POST", `/census/households/${houses.get(family.name)}/deactivate`, {
                reason: "moved_away",
                since: dayOf(m(family.movedAwayIn), 1),
            });
        }
    }
    // Gloria's late fee for the first month, paid in the second.
    await call("POST", "/finance/income", {
        submissionId: randomUUID(),
        type: "late_fee",
        householdId: houses.get("Gloria Mejía"),
        month: m(3),
        amountCentavos: LATE_FEE,
        occurredOn: dayOf(m(2), 25),
        paymentMethod: "cash",
        paperReceiptNumber: String((receipt += 1)),
    });
    // Donations.
    const donate = async (payerName, amountCentavos, occurredOn, method) => (await call("POST", "/finance/income", {
        submissionId: randomUUID(),
        type: "donation",
        payerName,
        amountCentavos,
        occurredOn,
        paymentMethod: method,
        ...(method === "transfer" ? { bankReference: `BAC-${receipt}` } : {}),
        paperReceiptNumber: String((receipt += 1)),
    })).entry.id;
    await donate("Iglesia del pueblo", 20000, dayOf(m(2), 12), "transfer");
    await donate("Familia Rivera", 15000, dayOf(m(1), 20), "cash");
    const twice = await donate("Asociación de Mujeres", 10000, dayOf(m(0), 28), "cash");
    // Expenses. The first of each month has the receipt's photo; the others say why not.
    const categories = new Map();
    for (const category of (await call("GET", "/finance/expenses/setup")).categories) {
        categories.set(category.name, category.id);
    }
    let expenseCount = 0;
    const spend = async (category, supplier, amountCentavos, occurredOn, method, photo) => {
        await call("POST", "/finance/expenses", {
            submissionId: randomUUID(),
            categoryId: categories.get(category),
            supplier,
            amountCentavos,
            occurredOn,
            paymentMethod: method,
            ...(method === "transfer" ? { bankReference: `BAC-${receipt}` } : {}),
            ...(photo ? { photo: RECEIPT_PHOTO } : { noPhotoReason: "Pagado a mano, sin factura" }),
        });
        expenseCount += 1;
    };
    await spend("Cloro", "Agroquímicos de Tela", 85000, dayOf(m(3), 18), "cash", true);
    await spend("Energía eléctrica", "ENEE", 120000, dayOf(m(3), 20), "transfer", true);
    await spend("Reparaciones y materiales", "Ferretería El Puente", 235000, dayOf(m(2), 6), "cash", false);
    await spend("Cloro", "Agroquímicos de Tela", 85000, dayOf(m(2), 14), "cash", true);
    await spend("Estipendio", "Fontanero Mario", 150000, dayOf(m(2), 28), "cash", false);
    await spend("Energía eléctrica", "ENEE", 118000, dayOf(m(1), 12), "transfer", true);
    await spend("Transporte", "Moto taxi", 30000, dayOf(m(1), 15), "cash", false);
    await spend("Cloro", "Agroquímicos de Tela", 90000, dayOf(m(1), 22), "cash", true);
    await spend("Cloro", "Agroquímicos de Tela", 40000, dayOf(m(0), 1), "cash", true);
    // Mistakes put right, today: nothing is deleted, each is undone with a reason.
    await call("POST", `/finance/income/${twice}/reverse`, { reason: "Se anotó dos veces" });
    const earlier = payments.get("Luis Pineda/2");
    if (!earlier)
        throw new Error("Luis Pineda's payment is missing");
    await call("POST", `/finance/payments/${earlier}/reverse`, { reason: "Era de otra casa, se anotó aquí por error" });
    return {
        households: FAMILIES.length,
        payments: paymentCount,
        income: 4,
        expenses: expenseCount,
        undone: 2,
        months: [m(3), m(2), m(1), m(0)],
    };
}
//# sourceMappingURL=demoData.js.map