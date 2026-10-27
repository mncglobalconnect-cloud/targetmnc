import { prisma } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { managedTeamIds, scopedEmployeeIds, viewableTeamIds } from "@/lib/scope";
import { getSettings } from "@/lib/settings";
import { todayInTz } from "@/lib/dates";

/** Session user + scoped lookup lists for forms and filters. */
export const GET = route(async () => {
  const user = await requireUser();
  const settings = await getSettings();
  const empScope = await scopedEmployeeIds(user);
  const teamScope = await viewableTeamIds(user);
  const manageable = managedTeamIds(user);

  const [employees, teams, departments, categories] = await Promise.all([
    prisma.employee.findMany({
      where: { archivedAt: null, ...(empScope === "ALL" ? {} : { id: { in: empScope } }) },
      select: { id: true, name: true, code: true, active: true, departmentId: true, user: { select: { role: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.team.findMany({
      where: { archivedAt: null, ...(teamScope === "ALL" ? {} : { id: { in: teamScope } }) },
      select: { id: true, name: true, active: true, leaderId: true, departmentId: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.achievementCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return ok({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      ledTeamIds: user.ledTeamIds,
    },
    today: todayInTz(settings.timezone),
    timezone: settings.timezone,
    permissions: settings.permissions,
    workday: { start: settings.workdayStart, end: settings.workdayEnd },
    employees: employees.map((e) => ({ id: e.id, name: e.name, code: e.code, active: e.active, departmentId: e.departmentId, role: e.user?.role ?? null })),
    teams: teams.map((t) => ({ ...t, manageable: manageable === "ALL" || manageable.includes(t.id) })),
    departments,
    categories: categories.map((c) => ({ id: c.id, code: c.code, name: c.name, countsTowardTarget: c.countsTowardTarget })),
    storage: { provider: "mongodb" },
  });
});
