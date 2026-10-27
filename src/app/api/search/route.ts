import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedEmployeeIds, viewableTeamIds } from "@/lib/scope";
import { leadScopeWhere } from "@/lib/lead-access";

/** Global header search across leads, employees and teams (scoped to what the user can see). */
export const GET = route(async (req) => {
  const user = await requireUser();
  const { q } = parseQuery(req, z.object({ q: z.string().trim().min(2).max(100) }));
  const emp = await scopedEmployeeIds(user);
  const teams = await viewableTeamIds(user);
  const digits = q.replace(/\D/g, "");
  const [leads, employees, teamRows] = await Promise.all([
    prisma.lead.findMany({
      where: {
        AND: [
          await leadScopeWhere(user),
          { deletedAt: null, mergedIntoId: null },
          { OR: [{ companyName: { contains: q, mode: "insensitive" } }, { contactPerson: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phoneNorm: { contains: digits } }] : [])] },
        ],
      },
      select: { id: true, companyName: true, contactPerson: true, status: true },
      take: 6,
    }),
    prisma.employee.findMany({
      where: { archivedAt: null, ...(emp === "ALL" ? {} : { id: { in: emp } }), OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] },
      select: { id: true, name: true, code: true },
      take: 5,
    }),
    prisma.team.findMany({
      where: { archivedAt: null, ...(teams === "ALL" ? {} : { id: { in: teams } }), name: { contains: q, mode: "insensitive" } },
      select: { id: true, name: true },
      take: 5,
    }),
  ]);
  return ok({ leads, employees, teams: teamRows });
});
