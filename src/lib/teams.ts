import type { Prisma } from "@prisma/client";
import { addDays, toDbDate } from "./dates";

/**
 * Adds an employee to a team from `effective` (inclusive). An employee belongs to one team at a time,
 * so any other open membership is closed the day before — history rows are kept, never deleted,
 * unless they would end before they started.
 */
export async function addMember(tx: Prisma.TransactionClient, teamId: string, employeeId: string, effective: string, actorId: string) {
  const open = await tx.teamMembership.findMany({ where: { employeeId, endDate: null } });
  for (const m of open) {
    if (m.teamId === teamId) return m; // already a member
    await closeMembership(tx, m.id, m.startDate, effective);
  }
  return tx.teamMembership.create({ data: { teamId, employeeId, startDate: toDbDate(effective), createdById: actorId } });
}

/** Ends a membership so the last day in the team is the day before `effective`. */
export async function closeMembership(tx: Prisma.TransactionClient, membershipId: string, startDate: Date, effective: string) {
  const lastDay = addDays(effective, -1);
  if (toDbDate(lastDay) < startDate) {
    await tx.teamMembership.delete({ where: { id: membershipId } }); // never effective
  } else {
    await tx.teamMembership.update({ where: { id: membershipId }, data: { endDate: toDbDate(lastDay) } });
  }
}
