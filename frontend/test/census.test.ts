import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Registration } from "../src/census.ts";
import { capitalizeName, formatIdNumber, formatLempiras, newSubmissionId, parseLempiras, whatsappLink } from "../src/census.ts";
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
