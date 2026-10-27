import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { viewableTeamIds } from "@/lib/scope";
import { audit } from "@/lib/audit";
import { addMember } from "@/lib/teams";
import { todayInTz } from "@/lib/dates";
import { zDate } from "@/lib/validation";

export const GET = route(async (req) => {
  const user = await requireUser();
  const scope = await viewableTeamIds(user);
  const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
  const teams = await prisma.team.findMany({
    where: { ...(includeArchived ? {} : { archivedAt: null }), ...(scope === "ALL" ? {} : { id: { in: scope } }) },
    include: {
      department: true,
      leader: { select: { id: true, name: true, code: true } },
      memberships: {
        orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }],
        include: { employee: { select: { id: true, name: true, code: true, designation: true, active: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return ok(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      archivedAt: t.archivedAt,
      createdAt: t.createdAt,
      department: t.department ? { id: t.department.id, name: t.department.name } : null,
      leader: t.leader,
      members: t.memberships
        .filter((m) => !m.endDate)
        .map((m) => ({ membershipId: m.id, ...m.employee, since: m.startDate.toISOString().slice(0, 10) })),
      history: t.memberships
        .filter((m) => m.endDate)
        .map((m) => ({
          membershipId: m.id,
          ...m.employee,
          since: m.startDate.toISOString().slice(0, 10),
          until: m.endDate!.toISOString().slice(0, 10),
        })),
    })),
  );
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  departmentId: z.string().nullable().optional(),
  leaderId: z.string().nullable().optional(),
  memberIds: z.array(z.string()).max(200).default([]),
  effectiveDate: zDate.optional(),
});

export const POST = route(async (req) => {
  const user = await requireUser(["SUPER_ADMIN"]);
  const body = await parseBody(req, createSchema);
  const effective = body.effectiveDate ?? todayInTz();
  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.team.create({
      data: { name: body.name, departmentId: body.departmentId || null, leaderId: body.leaderId || null, createdById: user.id },
    });
    for (const empId of new Set(body.memberIds)) await addMember(tx, t.id, empId, effective, user.id);
    await audit({ actorId: user.id, action: "TEAM_CREATED", entityType: "Team", entityId: t.id, after: { ...t, memberIds: body.memberIds, effective }, ip: clientIp(req) }, tx);
    return t;
  });
  return ok(team, { status: 201 });
});
