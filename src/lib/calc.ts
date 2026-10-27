// Pure target / lead calculations. No I/O — unit tested in tests/calc.test.ts.
import { Prisma } from "@prisma/client";
import type { AppSettings } from "./settings-schema";
import { parseHm } from "./dates";

type D = Prisma.Decimal;
const Z = new Prisma.Decimal(0);

export type PerfStatus =
  | "OVERACHIEVED"
  | "COMPLETED"
  | "ON_TRACK"
  | "AT_RISK"
  | "NOT_STARTED"
  | "PARTIAL"
  | "MISSED"
  | "NO_TARGET";

export interface Metrics {
  target: D;
  achieved: D;
  balance: D;
  pct: number | null;
  leadTarget: number;
  leads: number;
  leadBalance: number;
  leadPct: number | null;
}

/** Percentage rounded to 2dp, or null when the target is zero (avoids division by zero). */
export function pctOf(actual: D | number, target: D | number): number | null {
  const t = new Prisma.Decimal(target);
  if (t.lte(0)) return null;
  return new Prisma.Decimal(actual).div(t).mul(100).toDecimalPlaces(2).toNumber();
}

export function computeMetrics(target: D, achieved: D, leadTarget: number, leads: number): Metrics {
  const rawBalance = target.minus(achieved);
  return {
    target,
    achieved, // full value retained even when exceeding the target
    balance: rawBalance.lt(0) ? Z : rawBalance, // never negative
    pct: pctOf(achieved, target),
    leadTarget,
    leads,
    leadBalance: Math.max(leadTarget - leads, 0),
    leadPct: pctOf(leads, leadTarget),
  };
}

/** Aggregate metrics as a ratio of sums — never the average of daily percentages. */
export function sumMetrics(list: Metrics[]): Metrics {
  let t = Z;
  let a = Z;
  let lt = 0;
  let l = 0;
  for (const m of list) {
    t = t.plus(m.target);
    a = a.plus(m.achieved);
    lt += m.leadTarget;
    l += m.leads;
  }
  return computeMetrics(t, a, lt, l);
}

/**
 * Fraction of the day's target that should be done by now (0..1).
 * Past dates → 1, future dates → 0, today → linear between workday start and end.
 */
export function expectedProgress(date: string, today: string, minutesNow: number, s: AppSettings): number {
  if (date < today) return 1;
  if (date > today) return 0;
  const start = parseHm(s.workdayStart);
  const end = parseHm(s.workdayEnd);
  if (end <= start) return 1;
  if (minutesNow <= start) return 0;
  if (minutesNow >= end) return 1;
  return (minutesNow - start) / (end - start);
}

export interface ClassifyContext {
  date: string;
  today: string;
  minutesNow: number;
  /** The date is in the past, or its daily report is locked. */
  closed: boolean;
  settings: AppSettings;
}

function withinGrace(ctx: ClassifyContext): boolean {
  if (ctx.date > ctx.today) return true;
  if (ctx.date < ctx.today) return false;
  return ctx.minutesNow < parseHm(ctx.settings.workdayStart) + ctx.settings.status.graceMinutes;
}

export function classify(m: Metrics, ctx: ClassifyContext): PerfStatus {
  const ratios: number[] = [];
  if (m.target.gt(0)) ratios.push(m.achieved.div(m.target).toNumber());
  if (m.leadTarget > 0) ratios.push(m.leads / m.leadTarget);
  if (ratios.length === 0) return "NO_TARGET";

  if (ratios.every((r) => r >= 1)) return ratios.some((r) => r > 1) ? "OVERACHIEVED" : "COMPLETED";

  const nothingRecorded = m.achieved.lte(0) && m.leads === 0;
  if (ctx.closed) return nothingRecorded ? "MISSED" : "PARTIAL";
  if (nothingRecorded) return "NOT_STARTED";

  // Never flag someone early in the day just because the full target is not yet reached.
  if (withinGrace(ctx)) return "ON_TRACK";

  const expected = expectedProgress(ctx.date, ctx.today, ctx.minutesNow, ctx.settings);
  const threshold = expected * (1 - ctx.settings.status.onTrackTolerancePct / 100);
  return Math.min(...ratios) >= threshold ? "ON_TRACK" : "AT_RISK";
}

export interface AllocationCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  allocatedTarget: D;
  allocatedLeads: number;
  unallocatedTarget: D;
  unallocatedLeads: number;
}

/** Allocation validation for team plans (Mode 1 = ALLOCATED, Mode 2 = INDEPENDENT). */
export function validateAllocation(opts: {
  mode: "ALLOCATED" | "INDEPENDENT";
  teamTarget: D;
  teamLeadTarget: number;
  allocations: { monetaryTarget: D; leadTarget: number }[];
  allowUnallocated: boolean;
}): AllocationCheck {
  const allocatedTarget = opts.allocations.reduce((s, a) => s.plus(a.monetaryTarget), Z);
  const allocatedLeads = opts.allocations.reduce((s, a) => s + a.leadTarget, 0);
  const unallocatedTarget = opts.teamTarget.minus(allocatedTarget);
  const unallocatedLeads = opts.teamLeadTarget - allocatedLeads;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (opts.mode === "ALLOCATED") {
    if (unallocatedTarget.lt(0)) {
      errors.push(`Individual allocations exceed the team target by ₹${unallocatedTarget.abs().toFixed(2)}.`);
    } else if (unallocatedTarget.gt(0)) {
      if (opts.allowUnallocated) warnings.push(`₹${unallocatedTarget.toFixed(2)} of the team target is unallocated.`);
      else errors.push(`₹${unallocatedTarget.toFixed(2)} of the team target is not allocated. Allocate it or explicitly allow an unallocated balance.`);
    }
    if (unallocatedLeads < 0) {
      errors.push(`Lead allocations exceed the team lead target by ${-unallocatedLeads}.`);
    } else if (unallocatedLeads > 0) {
      if (opts.allowUnallocated) warnings.push(`${unallocatedLeads} lead(s) of the team lead target are unallocated.`);
      else errors.push(`${unallocatedLeads} lead(s) of the team lead target are not allocated.`);
    }
  } else if (!allocatedTarget.eq(opts.teamTarget) || allocatedLeads !== opts.teamLeadTarget) {
    warnings.push("Independent mode: the team goal differs from the sum of individual targets. Company totals use individual targets only.");
  }
  if (opts.allocations.length === 0) warnings.push("No individual allocations defined.");
  return { ok: errors.length === 0, errors, warnings, allocatedTarget, allocatedLeads, unallocatedTarget, unallocatedLeads };
}
