import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const SOURCE = new URL("../src/", import.meta.url);

/** These take a plain "should it focus" and ask `isTouchScreen` themselves, on their own input. */
const DECIDE_FOR_THEMSELVES = new Set(["CensusScreen"]);

/** Every `autoFocus` written in the screens: where, on which element, and with what value. */
function autoFocusUses(): Array<{ where: string; element: string; value: string }> {
  const uses: Array<{ where: string; element: string; value: string }> = [];
  // Not `SOURCE.pathname`: on Windows that is "/C:/…", a folder that does not exist.
  for (const file of globSync("**/*.tsx", { cwd: fileURLToPath(SOURCE) })) {
    const text = readFileSync(new URL(file, SOURCE), "utf8");
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText() === "autoFocus") {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
        uses.push({
          where: `${file}:${line + 1}`,
          element: node.parent.parent.tagName.getText(),
          value: node.initializer?.getText() ?? "true",
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return uses;
}

describe("the keyboard when a screen opens", () => {
  it("stays down on a phone: no field takes the focus by itself there", () => {
    const uses = autoFocusUses();
    assert.ok(uses.length >= 5, "the search below found the screens");

    const unguarded = uses.filter(({ element, value }) => !DECIDE_FOR_THEMSELVES.has(element) && !value.includes("!isTouchScreen()"));
    assert.deepEqual(unguarded, []);
  });
});
