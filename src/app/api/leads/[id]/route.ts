import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess, teamOnDate } from "@/lib/scope";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { findDuplicates, maskDuplicates, normalizeCompany, normalizeEmail, normalizePhone } from "@/lib/leads";
import { assertLeadAccess } from "@/lib/lead-access";
import { titleCaseServer } from "@/lib/strings";
import { zDate, zEmail, zMoney, zPhone, zReason, zText, zUrl } from "@/lib/validation";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "CONVERTED", "LOST", "ON_HOLD"] as const;

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, code: true } },
      creditedEmployee: { select: { id: true, name: true, code: true } },
      team: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: "desc" } },
      assignments: { orderBy: { createdAt: "desc" }, include: { fromEmployee: { select: { name: true } }, toEmployee: { select: { name: true } } } },
      achievements: { where: { deletedAt: null }, include: { category: { select: { name: true } }, employee: { select: { name: true } } }, orderBy: { date: "desc" } },
      mergedFrom: { select: { id: true, companyName: true, leadDate: true, phone: true } },
      mergedInto: { select: { id: true, companyName: true } },
    },
  });
  if (!lead || lead.deletedAt) throw new ApiError(404, "Lead not found.");
  await assertLeadAccess(user, lead);
  const actorIds = [...new Set([...lead.activities.map((a) => a.createdById), lead.createdById].filter(Boolean) as string[])];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, employee: { select: { name: true } } } });
  const actorName = new Map(actors.map((a) => [a.id, a.employee?.name ?? a.email]));
  const duplicates = lead.mergedIntoId ? [] : maskDuplicates(user.role, await findDuplicates(lead, lead.id));
  return ok({
    ...lead,
    leadDate: fromDbDate(lead.leadDate),
    followUpDate: lead.followUpDate ? fromDbDate(lead.followUpDate) : null,
    createdByName: lead.createdById ? actorName.get(lead.createdById) ?? null : null,
    activities: lead.activities.map((a) => ({ ...a, createdByName: a.createdById ? actorName.get(a.createdById) ?? null : null })),
    achievements: lead.achievements.map((a) => ({ ...a, date: fromDbDate(a.date) })),
    duplicates,
  });
});

const patchSchema = z.object({
  companyName: z.string().trim().min(2).max(200).optional(),
  phone: zPhone.optional(),
  contactPerson: zText(120),
  email: zEmail,
  altPhone: zText(25),
  website: zUrl,
  industry: zText(80),
  source: zText(80),
  estimatedValue: zMoney.nullable().optional(),
  followUpDate: zDate.nullable().optional(),
  status: z.enum(STATUSES).optional(),
  convertedValue: zMoney.nullable().optional(),
  notes: zText(2000),
  /** Ownership transfer: changes who works the lead. Target credit stays with the original creator. */
  ownerId: z.string().optional(),
  /** Explicit attribution change (managers/admins only, with reason). */
  creditedEmployeeId: z.string().optional(),
  leadDate: zDate.optional(),
  reason: zReason,
});

