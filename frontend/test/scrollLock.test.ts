import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ScrollablePage } from "../src/scrollLock.ts";
import { lockScroll } from "../src/scrollLock.ts";

function fakePage(scrollY: number): ScrollablePage & { scrolledTo: number | null } {
  return {
    scrollY,
    scrolledTo: null,
    scrollTo(_x, y) {
      this.scrolledTo = y;
    },
    document: { body: { style: { position: "", top: "", left: "", right: "", overflow: "" } } },
  };
}

describe("the screen behind a dialog", () => {
  it("is held where it was while the dialog is open", () => {
    const page = fakePage(420);
    lockScroll(page);
    assert.equal(page.document.body.style.position, "fixed");
    assert.equal(page.document.body.style.top, "-420px");
    assert.equal(page.document.body.style.overflow, "hidden");
  });

  it("goes back to the same place when the dialog closes", () => {
    const page = fakePage(420);
    const release = lockScroll(page);
    release();
    assert.equal(page.document.body.style.position, "");
    assert.equal(page.document.body.style.top, "");
    assert.equal(page.scrolledTo, 420);
  });

  it("stays held until the last dialog closes, when one opens another", () => {
    const page = fakePage(420);
    const form = lockScroll(page);
    const pin = lockScroll(page);
    pin();
    assert.equal(page.document.body.style.position, "fixed");
    assert.equal(page.scrolledTo, null);
    form();
    assert.equal(page.document.body.style.position, "");
    assert.equal(page.scrolledTo, 420);
  });

  it("is not let go twice by closing the same dialog twice", () => {
    const page = fakePage(0);
    const form = lockScroll(page);
    const pin = lockScroll(page);
    pin();
    pin();
    assert.equal(page.document.body.style.position, "fixed");
    form();
    assert.equal(page.document.body.style.position, "");
  });
});
