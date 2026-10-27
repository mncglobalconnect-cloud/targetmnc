import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { toDbDate } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { assertLeadAccess } from "@/lib/lead-access";
import { zDate } from "@/lib/validation";

const schema = z.object({
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "FOLLOW_UP"]),
  description: z.string().trim().min(2, "Add a short description").max(2000),
  nextFollowUpDate: zDate.nullable().optional(),
});

/** Log contact activity / follow-ups. Activities never create or count as a new lead. */
export const POST = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead || lead.deletedAt) throw new ApiError(404, "Lead not found.");
  await assertLeadAccess(user, lead);
  const activity = await prisma.$transaction(async (tx) => {
    const a = await tx.leadActivity.create({ data: { leadId: id, type: body.type, description: body.description, createdById: user.id } });
    if (body.nextFollowUpDate !== undefined) {
      await tx.lead.update({ where: { id }, data: { followUpDate: body.nextFollowUpDate ? toDbDate(body.nextFollowUpDate) : null, updatedById: user.id } });
    }
    if (lead.status === "NEW" && ["CALL", "EMAIL", "MEETING"].includes(body.type)) {
      await tx.lead.update({ where: { id }, data: { status: "CONTACTED" } });
      await tx.leadActivity.create({ data: { leadId: id, type: "STATUS_CHANGE", description: "Status changed from New to Contacted", createdById: user.id } });
    }
    await audit({ actorId: user.id, action: "LEAD_ACTIVITY_ADDED", entityType: "Lead", entityId: id, after: a, ip: clientIp(req) }, tx);
    return a;
  });
  return ok(activity, { status: 201 });
});
