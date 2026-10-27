import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { managedTeamIds, scopedEmployeeIds, viewableTeamIds } from "@/lib/scope";
import { getSettings, isWorkingDay } from "@/lib/settings";
import { toDbDate } from "@/lib/dates";
import { validateAllocation } from "@/lib/calc";
import { zDate } from "@/lib/validation";
import { lockState } from "@/lib/locks";

/** Targets for one date: individual allocations, team plans with validation, and employees missing targets. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const { date } = parseQuery(req, z.object({ date: zDate }));
  const settings = await getSettings();
  const d = toDbDate(date);
  const empScope = await scopedEmployeeIds(user);
  const teamScope = await viewableTeamIds(user);
  const manageable = managedTeamIds(user);

  const [allocations, plans, activeEmployees, rosters] = await Promise.all([
    prisma.employeeTargetAllocation.findMany({
      where: { date: d, ...(empScope === "ALL" ? {} : { employeeId: { in: empScope } }) },
      include: { employee: { select: { name: true, code: true } }, team: { select: { name: true } } },
      orderBy: { employee: { name: "asc" } },
    }),
    prisma.teamTargetPlan.findMany({
      where: { date: d, ...(teamScope === "ALL" ? {} : { teamId: { in: teamScope } }) },
      include: { team: { select: { name: true } } },
    }),
    prisma.employee.findMany({
      where: { active: true, archivedAt: null, ...(empScope === "ALL" ? {} : { id: { in: empScope } }), NOT: { user: { role: "SUPER_ADMIN" } } },
      select: { id: true, name: true, code: true, user: { select: { role: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.teamMembership.findMany({
      where: { startDate: { lte: d }, OR: [{ endDate: null }, { endDate: { gte: d } }] },
      select: { teamId: true, employeeId: true },
    }),
  ]);

  const withAlloc = new Set(allocations.map((a) => a.employeeId));
  const teamOf = new Map(rosters.map((r) => [r.employeeId, r.teamId]));
  const lock = await lockState(date, null, null);

  return ok({
    date,
    working: isWorkingDay(date, settings),
    companyLocked: lock.locked,
    allocations: allocations.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: a.employee.name,
      employeeCode: a.employee.code,
      teamId: a.teamId,
      teamName: a.team?.name ?? null,
      teamPlanId: a.teamPlanId,
      monetaryTarget: a.monetaryTarget,
      leadTarget: a.leadTarget,
      notes: a.notes,
      updatedAt: a.updatedAt,
    })),
    teamPlans: plans.map((p) => {
      const members = allocations.filter((a) => a.teamPlanId === p.id);
      const v = validateAllocation({
        mode: p.mode,
        teamTarget: p.monetaryTarget,
        teamLeadTarget: p.leadTarget,
        allocations: members,
        allowUnallocated: p.allowUnallocated,
      });
      return {
        id: p.id,
        teamId: p.teamId,
        teamName: p.team.name,
        mode: p.mode,
        monetaryTarget: p.monetaryTarget,
        leadTarget: p.leadTarget,
        allowUnallocated: p.allowUnallocated,
        notes: p.notes,
        manageable: manageable === "ALL" || manageable.includes(p.teamId),
        allocations: members.map((a) => ({ employeeId: a.employeeId, employeeName: a.employee.name, monetaryTarget: a.monetaryTarget, leadTarget: a.leadTarget })),
        validation: { ...v, allocatedTarget: v.allocatedTarget.toFixed(2), unallocatedTarget: v.unallocatedTarget.toFixed(2) },
      };
    }),
    missing: activeEmployees
      // Managers only need a target when they are also a team member that day.
      .filter((e) => !withAlloc.has(e.id) && !(e.user?.role === "MANAGER" && !teamOf.has(e.id)))
      .map((e) => ({ id: e.id, name: e.name, code: e.code, teamId: teamOf.get(e.id) ?? null })),
    totals: {
      // Company totals come from individual allocations only — team plans are never added on top.
      monetaryTarget: allocations.reduce((s, a) => s.plus(a.monetaryTarget), new Prisma.Decimal(0)).toFixed(2),
      leadTarget: allocations.reduce((s, a) => s + a.leadTarget, 0),
    },
  });
});
