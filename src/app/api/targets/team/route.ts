import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { getSettings, isWorkingDay } from "@/lib/settings";
import { toDbDate } from "@/lib/dates";
import { assertTeamManage, rosterOnDate } from "@/lib/scope";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { validateAllocation } from "@/lib/calc";
import { assertCanAssign, assertWithinLimit } from "@/lib/targets";
import { zCount, zDate, zMoney, zReason, zText } from "@/lib/validation";

const schema = z.object({
  date: zDate,
  teamId: z.string().min(1),
  mode: z.enum(["ALLOCATED", "INDEPENDENT"]),
  monetaryTarget: zMoney,
  leadTarget: zCount,
  allowUnallocated: z.boolean().default(false),
  notes: zText(1000),
  reason: zReason,
  dryRun: z.boolean().default(false),
  /** Full set of individual allocations for this team & date. Members omitted here lose their plan allocation. */
  allocations: z.array(z.object({ employeeId: z.string().min(1), monetaryTarget: zMoney, leadTarget: zCount })).max(200),
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const settings = await getSettings();
  await assertCanAssign(user, settings);
  const body = await parseBody(req, schema);
  assertTeamManage(user, body.teamId);

  const d = toDbDate(body.date);
  const team = await prisma.team.findUnique({ where: { id: body.teamId } });
  if (!team || team.archivedAt) throw new ApiError(404, "Team not found.");

  const roster = await rosterOnDate(body.teamId, d);
  const outside = body.allocations.filter((a) => !roster.includes(a.employeeId));
  if (outside.length) throw new ApiError(400, "Some selected employees are not members of this team on the selected date.", { employeeIds: outside.map((o) => o.employeeId) });
  if (new Set(body.allocations.map((a) => a.employeeId)).size !== body.allocations.length) throw new ApiError(400, "Each employee can be allocated only once.");

  const employees = await prisma.employee.findMany({ where: { id: { in: roster } } });
  const empById = new Map(employees.map((e) => [e.id, e]));
  body.allocations.forEach((a) => assertWithinLimit(user, settings, a.monetaryTarget, empById.get(a.employeeId)?.name ?? "employee"));

  const validation = validateAllocation({
    mode: body.mode,
    teamTarget: new Prisma.Decimal(body.monetaryTarget),
    teamLeadTarget: body.leadTarget,
    allocations: body.allocations.map((a) => ({ monetaryTarget: new Prisma.Decimal(a.monetaryTarget), leadTarget: a.leadTarget })),
    allowUnallocated: body.allowUnallocated,
  });
  const wd = isWorkingDay(body.date, settings);
  const warnings = [...validation.warnings];
  if (!wd.working) warnings.push(`${body.date} is a non-working day (${wd.reason}).`);
  const unallocatedMembers = roster.filter((id) => !body.allocations.some((a) => a.employeeId === id));
  if (unallocatedMembers.length) warnings.push(`${unallocatedMembers.length} team member(s) have no allocation: ${unallocatedMembers.map((id) => empById.get(id)?.name).join(", ")}.`);

  const preview = {
    ...validation,
    warnings,
    allocatedTarget: validation.allocatedTarget.toFixed(2),
    unallocatedTarget: validation.unallocatedTarget.toFixed(2),
    roster: roster.map((id) => ({ id, name: empById.get(id)?.name ?? id })),
  };
  if (body.dryRun) return ok({ preview });
  if (!validation.ok) throw new ApiError(400, validation.errors[0], { preview });

  // Lock checks for the team and every affected member.
  let correction = await assertEditable({ user, date: body.date, employeeId: null, teamId: body.teamId, reason: body.reason });
  for (const a of body.allocations) {
    correction = (await assertEditable({ user, date: body.date, employeeId: a.employeeId, teamId: body.teamId, reason: body.reason })) || correction;
  }

  const ip = clientIp(req);
  const plan = await prisma.$transaction(async (tx) => {
    const before = await tx.teamTargetPlan.findUnique({ where: { date_teamId: { date: d, teamId: body.teamId } }, include: { allocations: true } });
    const saved = await tx.teamTargetPlan.upsert({
      where: { date_teamId: { date: d, teamId: body.teamId } },
      create: {
        date: d,
        teamId: body.teamId,
        mode: body.mode,
        monetaryTarget: body.monetaryTarget,
        leadTarget: body.leadTarget,
        allowUnallocated: body.allowUnallocated,
        memberSnapshot: roster,
        notes: body.notes ?? null,
        assignedById: user.id,
      },
      update: {
        mode: body.mode,
        monetaryTarget: body.monetaryTarget,
        leadTarget: body.leadTarget,
        allowUnallocated: body.allowUnallocated,
        memberSnapshot: roster,
        notes: body.notes ?? null,
        updatedById: user.id,
      },
    });

    // Remove plan allocations for members no longer included.
    const keep = new Set(body.allocations.map((a) => a.employeeId));
    for (const old of before?.allocations ?? []) {
      if (!keep.has(old.employeeId)) {
        await tx.employeeTargetAllocation.delete({ where: { id: old.id } });
      }
    }
    for (const a of body.allocations) {
      const emp = empById.get(a.employeeId)!;
      await tx.employeeTargetAllocation.upsert({
        where: { date_employeeId: { date: d, employeeId: a.employeeId } },
        create: {
          date: d,
          employeeId: a.employeeId,
          teamId: body.teamId,
          teamPlanId: saved.id,
          departmentId: emp.departmentId,
          monetaryTarget: a.monetaryTarget,
          leadTarget: a.leadTarget,
          assignedById: user.id,
        },
        update: { teamId: body.teamId, teamPlanId: saved.id, monetaryTarget: a.monetaryTarget, leadTarget: a.leadTarget, updatedById: user.id },
      });
    }
    await audit(
      {
        actorId: user.id,
        action: correction ? "TEAM_TARGET_CORRECTED_AFTER_LOCK" : before ? "TEAM_TARGET_UPDATED" : "TEAM_TARGET_ASSIGNED",
        entityType: "TeamTargetPlan",
        entityId: saved.id,
        before,
        after: { ...saved, allocations: body.allocations },
        reason: body.reason,
        ip,
      },
      tx,
    );
    return saved;
  });
  return ok({ plan, preview });
});
