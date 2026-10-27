import { Prisma } from "@prisma/client";
import { ApiError } from "./api";
import type { AuthUser } from "./auth/server";
import type { AppSettings } from "./settings-schema";
import { managedTeamIds, scopedEmployeeIds } from "./scope";

/** Who may assign targets and within what limits. Employees can never change targets. */
export async function assertCanAssign(user: AuthUser, settings: AppSettings) {
  if (user.role === "EMPLOYEE") throw new ApiError(403, "Employees cannot assign or change targets.");
  if (user.role === "MANAGER" && !settings.permissions.managersCanAssignTargets) {
    throw new ApiError(403, "Managers are not permitted to assign targets. Contact a Super Admin.");
  }
}

export async function assertAssignableEmployee(user: AuthUser, employeeId: string, teamIdOnDate: string | null) {
  if (user.role === "SUPER_ADMIN") return;
  const managed = managedTeamIds(user);
  const scope = await scopedEmployeeIds(user);
  const okTeam = teamIdOnDate && managed !== "ALL" && managed.includes(teamIdOnDate);
  const okScope = scope === "ALL" || scope.includes(employeeId);
  if (!okTeam && !okScope) throw new ApiError(403, "You can only assign targets to members of teams you lead.");
}

export function assertWithinLimit(user: AuthUser, settings: AppSettings, amount: Prisma.Decimal.Value, who: string) {
  const max = settings.permissions.managerMaxDailyTarget;
  if (user.role === "MANAGER" && max !== null && new Prisma.Decimal(amount).gt(max)) {
    throw new ApiError(403, `Target for ${who} exceeds the manager limit of ₹${max.toLocaleString("en-IN")} per day.`);
  }
}
