import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess, teamOnDate } from "@/lib/scope";
import { getSettings } from "@/lib/settings";
import { toDbDate, todayInTz } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { findDuplicates, maskDuplicates, normalizeCompany, normalizeEmail, normalizePhone } from "@/lib/leads";
import { leadScopeWhere } from "@/lib/lead-access";
import { zDate, zEmail, zMoney, zPage, zPhone, zReason, zText, zUrl } from "@/lib/validation";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "CONVERTED", "LOST", "ON_HOLD"] as const;

const listSchema = zPage.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  ownerId: z.string().optional(),
  teamId: z.string().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  validation: z.enum(["VALID", "PENDING_VALIDATION", "REJECTED"]).optional(),
  followUpDue: z.enum(["true", "false"]).optional(),
  includeMerged: z.enum(["true", "false"]).optional(),
  sort: z.enum(["leadDate", "companyName", "status", "estimatedValue", "followUpDate", "createdAt"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, listSchema);
  const settings = await getSettings();
  const scope = await leadScopeWhere(user);
  const where: Prisma.LeadWhereInput = {
    AND: [
      scope,
      { deletedAt: null },
      q.includeMerged === "true" ? {} : { mergedIntoId: null },
      q.status ? { status: q.status } : {},
      q.ownerId ? { ownerId: q.ownerId } : {},
      q.teamId ? { teamId: q.teamId } : {},
      q.validation ? { validation: q.validation } : {},
      q.from || q.to ? { leadDate: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {},
      q.followUpDue === "true" ? { followUpDate: { lte: toDbDate(todayInTz(settings.timezone)) }, status: { notIn: ["CONVERTED", "LOST"] } } : {},
      q.q
        ? {
            OR: [
              { companyName: { contains: q.q, mode: "insensitive" } },
              { contactPerson: { contains: q.q, mode: "insensitive" } },
              { email: { contains: q.q, mode: "insensitive" } },
              { phoneNorm: { contains: q.q.replace(/\D/g, "") || "~" } },
            ],
          }
        : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true } },
        creditedEmployee: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: [{ [q.sort]: q.dir }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return ok({
    total,
    page: q.page,
    pageSize: q.pageSize,
    rows: rows.map((l) => ({
      ...l,
      leadDate: l.leadDate.toISOString().slice(0, 10),
      followUpDate: l.followUpDate?.toISOString().slice(0, 10) ?? null,
    })),
  });
});

const createSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(200),
  phone: zPhone,
  leadDate: zDate.optional(),
  ownerId: z.string().optional(),
  contactPerson: zText(120),
  email: zEmail,
  altPhone: zText(25),
  website: zUrl,
  industry: zText(80),
  source: zText(80),
  estimatedValue: zMoney.nullable().optional(),
  followUpDate: zDate.nullable().optional(),
  status: z.enum(STATUSES).default("NEW"),
  notes: zText(2000),
  confirmDuplicate: z.boolean().default(false),
  reason: zReason,
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const POST = route(async (req) => {
  const user = await requireUser();
  rateLimit(`lead:${user.id}`, 60, 60_000);
  const body = await parseBody(req, createSchema);
  const idem = body.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined;
  if (idem) {
    const prior = await prisma.lead.findUnique({ where: { idempotencyKey: idem } });
    if (prior) return ok({ ...prior, duplicateRequest: true });
  }
  const settings = await getSettings();
  const today = todayInTz(settings.timezone);
  const leadDate = body.leadDate ?? today;
  if (leadDate > today) throw new ApiError(400, "Lead date cannot be in the future.");

  const ownerId = body.ownerId || user.employeeId;
  if (!ownerId) throw new ApiError(400, "Select the lead owner.");
  if (user.role === "EMPLOYEE" && ownerId !== user.employeeId) throw new ApiError(403, "You can only add leads for yourself.");
  if (user.role !== "EMPLOYEE") await assertEmployeeAccess(user, ownerId);
  const owner = await prisma.employee.findUnique({ where: { id: ownerId } });
  if (!owner || !owner.active) throw new ApiError(400, "Lead owner not found or inactive.");

  const duplicates = await findDuplicates({ companyName: body.companyName, email: body.email, phone: body.phone });
  if (duplicates.some((d) => d.exact) && settings.leads.blockExactDuplicates) {
    throw new ApiError(409, "A lead with the same phone or email already exists.", { duplicates: maskDuplicates(user.role, duplicates), blocked: true });
  }
  if (duplicates.length && !body.confirmDuplicate) {
    throw new ApiError(409, "Possible duplicate lead found. Review and confirm before saving.", { duplicates: maskDuplicates(user.role, duplicates), requiresConfirmation: true });
  }

  const d = toDbDate(leadDate);
  const teamId = await teamOnDate(ownerId, d);
  const correction = await assertEditable({ user, date: leadDate, employeeId: ownerId, teamId, reason: body.reason });

  const lead = await prisma.$transaction(async (tx) => {
    const l = await tx.lead.create({
      data: {
        companyName: body.companyName,
        companyNameNorm: normalizeCompany(body.companyName),
        contactPerson: body.contactPerson ?? null,
        email: body.email ?? null,
        emailNorm: normalizeEmail(body.email),
        phone: body.phone,
        phoneNorm: normalizePhone(body.phone),
        altPhone: body.altPhone ?? null,
        website: body.website ?? null,
        industry: body.industry ?? null,
        source: body.source ?? null,
        estimatedValue: body.estimatedValue ?? null,
        followUpDate: body.followUpDate ? toDbDate(body.followUpDate) : null,
        status: body.status,
        notes: body.notes ?? null,
        leadDate: d,
        ownerId,
        teamId,
        creditedEmployeeId: ownerId, // attribution fixed at creation
        creditedTeamId: teamId,
        idempotencyKey: idem ?? null,
        createdById: user.id,
      },
    });
    await tx.leadAssignment.create({ data: { leadId: l.id, toEmployeeId: ownerId, reason: "Lead created", changedById: user.id } });
    await tx.leadActivity.create({
      data: { leadId: l.id, type: "CREATED", description: duplicates.length ? `Lead created (confirmed despite ${duplicates.length} possible duplicate(s))` : "Lead created", createdById: user.id },
    });
    await audit(
      {
        actorId: user.id,
        action: correction ? "LEAD_ADDED_AFTER_LOCK" : "LEAD_CREATED",
        entityType: "Lead",
        entityId: l.id,
        after: l,
        reason: body.reason ?? (duplicates.length ? `Confirmed as distinct from: ${duplicates.map((x) => x.companyName).join(", ")}` : null),
        ip: clientIp(req),
      },
      tx,
    );
    return l;
  });
  return ok(lead, { status: 201 });
});