export const PATCH = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  const before = await prisma.lead.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new ApiError(404, "Lead not found.");
  if (before.mergedIntoId) throw new ApiError(400, "This lead was merged into another record and is read-only.");
  await assertLeadAccess(user, before);

  const countingChange = (body.creditedEmployeeId && body.creditedEmployeeId !== before.creditedEmployeeId) || (body.leadDate && body.leadDate !== fromDbDate(before.leadDate));
  if (countingChange) {
    if (user.role === "EMPLOYEE") throw new ApiError(403, "Only managers can change lead credit or lead date.");
    if (!body.reason) throw new ApiError(428, "Provide a reason for changing lead credit or lead date.", { requiresReason: true });
  }
  if (body.ownerId && body.ownerId !== before.ownerId) {
    if (user.role === "EMPLOYEE") throw new ApiError(403, "Only managers can transfer leads.");
    await assertEmployeeAccess(user, body.ownerId);
  }
  if (body.creditedEmployeeId) await assertEmployeeAccess(user, body.creditedEmployeeId);

  // Lock checks: any change to counting fields affects the original (and new) day's numbers.
  let correction = false;
  if (countingChange) {
    correction = await assertEditable({ user, date: fromDbDate(before.leadDate), employeeId: before.creditedEmployeeId, teamId: before.creditedTeamId, reason: body.reason });
    const newDate = body.leadDate ?? fromDbDate(before.leadDate);
    const newEmp = body.creditedEmployeeId ?? before.creditedEmployeeId;
    correction = (await assertEditable({ user, date: newDate, employeeId: newEmp, teamId: null, reason: body.reason })) || correction;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const data: Parameters<typeof tx.lead.update>[0]["data"] = { updatedById: user.id };
    if (body.companyName) Object.assign(data, { companyName: body.companyName, companyNameNorm: normalizeCompany(body.companyName) });
    if (body.phone) Object.assign(data, { phone: body.phone, phoneNorm: normalizePhone(body.phone) });
    if (body.email !== undefined) Object.assign(data, { email: body.email, emailNorm: normalizeEmail(body.email) });
    for (const k of ["contactPerson", "altPhone", "website", "industry", "source", "notes"] as const) {
      if (body[k] !== undefined) Object.assign(data, { [k]: body[k] });
    }
    if (body.estimatedValue !== undefined) data.estimatedValue = body.estimatedValue;
    if (body.followUpDate !== undefined) data.followUpDate = body.followUpDate ? toDbDate(body.followUpDate) : null;
    if (body.convertedValue !== undefined) data.convertedValue = body.convertedValue;

    if (body.status && body.status !== before.status) {
      data.status = body.status;
      if (body.status === "CONVERTED") data.convertedAt = new Date();
      await tx.leadActivity.create({
        data: { leadId: id, type: "STATUS_CHANGE", description: `Status changed from ${titleCaseServer(before.status)} to ${titleCaseServer(body.status)}`, createdById: user.id },
      });
    }
    if (body.ownerId && body.ownerId !== before.ownerId) {
      const newTeam = await teamOnDate(body.ownerId, new Date());
      Object.assign(data, { ownerId: body.ownerId, teamId: newTeam });
      await tx.leadAssignment.create({ data: { leadId: id, fromEmployeeId: before.ownerId, toEmployeeId: body.ownerId, reason: body.reason ?? null, changedById: user.id } });
      const names = await tx.employee.findMany({ where: { id: { in: [before.ownerId, body.ownerId] } }, select: { id: true, name: true } });
      const n = (x: string) => names.find((e) => e.id === x)?.name ?? x;
      await tx.leadActivity.create({
        data: { leadId: id, type: "OWNER_CHANGE", description: `Ownership transferred from ${n(before.ownerId)} to ${n(body.ownerId)}. Target credit unchanged (original creator policy).`, createdById: user.id },
      });
    }
    if (countingChange) {
      if (body.creditedEmployeeId) {
        const d = body.leadDate ? toDbDate(body.leadDate) : before.leadDate;
        Object.assign(data, { creditedEmployeeId: body.creditedEmployeeId, creditedTeamId: await teamOnDate(body.creditedEmployeeId, d) });
      }
      if (body.leadDate) data.leadDate = toDbDate(body.leadDate);
      await tx.leadActivity.create({ data: { leadId: id, type: "CREDIT_CHANGE", description: `Target credit/date changed. Reason: ${body.reason}`, createdById: user.id } });
    }

    const l = await tx.lead.update({ where: { id }, data });
    await audit(
      {
        actorId: user.id,
        action: correction ? "LEAD_CORRECTED_AFTER_LOCK" : body.ownerId && body.ownerId !== before.ownerId ? "LEAD_TRANSFERRED" : countingChange ? "LEAD_CREDIT_CHANGED" : "LEAD_UPDATED",
        entityType: "Lead",
        entityId: id,
        before,
        after: l,
        reason: body.reason,
        ip: clientIp(req),
      },
      tx,
    );
    return l;
  });
  return ok(updated);
});

export const DELETE = route(async (req, ctx) => {
  const user = await requireUser(["SUPER_ADMIN", "MANAGER"]);
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, z.object({ reason: z.string().trim().min(5, "Provide a reason (min. 5 characters)").max(500) }));
  const before = await prisma.lead.findUnique({ where: { id } });
  if (!before || before.deletedAt) throw new ApiError(404, "Lead not found.");
  await assertLeadAccess(user, before);
  const correction = await assertEditable({ user, date: fromDbDate(before.leadDate), employeeId: before.creditedEmployeeId, teamId: before.creditedTeamId, reason });
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await audit({ actorId: user.id, action: correction ? "LEAD_DELETED_AFTER_LOCK" : "LEAD_DELETED", entityType: "Lead", entityId: id, before, reason, ip: clientIp(req) }, tx);
  });
  return ok({ ok: true });
});
