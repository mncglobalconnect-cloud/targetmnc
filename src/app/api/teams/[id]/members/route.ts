import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { addMember, closeMembership } from "@/lib/teams";
import { todayInTz } from "@/lib/dates";
import { zDate } from "@/lib/validation";

const schema = z.object({
  action: z.enum(["add", "remove"]),
  employeeIds: z.array(z.string()).min(1).max(200),
  effectiveDate: zDate.optional(),
});

/** Add/remove members. Memberships are closed (not deleted) so past reports keep their team attribution. */
export const POST = route(async (req, ctx) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const { id: teamId } = await ctx.params;
  const body = await parseBody(req, schema);
  const effective = body.effectiveDate ?? todayInTz();
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new ApiError(404, "Team not found.");

  await prisma.$transaction(async (tx) => {
    for (const employeeId of new Set(body.employeeIds)) {
      if (body.action === "add") {
        await addMember(tx, teamId, employeeId, effective, user.id);
      } else {
        const open = await tx.teamMembership.findFirst({ where: { teamId, employeeId, endDate: null } });
        if (open) await closeMembership(tx, open.id, open.startDate, effective);
      }
    }
    await audit(
      { actorId: user.id, action: body.action === "add" ? "TEAM_MEMBERS_ADDED" : "TEAM_MEMBERS_REMOVED", entityType: "Team", entityId: teamId, after: { employeeIds: body.employeeIds, effective }, ip: clientIp(req) },
      tx,
    );
  });
  return ok({ ok: true });
});
