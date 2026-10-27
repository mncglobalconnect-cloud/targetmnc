import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { getSettings } from "@/lib/settings";
import { fromDbDate } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { assertAssignableEmployee, assertCanAssign } from "@/lib/targets";
import { zReason } from "@/lib/validation";

/** Remove a target allocation (e.g. assigned by mistake). Always audited. */
export const DELETE = route(async (req, ctx) => {
  const user = await requireUser();
  await assertCanAssign(user, await getSettings());
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, z.object({ reason: zReason }));
  const alloc = await prisma.employeeTargetAllocation.findUnique({ where: { id } });
  if (!alloc) throw new ApiError(404, "Target not found.");
  await assertAssignableEmployee(user, alloc.employeeId, alloc.teamId);
  const correction = await assertEditable({ user, date: fromDbDate(alloc.date), employeeId: alloc.employeeId, teamId: alloc.teamId, reason });

  await prisma.$transaction(async (tx) => {
    await tx.employeeTargetAllocation.delete({ where: { id } });
    await audit(
      { actorId: user.id, action: correction ? "TARGET_REMOVED_AFTER_LOCK" : "TARGET_REMOVED", entityType: "EmployeeTargetAllocation", entityId: id, before: alloc, reason, ip: clientIp(req) },
      tx,
    );
  });
  return ok({ ok: true });
});
