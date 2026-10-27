import { prisma } from "./db";
import { ApiError } from "./api";
import type { AuthUser } from "./auth/server";

/**
 * Server-side data scoping.
 * - SUPER_ADMIN: everything.
 * - MANAGER: themselves + anyone who has ever been a member of a team they lead (keeps history visible).
 * - EMPLOYEE: themselves only.
 */
export async function scopedEmployeeIds(user: AuthUser): Promise<string[] | "ALL"> {
  if (user.role === "SUPER_ADMIN") return "ALL";
  const ids = new Set<string>();
  if (user.employeeId) ids.add(user.employeeId);
  if (user.role === "MANAGER" && user.ledTeamIds.length) {
    const members = await prisma.teamMembership.findMany({
      where: { teamId: { in: user.ledTeamIds } },
      select: { employeeId: true },
    });
    members.forEach((m) => ids.add(m.employeeId));
  }
  return [...ids];
}

/** Teams the user can manage (assign targets, lock reports). */
export function managedTeamIds(user: AuthUser): string[] | "ALL" {
  if (user.role === "SUPER_ADMIN") return "ALL";
  if (user.role === "MANAGER") return user.ledTeamIds;
  return [];
}

/** Teams whose aggregate progress the user may view (employees see their own team's totals). */
export async function viewableTeamIds(user: AuthUser): Promise<string[] | "ALL"> {
  if (user.role === "SUPER_ADMIN") return "ALL";
  const ids = new Set(user.ledTeamIds);
  if (user.employeeId) {
    const ms = await prisma.teamMembership.findMany({ where: { employeeId: user.employeeId }, select: { teamId: true } });
    ms.forEach((m) => ids.add(m.teamId));
  }
  return [...ids];
}

export async function assertEmployeeAccess(user: AuthUser, employeeId: string) {
  const scope = await scopedEmployeeIds(user);
  if (scope !== "ALL" && !scope.includes(employeeId)) {
    throw new ApiError(403, "You do not have access to this employee's records.");
  }
}

export function assertTeamManage(user: AuthUser, teamId: string) {
  const scope = managedTeamIds(user);
  if (scope !== "ALL" && !scope.includes(teamId)) throw new ApiError(403, "You can only manage teams you lead.");
}

export function inScope(scope: string[] | "ALL", id: string) {
  return scope === "ALL" || scope.includes(id);
}

/** Team an employee belongs to on a given date, from membership history. */
export async function teamOnDate(employeeId: string, date: Date): Promise<string | null> {
  const m = await prisma.teamMembership.findFirst({
    where: { employeeId, startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] },
    orderBy: { startDate: "desc" },
    select: { teamId: true },
  });
  return m?.teamId ?? null;
}

/** Active roster of a team on a given date. */
export async function rosterOnDate(teamId: string, date: Date): Promise<string[]> {
  const ms = await prisma.teamMembership.findMany({
    where: { teamId, startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] },
    select: { employeeId: true },
  });
  return [...new Set(ms.map((m) => m.employeeId))];
}
