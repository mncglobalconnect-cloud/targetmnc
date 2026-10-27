import { z } from "zod";
import { ApiError, ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedPerformance } from "@/lib/perf-access";
import { leadConversionStats } from "@/lib/performance";
import { scopedEmployeeIds } from "@/lib/scope";
import { resolveReportRange } from "@/lib/report-periods";
import { zDate } from "@/lib/validation";

const schema = z.object({ from: zDate, to: zDate, teamId: z.string().optional(), departmentId: z.string().optional(), employeeId: z.string().optional() });

/** Weekly / monthly / yearly / custom-range report. All ratios are ratio-of-sums. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, schema);
  try { resolveReportRange(q); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid report range."); }
  const perf = await scopedPerformance(user, q);
  const scope =
    user.role === "EMPLOYEE"
      ? [user.employeeId ?? ""]
      : q.employeeId
        ? [q.employeeId]
        : q.departmentId
          ? [...new Set(perf.rows.map((r) => r.employeeId))]
          : await scopedEmployeeIds(user);
  const conversion = await leadConversionStats(q.from, q.to, scope, q.teamId);

  const withTarget = perf.byEmployee.filter((e) => Number(e.target) > 0 || e.leadTarget > 0);
  const best = [...withTarget].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 5);
  // "Consistently missing": missed/partial on at least half of their targeted days (min. 2 days).
  const consistentlyMissing = withTarget
    .filter((e) => e.days >= 2 && e.daysMissed / e.days >= 0.5)
    .sort((a, b) => b.daysMissed / b.days - a.daysMissed / a.days);

  const targetedDays = perf.byDate.filter((d) => Number(d.target) > 0);
  return ok({
    ...perf,
    conversion,
    best,
    consistentlyMissing,
    summary: {
      workingDays: perf.byDate.filter((d) => d.working).length,
      daysWithTargets: targetedDays.length,
      // Mean of per-employee percentages is shown separately; the headline % is total achieved / total target.
      averageEmployeePct: withTarget.length ? Number((withTarget.reduce((s, e) => s + (e.pct ?? 0), 0) / withTarget.length).toFixed(2)) : null,
    },
  });
});
