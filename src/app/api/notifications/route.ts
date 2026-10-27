import { prisma } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { scopedPerformance } from "@/lib/perf-access";
import { leadScopeWhere } from "@/lib/lead-access";
import { getSettings, isWorkingDay } from "@/lib/settings";
import { toDbDate, todayInTz } from "@/lib/dates";

interface Note {
  id: string;
  level: "info" | "warning" | "danger";
  title: string;
  body: string;
  href: string;
}

/** Notifications are computed live from saved records (no stale copies). */
export const GET = route(async () => {
  const user = await requireUser();
  const settings = await getSettings();
  const today = todayInTz(settings.timezone);
  const notes: Note[] = [];

  if (isWorkingDay(today, settings).working) {
    const perf = await scopedPerformance(user, { from: today, to: today, includeIdle: user.role !== "EMPLOYEE" });
    const atRisk = perf.rows.filter((r) => r.status === "AT_RISK");
    if (atRisk.length && user.role !== "EMPLOYEE") {
      notes.push({ id: "at-risk", level: "danger", title: `${atRisk.length} employee(s) at risk`, body: atRisk.slice(0, 4).map((r) => r.employeeName).join(", "), href: "/dashboard" });
    }
    if (perf.missingTargets.length && user.role !== "EMPLOYEE") {
      notes.push({ id: "missing", level: "warning", title: `${perf.missingTargets.length} employee(s) without targets today`, body: perf.missingTargets.slice(0, 4).map((m) => m.employeeName).join(", "), href: "/targets" });
    }
    if (user.role === "EMPLOYEE" && perf.rows[0]) {
      const r = perf.rows[0];
      if (r.hasAllocation) notes.push({ id: "my-balance", level: r.status === "AT_RISK" ? "danger" : "info", title: "Today's remaining target", body: `₹${Number(r.balance).toLocaleString("en-IN")} and ${r.leadBalance} lead(s) remaining`, href: "/dashboard" });
    }
  }

  const followUps = await prisma.lead.count({
    where: { AND: [await leadScopeWhere(user), { deletedAt: null, mergedIntoId: null, followUpDate: { lte: toDbDate(today) }, status: { notIn: ["CONVERTED", "LOST"] } }] },
  });
  if (followUps) notes.push({ id: "followups", level: "warning", title: `${followUps} follow-up(s) due`, body: "Leads with follow-up dates today or overdue", href: "/leads?followUpDue=true" });

  if (user.role !== "EMPLOYEE") {
    const pending = await prisma.lead.count({ where: { AND: [await leadScopeWhere(user), { validation: "PENDING_VALIDATION", deletedAt: null }] } });
    if (pending) notes.push({ id: "pending", level: "info", title: `${pending} imported lead(s) awaiting validation`, body: "Imported leads count only after validation", href: "/leads?validation=PENDING_VALIDATION" });
  }
  return ok({ notes });
});
