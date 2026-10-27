import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { classify, computeMetrics, expectedProgress, pctOf, sumMetrics, validateAllocation } from "../src/lib/calc";
import { DEFAULT_SETTINGS } from "../src/lib/settings-schema";
import { normalizeCompany, normalizePhone } from "../src/lib/leads";

const D = (v: number | string) => new Prisma.Decimal(v);
const S = DEFAULT_SETTINGS;

test("spec example: Appu 50,000 target / 30,000 achieved / 5 leads target / 1 lead", () => {
  const m = computeMetrics(D(50000), D(30000), 5, 1);
  assert.equal(m.balance.toFixed(2), "20000.00");
  assert.equal(m.pct, 60);
  assert.equal(m.leadBalance, 4);
  assert.equal(m.leadPct, 20);
});

test("multiple achievement entries aggregate (10k + 8k + 12k = 30k)", () => {
  const total = [10000, 8000, 12000].reduce((s, v) => s.plus(v), D(0));
  assert.equal(total.toFixed(2), "30000.00");
});

test("overachievement keeps actual value but balance never goes negative", () => {
  const m = computeMetrics(D(50000), D(65000), 5, 7);
  assert.equal(m.achieved.toFixed(2), "65000.00");
  assert.equal(m.balance.toFixed(2), "0.00");
  assert.equal(m.pct, 130);
  assert.equal(m.leadBalance, 0);
  assert.equal(m.leadPct, 140);
});

test("zero targets do not divide by zero", () => {
  const m = computeMetrics(D(0), D(1000), 0, 2);
  assert.equal(m.pct, null);
  assert.equal(m.leadPct, null);
  assert.equal(pctOf(5, 0), null);
});

test("spec team example: Sales Team A totals", () => {
  const team = sumMetrics([
    computeMetrics(D(50000), D(30000), 5, 1),
    computeMetrics(D(50000), D(45000), 5, 3),
    computeMetrics(D(50000), D(25000), 5, 2),
  ]);
  assert.equal(team.target.toFixed(2), "150000.00");
  assert.equal(team.achieved.toFixed(2), "100000.00");
  assert.equal(team.balance.toFixed(2), "50000.00");
  assert.equal(team.pct, 66.67);
  assert.equal(team.leadTarget, 15);
  assert.equal(team.leads, 6);
  assert.equal(team.leadBalance, 9);
});

test("range metrics use ratio of sums, not average of daily percentages", () => {
  // Day 1: 100/100 = 100%; Day 2: 0/300 = 0%. Average would be 50%, correct is 25%.
  const r = sumMetrics([computeMetrics(D(100), D(100), 0, 0), computeMetrics(D(300), D(0), 0, 0)]);
  assert.equal(r.pct, 25);
});

test("decimal money has no float drift", () => {
  const m = sumMetrics([computeMetrics(D("0.10"), D("0.10"), 0, 0), computeMetrics(D("0.20"), D("0.20"), 0, 0)]);
  assert.equal(m.target.toFixed(2), "0.30");
  assert.equal(m.pct, 100);
});

test("expected progress is linear across the workday", () => {
  assert.equal(expectedProgress("2026-10-25", "2026-10-26", 600, S), 1);
  assert.equal(expectedProgress("2026-10-27", "2026-10-26", 600, S), 0);
  assert.equal(expectedProgress("2026-10-26", "2026-10-26", 9 * 60 + 30, S), 0);
  assert.equal(expectedProgress("2026-10-26", "2026-10-26", 14 * 60, S), 0.5);
  assert.equal(expectedProgress("2026-10-26", "2026-10-26", 20 * 60, S), 1);
});

const ctx = (minutesNow: number, closed = false, date = "2026-10-26") => ({ date, today: "2026-10-26", minutesNow, closed, settings: S });

test("status: not flagged at risk early in the day", () => {
  const m = computeMetrics(D(50000), D(2000), 5, 0);
  assert.equal(classify(m, ctx(10 * 60)), "ON_TRACK"); // inside grace period
  assert.equal(classify(computeMetrics(D(50000), D(0), 5, 0), ctx(10 * 60)), "NOT_STARTED");
});

test("status: at risk later in the day when behind expectation", () => {
  const m = computeMetrics(D(50000), D(5000), 5, 0); // 10% money, 0% leads at 16:00
  assert.equal(classify(m, ctx(16 * 60)), "AT_RISK");
  const good = computeMetrics(D(50000), D(40000), 5, 4); // 80% / 80% at 16:00 (expected ~72%)
  assert.equal(classify(good, ctx(16 * 60)), "ON_TRACK");
});

test("status: completed, overachieved, partial, missed, no target", () => {
  assert.equal(classify(computeMetrics(D(100), D(100), 2, 2), ctx(12 * 60)), "COMPLETED");
  assert.equal(classify(computeMetrics(D(100), D(150), 2, 2), ctx(12 * 60)), "OVERACHIEVED");
  assert.equal(classify(computeMetrics(D(100), D(40), 2, 0), ctx(0, true, "2026-10-25")), "PARTIAL");
  assert.equal(classify(computeMetrics(D(100), D(0), 2, 0), ctx(0, true, "2026-10-25")), "MISSED");
  assert.equal(classify(computeMetrics(D(0), D(0), 0, 0), ctx(12 * 60)), "NO_TARGET");
});

test("allocated mode requires allocations to equal the team target", () => {
  const base = { mode: "ALLOCATED" as const, teamTarget: D(150000), teamLeadTarget: 15 };
  const three = [50000, 50000, 50000].map((v) => ({ monetaryTarget: D(v), leadTarget: 5 }));
  assert.equal(validateAllocation({ ...base, allocations: three, allowUnallocated: false }).ok, true);

  const short = [50000, 50000].map((v) => ({ monetaryTarget: D(v), leadTarget: 5 }));
  assert.equal(validateAllocation({ ...base, allocations: short, allowUnallocated: false }).ok, false);
  const allowed = validateAllocation({ ...base, allocations: short, allowUnallocated: true });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.unallocatedTarget.toFixed(2), "50000.00");

  const over = [60000, 60000, 60000].map((v) => ({ monetaryTarget: D(v), leadTarget: 5 }));
  assert.equal(validateAllocation({ ...base, allocations: over, allowUnallocated: true }).ok, false);
});

test("independent mode never fails on mismatch", () => {
  const r = validateAllocation({
    mode: "INDEPENDENT",
    teamTarget: D(200000),
    teamLeadTarget: 20,
    allocations: [{ monetaryTarget: D(50000), leadTarget: 5 }],
    allowUnallocated: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
});

test("lead normalization for duplicate detection", () => {
  assert.equal(normalizeCompany("XYZ Pvt. Ltd."), "xyz");
  assert.equal(normalizeCompany("  xyz private limited "), "xyz");
  assert.equal(normalizePhone("+91 38798-78377"), "3879878377");
  assert.equal(normalizePhone("03879878377"), "3879878377");
});
