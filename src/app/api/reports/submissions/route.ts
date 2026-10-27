import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess, assertTeamManage, scopedEmployeeIds, viewableTeamIds } from "@/lib/scope";
import { getSettings } from "@/lib/settings";
import { fromDbDate, toDbDate, todayInTz } from "@/lib/dates";
import { scopedPerformance } from "@/lib/perf-access";
import { audit } from "@/lib/audit";
import { zDate, zText } from "@/lib/validation";

export const GET = route(async (req) => {
  const user = await requireUser();
  const { date } = parseQuery(req, z.object({ date: zDate }));
  const emp = await scopedEmployeeIds(user);
  const teams = await viewableTeamIds(user);
  const subs = await prisma.dailyReportSubmission.findMany({
    where: {
      date: toDbDate(date),
      OR: [
        { scope: "COMPANY" },
        { scope: "TEAM", ...(teams === "ALL" ? {} : { teamId: { in: teams } }) },
        { scope: "EMPLOYEE", ...(emp === "ALL" ? {} : { employeeId: { in: emp } }) },
      ],
    },
    include: { employee: { select: { name: true } }, team: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok(subs.map((s) => ({ ...s, date: fromDbDate(s.date), snapshot: undefined })));
});

const submitSchema = z.object({
  date: zDate,
  scope: z.enum(["EMPLOYEE", "TEAM", "COMPANY"]),
  employeeId: z.string().optional(),
  teamId: z.string().optional(),
  remarks: zText(2000),
  managerRemarks: zText(2000),
  lock: z.boolean().default(true),
});

/** End-of-day submission. Employees submit their own day; managers submit & lock team days; admins lock the company day. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await parseBody(req, submitSchema);
  const settings = await getSettings();
  if (body.date > todayInTz(settings.timezone)) throw new ApiError(400, "You cannot submit a report for a future date.");

  let scopeKey: string;
  let employeeId: string | null = null;
  let teamId: string | null = null;
  let status: "SUBMITTED" | "LOCKED";
  if (body.scope === "EMPLOYEE") {
    employeeId = body.employeeId || user.employeeId;
    if (!employeeId) throw new ApiError(400, "Select an employee.");
    if (user.role === "EMPLOYEE" && employeeId !== user.employeeId) throw new ApiError(403, "You can only submit your own report.");
    await assertEmployeeAccess(user, employeeId);
    scopeKey = `EMP:${employeeId}`;
    status = "SUBMITTED";
  } else if (body.scope === "TEAM") {
    if (user.role === "EMPLOYEE") throw new ApiError(403, "Only managers can submit team reports.");
    if (!body.teamId) throw new ApiError(400, "Select a team.");
    assertTeamManage(user, body.teamId);
    teamId = body.teamId;
    scopeKey = `TEAM:${teamId}`;
    status = body.lock ? "LOCKED" : "SUBMITTED";
  } else {
    if (user.role !== "SUPER_ADMIN") throw new ApiError(403, "Only a Super Admin can lock the company report.");
    scopeKey = "COMPANY";
    status = "LOCKED";
  }

  const d = toDbDate(body.date);
  const existing = await prisma.dailyReportSubmission.findUnique({ where: { date_scopeKey: { date: d, scopeKey } } });
  if (existing && existing.status !== "REOPENED") {
    // A manager may add remarks or lock a previously submitted (unlocked) report.
    if (!(existing.status === "SUBMITTED" && user.role !== "EMPLOYEE")) {
      throw new ApiError(409, "This report has already been submitted. Reopen it (with a reason) to make changes.");
    }
  }

  const perf = await scopedPerformance(user, { from: body.date, to: body.date, employeeId: employeeId ?? undefined, teamId: teamId ?? undefined });
  const snapshot = JSON.parse(
    JSON.stringify({
      totals: perf.totals,
      byTeam: perf.byTeam,
      rows: perf.rows.map((r) => ({ employeeId: r.employeeId, employeeName: r.employeeName, target: r.target, achieved: r.achieved, leadTarget: r.leadTarget, leads: r.leads, status: r.status })),
      at: new Date().toISOString(),
    }),
  );
  const now = new Date();
  const saved = await prisma.$transaction(async (tx) => {
    const s = await tx.dailyReportSubmission.upsert({
      where: { date_scopeKey: { date: d, scopeKey } },
      create: {
        date: d,
        scope: body.scope,
        scopeKey,
        employeeId,
        teamId,
        status,
        remarks: body.remarks ?? null,
        managerRemarks: body.managerRemarks ?? null,
        snapshot,
        submittedById: user.id,
        submittedAt: now,
        ...(status === "LOCKED" ? { lockedById: user.id, lockedAt: now } : {}),
      },
      update: {
        status: existing?.status === "SUBMITTED" && user.role !== "EMPLOYEE" && body.scope === "EMPLOYEE" ? "SUBMITTED" : status,
        remarks: body.remarks ?? existing?.remarks ?? null,
        managerRemarks: body.managerRemarks ?? existing?.managerRemarks ?? null,
        snapshot,
        submittedById: user.id,
        submittedAt: now,
        ...(status === "LOCKED" ? { lockedById: user.id, lockedAt: now } : {}),
      },
    });
    await audit({ actorId: user.id, action: status === "LOCKED" ? "REPORT_LOCKED" : "REPORT_SUBMITTED", entityType: "DailyReportSubmission", entityId: s.id, before: existing, after: { ...s, snapshot: undefined }, ip: clientIp(req) }, tx);
    return s;
  });

  return ok({ ...saved, snapshot: undefined });
});
