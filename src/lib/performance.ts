// Builds performance data from MongoDB records only. Used by the dashboard, reports and exports.
//
// Double-counting rules:
//  - Company totals = sum of employee allocations / employee results. Team plan targets are never added on top.
//  - Each lead is credited to exactly one employee (creditedEmployeeId) on its leadDate.
//  - Team attribution per (date, employee) uses the allocation's team snapshot, falling back to membership on that date.
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { COUNTABLE_LEAD } from "./leads";
import { classify, computeMetrics, sumMetrics, pctOf, type Metrics, type PerfStatus } from "./calc";
import { eachDate, fromDbDate, minutesNowInTz, todayInTz, toDbDate } from "./dates";
import { getSettings, isWorkingDay } from "./settings";

const Z = new Prisma.Decimal(0);

export interface PerfQuery {
  from: string;
  to: string;
  employeeIds: string[] | "ALL";
  teamId?: string | null;
  departmentId?: string | null;
  /** Include active in-scope employees with no records (single-day views flag missing targets). */
  includeIdle?: boolean;
}

export interface SerializedMetrics {
  target: string;
  achieved: string;
  balance: string;
  pct: number | null;
  leadTarget: number;
  leads: number;
  leadBalance: number;
  leadPct: number | null;
}

export interface PerfRow extends SerializedMetrics {
  date: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  teamId: string | null;
  teamName: string | null;
  departmentName: string | null;
  hasAllocation: boolean;
  nonQualifying: string; // pipeline / quotations recorded but not counted
  status: PerfStatus;
  submissionStatus: string | null;
  remarks: string | null;
  managerRemarks: string | null;
}

export interface EmployeeAgg extends SerializedMetrics {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  teamName: string | null;
  days: number;
  daysTargetMet: number;
  daysMissed: number;
  status: PerfStatus;
}

export interface TeamAgg extends SerializedMetrics {
  teamId: string;
  teamName: string;
  /** Sum of member allocations (the part that rolls into company totals). */
  memberTarget: string;
  memberLeadTarget: number;
  /** Team goal: plan target where a plan exists for a date, else the member allocation sum. */
  goalTarget: string;
  goalLeadTarget: number;
  goalPct: number | null;
  goalLeadPct: number | null;
  goalBalance: string;
  goalLeadBalance: number;
  modes: string[];
  memberCount: number;
  locked: boolean;
}

export interface DateAgg extends SerializedMetrics {
  date: string;
  working: boolean;
}

export interface PerformanceResult {
  from: string;
  to: string;
  today: string;
  rows: PerfRow[];
  byEmployee: EmployeeAgg[];
  byTeam: TeamAgg[];
  byDate: DateAgg[];
  totals: SerializedMetrics;
  statusCounts: Record<string, number>;
  missingTargets: { employeeId: string; employeeName: string; date: string }[];
}

export function serializeMetrics(m: Metrics): SerializedMetrics {
  return {
    target: m.target.toFixed(2),
    achieved: m.achieved.toFixed(2),
    balance: m.balance.toFixed(2),
    pct: m.pct,
    leadTarget: m.leadTarget,
    leads: m.leads,
    leadBalance: m.leadBalance,
    leadPct: m.leadPct,
  };
}

const key = (date: string, emp: string) => `${date}|${emp}`;

