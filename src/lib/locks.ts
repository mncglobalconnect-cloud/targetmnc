import { prisma } from "./db";
import { ApiError } from "./api";
import type { AuthUser } from "./auth/server";
import { toDbDate } from "./dates";

export interface LockState {
  locked: boolean;
  by?: "COMPANY" | "TEAM" | "EMPLOYEE";
}

/**
 * A date is locked for an employee when the company day is locked, the employee's team report
 * for that day is locked, or the employee has submitted their end-of-day report (and it was not reopened).
 */
export async function lockState(date: string, employeeId: string | null, teamId: string | null): Promise<LockState> {
  const keys = ["COMPANY"];
  if (teamId) keys.push(`TEAM:${teamId}`);
  if (employeeId) keys.push(`EMP:${employeeId}`);
  const subs = await prisma.dailyReportSubmission.findMany({
    where: { date: toDbDate(date), scopeKey: { in: keys }, status: { in: ["LOCKED", "SUBMITTED"] } },
    select: { scope: true, status: true },
  });
  const company = subs.find((s) => s.scope === "COMPANY" && s.status === "LOCKED");
  if (company) return { locked: true, by: "COMPANY" };
  const team = subs.find((s) => s.scope === "TEAM" && s.status === "LOCKED");
  if (team) return { locked: true, by: "TEAM" };
  const emp = subs.find((s) => s.scope === "EMPLOYEE");
  if (emp) return { locked: true, by: "EMPLOYEE" };
  return { locked: false };
}

/**
 * Guards writes that affect a day's numbers. Returns true when the write is a post-submission
 * correction (caller must record it in the audit log with the supplied reason).
 */
export async function assertEditable(opts: {
  user: AuthUser;
  date: string;
  employeeId: string | null;
  teamId: string | null;
  reason?: string | null;
}): Promise<boolean> {
  const state = await lockState(opts.date, opts.employeeId, opts.teamId);
  if (!state.locked) return false;
  if (opts.user.role === "EMPLOYEE") {
    throw new ApiError(423, "The report for this date has been submitted and is locked. Ask your manager to make a correction.");
  }
  if (state.by === "COMPANY" && opts.user.role !== "SUPER_ADMIN") {
    throw new ApiError(423, "The company report for this date is locked. Only a Super Admin can correct it.");
  }
  if (!opts.reason || opts.reason.trim().length < 5) {
    throw new ApiError(428, "This date's report is locked. Provide a correction reason (min. 5 characters) to proceed.", { requiresReason: true });
  }
  return true;
}
