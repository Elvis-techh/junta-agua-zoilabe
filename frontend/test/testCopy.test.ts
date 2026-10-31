import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { testCopyLabel } from "../src/testCopy.ts";

describe("test copy strip", () => {
  it("shows nothing on a real build, which has no branch", () => {
    assert.equal(testCopyLabel(undefined, undefined), null);
    assert.equal(testCopyLabel("", "c19a1bb5d1f0"), null);
    assert.equal(testCopyLabel("  ", undefined), null);
  });

  it("names the branch and the short commit the test copy runs", () => {
    assert.equal(testCopyLabel("feat/test-copy", "c19a1bb5d1f04e2a9b7c"), "feat/test-copy · c19a1bb");
    assert.equal(testCopyLabel("main", undefined), "main");
  });
});
