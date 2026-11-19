import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSimilarName, nameWords } from "../src/lib/similarNames.js";

describe("similar names", () => {
  it("compares words without accents, capitals or particles", () => {
    assert.deepEqual(nameWords("  María de los ÁNGELES  Pérez-Gómez "), ["maria", "angeles", "perez", "gomez"]);
    // ñ is folded to n, as in the census search.
    assert.deepEqual(nameWords("Ñoño Muñoz"), ["nono", "munoz"]);
  });

  it("finds the same family written a little differently", () => {
    const alike: Array<[string, string]> = [
      ["Juan Pérez", "juan perez"],
      ["Juan Pérez", "Juan Carlos Pérez López"],
      ["José Luis Pérez", "José Pérez"],
      ["José Martínez Pérez", "José Luis Martínez"],
      ["María Rodríguez", "Maria Rodrigues"],
      ["Ana  López", "Ana de López"],
      ["Rosa Amaya", "Rosa  Amaya Cruz"],
    ];
    for (const [a, b] of alike) {
      assert.ok(isSimilarName(a, b), `${a} ~ ${b}`);
      assert.ok(isSimilarName(b, a), `${b} ~ ${a}`);
    }
  });

  it("does not mix up different families", () => {
    const apart: Array<[string, string]> = [
      ["Juan Pérez", "Juan Martínez"],
      ["José Luis Pérez", "José Luis Martínez"],
      ["Carlos Pérez Díaz", "Luis Pérez Díaz"],
      ["Ana López", "Ana Lopera"],
      ["Juan Pérez", "Pedro Juan Pérez"],
      // One word is not enough to say anything.
      ["Juan", "Juan Pérez"],
      ["", "Juan Pérez"],
      ["Rosa Amaya", "Rosa Amador"],
    ];
    for (const [a, b] of apart) {
      assert.ok(!isSimilarName(a, b), `${a} !~ ${b}`);
      assert.ok(!isSimilarName(b, a), `${b} !~ ${a}`);
    }
  });

  it("forgives one letter only in a word of five letters or more", () => {
    assert.ok(isSimilarName("Marta Hernández", "Marta Hernandes"));
    assert.ok(isSimilarName("Marta Hernández", "Martha Hernández"));
    assert.ok(!isSimilarName("Luis Cruz", "Luis Cruces"));
    assert.ok(!isSimilarName("Juan Paz", "Juan Pax"));
  });
});
