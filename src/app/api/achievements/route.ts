import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess, scopedEmployeeIds, teamOnDate } from "@/lib/scope";
import { getSettings } from "@/lib/settings";
import { toDbDate, todayInTz } from "@/lib/dates";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { zDate, zPage, zPositiveMoney, zReason, zText } from "@/lib/validation";

const listSchema = zPage.extend({
  from: zDate.optional(),
  to: zDate.optional(),
  employeeId: z.string().optional(),
  teamId: z.string().optional(),
  categoryId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, listSchema);
  const scope = await scopedEmployeeIds(user);
  if (q.employeeId && scope !== "ALL" && !scope.includes(q.employeeId)) throw new ApiError(403, "No access to this employee.");

  const where: Prisma.AchievementEntryWhereInput = {
    deletedAt: null,
    ...(q.employeeId ? { employeeId: q.employeeId } : scope === "ALL" ? {} : { employeeId: { in: scope } }),
    ...(q.teamId ? { teamId: q.teamId } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
    ...(q.q
      ? { OR: [{ description: { contains: q.q, mode: "insensitive" } }, { referenceNo: { contains: q.q, mode: "insensitive" } }, { lead: { companyName: { contains: q.q, mode: "insensitive" } } }] }
      : {}),
  };
  const [total, rows, sums] = await Promise.all([
    prisma.achievementEntry.count({ where }),
    prisma.achievementEntry.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, code: true } },
        team: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, code: true } },
        lead: { select: { id: true, companyName: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.achievementEntry.groupBy({ by: ["countsTowardTarget"], where, _sum: { amount: true } }),
  ]);
  const creators = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter(Boolean) as string[])] } },
    select: { id: true, email: true, employee: { select: { name: true } } },
  });
  const creatorName = new Map(creators.map((c) => [c.id, c.employee?.name ?? c.email]));
  return ok({
    total,
    page: q.page,
    pageSize: q.pageSize,
    sums: {
      qualifying: (sums.find((s) => s.countsTowardTarget)?._sum.amount ?? 0).toString(),
      nonQualifying: (sums.find((s) => !s.countsTowardTarget)?._sum.amount ?? 0).toString(),
    },
    rows: rows.map((r) => ({
      ...r,
      date: r.date.toISOString().slice(0, 10),
      createdByName: r.createdById ? creatorName.get(r.createdById) ?? null : null,
    })),
  });
});

const createSchema = z.object({
  date: zDate,
  employeeId: z.string().optional(),
  categoryId: z.string().min(1, "Select a category"),
  amount: zPositiveMoney,
  description: zText(500),
  leadId: z.string().nullable().optional(),
  referenceNo: zText(100),
  notes: zText(1000),
  reason: zReason,
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const POST = route(async (req) => {
  const user = await requireUser();
  rateLimit(`ach:${user.id}`, 60, 60_000);
  const body = await parseBody(req, createSchema);
  const idem = body.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined;
  if (idem) {
    const prior = await prisma.achievementEntry.findUnique({ where: { idempotencyKey: idem } });
    if (prior) return ok({ ...prior, duplicateRequest: true }); // retry of an already-saved request
  }

  const settings = await getSettings();
  const employeeId = body.employeeId || user.employeeId;
  if (!employeeId) throw new ApiError(400, "Select an employee.");
  if (user.role === "EMPLOYEE") {
    if (employeeId !== user.employeeId) throw new ApiError(403, "You can only record your own achievements.");
    if (!settings.permissions.employeesCanRecordAchievements) throw new ApiError(403, "Achievement entry is restricted to managers.");
  } else {
    await assertEmployeeAccess(user, employeeId);
  }
  const today = todayInTz(settings.timezone);
  if (body.date > today) throw new ApiError(400, "Achievements cannot be recorded for a future date.");

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.active) throw new ApiError(400, "Employee not found or inactive.");
  const category = await prisma.achievementCategory.findUnique({ where: { id: body.categoryId } });
  if (!category || !category.active) throw new ApiError(400, "Select a valid achievement category.");
  if (body.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: body.leadId } });
    if (!lead || lead.deletedAt) throw new ApiError(400, "Related lead not found.");
  }

  const d = toDbDate(body.date);
  const alloc = await prisma.employeeTargetAllocation.findUnique({ where: { date_employeeId: { date: d, employeeId } } });
  const teamId = alloc?.teamId ?? (await teamOnDate(employeeId, d));
  const correction = await assertEditable({ user, date: body.date, employeeId, teamId, reason: body.reason });

  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.achievementEntry.create({
      data: {
        date: d,
        employeeId,
        teamId,
        amount: body.amount,
        categoryId: category.id,
        countsTowardTarget: category.countsTowardTarget, // frozen at save time
        description: body.description ?? null,
        leadId: body.leadId || null,
        referenceNo: body.referenceNo ?? null,
        notes: body.notes ?? null,
        idempotencyKey: idem ?? null,
        createdById: user.id,
      },
    });
    await audit(
      { actorId: user.id, action: correction ? "ACHIEVEMENT_ADDED_AFTER_LOCK" : "ACHIEVEMENT_CREATED", entityType: "AchievementEntry", entityId: e.id, after: e, reason: body.reason, ip: clientIp(req) },
      tx,
    );
    return e;
  });
  return ok(entry, { status: 201 });
});
