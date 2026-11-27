import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HouseholdFile, HouseholdForm, PersonForm, Registration } from "../src/census.ts";
import {
  AMOUNT_WHOLE_DIGITS,
  amountCaret,
  capitalizeName,
  formatAmountTyping,
  formatIdNumber,
  formatLempiras,
  householdChanges,
  householdForm,
  newSubmissionId,
  parseLempiras,
  personChanges,
  personForm,
  significantChars,
  whatsappLink,
} from "../src/census.ts";
import type { SendResult, Store } from "../src/queue.ts";
import { CensusQueue } from "../src/queue.ts";

describe("census helpers", () => {
  it("capitalizes names like the server does", () => {
    assert.equal(capitalizeName("  juan  PÉREZ de la cruz "), "Juan Pérez de la Cruz");
  });

  it("reads lempiras as whole centavos, never through a float", () => {
    assert.equal(parseLempiras("35"), 3500);
    assert.equal(parseLempiras("35.5"), 3550);
    assert.equal(parseLempiras("L 35,50"), 3550);
    assert.equal(parseLempiras("0"), 0);
    assert.equal(parseLempiras("0.10"), 10);
    assert.equal(parseLempiras("35.555"), null);
    assert.equal(parseLempiras("-5"), null);
    assert.equal(parseLempiras("treinta"), null);
    assert.equal(formatLempiras(3550), "L 35.50");
    assert.equal(formatLempiras(123456), "L 1,234.56");
  });

  it("reads an amount with thousands commas", () => {
    assert.equal(parseLempiras("1,000"), 100000);
    assert.equal(parseLempiras("1,250.50"), 125050);
    assert.equal(parseLempiras("L 12,345.67"), 1234567);
    assert.equal(parseLempiras("L. 1,000"), 100000);
    assert.equal(parseLempiras("100,000"), 10000000);
    // Up to L 999,999,999.99, the most any amount field takes (owner, 19 November 2026).
    assert.equal(parseLempiras("L 999,999,999.99"), 99999999999);
    assert.equal(parseLempiras("1,000,000,000"), null);
    // Not where a thousands comma goes, so not an amount.
    assert.equal(parseLempiras("1,0000"), null);
    assert.equal(parseLempiras("12,34,567"), null);
  });

  it("adds the thousands commas to an amount while it is typed", () => {
    const cases: Array<[string, string]> = [
      ["", ""],
      ["7", "7"],
      ["70", "70"],
      ["1000", "1,000"],
      ["1,0000", "10,000"],
      ["12345", "12,345"],
      ["123456", "123,456"],
      ["123456789", "123,456,789"],
      ["1234567890", "123,456,789"],
      ["999999999.99", "999,999,999.99"],
      ["1250.", "1,250."],
      ["1250.5", "1,250.5"],
      ["1250.505", "1,250.50"],
      ["1.2.3", "1.23"],
      [".5", "0.5"],
      ["0", "0"],
      ["007", "7"],
      ["0.5", "0.5"],
      ["L 70", "70"],
      ["abc", ""],
    ];
    for (const [typed, shown] of cases) {
      assert.equal(formatAmountTyping(typed), shown, typed);
    }
  });

  it("takes as many lempira digits as the server", async () => {
    // Read at run time: the two workspaces do not import each other's code.
    const server = (await import(new URL("../../backend/src/lib/money.ts", import.meta.url).href)) as {
      MAX_AMOUNT_CENTAVOS: number;
    };
    assert.equal(10 ** AMOUNT_WHOLE_DIGITS * 100 - 1, server.MAX_AMOUNT_CENTAVOS);
  });

  it("reads back to the same centavos whatever the field shows", () => {
    for (const [typed, centavos] of [["1000", 100000], ["1250.5", 125050], ["99999.99", 9999999], ["999999999.99", 99999999999], ["0", 0]] as const) {
      assert.equal(parseLempiras(formatAmountTyping(typed)), centavos, typed);
    }
  });

  it("keeps the cursor after the same digit when the commas move", () => {
    // "1,000" with the cursor at the end, then a 5 typed there.
    assert.equal(amountCaret(formatAmountTyping("1,0005"), significantChars("1,0005")), "10,005".length);
    // A 9 typed after the first digit of "1,000".
    assert.equal(amountCaret(formatAmountTyping("19,000"), significantChars("19")), "19".length);
    // The comma itself deleted: the number stays, and the cursor moves before the comma.
    assert.equal(amountCaret(formatAmountTyping("1000"), significantChars("1")), 1);
  });

  it("makes version-4 UUIDs without crypto.randomUUID", () => {
    const id = newSubmissionId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id, newSubmissionId());
  });

  it("writes an ID number as on the card, and the WhatsApp link to a Honduran number", () => {
    assert.equal(formatIdNumber("0801199012345"), "0801-1990-12345");
    assert.equal(formatIdNumber("•••••••••2345"), "•••••••••2345");
    assert.match(whatsappLink("99887766", "Juan", "Z-0001"), /^https:\/\/wa\.me\/50499887766\?text=.*Z-0001/);
    assert.match(whatsappLink(null, "Juan", "Z-0001"), /^https:\/\/wa\.me\/\?text=/);
  });
});

