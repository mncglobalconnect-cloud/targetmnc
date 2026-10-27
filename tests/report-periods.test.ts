import { test } from "node:test";
import assert from "node:assert/strict";
import { eachDate } from "../src/lib/dates";
import { periodRange, resolveReportRange } from "../src/lib/report-periods";

test("daily reports contain exactly the selected date", () => {
  assert.deepEqual(resolveReportRange({ period: "daily", date: "2026-10-26" }), {
    period: "daily", from: "2026-10-26", to: "2026-10-26",
  });
});

test("weekly reports use Monday through Sunday, including year boundaries", () => {
  assert.deepEqual(periodRange("weekly", "2025-01-01"), ["2024-12-30", "2025-01-05"]);
  assert.deepEqual(periodRange("weekly", "2025-01-05"), ["2024-12-30", "2025-01-05"]);
});

test("monthly reports include leap day and calendar month end", () => {
  assert.deepEqual(periodRange("monthly", "2024-02-15"), ["2024-02-01", "2024-02-29"]);
  assert.deepEqual(periodRange("monthly", "2025-02-15"), ["2025-02-01", "2025-02-28"]);
  assert.deepEqual(periodRange("monthly", "2025-12-15"), ["2025-12-01", "2025-12-31"]);
});

test("yearly reports contain 365 days or all 366 leap-year days", () => {
  for (const [date, days] of [["2024-06-01", 366], ["2025-06-01", 365]] as const) {
    const range = resolveReportRange({ period: "yearly", date });
    assert.equal(eachDate(range.from, range.to).length, days);
    assert.equal(range.from, `${date.slice(0, 4)}-01-01`);
    assert.equal(range.to, `${date.slice(0, 4)}-12-31`);
  }
});

test("legacy start/end ranges remain supported and validated", () => {
  assert.deepEqual(resolveReportRange({ from: "2024-01-01", to: "2024-12-31" }), {
    period: "custom", from: "2024-01-01", to: "2024-12-31",
  });
  assert.equal(resolveReportRange({ from: "2024-01-01", to: "2024-01-01" }).period, "daily");
  assert.throws(() => resolveReportRange({ from: "2024-01-01", to: "2025-01-01" }), /366/);
  assert.throws(() => resolveReportRange({ from: "2025-01-02", to: "2025-01-01" }), /before/);
  assert.throws(() => resolveReportRange({ from: "2025-02-29", to: "2025-03-01" }), /valid/);
  assert.throws(() => resolveReportRange({}), /valid/);
  assert.throws(() => resolveReportRange({ period: "monthly" }), /Choose a date/);
});

test("period metadata cannot silently override conflicting filter dates", () => {
  assert.equal(resolveReportRange({ period: "weekly", from: "2024-12-30", to: "2025-01-05" }).period, "weekly");
  assert.throws(() => resolveReportRange({ period: "weekly", from: "2025-01-01", to: "2025-01-05" }), /do not match/);
  assert.throws(() => resolveReportRange({ period: "yearly", date: "2024-06-01", from: "2025-01-01" }), /do not match/);
});
