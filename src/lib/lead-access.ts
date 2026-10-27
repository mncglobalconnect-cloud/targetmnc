import type { Lead, Prisma } from "@prisma/client";
import { ApiError } from "./api";
import type { AuthUser } from "./auth/server";
import { managedTeamIds, scopedEmployeeIds } from "./scope";

/** Prisma filter restricting leads to what the user may see. */
export async function leadScopeWhere(user: AuthUser): Promise<Prisma.LeadWhereInput> {
  if (user.role === "SUPER_ADMIN") return {};
  if (user.role === "EMPLOYEE") {
    const me = user.employeeId ?? "__none__";
    return { OR: [{ ownerId: me }, { creditedEmployeeId: me }] };
  }
  const scope = await scopedEmployeeIds(user);
  const teams = managedTeamIds(user);
  const ids = scope === "ALL" ? [] : scope;
  return {
    OR: [
      { ownerId: { in: ids } },
      { creditedEmployeeId: { in: ids } },
      ...(teams !== "ALL" && teams.length ? [{ teamId: { in: teams } }] : []),
    ],
  };
}

export async function assertLeadAccess(user: AuthUser, lead: Pick<Lead, "ownerId" | "creditedEmployeeId" | "teamId">) {
  if (user.role === "SUPER_ADMIN") return;
  if (user.role === "EMPLOYEE") {
    if (lead.ownerId === user.employeeId || lead.creditedEmployeeId === user.employeeId) return;
    throw new ApiError(403, "You do not have access to this lead.");
  }
  const scope = await scopedEmployeeIds(user);
  const teams = managedTeamIds(user);
  const okEmp = scope === "ALL" || scope.includes(lead.ownerId) || scope.includes(lead.creditedEmployeeId);
  const okTeam = teams === "ALL" || (lead.teamId ? teams.includes(lead.teamId) : false);
  if (!okEmp && !okTeam) throw new ApiError(403, "You do not have access to this lead.");
}
