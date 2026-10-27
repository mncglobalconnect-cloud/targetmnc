import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser, type AuthUser } from "@/lib/auth/server";
import { assertEmployeeAccess } from "@/lib/scope";
import { getSettings } from "@/lib/settings";
import { fromDbDate, todayInTz } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { zPositiveMoney, zReason, zText } from "@/lib/validation";

async function loadEditable(user: AuthUser, id: string) {
  const entry = await prisma.achievementEntry.findUnique({ where: { id } });
  if (!entry || entry.deletedAt) throw new ApiError(404, "Achievement entry not found.");
  const settings = await getSettings();
  if (user.role === "EMPLOYEE") {
    const today = todayInTz(settings.timezone);
    const own = entry.employeeId === user.employeeId && entry.createdById === user.id;
    if (!own || !settings.permissions.employeesCanEditOwnSameDay || fromDbDate(entry.date) !== today) {
      throw new ApiError(403, "You can only edit your own entries on the same day. Ask your manager for corrections.");
    }
  } else {
    await assertEmployeeAccess(user, entry.employeeId);
  }
  return entry;
}

const patchSchema = z.object({
  amount: zPositiveMoney.optional(),
  categoryId: z.string().optional(),
  description: zText(500),
  leadId: z.string().nullable().optional(),
  referenceNo: zText(100),
  notes: zText(1000),
  reason: zReason,
});

export const PATCH = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  const before = await loadEditable(user, id);
  const correction = await assertEditable({ user, date: fromDbDate(before.date), employeeId: before.employeeId, teamId: before.teamId, reason: body.reason });
  if (user.role !== "EMPLOYEE" && before.createdById !== user.id && !body.reason) {
    throw new ApiError(428, "Provide a reason when correcting another user's entry.", { requiresReason: true });
  }

  let countsTowardTarget = before.countsTowardTarget;
  if (body.categoryId && body.categoryId !== before.categoryId) {
    const cat = await prisma.achievementCategory.findUnique({ where: { id: body.categoryId } });
    if (!cat || !cat.active) throw new ApiError(400, "Select a valid category.");
    countsTowardTarget = cat.countsTowardTarget;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const e = await tx.achievementEntry.update({
      where: { id },
      data: {
        amount: body.amount,
        categoryId: body.categoryId,
        countsTowardTarget,
        description: body.description === undefined ? undefined : body.description,
        leadId: body.leadId === undefined ? undefined : body.leadId || null,
        referenceNo: body.referenceNo === undefined ? undefined : body.referenceNo,
        notes: body.notes === undefined ? undefined : body.notes,
        updatedById: user.id,
      },
    });
    await audit(
      { actorId: user.id, action: correction ? "ACHIEVEMENT_CORRECTED_AFTER_LOCK" : "ACHIEVEMENT_UPDATED", entityType: "AchievementEntry", entityId: id, before, after: e, reason: body.reason, ip: clientIp(req) },
      tx,
    );
    return e;
  });
  return ok(updated);
});

export const DELETE = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, z.object({ reason: z.string().trim().min(5, "Provide a reason (min. 5 characters)").max(500) }));
  const before = await loadEditable(user, id);
  const correction = await assertEditable({ user, date: fromDbDate(before.date), employeeId: before.employeeId, teamId: before.teamId, reason });
  await prisma.$transaction(async (tx) => {
    await tx.achievementEntry.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await audit(
      { actorId: user.id, action: correction ? "ACHIEVEMENT_VOIDED_AFTER_LOCK" : "ACHIEVEMENT_VOIDED", entityType: "AchievementEntry", entityId: id, before, reason, ip: clientIp(req) },
      tx,
    );
  });
  return ok({ ok: true });
});