export async function buildPerformance(q: PerfQuery): Promise<PerformanceResult> {
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = todayInTz(tz);
  const minutesNow = minutesNowInTz(tz);
  const from = toDbDate(q.from);
  const to = toDbDate(q.to);
  const empFilter = q.employeeIds === "ALL" ? {} : { employeeId: { in: q.employeeIds } };
  const dateRange = { gte: from, lte: to };

  const [allocations, achQualifying, achOther, leadCounts, memberships, plans, submissions] = await Promise.all([
    prisma.employeeTargetAllocation.findMany({ where: { date: dateRange, ...empFilter } }),
    prisma.achievementEntry.groupBy({
      by: ["date", "employeeId"],
      where: { date: dateRange, deletedAt: null, countsTowardTarget: true, ...empFilter },
      _sum: { amount: true },
    }),
    prisma.achievementEntry.groupBy({
      by: ["date", "employeeId"],
      where: { date: dateRange, deletedAt: null, countsTowardTarget: false, ...empFilter },
      _sum: { amount: true },
    }),
    prisma.lead.groupBy({
      by: ["leadDate", "creditedEmployeeId"],
      where: {
        leadDate: dateRange,
        ...COUNTABLE_LEAD,
        ...(q.employeeIds === "ALL" ? {} : { creditedEmployeeId: { in: q.employeeIds } }),
      },
      _count: { _all: true },
    }),
    prisma.teamMembership.findMany({
      where: { startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }], ...empFilter },
      orderBy: { startDate: "asc" },
    }),
    prisma.teamTargetPlan.findMany({ where: { date: dateRange } }),
    prisma.dailyReportSubmission.findMany({ where: { date: dateRange } }),
  ]);

  // Collect (date, employee) keys from all sources.
  const keys = new Set<string>();
  const allocByKey = new Map(allocations.map((a) => [key(fromDbDate(a.date), a.employeeId), a]));
  allocations.forEach((a) => keys.add(key(fromDbDate(a.date), a.employeeId)));
  const achByKey = new Map<string, Prisma.Decimal>();
  achQualifying.forEach((r) => {
    const k = key(fromDbDate(r.date), r.employeeId);
    achByKey.set(k, r._sum.amount ?? Z);
    keys.add(k);
  });
  const otherByKey = new Map<string, Prisma.Decimal>();
  achOther.forEach((r) => {
    const k = key(fromDbDate(r.date), r.employeeId);
    otherByKey.set(k, r._sum.amount ?? Z);
    keys.add(k);
  });
  const leadsByKey = new Map<string, number>();
  leadCounts.forEach((r) => {
    const k = key(fromDbDate(r.leadDate), r.creditedEmployeeId);
    leadsByKey.set(k, r._count._all);
    keys.add(k);
  });

  const dates = eachDate(q.from, q.to);
  const employees = await prisma.employee.findMany({
    where: {
      OR: [
        { id: { in: [...new Set([...keys].map((k) => k.split("|")[1]))] } },
        ...(q.includeIdle
          ? [{ active: true, archivedAt: null, ...(q.employeeIds === "ALL" ? {} : { id: { in: q.employeeIds } }) }]
          : []),
      ],
    },
    include: { department: true, user: { select: { role: true } } },
  });
  const empById = new Map(employees.map((e) => [e.id, e]));

  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const teamFor = (date: string, employeeId: string): string | null => {
    const alloc = allocByKey.get(key(date, employeeId));
    if (alloc?.teamId) return alloc.teamId;
    const d = toDbDate(date);
    let found: string | null = null;
    for (const m of memberships) {
      if (m.employeeId !== employeeId) continue;
      if (m.startDate <= d && (!m.endDate || m.endDate >= d)) found = m.teamId;
    }
    return found;
  };

  if (q.includeIdle) {
    for (const e of employees) {
      if (!e.active || e.archivedAt) continue;
      if (e.user?.role === "SUPER_ADMIN") continue; // admins are not target-carrying staff
      for (const d of dates) {
        if (!isWorkingDay(d, settings).working) continue;
        // Managers are only expected to carry targets when they are also a team member that day.
        if (e.user?.role === "MANAGER" && !teamFor(d, e.id)) continue;
        keys.add(key(d, e.id));
      }
    }
  }

  const subByKey = new Map(submissions.map((s) => [`${fromDbDate(s.date)}|${s.scopeKey}`, s]));
  const isClosed = (date: string, teamId: string | null) =>
    date < today ||
    subByKey.get(`${date}|COMPANY`)?.status === "LOCKED" ||
    (teamId ? subByKey.get(`${date}|TEAM:${teamId}`)?.status === "LOCKED" : false);

  const rows: PerfRow[] = [];
  const metricsByRow = new Map<PerfRow, Metrics>();
  for (const k of keys) {
    const [date, employeeId] = k.split("|");
    const emp = empById.get(employeeId);
    if (!emp) continue;
    const alloc = allocByKey.get(k);
    const teamId = teamFor(date, employeeId);
    if (q.teamId && teamId !== q.teamId) continue;
    const deptId = alloc?.departmentId ?? emp.departmentId;
    if (q.departmentId && deptId !== q.departmentId) continue;

    const m = computeMetrics(alloc?.monetaryTarget ?? Z, achByKey.get(k) ?? Z, alloc?.leadTarget ?? 0, leadsByKey.get(k) ?? 0);
    const sub = subByKey.get(`${date}|EMP:${employeeId}`);
    const row: PerfRow = {
      date,
      employeeId,
      employeeName: emp.name,
      employeeCode: emp.code,
      teamId,
      teamName: teamId ? teamName.get(teamId) ?? null : null,
      departmentName: emp.department?.name ?? null,
      hasAllocation: !!alloc,
      nonQualifying: (otherByKey.get(k) ?? Z).toFixed(2),
      ...serializeMetrics(m),
      status: classify(m, { date, today, minutesNow, closed: isClosed(date, teamId), settings }),
      submissionStatus: sub?.status ?? null,
      remarks: sub?.remarks ?? null,
      managerRemarks: sub?.managerRemarks ?? subByKey.get(`${date}|TEAM:${teamId}`)?.managerRemarks ?? null,
    };
    rows.push(row);
    metricsByRow.set(row, m);
  }
  rows.sort((a, b) => (a.date === b.date ? a.employeeName.localeCompare(b.employeeName) : a.date < b.date ? 1 : -1));

  // Per-employee aggregates (ratio of sums).
  const empGroups = new Map<string, PerfRow[]>();
  rows.forEach((r) => empGroups.set(r.employeeId, [...(empGroups.get(r.employeeId) ?? []), r]));
  const byEmployee: EmployeeAgg[] = [...empGroups.entries()].map(([employeeId, rs]) => {
    const m = sumMetrics(rs.map((r) => metricsByRow.get(r)!));
    const latest = rs[0];
    const single = q.from === q.to;
    return {
      employeeId,
      employeeName: latest.employeeName,
      employeeCode: latest.employeeCode,
      teamName: latest.teamName,
      days: rs.length,
      daysTargetMet: rs.filter((r) => r.status === "COMPLETED" || r.status === "OVERACHIEVED").length,
      daysMissed: rs.filter((r) => r.status === "MISSED" || r.status === "PARTIAL").length,
      ...serializeMetrics(m),
      status: single ? latest.status : classify(m, { date: q.to, today, minutesNow, closed: q.to < today, settings }),
    };
  });
  byEmployee.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || Number(b.achieved) - Number(a.achieved));

  // Per-team aggregates. Plans supply the team goal; member results supply achievement.
  const teamGroups = new Map<string, PerfRow[]>();
  rows.forEach((r) => r.teamId && teamGroups.set(r.teamId, [...(teamGroups.get(r.teamId) ?? []), r]));
  plans.forEach((p) => {
    if (q.teamId && p.teamId !== q.teamId) return;
    if (!teamGroups.has(p.teamId)) teamGroups.set(p.teamId, []);
  });
  const byTeam: TeamAgg[] = [];
  for (const [teamId, rs] of teamGroups) {
    if (q.employeeIds !== "ALL" && rs.length === 0) continue;
    const member = sumMetrics(rs.map((r) => metricsByRow.get(r)!));
    let goalT = Z;
    let goalL = 0;
    const modes = new Set<string>();
    for (const d of dates) {
      const plan = plans.find((p) => p.teamId === teamId && fromDbDate(p.date) === d);
      const dayRows = rs.filter((r) => r.date === d);
      if (plan) {
        goalT = goalT.plus(plan.monetaryTarget);
        goalL += plan.leadTarget;
        modes.add(plan.mode);
      } else {
        dayRows.forEach((r) => {
          const m = metricsByRow.get(r)!;
          goalT = goalT.plus(m.target);
          goalL += m.leadTarget;
        });
      }
    }
    const goalBalance = goalT.minus(member.achieved);
    byTeam.push({
      teamId,
      teamName: teamName.get(teamId) ?? "Unknown team",
      ...serializeMetrics(member),
      memberTarget: member.target.toFixed(2),
      memberLeadTarget: member.leadTarget,
      goalTarget: goalT.toFixed(2),
      goalLeadTarget: goalL,
      goalPct: pctOf(member.achieved, goalT),
      goalLeadPct: pctOf(member.leads, goalL),
      goalBalance: (goalBalance.lt(0) ? Z : goalBalance).toFixed(2),
      goalLeadBalance: Math.max(goalL - member.leads, 0),
      modes: [...modes],
      memberCount: new Set(rs.map((r) => r.employeeId)).size,
      locked: q.from === q.to && subByKey.get(`${q.from}|TEAM:${teamId}`)?.status === "LOCKED",
    });
  }
  byTeam.sort((a, b) => (b.goalPct ?? -1) - (a.goalPct ?? -1));

  const byDate: DateAgg[] = dates.map((d) => ({
    date: d,
    working: isWorkingDay(d, settings).working,
    ...serializeMetrics(sumMetrics(rows.filter((r) => r.date === d).map((r) => metricsByRow.get(r)!))),
  }));

  const statusCounts: Record<string, number> = {};
  rows.forEach((r) => (statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1));

  return {
    from: q.from,
    to: q.to,
    today,
    rows,
    byEmployee,
    byTeam,
    byDate,
    totals: serializeMetrics(sumMetrics([...metricsByRow.values()])),
    statusCounts,
    missingTargets: rows.filter((r) => !r.hasAllocation).map((r) => ({ employeeId: r.employeeId, employeeName: r.employeeName, date: r.date })),
  };
}

/** Lead conversion stats for leads created in a range (kept separate from monetary achievement). */
export async function leadConversionStats(from: string, to: string, employeeIds: string[] | "ALL", teamId?: string | null) {
  const where: Prisma.LeadWhereInput = {
    leadDate: { gte: toDbDate(from), lte: toDbDate(to) },
    ...COUNTABLE_LEAD,
    ...(employeeIds === "ALL" ? {} : { creditedEmployeeId: { in: employeeIds } }),
    ...(teamId ? { creditedTeamId: teamId } : {}),
  };
  const [total, byStatus, converted] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.lead.aggregate({ where: { ...where, status: "CONVERTED" }, _count: { _all: true }, _sum: { convertedValue: true } }),
  ]);
  return {
    total,
    converted: converted._count._all,
    conversionRate: pctOf(converted._count._all, total),
    convertedValue: (converted._sum.convertedValue ?? Z).toFixed(2),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
  };
}
