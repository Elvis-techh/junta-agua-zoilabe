import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { auditLog, categories, feeRates, months, receiptFiles, transactions } from "../src/db/schema.js";
import { firstOfMonth } from "../src/lib/fees.js";
import { addMonths } from "../src/lib/payments.js";
import { MAX_PHOTO_BYTES } from "../src/lib/receiptPhotos.js";
import { HONDURAS_TIME_ZONE, businessToday } from "../src/lib/time.js";
import type { TestApp } from "./helpers.js";
import { buildTestApp, rejectsWithDbError, signedInUser, takeAway } from "./helpers.js";

/** The start of a JPEG and some bytes after it: all the server looks at. */
const jpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]);

describe("Gasto: expenses with a photo of the receipt or invoice", () => {
  let t: TestApp;
  let receiptsPath: string;
  let treasurer: { id: string; cookie: string };
  let president: { cookie: string };
  let vocal: { cookie: string };
  let secretary: { cookie: string };
  let chlorine: number;
  let otherExpense: number;

  const today = businessToday(HONDURAS_TIME_ZONE);

  const call = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const expense = (overrides: Record<string, unknown> = {}) => ({
    submissionId: randomUUID(),
    categoryId: chlorine,
    supplier: "Ferretería El Puente",
    amountCentavos: 45000,
    occurredOn: today,
    paymentMethod: "cash",
    photo: jpeg().toString("base64"),
    ...overrides,
  });
  const record = (overrides: Record<string, unknown> = {}) => call(treasurer.cookie, "POST", "/api/finance/expenses", expense(overrides));
  const photosOnDisk = () => readdirSync(receiptsPath).length;
  const list = async () => {
    const response = await call(treasurer.cookie, "GET", "/api/finance/expenses");
    assert.equal(response.statusCode, 200, response.body);
    return response.json().entries as Array<Record<string, unknown> & { id: string }>;
  };

  before(async () => {
    receiptsPath = mkdtempSync(join(tmpdir(), "zoilabe-receipts-"));
    t = await buildTestApp({ receiptsPath });
    treasurer = await signedInUser(t, "tesorero", "Tina Tesorera");
    president = await signedInUser(t, "presidente", "Pedro Presidente");
    vocal = await signedInUser(t, "primer_vocal");
    secretary = await signedInUser(t, "secretario");
    const all = await t.db.select().from(categories).where(eq(categories.kind, "expense"));
    chlorine = all.find((category) => category.name === "Cloro")!.id;
    otherExpense = all.find((category) => category.name === "Otro gasto")!.id;
  });
  after(async () => {
    await t.close();
    rmSync(receiptsPath, { recursive: true, force: true });
  });

  it("lets only those who may record add an expense, and only those who may see finances list them or open a photo", async () => {
    takeAway(t, "primer_vocal", "finance:record", "finance:reverse");
    takeAway(t, "secretario", "finance:view");
    assert.equal((await call(vocal.cookie, "POST", "/api/finance/expenses", expense())).statusCode, 403);
    assert.equal((await call(vocal.cookie, "GET", "/api/finance/expenses/setup")).statusCode, 403);
    assert.equal((await call(secretary.cookie, "GET", "/api/finance/expenses")).statusCode, 403);
    assert.equal((await call(secretary.cookie, "GET", `/api/finance/expenses/${randomUUID()}/photo`)).statusCode, 403);
    assert.equal((await t.db.select().from(transactions)).length, 0);
    assert.equal(photosOnDisk(), 0);
  });

  it("gives the screen today and the plan's expense categories, with the one that says what it is", async () => {
    const response = await call(treasurer.cookie, "GET", "/api/finance/expenses/setup");
    assert.equal(response.statusCode, 200, response.body);
    const setup = response.json() as { today: string; categories: Array<{ id: number; name: string; saysWhat: boolean }> };
    assert.equal(setup.today, today);
    assert.deepEqual(
      setup.categories.map((category) => category.name),
      ["Reparaciones y materiales", "Energía eléctrica", "Cloro", "Estipendio", "Transporte", "Otro gasto"],
    );
    assert.deepEqual(
      setup.categories.filter((category) => category.saysWhat).map((category) => category.name),
      ["Otro gasto"],
    );
  });

  it("records an expense with its photo, in the history log, and gives the photo back only through the API", async () => {
    const photo = jpeg(3000);
    const response = await record({ photo: photo.toString("base64"), invoiceNumber: " 000-123 ", note: "Dos galones" });
    assert.equal(response.statusCode, 201, response.body);
    const entry = response.json().entry;
    assert.equal(entry.category, "Cloro");
    assert.equal(entry.supplier, "Ferretería El Puente");
    assert.equal(entry.amountCentavos, 45000);
    assert.equal(entry.invoiceNumber, "000-123");
    assert.equal(entry.hasPhoto, true);
    assert.equal(entry.noPhotoReason, null);
    assert.equal(entry.recordedBy, "Tina Tesorera");
    assert.equal(entry.reversed, false);

    const [row] = await t.db.select().from(transactions).where(eq(transactions.id, entry.id));
    assert.equal(row!.kind, "expense");
    assert.equal(row!.amountCentavos, 45000);
    assert.equal(row!.householdId, null);
    const [month] = await t.db.select().from(months).where(eq(months.id, row!.monthId));
    assert.equal(month!.month, firstOfMonth(today));

    const [file] = await t.db.select().from(receiptFiles).where(eq(receiptFiles.transactionId, entry.id));
    assert.equal(file!.contentType, "image/jpeg");
    assert.equal(file!.sizeBytes, 3000);
    assert.match(file!.storageKey, /^receipts\/[0-9a-f-]{36}\.jpg$/);
    assert.deepEqual(readFileSync(join(receiptsPath, file!.storageKey.slice("receipts/".length))), photo);

    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, entry.id));
    assert.equal(logged!.action, "expense.recorded");
    assert.equal(logged!.summary, "Tina Tesorera (Tesorero/a) registró un gasto de Cloro: L 450.00 a Ferretería El Puente, factura nº 000-123");

    const served = await call(president.cookie, "GET", `/api/finance/expenses/${entry.id}/photo`);
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers["content-type"], "image/jpeg");
    assert.equal(served.headers["cache-control"], "private, no-store");
    assert.deepEqual(served.rawPayload, photo);
    assert.equal((await t.app.inject({ method: "GET", url: `/api/finance/expenses/${entry.id}/photo` })).statusCode, 401);
  });

  it("asks for the photo every time, and saves without one only with a written reason (owner, 15 November 2026)", async () => {
    const before = photosOnDisk();
    const none = await record({ photo: undefined });
    assert.equal(none.statusCode, 400);
    assert.equal(none.json().error, "photo_required");
    assert.match(none.json().message, /^Tome la foto del recibo o la factura\. Si no hay, toque «No hay recibo» y escriba por qué\.$/);
    assert.equal((await record({ photo: undefined, noPhotoReason: "no" })).statusCode, 400);

    const withReason = await record({ photo: undefined, noPhotoReason: "Jornal pagado a mano, sin recibo", supplier: "Juan Pérez" });
    assert.equal(withReason.statusCode, 201, withReason.body);
    const entry = withReason.json().entry;
    assert.equal(entry.hasPhoto, false);
    assert.equal(entry.noPhotoReason, "Jornal pagado a mano, sin recibo");
    assert.equal((await t.db.select().from(receiptFiles).where(eq(receiptFiles.transactionId, entry.id))).length, 0);
    assert.equal(photosOnDisk(), before);
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, entry.id));
    assert.match(logged!.summary, /a Juan Pérez \(sin foto\)$/);
    assert.equal(logged!.reason, "Jornal pagado a mano, sin recibo");
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/expenses/${entry.id}/photo`)).statusCode, 404);
  });

  it("keeps only a real photo of a size a phone sends, and leaves no file behind for an expense it refuses", async () => {
    const before = photosOnDisk();
    const notAPhoto = await record({ photo: Buffer.from("<html>hola</html>").toString("base64") });
    assert.equal(notAPhoto.statusCode, 400);
    assert.equal(notAPhoto.json().error, "invalid_photo");
    assert.equal((await record({ photo: "no es base64 !!" })).json().error, "invalid_photo");
    const tooLarge = await record({ photo: jpeg(MAX_PHOTO_BYTES + 3000).toString("base64") });
    assert.ok(tooLarge.statusCode === 400 || tooLarge.statusCode === 413, tooLarge.body);

    // Refused after its photo was already written: a future date, a category that is not an expense's.
    assert.equal((await record({ occurredOn: "2999-01-01" })).statusCode, 400);
    const income = (await t.db.select().from(categories).where(eq(categories.kind, "income")))[0]!;
    assert.equal((await record({ categoryId: income.id })).statusCode, 400);
    assert.equal(photosOnDisk(), before);
  });

  it("checks the rest of what it asks: who was paid, the amount, the date, the transfer's reference, what another expense is", async () => {
    assert.match((await record({ supplier: " " })).json().message, /^Escriba a quién se le pagó\.$/);
    assert.match((await record({ amountCentavos: 0 })).json().message, /^Escriba el monto que se pagó\.$/);
    assert.match((await record({ occurredOn: "2999-01-01" })).json().message, /^La fecha del gasto no puede ser después de hoy\.$/);
    assert.match((await record({ paymentMethod: "transfer" })).json().message, /referencia de la transferencia/);
    assert.match((await record({ categoryId: otherExpense })).json().message, /^Escriba de qué es el gasto\.$/);

    const transfer = await record({ paymentMethod: "transfer", bankReference: "TRX-9", categoryId: otherExpense, note: "Papelería" });
    assert.equal(transfer.statusCode, 201, transfer.body);
    assert.equal(transfer.json().entry.bankReference, "TRX-9");
    assert.equal(transfer.json().entry.category, "Otro gasto");
    assert.equal(transfer.json().entry.note, "Papelería");
  });

  it("saves a retry of the same expense once, with one photo", async () => {
    const before = photosOnDisk();
    const body = expense({ supplier: "ENEE" });
    const first = await call(treasurer.cookie, "POST", "/api/finance/expenses", body);
    const again = await call(treasurer.cookie, "POST", "/api/finance/expenses", body);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().entry.id, first.json().entry.id);
    assert.equal((await t.db.select().from(transactions).where(eq(transactions.submissionId, body.submissionId))).length, 1);
    assert.equal(photosOnDisk(), before + 1);
  });

  it("flags the same invoice number from the same supplier, not blocks it, and not another supplier's", async () => {
    const first = await record({ supplier: "Agroquímicos Tela", invoiceNumber: "A-77" });
    assert.equal(first.statusCode, 201, first.body);

    // The same shop, typed without its accent and in other letters.
    const repeated = await record({ supplier: "agroquimicos  TELA", invoiceNumber: "A-77" });
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.json().error, "invoice_repeated");
    assert.match(repeated.json().message, /^La factura nº A-77 de Agroquímicos Tela ya se registró el .+ \(L 450\.00\)\.$/);

    const otherShop = await record({ supplier: "Ferretería El Puente", invoiceNumber: "A-77" });
    assert.equal(otherShop.statusCode, 201, otherShop.body);
    assert.equal(otherShop.json().entry.repeatedInvoice, false);

    const confirmed = await record({ supplier: "agroquimicos tela", invoiceNumber: "A-77", confirmRepeatedInvoice: true });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal(confirmed.json().entry.repeatedInvoice, true);
    const [logged] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, confirmed.json().entry.id));
    assert.match(logged!.summary, /\(número de factura repetido\)$/);
    const entries = await list();
    assert.equal(entries.find((entry) => entry.id === first.json().entry.id)!.repeatedInvoice, true);
  });

  it("keeps a supplier's invoice number apart from the board's own receipt numbers", async () => {
    const admin = await signedInUser(t, "administrador");
    const sector = await call(admin.cookie, "POST", "/api/settings/sectors", { name: "Sector Gastos" });
    const house = await call(president.cookie, "POST", "/api/census/households", {
      submissionId: randomUUID(),
      person: { fullName: "maría lópez", idNumber: "0801199200777", phone: "99887766" },
      household: { sectorId: sector.json().sector.id, references: "Junto al puente", waterConnection: "connected", relation: "owner" },
      fee: { kind: "base" },
    });
    assert.equal(house.statusCode, 201, house.body);
    await t.db.insert(feeRates).values({ kind: "base_monthly", amountCentavos: 7000, startsOn: addMonths(firstOfMonth(today), -24) });

    assert.equal((await record({ invoiceNumber: "4400" })).statusCode, 201);
    // The board's receipt nº 4400 is not a repeat of a shop's invoice nº 4400…
    const payment = await call(treasurer.cookie, "POST", "/api/finance/payments", {
      submissionId: randomUUID(),
      householdId: house.json().household.id,
      months: [firstOfMonth(today)],
      amountCentavos: 7000,
      occurredOn: today,
      paymentMethod: "cash",
      paperReceiptNumber: "4400",
    });
    assert.equal(payment.statusCode, 201, payment.body);
    // …nor the other way round.
    assert.equal((await record({ supplier: "Otra tienda", invoiceNumber: "4400" })).statusCode, 201);
  });

  it("undoes an expense with a reversal entry and a reason, once, and keeps both and the photo", async () => {
    const recorded = (await record({ supplier: "Transportes Lima", amountCentavos: 30000 })).json().entry;
    takeAway(t, "primer_vocal", "finance:reverse");
    assert.equal((await call(vocal.cookie, "POST", `/api/finance/expenses/${recorded.id}/reverse`, { reason: "Se anotó dos veces" })).statusCode, 403);
    assert.equal((await call(president.cookie, "POST", `/api/finance/expenses/${recorded.id}/reverse`, { reason: "no" })).statusCode, 400);

    const reversed = await call(president.cookie, "POST", `/api/finance/expenses/${recorded.id}/reverse`, { reason: "Se anotó dos veces" });
    assert.equal(reversed.statusCode, 200, reversed.body);
    const entry = reversed.json().entry;
    assert.equal(entry.reversed, true);
    assert.equal(entry.reversal.reason, "Se anotó dos veces");
    assert.equal(entry.reversal.recordedBy, "Pedro Presidente");
    assert.equal(entry.hasPhoto, true);

    const [reversal] = await t.db.select().from(transactions).where(eq(transactions.reversesId, recorded.id));
    assert.equal(reversal!.kind, "expense");
    assert.equal(reversal!.amountCentavos, -30000);
    assert.equal(reversal!.occurredOn, today);
    assert.equal(reversal!.supplier, "Transportes Lima");
    const [original] = await t.db.select().from(transactions).where(eq(transactions.id, recorded.id));
    assert.equal(original!.amountCentavos, 30000);

    const logged = await t.db.select().from(auditLog).where(eq(auditLog.entityId, recorded.id));
    assert.deepEqual(logged.map((row) => row.action).sort(), ["expense.recorded", "expense.reversed"]);
    assert.match(
      logged.find((row) => row.action === "expense.reversed")!.summary,
      /^Pedro Presidente \(Presidente\) anuló el gasto de Cloro: L 300\.00 a Transportes Lima del /,
    );

    const twice = await call(president.cookie, "POST", `/api/finance/expenses/${recorded.id}/reverse`, { reason: "Otra vez por error" });
    assert.equal(twice.statusCode, 409);
    assert.equal(twice.json().error, "already_reversed");
    // A reversal is final, and is not listed as an expense of its own.
    assert.equal((await call(president.cookie, "POST", `/api/finance/expenses/${reversal!.id}/reverse`, { reason: "Deshacer la anulación" })).statusCode, 404);
    assert.ok(!(await list()).some((row) => row.id === reversal!.id));
    assert.equal((await call(treasurer.cookie, "GET", `/api/finance/expenses/${recorded.id}/photo`)).statusCode, 200);
  });

  it("is refused by the database itself when an expense or its photo's row is changed or deleted", async () => {
    const recorded = (await record()).json().entry;
    await rejectsWithDbError(t.db.update(transactions).set({ amountCentavos: 1 }).where(eq(transactions.id, recorded.id)), /history is never changed: transactions/);
    await rejectsWithDbError(t.db.delete(receiptFiles).where(eq(receiptFiles.transactionId, recorded.id)), /nothing is deleted: receipt_files/);
  });
});
