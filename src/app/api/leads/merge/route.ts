import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { fromDbDate } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { assertLeadAccess } from "@/lib/lead-access";

const schema = z.object({
  primaryId: z.string().min(1),
  duplicateIds: z.array(z.string().min(1)).min(1).max(20),
  reason: z.string().trim().min(5, "Provide a reason (min. 5 characters)").max(500),
});

/**
 * Merge duplicates into a primary lead. Duplicates stop counting toward targets (the primary keeps its
 * single count); their activities, assignments and achievements move to the primary so no history is lost.
 */
export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN", "MANAGER"]);
  const body = await parseBody(req, schema);
  if (body.duplicateIds.includes(body.primaryId)) throw new ApiError(400, "The primary lead cannot also be a duplicate.");
  const leads = await prisma.lead.findMany({ where: { id: { in: [body.primaryId, ...body.duplicateIds] }, deletedAt: null } });
  const primary = leads.find((l) => l.id === body.primaryId);
  if (!primary || primary.mergedIntoId) throw new ApiError(404, "Primary lead not found or already merged.");
  const dups = leads.filter((l) => body.duplicateIds.includes(l.id));
  if (dups.length !== body.duplicateIds.length || dups.some((d) => d.mergedIntoId)) throw new ApiError(400, "Some duplicates were not found or are already merged.");
  for (const l of leads) await assertLeadAccess(user, l);

  let correction = false;
  for (const d of dups) {
    correction = (await assertEditable({ user, date: fromDbDate(d.leadDate), employeeId: d.creditedEmployeeId, teamId: d.creditedTeamId, reason: body.reason })) || correction;
  }

  await prisma.$transaction(async (tx) => {
    for (const d of dups) {
      await tx.leadActivity.updateMany({ where: { leadId: d.id }, data: { leadId: primary.id } });
      await tx.leadAssignment.updateMany({ where: { leadId: d.id }, data: { leadId: primary.id } });
      await tx.achievementEntry.updateMany({ where: { leadId: d.id }, data: { leadId: primary.id } });
      await tx.lead.update({ where: { id: d.id }, data: { mergedIntoId: primary.id, countsTowardTarget: false, updatedById: user.id } });
      await tx.leadActivity.create({
        data: {
          leadId: primary.id,
          type: "MERGE",
          description: `Merged duplicate "${d.companyName}" (${d.phone}, created ${fromDbDate(d.leadDate)}). Reason: ${body.reason}`,
          createdById: user.id,
        },
      });
    }
    // Fill gaps on the primary from duplicates without overwriting existing values.
    const fill: Record<string, unknown> = {};
    for (const k of ["contactPerson", "email", "emailNorm", "altPhone", "website", "industry", "source"] as const) {
      if (!primary[k]) {
        const v = dups.find((d) => d[k])?.[k];
        if (v) fill[k] = v;
      }
    }
    if (Object.keys(fill).length) await tx.lead.update({ where: { id: primary.id }, data: fill });
    await audit(
      { actorId: user.id, action: correction ? "LEADS_MERGED_AFTER_LOCK" : "LEADS_MERGED", entityType: "Lead", entityId: primary.id, before: dups, after: { primaryId: primary.id, filled: fill }, reason: body.reason, ip: clientIp(req) },
      tx,
    );
  });
  return ok({ ok: true, merged: dups.length });
});
