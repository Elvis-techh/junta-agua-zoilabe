import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem, suggestPassword } from "../src/password.ts";

describe("passwords on the screens", () => {
  it("follow the same rule as the server, word for word", async () => {
    // Read at run time: the two workspaces do not import each other's code.
    const server = (await import(new URL("../../backend/src/lib/password.ts", import.meta.url).href)) as {
      PASSWORD_MIN_LENGTH: number;
      PASSWORD_MAX_LENGTH: number;
      passwordProblem: (password: string) => string | null;
    };
    assert.equal(PASSWORD_MIN_LENGTH, server.PASSWORD_MIN_LENGTH);
    assert.equal(PASSWORD_MAX_LENGTH, server.PASSWORD_MAX_LENGTH);
    for (const sample of ["", "x".repeat(3), `  ${"x".repeat(5)}  `, "x".repeat(6), "1".repeat(6), "x".repeat(101)]) {
      assert.equal(passwordProblem(sample), server.passwordProblem(sample), JSON.stringify(sample));
    }
  });

  it("needs at least six letters or numbers", () => {
    const five = "x".repeat(5);
    assert.match(passwordProblem(five)!, /al menos 6/);
    assert.equal(passwordProblem(`${five}y`), null);
  });

  it("suggests one that is easy to read aloud: two syllables, four digits, nothing that looks alike", () => {
    for (let i = 0; i < 200; i += 1) {
      const suggested = suggestPassword();
      assert.match(suggested, /^[bcdfghjkmnprstvz][aeiu][bcdfghjkmnprstvz][aeiu][2-9]{4}$/);
      assert.equal(passwordProblem(suggested), null);
    }
  });
});
