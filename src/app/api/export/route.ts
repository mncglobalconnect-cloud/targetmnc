import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedPerformance } from "@/lib/perf-access";
import { buildDataset, toCsv, type Dataset } from "@/lib/datasets";
import { buildWorkbook } from "@/lib/excel";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { resolveReportRange } from "@/lib/report-periods";
import { zDate } from "@/lib/validation";

const schema = z.object({
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
  dataset: z.enum(["performance", "achievements", "leads", "teams"]).default("performance"),
  period: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  date: zDate.optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  teamId: z.string().optional(),
  employeeId: z.string().optional(),
  departmentId: z.string().optional(),
});

/** Download Excel/CSV from MongoDB for a day, ISO week, calendar month/year, or custom range. */
export const GET = route(async (req) => {
  const user = await requireUser();
  rateLimit(`export:${user.id}`, 10, 60_000);
  const input = parseQuery(req, schema);
  let range: ReturnType<typeof resolveReportRange>;
  try { range = resolveReportRange(input); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid report range."); }
  const q = { ...input, ...range };

  const perf = await scopedPerformance(user, { ...q, includeIdle: q.from === q.to });
  const empIds = [...new Set(perf.rows.map((r) => r.employeeId))];
  const filterLeads = (ds: Dataset) => ({ ...ds, rows: ds.rows.filter((r) => r[20] !== "DELETED") });
  const filterAch = (ds: Dataset) => ({ ...ds, rows: ds.rows.filter((r) => r[12] !== "VOIDED") });

  let scopeLabel = "Company";
  if (q.employeeId) scopeLabel = `Employee: ${(await prisma.employee.findUnique({ where: { id: q.employeeId } }))?.name ?? q.employeeId}`;
  else if (q.teamId) scopeLabel = `Team: ${(await prisma.team.findUnique({ where: { id: q.teamId } }))?.name ?? q.teamId}`;
  else if (user.role === "MANAGER") scopeLabel = "My teams";
  else if (user.role === "EMPLOYEE") scopeLabel = `Employee: ${user.name}`;

  const base = `mnc-${q.period}-${q.dataset}-${q.from}${q.from === q.to ? "" : `_to_${q.to}`}`;
  const recordExport = () => audit({ actorId: user.id, action: "REPORT_EXPORTED", entityType: "Export", after: { ...q, scopeLabel }, ip: clientIp(req) });

  if (q.format === "csv") {
    let ds: Dataset;
    if (q.dataset === "achievements") ds = filterAch(await buildDataset("Achievement_Entries", q.from, q.to, empIds));
    else if (q.dataset === "leads") ds = filterLeads(await buildDataset("Lead_Records", q.from, q.to, empIds));
    else if (q.dataset === "teams") {
      ds = {
        columns: ["Team", "Team Target", "Allocated", "Achieved", "Remaining", "Achievement %", "Lead Target", "Leads", "Remaining Leads", "Lead %", "Members"],
        rows: perf.byTeam.map((t) => [t.teamName, t.goalTarget, t.memberTarget, t.achieved, t.goalBalance, t.goalPct, t.goalLeadTarget, t.leads, t.goalLeadBalance, t.goalLeadPct, t.memberCount]),
      };
    } else {
      ds = {
        columns: ["Date", "Employee Code", "Employee", "Team", "Assigned Target", "Achieved", "Remaining Target", "Achievement %", "Lead Target", "Leads Added", "Remaining Leads", "Lead %", "Status"],
        rows: perf.rows.map((r) => [r.date, r.employeeCode, r.employeeName, r.teamName, r.target, r.achieved, r.balance, r.pct, r.leadTarget, r.leads, r.leadBalance, r.leadPct, r.status]),
      };
    }
    const csv = toCsv(ds);
    await recordExport();
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" },
    });
  }

  const [achievements, leads] = await Promise.all([
    buildDataset("Achievement_Entries", q.from, q.to, empIds).then(filterAch),
    buildDataset("Lead_Records", q.from, q.to, empIds).then(filterLeads),
  ]);
  const buf = await buildWorkbook({
    title: `${q.period === "custom" ? "Custom" : q.period[0].toUpperCase() + q.period.slice(1)} Performance Report — ${q.from}${q.from === q.to ? "" : ` to ${q.to}`}`,
    scopeLabel,
    perf,
    achievements,
    leads,
    generatedBy: user.name,
  });
  await recordExport();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});
