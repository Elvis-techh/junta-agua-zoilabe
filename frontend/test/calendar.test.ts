import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { dayCells, dayLabel, monthCells, monthLabel, placeCalendar, shiftMonth } from "../src/calendar.ts";
import { DateField, MonthField } from "../src/components/CalendarField.tsx";

describe("the calendar's words and months", () => {
  it("says months and days in Spanish", () => {
    assert.equal(monthLabel("2026-11"), "noviembre de 2026");
    assert.equal(dayLabel("2026-11-03"), "3 de noviembre de 2026");
  });

  it("moves between months across the year's end", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2027-01", -1), "2026-12");
    assert.equal(shiftMonth("2026-06", 0), "2026-06");
  });
});

describe("the months of a year", () => {
  const limits = { selected: "2026-11", min: "2026-11", today: "2026-11" };

  it("are twelve, with the earlier ones closed when there is a first month", () => {
    const cells = monthCells(2026, limits);
    assert.equal(cells.length, 12);
    assert.equal(cells[0]!.label, "ene");
    assert.equal(cells[9]!.disabled, true);
    assert.equal(cells[10]!.disabled, false);
    assert.equal(cells[10]!.selected, true);
    assert.equal(cells[10]!.current, true);
    assert.equal(cells[11]!.disabled, false);
  });

  it("are all open when the first amount of a fee may start in any month", () => {
    assert.ok(monthCells(2020, { selected: "", today: "2026-11" }).every((cell) => !cell.disabled));
  });

  it("stop at the last month allowed", () => {
    const cells = monthCells(2026, { selected: "", max: "2026-03", today: "2026-11" });
    assert.equal(cells[2]!.disabled, false);
    assert.equal(cells[3]!.disabled, true);
  });
});

describe("the days of a month", () => {
  const limits = { selected: "", today: "2026-11-03" };

  it("sit under the right weekday, starting on Sunday", () => {
    // 1 November 2026 is a Sunday; 1 February 2026 too; 1 January 2027 is a Friday.
    assert.equal(dayCells("2026-11", limits)[0]!.label, "1");
    assert.equal(dayCells("2027-01", limits).findIndex(Boolean), 5);
  });

  it("know how long each month is, leap years too", () => {
    const count = (month: string) => dayCells(month, limits).filter(Boolean).length;
    assert.equal(count("2026-11"), 30);
    assert.equal(count("2026-12"), 31);
    assert.equal(count("2026-02"), 28);
    assert.equal(count("2028-02"), 29);
  });

  it("always take six rows, so the panel does not jump between months", () => {
    for (const month of ["2026-02", "2026-11", "2027-01", "2028-02"]) {
      assert.equal(dayCells(month, limits).length, 42);
    }
  });

  it("close after the last day allowed, as the paper form's date does", () => {
    const cells = dayCells("2026-11", { selected: "", max: "2026-11-03", today: "2026-11-03" }).filter((cell) => cell !== null);
    assert.equal(cells[2]!.disabled, false);
    assert.equal(cells[3]!.disabled, true);
  });
});

describe("where the panel opens", () => {
  const screen = { width: 1280, height: 800 };
  const panel = { width: 320, height: 300 };

  it("is under the field when it fits", () => {
    assert.deepEqual(placeCalendar({ top: 100, bottom: 156, left: 40 }, panel, screen), { top: 164, left: 40 });
  });

  it("is over the field when there is more room there", () => {
    assert.deepEqual(placeCalendar({ top: 600, bottom: 656, left: 40 }, panel, screen), { top: 292, left: 40 });
  });

  it("is never past the screen's edges", () => {
    assert.equal(placeCalendar({ top: 100, bottom: 156, left: 1200 }, panel, screen).left, 952);
    assert.equal(placeCalendar({ top: 300, bottom: 356, left: 40 }, { ...panel, height: 500 }, { ...screen, height: 700 }).top, 192);
    assert.equal(placeCalendar({ top: 330, bottom: 386, left: 40 }, { ...panel, height: 500 }, { ...screen, height: 700 }).top, 8);
  });
});

describe("on a phone", () => {
  // These tests run with no mouse, as a phone has none.
  it("the month and date fields stay the phone's own", () => {
    const month = renderToStaticMarkup(createElement(MonthField, { value: "2026-11", onChange: () => undefined, min: "2026-11" }));
    assert.match(month, /type="month"/);
    assert.match(month, /min="2026-11"/);
    const day = renderToStaticMarkup(createElement(DateField, { value: "", onChange: () => undefined, max: "2026-11-03" }));
    assert.match(day, /type="date"/);
    assert.match(day, /max="2026-11-03"/);
  });
});
