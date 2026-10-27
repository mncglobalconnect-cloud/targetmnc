import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { toDbDate } from "@/lib/dates";
import { zDate, zPage } from "@/lib/validation";

const schema = zPage.extend({
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  q: z.string().max(100).optional(),
});

export const GET = route(async (req) => {
  await requireUser(["SUPER_ADMIN"]);
  const q = parseQuery(req, schema);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lt: new Date(toDbDate(q.to).getTime() + 86_400_000) } : {}) } }
      : {}),
    ...(q.q ? { OR: [{ action: { contains: q.q, mode: "insensitive" } }, { reason: { contains: q.q, mode: "insensitive" } }, { entityId: q.q }] } : {}),
  };
  const [total, rows, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { email: true, employee: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return ok({
    total,
    page: q.page,
    pageSize: q.pageSize,
    actions: actions.map((a) => a.action),
    rows: rows.map((r) => ({ ...r, actorName: r.actor?.employee?.name ?? r.actor?.email ?? "System" })),
  });
});