function memoryStore(): Store {
  const data = new Map<string, string>();
  return { get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) };
}

function entry(userId: string, submissionId = newSubmissionId()) {
  const registration: Registration = {
    submissionId,
    person: { fullName: "Juan Pérez", idNumber: "0801199012345", phone: "99887766" },
    addToExistingPerson: false,
    household: { sectorId: 1, references: "Frente a la iglesia", waterConnection: "connected", relation: "owner" },
    fee: { kind: "base" },
  };
  return { submissionId, userId, registration, label: { fullName: "Juan Pérez", sectorName: "El Centro" } };
}

const saved = (code: string): SendResult => ({ kind: "saved", householdId: "h", code, fullName: "Juan Pérez", phone: null });

describe("census queue", () => {
  it("keeps entries on the phone while there is no signal, and sends them when it returns", async () => {
    const queue = new CensusQueue(memoryStore());
    queue.add(entry("ana"));
    queue.add(entry("ana"));
    assert.equal(queue.pendingCount("ana"), 2);

    let calls = 0;
    await queue.sendAll("ana", async () => {
      calls += 1;
      return { kind: "offline" };
    });
    // It stops at the first sign of no signal instead of trying every entry.
    assert.equal(calls, 1);
    assert.equal(queue.pendingCount("ana"), 2);

    let next = 0;
    await queue.sendAll("ana", async () => saved(`Z-000${(next += 1)}`));
    assert.equal(queue.pendingCount("ana"), 0);
    assert.deepEqual(queue.sent().map((s) => s.code), ["Z-0002", "Z-0001"]);
  });

  it("sends only the entries of the person signed in", async () => {
    const queue = new CensusQueue(memoryStore());
    queue.add(entry("ana"));
    queue.add(entry("beto"));

    await queue.sendAll("ana", async () => saved("Z-0001"));
    assert.equal(queue.pendingCount("ana"), 0);
    assert.equal(queue.pendingCount("beto"), 1);
  });

  it("holds a repeated ID for a decision, then sends it as another house of that person", async () => {
    const queue = new CensusQueue(memoryStore());
    const item = entry("ana");
    queue.add(item);

    await queue.sendAll("ana", async () => ({
      kind: "duplicate",
      message: "Esta identidad ya está registrada a nombre de Juan Pérez.",
      person: { fullName: "Juan Pérez", codes: ["Z-0001"] },
    }));
    const held = queue.find(item.submissionId).queued;
    assert.equal(held?.state, "attention");
    assert.deepEqual(held?.existingPerson?.codes, ["Z-0001"]);

    // Not sent again on its own: it waits for the person to choose.
    let calls = 0;
    await queue.sendAll("ana", async () => {
      calls += 1;
      return saved("Z-0002");
    });
    assert.equal(calls, 0);

    queue.addToExistingPerson(item.submissionId);
    let sentBody: Registration | null = null;
    await queue.sendAll("ana", async (registration) => {
      sentBody = registration;
      return saved("Z-0002");
    });
    assert.equal(sentBody!.addToExistingPerson, true);
    assert.equal(queue.find(item.submissionId).sent?.code, "Z-0002");
  });

  it("sends an entry saved while a round is already running in that same round", async () => {
    const queue = new CensusQueue(memoryStore());
    queue.add(entry("ana"));
    const late = entry("ana");

    const codes: string[] = [];
    await queue.sendAll("ana", async (registration) => {
      if (codes.length === 0) {
        queue.add(late);
        // A second call during the round joins it instead of starting another.
        void queue.sendAll("ana", async () => saved("never"));
      }
      codes.push(registration.submissionId);
      return saved(`Z-${codes.length}`);
    });
    assert.deepEqual(codes.length, 2);
    assert.equal(codes[1], late.submissionId);
  });

  it("drops a refused entry only when asked, and survives a corrupted store", () => {
    const store = memoryStore();
    const queue = new CensusQueue(store);
    const item = entry("ana");
    queue.add(item);
    queue.discard(item.submissionId);
    assert.equal(queue.pendingCount("ana"), 0);

    store.set("zoilabe.censusQueue.v1", "{not json");
    assert.deepEqual(new CensusQueue(store).entries(), []);
  });
});

