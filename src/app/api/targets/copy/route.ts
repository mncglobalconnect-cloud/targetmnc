import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { getSettings, isWorkingDay } from "@/lib/settings";
import { eachDate, toDbDate } from "@/lib/dates";
import { managedTeamIds, rosterOnDate, teamOnDate } from "@/lib/scope";
import { lockState } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { assertAssignableEmployee, assertCanAssign } from "@/lib/targets";
import { zDate } from "@/lib/validation";

const schema = z.object({
  sourceDate: zDate,
  from: zDate,
  to: zDate,
  teamId: z.string().nullable().optional(),
  overwrite: z.boolean().default(false),
  skipNonWorking: z.boolean().default(true),
});

/** Copy a day's targets (individual allocations and team plans) to a date range. Locked days are skipped. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const settings = await getSettings();
  await assertCanAssign(user, settings);
  const body = await parseBody(req, schema);
  if (body.from > body.to) throw new ApiError(400, "End date must be on or after start date.");
  const targets = eachDate(body.from, body.to).filter((d) => d !== body.sourceDate);
  if (targets.length > 62) throw new ApiError(400, "Copy is limited to 62 days at a time.");

  const managed = managedTeamIds(user);
  const src = toDbDate(body.sourceDate);
  const plans = await prisma.teamTargetPlan.findMany({
    where: { date: src, ...(body.teamId ? { teamId: body.teamId } : {}), ...(managed === "ALL" ? {} : { teamId: { in: managed } }) },
  });
  const allocations = await prisma.employeeTargetAllocation.findMany({
    where: { date: src, ...(body.teamId ? { teamId: body.teamId } : {}) },
    include: { employee: true },
  });
  const copyable: typeof allocations = [];
  for (const a of allocations) {
    try {
      await assertAssignableEmployee(user, a.employeeId, a.teamId);
      copyable.push(a);
    } catch {
      /* out of scope — skip silently */
    }
  }
  if (!copyable.length && !plans.length) throw new ApiError(404, "No targets found on the source date to copy.");

  let created = 0;
  let updated = 0;
  const skipped: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      for (const date of targets) {
        if (body.skipNonWorking && !isWorkingDay(date, settings).working) {
          skipped.push(`${date}: non-working day`);
          continue;
        }
        if ((await lockState(date, null, null)).locked) {
          skipped.push(`${date}: company report locked`);
          continue;
        }
        const d = toDbDate(date);
        const planIdMap = new Map<string, string>();
        for (const p of plans) {
          if ((await lockState(date, null, p.teamId)).locked) {
            skipped.push(`${date}: team report locked`);
            continue;
          }
          const exists = await tx.teamTargetPlan.findUnique({ where: { date_teamId: { date: d, teamId: p.teamId } } });
          if (exists && !body.overwrite) {
            planIdMap.set(p.id, exists.id);
            continue;
          }
          const roster = await rosterOnDate(p.teamId, d);
          const saved = await tx.teamTargetPlan.upsert({
            where: { date_teamId: { date: d, teamId: p.teamId } },
            create: { date: d, teamId: p.teamId, mode: p.mode, monetaryTarget: p.monetaryTarget, leadTarget: p.leadTarget, allowUnallocated: p.allowUnallocated, memberSnapshot: roster, notes: p.notes, assignedById: user.id },
            update: { mode: p.mode, monetaryTarget: p.monetaryTarget, leadTarget: p.leadTarget, allowUnallocated: p.allowUnallocated, memberSnapshot: roster, notes: p.notes, updatedById: user.id },
          });
          planIdMap.set(p.id, saved.id);
        }
        for (const a of copyable) {
          if (!a.employee.active) continue;
          const teamId = await teamOnDate(a.employeeId, d);
          if ((await lockState(date, a.employeeId, teamId)).locked) continue;
          const exists = await tx.employeeTargetAllocation.findUnique({ where: { date_employeeId: { date: d, employeeId: a.employeeId } } });
          if (exists && !body.overwrite) continue;
          const teamPlanId = a.teamPlanId && teamId === a.teamId ? planIdMap.get(a.teamPlanId) ?? null : null;
          await tx.employeeTargetAllocation.upsert({
            where: { date_employeeId: { date: d, employeeId: a.employeeId } },
            create: { date: d, employeeId: a.employeeId, teamId, teamPlanId, departmentId: a.employee.departmentId, monetaryTarget: a.monetaryTarget, leadTarget: a.leadTarget, notes: a.notes, assignedById: user.id },
            update: { teamId, teamPlanId, monetaryTarget: a.monetaryTarget, leadTarget: a.leadTarget, notes: a.notes, updatedById: user.id },
          });
          if (exists) updated++;
          else created++;
        }
      }
      await audit(
        { actorId: user.id, action: "TARGETS_COPIED", entityType: "EmployeeTargetAllocation", after: { ...body, created, updated, skipped }, ip: clientIp(req) },
        tx,
      );
    },
    { timeout: 120_000 },
  );
  return ok({ created, updated, skipped });
});
