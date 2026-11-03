import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { hiddenBelow, isKeyboardOpen, isTyping, moreTypingAfter } from "../src/viewport.ts";

const element = (tagName: string, type?: string) => ({
  tagName,
  getAttribute: (name: string) => (name === "type" ? (type ?? null) : null),
});

describe("the keyboard", () => {
  it("is open when someone is typing and the screen has clearly shrunk", () => {
    assert.equal(isKeyboardOpen(680, 380, true), true);
  });

  it("is not taken for the browser's address bar hiding", () => {
    assert.equal(isKeyboardOpen(680, 624, true), false);
  });

  it("is not assumed when nobody is typing, as when the screen is split with another app", () => {
    assert.equal(isKeyboardOpen(680, 380, false), false);
  });

  it("comes up for fields that are typed in, not for buttons or the phone's date picker", () => {
    assert.equal(isTyping(element("INPUT")), true);
    assert.equal(isTyping(element("INPUT", "password")), true);
    assert.equal(isTyping(element("TEXTAREA")), true);
    assert.equal(isTyping(element("INPUT", "date")), false);
    assert.equal(isTyping(element("INPUT", "month")), false);
    assert.equal(isTyping(element("BUTTON")), false);
    assert.equal(isTyping(element("SELECT")), false);
    assert.equal(isTyping(null), false);
  });

  it("is asked to shrink the page on Android, so what sits at the bottom stays above it", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.match(html, /name="viewport"[^>]*interactive-widget=resizes-content/);
  });
});

describe("the button that goes on", () => {
  const name = element("INPUT");
  const phone = element("INPUT");
  const month = element("INPUT", "month");
  const notes = element("TEXTAREA");

  it("waits while more typing is coming, so the next field can be seen", () => {
    assert.equal(moreTypingAfter([name, phone], name), true);
    assert.equal(moreTypingAfter([name, month, notes], name), true);
  });

  it("is what comes next on the last field", () => {
    assert.equal(moreTypingAfter([name, phone], phone), false);
    assert.equal(moreTypingAfter([name], name), false);
  });

  it("does not wait for a field that brings up no keyboard", () => {
    assert.equal(moreTypingAfter([name, month], name), false);
  });

  it("does not wait when nothing is being typed", () => {
    assert.equal(moreTypingAfter([name, phone], null), false);
  });
});

describe("something below what can be seen", () => {
  it("counts as hidden when it runs past the edge", () => {
    assert.equal(hiddenBelow(700, 600), true);
    assert.equal(hiddenBelow(610, 600), true);
  });

  it("does not count when all of it is on the screen", () => {
    assert.equal(hiddenBelow(500, 600), false);
    assert.equal(hiddenBelow(600, 600), false);
  });

  it("does not count for a small overhang, like a shadow", () => {
    assert.equal(hiddenBelow(603, 600), false);
  });
});
