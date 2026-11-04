import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { whatsappLink } from "../src/census.ts";
import { EMPTY_PHONE, PHONE_COUNTRIES, formatPhone, phoneEntry, phoneHint, phoneProblem, typedNumber, wholePhone, whatsappNumber } from "../src/phone.ts";

describe("the phone field", () => {
  it("starts on Honduras", () => {
    assert.deepEqual(EMPTY_PHONE, { code: "504", number: "" });
    assert.equal(PHONE_COUNTRIES[0].name, "Honduras");
  });

  it("offers the owner's list, in the owner's order", () => {
    assert.deepEqual(
      PHONE_COUNTRIES.map(({ name, code }) => `${name} (+${code})`),
      [
        "Honduras (+504)",
        "Estados Unidos y Canadá (+1)",
        "España (+34)",
        "México (+52)",
        "Guatemala (+502)",
        "El Salvador (+503)",
        "Nicaragua (+505)",
        "Costa Rica (+506)",
        "Panamá (+507)",
      ],
    );
  });

  it("holds the same countries and lengths as the server", async () => {
    // Read at run time: the two workspaces do not import each other's code.
    const server = (await import(new URL("../../backend/src/lib/phone.ts", import.meta.url).href)) as {
      PHONE_COUNTRIES: unknown;
    };
    assert.deepEqual(PHONE_COUNTRIES, server.PHONE_COUNTRIES);
  });

  it("takes only as many digits as that country has", () => {
    assert.equal(typedNumber("504", "9999-88887"), "99998888");
    assert.equal(typedNumber("1", "202 555 0123 9"), "2025550123");
    assert.equal(typedNumber("507", "612345678"), "61234567");
  });

  it("drops the code from a number pasted with it", () => {
    assert.equal(typedNumber("504", "+504 9999-8888"), "99998888");
    assert.equal(typedNumber("1", "+1 (202) 555-0123"), "2025550123");
  });

  it("does not mistake a number that starts like the code for one that has it", () => {
    assert.equal(typedNumber("504", "50412345"), "50412345");
  });

  it("says what is wrong in plain words, with that country's length", () => {
    assert.equal(phoneProblem({ code: "504", number: "99998888" }), null);
    assert.equal(phoneProblem({ code: "1", number: "2025550123" }), null);
    assert.equal(phoneProblem({ code: "507", number: "2123456" }), null);
    assert.equal(phoneProblem({ code: "507", number: "61234567" }), null);
    assert.match(phoneProblem({ code: "504", number: "" })!, /Honduras tiene 8 números/);
    assert.match(phoneProblem({ code: "1", number: "99998888" })!, /Estados Unidos y Canadá tiene 10 números/);
    assert.match(phoneProblem({ code: "34", number: "99998888" })!, /España tiene 9 números/);
    assert.match(phoneProblem({ code: "507", number: "123" })!, /Panamá tiene 7 u 8 números/);
  });

  it("shows how many digits to type", () => {
    assert.equal(phoneHint("504"), "8 números");
    assert.equal(phoneHint("1"), "10 números");
    assert.equal(phoneHint("507"), "7 u 8 números");
  });
});

describe("a saved phone", () => {
  it("comes apart for correcting, and goes back the same", () => {
    for (const phone of ["+50499998888", "+12025550123", "+34612345678", "+525512345678", "+5072123456"]) {
      assert.equal(wholePhone(phoneEntry(phone)), phone);
    }
    assert.deepEqual(phoneEntry("+12025550123"), { code: "1", number: "2025550123" });
  });

  it("starts empty when there is none, or only a masked one", () => {
    assert.deepEqual(phoneEntry(null), EMPTY_PHONE);
    assert.deepEqual(phoneEntry("••••••66"), EMPTY_PHONE);
  });

  it("is written the way it is read aloud, and a masked one stays as it is", () => {
    assert.equal(formatPhone("+50499998888"), "+504 9999-8888");
    assert.equal(formatPhone("+12025550123"), "+1 202-555-0123");
    assert.equal(formatPhone("+34612345678"), "+34 612-345-678");
    assert.equal(formatPhone("+5072123456"), "+507 212-3456");
    assert.equal(formatPhone("••••••66"), "••••••66");
  });
});

describe("the WhatsApp link", () => {
  it("goes to the right country", () => {
    assert.match(whatsappLink("+12025550123", "Juan", "Z-0001"), /^https:\/\/wa\.me\/12025550123\?text=/);
    assert.match(whatsappLink("+50499887766", "Juan", "Z-0001"), /^https:\/\/wa\.me\/50499887766\?text=/);
  });

  it("still works for an entry sent before country codes, which holds 8 digits", () => {
    assert.equal(whatsappNumber("99887766"), "50499887766");
  });

  it("has no number when there is none to use", () => {
    assert.equal(whatsappNumber(null), "");
    assert.equal(whatsappNumber("••••••66"), "");
  });
});
