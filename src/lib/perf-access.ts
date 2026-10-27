import { prisma } from "./db";
import { ApiError } from "./api";
import type { AuthUser } from "./auth/server";
import { buildPerformance, type PerformanceResult } from "./performance";
import { scopedEmployeeIds, viewableTeamIds } from "./scope";

export interface ScopedPerfQuery {
  from: string;
  to: string;
  teamId?: string | null;
  departmentId?: string | null;
  employeeId?: string | null;
  includeIdle?: boolean;
}

/**
 * Performance scoped to the user. Employees get only their own rows plus aggregate totals for
 * their team(s) — never other employees' individual figures.
 */
export async function scopedPerformance(user: AuthUser, q: ScopedPerfQuery): Promise<PerformanceResult> {
  if (q.from > q.to) throw new ApiError(400, "Start date must be on or before end date.");
  const scope = await scopedEmployeeIds(user);
  if (q.employeeId && scope !== "ALL" && !scope.includes(q.employeeId)) throw new ApiError(403, "No access to this employee.");
  if (q.teamId) {
    const teams = await viewableTeamIds(user);
    if (teams !== "ALL" && !teams.includes(q.teamId)) throw new ApiError(403, "No access to this team.");
  }

  if (user.role !== "EMPLOYEE") {
    return buildPerformance({
      from: q.from,
      to: q.to,
      employeeIds: q.employeeId ? [q.employeeId] : scope,
      teamId: q.teamId,
      departmentId: q.departmentId,
      includeIdle: q.includeIdle,
    });
  }

  const self = user.employeeId ? [user.employeeId] : [];
  const own = await buildPerformance({ from: q.from, to: q.to, employeeIds: self, includeIdle: q.includeIdle });
  const teamIds = await viewableTeamIds(user);
  if (teamIds !== "ALL" && teamIds.length) {
    const members = await prisma.teamMembership.findMany({ where: { teamId: { in: teamIds } }, select: { employeeId: true } });
    const team = await buildPerformance({ from: q.from, to: q.to, employeeIds: [...new Set(members.map((m) => m.employeeId))] });
    own.byTeam = team.byTeam.filter((t) => teamIds.includes(t.teamId));
  }
  return own;
}
