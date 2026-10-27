import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedPerformance } from "@/lib/perf-access";
import { COUNTABLE_LEAD } from "@/lib/leads";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { zDate } from "@/lib/validation";

const STATUS = ["OVERACHIEVED", "COMPLETED", "ON_TRACK", "AT_RISK", "NOT_STARTED", "PARTIAL", "MISSED", "NO_TARGET"] as const;

const schema = z.object({
  from: zDate,
  to: zDate,
  teamId: z.string().optional(),
  departmentId: z.string().optional(),
  employeeId: z.string().optional(),
  status: z.enum(STATUS).optional(),
  leadStatus: z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "CONVERTED", "LOST", "ON_HOLD"]).optional(),
});

/** Date-wise report: performance rows enriched with the company names of qualifying new leads. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, schema);
  const perf = await scopedPerformance(user, { ...q, includeIdle: q.from === q.to });
  const empIds = [...new Set(perf.rows.map((r) => r.employeeId))];
  const leads = await prisma.lead.findMany({
    where: {
      ...COUNTABLE_LEAD,
      leadDate: { gte: toDbDate(q.from), lte: toDbDate(q.to) },
      creditedEmployeeId: { in: empIds },
      ...(q.leadStatus ? { status: q.leadStatus } : {}),
    },
    select: { id: true, companyName: true, leadDate: true, creditedEmployeeId: true, status: true },
  });
  const byKey = new Map<string, { id: string; companyName: string; status: string }[]>();
  leads.forEach((l) => {
    const k = `${fromDbDate(l.leadDate)}|${l.creditedEmployeeId}`;
    byKey.set(k, [...(byKey.get(k) ?? []), { id: l.id, companyName: l.companyName, status: l.status }]);
  });
  let rows = perf.rows.map((r) => ({ ...r, newLeads: byKey.get(`${r.date}|${r.employeeId}`) ?? [] }));
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.leadStatus) rows = rows.filter((r) => r.newLeads.length > 0);

  const company = await prisma.dailyReportSubmission.findMany({
    where: { date: { gte: toDbDate(q.from), lte: toDbDate(q.to) }, scope: { in: ["COMPANY", "TEAM"] } },
    select: { date: true, scopeKey: true, status: true, lockedAt: true, managerRemarks: true },
  });
  return ok({
    ...perf,
    rows,
    submissions: company.map((s) => ({ ...s, date: fromDbDate(s.date) })),
  });
});
