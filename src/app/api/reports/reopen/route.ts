import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess, assertTeamManage } from "@/lib/scope";
import { toDbDate } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { zDate } from "@/lib/validation";

const schema = z.object({
  date: zDate,
  scopeKey: z.string().regex(/^(COMPANY|TEAM:.+|EMP:.+)$/),
  reason: z.string().trim().min(5, "Provide a reason (min. 5 characters)").max(500),
});

/** Reopen a submitted/locked report for corrections. Always requires a reason and is audited. */
export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN", "MANAGER"]);
  const body = await parseBody(req, schema);
  const sub = await prisma.dailyReportSubmission.findUnique({ where: { date_scopeKey: { date: toDbDate(body.date), scopeKey: body.scopeKey } } });
  if (!sub) throw new ApiError(404, "Report submission not found.");
  if (sub.status === "REOPENED") throw new ApiError(400, "Report is already open.");
  if (sub.scope === "COMPANY" && user.role !== "SUPER_ADMIN") throw new ApiError(403, "Only a Super Admin can reopen the company report.");
  if (sub.scope === "TEAM" && sub.teamId) assertTeamManage(user, sub.teamId);
  if (sub.scope === "EMPLOYEE" && sub.employeeId) await assertEmployeeAccess(user, sub.employeeId);

  const updated = await prisma.dailyReportSubmission.update({
    where: { id: sub.id },
    data: { status: "REOPENED", reopenedById: user.id, reopenedAt: new Date(), reopenReason: body.reason },
  });
  await audit({ actorId: user.id, action: "REPORT_REOPENED", entityType: "DailyReportSubmission", entityId: sub.id, before: { ...sub, snapshot: undefined }, after: { ...updated, snapshot: undefined }, reason: body.reason, ip: clientIp(req) });
  return ok({ ...updated, snapshot: undefined });
});