describe("correcting a house or a person", () => {
  const file: HouseholdFile = {
    id: "casa",
    code: "Z-0001",
    status: "active",
    inactiveReason: null,
    sector: { id: 1, name: "El Centro" },
    references: "Portón verde",
    gps: { lat: 14.1, lng: -87.2 },
    waterConnection: "connected",
    paperDate: "2026-08-01",
    paperFormNumber: "100",
    lastVerifiedOn: null,
    registeredBy: "Sara",
    createdAt: "2026-08-01T12:00:00.000Z",
    owner: {
      personId: "persona",
      fullName: "Juan Pérez",
      idNumber: "0801199000001",
      phone: "+50499887766",
      phoneMissing: null,
      gender: "Hombre",
      relation: "owner",
      startsOn: "2026-08-01",
    },
    fee: { kind: "base", baseFeeCentavos: 7000 },
    otherHouseholds: [],
    statusHistory: [],
  };
  const house = (typed: Partial<HouseholdForm> = {}) =>
    householdChanges(householdForm(file), { ...householdForm(file), ...typed }, "2026-11-27");
  const person = (typed: Partial<PersonForm> = {}, canEditSensitive = true, owner = file.owner) =>
    personChanges(personForm(owner), { ...personForm(owner), ...typed }, canEditSensitive);

  // Anything sent that was not changed would put back what someone else corrected meanwhile.
  it("sends nothing from a form saved as it was opened", () => {
    assert.deepEqual(house(), {});
    assert.deepEqual(person(), {});
  });

  it("sends only the field that was changed", () => {
    assert.deepEqual(house({ sectorId: 2 }), { sectorId: 2 });
    assert.deepEqual(house({ references: "Casa azul" }), { references: "Casa azul" });
    assert.deepEqual(house({ relation: "renter" }), { relation: "renter" });
    assert.deepEqual(house({ paperDate: "2026-08-02" }), { paperDate: "2026-08-02" });
    assert.deepEqual(house({ paperFormNumber: " 101 " }), { paperFormNumber: "101" });
    assert.deepEqual(house({ gps: { lat: 14.2, lng: -87.2 } }), { gps: { lat: 14.2, lng: -87.2 } });
    assert.deepEqual(person({ fullName: "Juan Pérez López" }), { fullName: "Juan Pérez López" });
    assert.deepEqual(person({ gender: "Mujer" }), { gender: "Mujer" });
    assert.deepEqual(person({ idNumber: "0801199000002" }), { idNumber: "0801199000002" });
  });

  it("does not count spaces around the text, or the same place taken again, as a change", () => {
    assert.deepEqual(house({ references: "Portón verde ", paperFormNumber: " 100", gps: { lat: 14.1, lng: -87.2 } }), {});
    assert.deepEqual(person({ fullName: " Juan Pérez " }), {});
  });

  it("sends the date with a new water connection, and only then", () => {
    assert.deepEqual(house({ waterConnection: "shared" }), { waterConnection: "shared", connectionSince: "2026-11-27" });
  });

  it("sends an empty value when something was taken away", () => {
    assert.deepEqual(house({ references: "", gps: null, paperDate: "", paperFormNumber: "" }), {
      references: "",
      gps: null,
      paperDate: null,
      paperFormNumber: null,
    });
    assert.deepEqual(person({ gender: "" }), { gender: null });
    // Except the ID: it can be added or corrected here, not taken away.
    assert.deepEqual(person({ idNumber: "" }), {});
  });

  it("sends the phone, or why there is none, as one answer", () => {
    assert.deepEqual(person({ phone: { code: "504", number: "88776655" } }), { phone: "+50488776655" });
    assert.deepEqual(person({ phone: { code: "502", number: "99887766" } }), { phone: "+50299887766" });
    assert.deepEqual(person({ phoneMode: "declined" }), { phoneMissing: "declined" });

    const without = { ...file.owner, phone: null, phoneMissing: "no_phone" as const };
    assert.deepEqual(person({}, true, without), {});
    assert.deepEqual(person({ phoneMode: "number", phone: { code: "504", number: "88776655" } }, true, without), { phone: "+50488776655" });
  });

  it("never sends the ID or phone of someone who may not see them", () => {
    const masked = { ...file.owner, idNumber: "•••••••••0001", phone: "••••••66" };
    assert.deepEqual(person({}, false, masked), {});
    assert.deepEqual(
      person({ fullName: "Juana Pérez", idNumber: "0801199000002", phoneMode: "declined" }, false, masked),
      { fullName: "Juana Pérez" },
    );
  });
});
