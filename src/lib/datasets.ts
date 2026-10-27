// Tabular datasets used by Excel and CSV exports. Every row's first column is a stable
// identifier derived from persistent record IDs.
import { prisma } from "./db";
import { buildPerformance } from "./performance";
import { endOfMonth, fromDbDate, startOfMonth, toDbDate } from "./dates";

export const SHEET_CATEGORIES = [
  "Daily_Summary",
  "Employee_Targets",
  "Team_Targets",
  "Achievement_Entries",
  "Lead_Records",
  "Employee_Master",
  "Team_Master",
  "Monthly_Reports",
  "Audit_Log",
] as const;
export type SheetCategory = (typeof SHEET_CATEGORIES)[number];

export type Cell = string | number | boolean | null;
export interface Dataset {
  columns: string[];
  rows: Cell[][];
}

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function buildDataset(category: SheetCategory, from: string, to: string, employeeIds: string[] | "ALL" = "ALL"): Promise<Dataset> {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const empWhere = employeeIds === "ALL" ? {} : { employeeId: { in: employeeIds } };

  switch (category) {
    case "Daily_Summary": {
      const perf = await buildPerformance({ from, to, employeeIds });
      return {
        columns: ["ID", "Date", "Working Day", "Assigned Target", "Achieved", "Remaining Target", "Achievement %", "Lead Target", "Leads Generated", "Remaining Leads", "Lead Achievement %"],
        rows: perf.byDate.map((d) => [`day:${d.date}`, d.date, d.working ? "Yes" : "No", n(d.target), n(d.achieved), n(d.balance), d.pct, d.leadTarget, d.leads, d.leadBalance, d.leadPct]),
      };
    }
    case "Employee_Targets": {
      const perf = await buildPerformance({ from, to, employeeIds });
      return {
        columns: ["ID", "Date", "Employee Code", "Employee", "Team", "Department", "Assigned Target", "Achieved", "Remaining Target", "Achievement %", "Lead Target", "Leads Added", "Remaining Leads", "Lead Achievement %", "Status", "Submission", "Non-qualifying Value"],
        rows: perf.rows.map((r) => [
          `${r.date}:${r.employeeId}`, r.date, r.employeeCode, r.employeeName, r.teamName, r.departmentName,
          n(r.target), n(r.achieved), n(r.balance), r.pct, r.leadTarget, r.leads, r.leadBalance, r.leadPct, r.status, r.submissionStatus, n(r.nonQualifying),
        ]),
      };
    }
    case "Team_Targets": {
      const dates: string[] = [];
      for (let d = from; d <= to; d = fromDbDate(new Date(toDbDate(d).getTime() + 86_400_000))) dates.push(d);
      const rows: Cell[][] = [];
      for (const d of dates) {
        const perf = await buildPerformance({ from: d, to: d, employeeIds });
        for (const t of perf.byTeam) {
          rows.push([`${d}:${t.teamId}`, d, t.teamName, t.modes.join(", ") || "Sum of members", n(t.goalTarget), n(t.memberTarget), n(t.achieved), n(t.goalBalance), t.goalPct, t.goalLeadTarget, t.memberLeadTarget, t.leads, t.goalLeadBalance, t.goalLeadPct, t.memberCount]);
        }
      }
      return {
        columns: ["ID", "Date", "Team", "Mode", "Team Target", "Allocated to Members", "Achieved", "Remaining", "Achievement %", "Team Lead Target", "Allocated Leads", "Leads Generated", "Remaining Leads", "Lead %", "Members"],
        rows,
      };
    }
    case "Achievement_Entries": {
      const entries = await prisma.achievementEntry.findMany({
        where: { date: range, ...empWhere },
        include: { employee: true, team: true, category: true, lead: { select: { companyName: true } } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });
      return {
        columns: ["ID", "Date", "Employee Code", "Employee", "Team", "Category", "Counts Toward Target", "Amount", "Description", "Related Lead", "Reference No", "Notes", "Status", "Created At", "Updated At"],
        rows: entries.map((e) => [
          e.id, fromDbDate(e.date), e.employee.code, e.employee.name, e.team?.name ?? null, e.category.name, e.countsTowardTarget ? "Yes" : "No",
          Number(e.amount), e.description, e.lead?.companyName ?? null, e.referenceNo, e.notes, e.deletedAt ? "VOIDED" : "ACTIVE", e.createdAt.toISOString(), e.updatedAt.toISOString(),
        ]),
      };
    }
    case "Lead_Records": {
      const leads = await prisma.lead.findMany({
        where: { leadDate: range, ...(employeeIds === "ALL" ? {} : { OR: [{ ownerId: { in: employeeIds } }, { creditedEmployeeId: { in: employeeIds } }] }) },
        include: { owner: true, creditedEmployee: true, team: true },
        orderBy: [{ leadDate: "asc" }, { createdAt: "asc" }],
      });
      return {
        columns: ["ID", "Lead Date", "Company", "Contact Person", "Email", "Phone", "Alt Phone", "Website", "Industry", "Source", "Status", "Estimated Value", "Converted Value", "Follow-up Date", "Owner", "Credited To", "Team", "Counts Toward Target", "Validation", "Merged Into", "Record Status", "Created At"],
        rows: leads.map((l) => [
          l.id, fromDbDate(l.leadDate), l.companyName, l.contactPerson, l.email, l.phone, l.altPhone, l.website, l.industry, l.source, l.status,
          n(l.estimatedValue?.toString()), n(l.convertedValue?.toString()), l.followUpDate ? fromDbDate(l.followUpDate) : null,
          l.owner.name, l.creditedEmployee.name, l.team?.name ?? null,
          l.countsTowardTarget && l.validation === "VALID" && !l.mergedIntoId && !l.deletedAt ? "Yes" : "No",
          l.validation, l.mergedIntoId, l.deletedAt ? "DELETED" : "ACTIVE", l.createdAt.toISOString(),
        ]),
      };
    }
    case "Employee_Master": {
      const emps = await prisma.employee.findMany({
        where: employeeIds === "ALL" ? {} : { id: { in: employeeIds } },
        include: { department: true, user: { select: { role: true } }, memberships: { where: { endDate: null }, include: { team: true } } },
        orderBy: { name: "asc" },
      });
      return {
        columns: ["ID", "Code", "Name", "Designation", "Department", "Current Team", "Role", "Email", "Phone", "Active", "Joined On"],
        rows: emps.map((e) => [e.id, e.code, e.name, e.designation, e.department?.name ?? null, e.memberships.map((m) => m.team.name).join(", ") || null, e.user?.role ?? null, e.email, e.phone, e.active && !e.archivedAt ? "Yes" : "No", e.joinedOn ? fromDbDate(e.joinedOn) : null]),
      };
    }
    case "Team_Master": {
      const teams = await prisma.team.findMany({
        include: { department: true, leader: true, memberships: { where: { endDate: null }, include: { employee: true } } },
        orderBy: { name: "asc" },
      });
      return {
        columns: ["ID", "Team", "Department", "Team Leader", "Members", "Member Count", "Active", "Created On"],
        rows: teams.map((t) => [t.id, t.name, t.department?.name ?? null, t.leader?.name ?? null, t.memberships.map((m) => m.employee.name).join(", "), t.memberships.length, t.active && !t.archivedAt ? "Yes" : "No", t.createdAt.toISOString().slice(0, 10)]),
      };
    }
    case "Monthly_Reports": {
      const rows: Cell[][] = [];
      for (let m = startOfMonth(from); m <= to; m = fromDbDate(new Date(toDbDate(endOfMonth(m)).getTime() + 86_400_000))) {
        const perf = await buildPerformance({ from: m, to: endOfMonth(m), employeeIds });
        const month = m.slice(0, 7);
        rows.push([`${month}:COMPANY`, month, "Company Total", null, n(perf.totals.target), n(perf.totals.achieved), n(perf.totals.balance), perf.totals.pct, perf.totals.leadTarget, perf.totals.leads, perf.totals.leadBalance, perf.totals.leadPct, null]);
        for (const e of perf.byEmployee) {
          rows.push([`${month}:${e.employeeId}`, month, e.employeeName, e.teamName, n(e.target), n(e.achieved), n(e.balance), e.pct, e.leadTarget, e.leads, e.leadBalance, e.leadPct, e.daysTargetMet]);
        }
      }
      return {
        columns: ["ID", "Month", "Employee", "Team", "Total Target", "Total Achieved", "Balance", "Achievement %", "Lead Target", "Leads", "Lead Balance", "Lead %", "Days Target Met"],
        rows,
      };
    }
    case "Audit_Log": {
      const logs = await prisma.auditLog.findMany({
        where: { createdAt: { gte: toDbDate(from), lt: new Date(toDbDate(to).getTime() + 86_400_000) } },
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: "asc" },
        take: 20_000,
      });
      return {
        columns: ["ID", "Timestamp", "Actor", "Action", "Entity", "Entity ID", "Reason", "IP"],
        rows: logs.map((l) => [l.id, l.createdAt.toISOString(), l.actor?.email ?? "system", l.action, l.entityType, l.entityId, l.reason, l.ip]),
      };
    }
  }
}

export function toCsv(ds: Dataset): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [ds.columns, ...ds.rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
