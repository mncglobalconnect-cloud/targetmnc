import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { assertEmployeeAccess } from "@/lib/scope";
import { toDbDate } from "@/lib/dates";
import { zDate } from "@/lib/validation";

/** Drill-down: the achievement entries and leads behind one employee's numbers for a day. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(req, z.object({ date: zDate, employeeId: z.string().min(1) }));
  await assertEmployeeAccess(user, q.employeeId);
  const d = toDbDate(q.date);
  const [entries, leads, allocation] = await Promise.all([
    prisma.achievementEntry.findMany({
      where: { date: d, employeeId: q.employeeId, deletedAt: null },
      include: { category: { select: { name: true } }, lead: { select: { id: true, companyName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.lead.findMany({
      where: { leadDate: d, creditedEmployeeId: q.employeeId, deletedAt: null },
      select: { id: true, companyName: true, contactPerson: true, phone: true, email: true, status: true, validation: true, countsTowardTarget: true, mergedIntoId: true, ownerId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.employeeTargetAllocation.findUnique({ where: { date_employeeId: { date: d, employeeId: q.employeeId } } }),
  ]);
  return ok({
    allocation,
    entries,
    leads: leads.map((l) => ({ ...l, counted: l.countsTowardTarget && l.validation === "VALID" && !l.mergedIntoId })),
  });
});
