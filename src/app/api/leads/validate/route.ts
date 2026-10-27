import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { fromDbDate } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { assertLeadAccess } from "@/lib/lead-access";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum(["VALID", "REJECTED"]),
  reason: z.string().trim().max(500).optional().nullable(),
});

/** Approve or reject imported leads. Only validated leads count toward lead targets. */
export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN", "MANAGER"]);
  const body = await parseBody(req, schema);
  const leads = await prisma.lead.findMany({ where: { id: { in: body.ids }, validation: "PENDING_VALIDATION", deletedAt: null } });
  if (!leads.length) throw new ApiError(404, "No pending leads found.");
  for (const l of leads) {
    await assertLeadAccess(user, l);
    if (body.action === "VALID") await assertEditable({ user, date: fromDbDate(l.leadDate), employeeId: l.creditedEmployeeId, teamId: l.creditedTeamId, reason: body.reason });
  }
  await prisma.$transaction(async (tx) => {
    await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { validation: body.action, countsTowardTarget: body.action === "VALID", updatedById: user.id } });
    await tx.leadActivity.createMany({
      data: leads.map((l) => ({ leadId: l.id, type: "NOTE" as const, description: body.action === "VALID" ? "Import validated — now counts toward lead target" : `Import rejected${body.reason ? `: ${body.reason}` : ""}`, createdById: user.id })),
    });
    await audit({ actorId: user.id, action: body.action === "VALID" ? "LEADS_VALIDATED" : "LEADS_REJECTED", entityType: "Lead", after: { ids: leads.map((l) => l.id) }, reason: body.reason, ip: clientIp(req) }, tx);
  });
  return ok({ updated: leads.length });
});
