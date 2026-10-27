import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, clientIp, ok, parseBody, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { getSettings, isWorkingDay } from "@/lib/settings";
import { eachDate, toDbDate } from "@/lib/dates";
import { teamOnDate } from "@/lib/scope";
import { assertEditable } from "@/lib/locks";
import { audit } from "@/lib/audit";
import { assertAssignableEmployee, assertCanAssign, assertWithinLimit } from "@/lib/targets";
import { zCount, zDate, zMoney, zReason, zText } from "@/lib/validation";

const schema = z
  .object({
    from: zDate,
    to: zDate,
    skipNonWorking: z.boolean().default(true),
    overwrite: z.boolean().default(false),
    reason: zReason,
    entries: z
      .array(z.object({ employeeId: z.string().min(1), monetaryTarget: zMoney, leadTarget: zCount, notes: zText(500) }))
      .min(1, "Select at least one employee")
      .max(300),
  })
  .refine((b) => b.from <= b.to, { message: "End date must be on or after the start date", path: ["to"] });

/** Create / update (bulk) individual daily targets — one allocation per employee per date. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const settings = await getSettings();
  await assertCanAssign(user, settings);
  const body = await parseBody(req, schema);
  const dates = eachDate(body.from, body.to);
  if (dates.length > 62) throw new ApiError(400, "Bulk assignment is limited to 62 days at a time.");

  const ip = clientIp(req);
  const result = { created: 0, updated: 0, skipped: [] as { date: string; employeeId: string; reason: string }[] };

  const employees = await prisma.employee.findMany({ where: { id: { in: body.entries.map((e) => e.employeeId) } } });
  const empById = new Map(employees.map((e) => [e.id, e]));

  // Phase 1: validate everything (authorization, limits, locks) before writing anything.
  type Planned = {
    date: string;
    entry: (typeof body.entries)[number];
    emp: (typeof employees)[number];
    teamId: string | null;
    existing: Awaited<ReturnType<typeof prisma.employeeTargetAllocation.findUnique>>;
    correction: boolean;
  };
  const planned: Planned[] = [];
  for (const date of dates) {
    const wd = isWorkingDay(date, settings);
    if (!wd.working && body.skipNonWorking) {
      body.entries.forEach((e) => result.skipped.push({ date, employeeId: e.employeeId, reason: wd.reason ?? "Non-working day" }));
      continue;
    }
    const d = toDbDate(date);
    for (const entry of body.entries) {
      const emp = empById.get(entry.employeeId);
      if (!emp || !emp.active) {
        result.skipped.push({ date, employeeId: entry.employeeId, reason: "Employee not found or inactive" });
        continue;
      }
      const teamId = await teamOnDate(emp.id, d);
      await assertAssignableEmployee(user, emp.id, teamId);
      assertWithinLimit(user, settings, entry.monetaryTarget, emp.name);

      const existing = await prisma.employeeTargetAllocation.findUnique({ where: { date_employeeId: { date: d, employeeId: emp.id } } });
      if (existing && !body.overwrite) {
        result.skipped.push({ date, employeeId: emp.id, reason: "Target already exists (enable overwrite to replace)" });
        continue;
      }
      const correction = await assertEditable({ user, date, employeeId: emp.id, teamId, reason: body.reason });
      planned.push({ date, entry, emp, teamId, existing, correction });
    }
  }

  // Phase 2: write all allocations atomically.
  await prisma.$transaction(async (tx) => {
    for (const { date, entry, emp, teamId, existing, correction } of planned) {
      const d = toDbDate(date);
      {
        const saved = existing
          ? await tx.employeeTargetAllocation.update({
              where: { id: existing.id },
              data: { monetaryTarget: entry.monetaryTarget, leadTarget: entry.leadTarget, notes: entry.notes ?? existing.notes, updatedById: user.id },
            })
          : await tx.employeeTargetAllocation.create({
              data: {
                date: d,
                employeeId: emp.id,
                teamId,
                departmentId: emp.departmentId,
                monetaryTarget: entry.monetaryTarget,
                leadTarget: entry.leadTarget,
                notes: entry.notes ?? null,
                assignedById: user.id,
              },
            });
        await audit(
          {
            actorId: user.id,
            action: correction ? "TARGET_CORRECTED_AFTER_LOCK" : existing ? "TARGET_UPDATED" : "TARGET_ASSIGNED",
            entityType: "EmployeeTargetAllocation",
            entityId: saved.id,
            before: existing,
            after: saved,
            reason: body.reason,
            ip,
          },
          tx,
        );
      }
      if (existing) result.updated++;
      else result.created++;
    }
  }, { timeout: 60_000 });
  return ok(result);
});
