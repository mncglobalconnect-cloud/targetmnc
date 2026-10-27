export interface Allocation {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  teamId: string | null;
  teamName: string | null;
  teamPlanId: string | null;
  monetaryTarget: string;
  leadTarget: number;
  notes: string | null;
  updatedAt: string;
}

export interface PlanValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  allocatedTarget: string;
  allocatedLeads: number;
  unallocatedTarget: string;
  unallocatedLeads: number;
}

export interface TeamPlan {
  id: string;
  teamId: string;
  teamName: string;
  mode: "ALLOCATED" | "INDEPENDENT";
  monetaryTarget: string;
  leadTarget: number;
  allowUnallocated: boolean;
  notes: string | null;
  manageable: boolean;
  allocations: { employeeId: string; employeeName: string; monetaryTarget: string; leadTarget: number }[];
  validation: PlanValidation;
}

export interface TargetsDay {
  date: string;
  working: { working: boolean; reason?: string };
  companyLocked: boolean;
  allocations: Allocation[];
  teamPlans: TeamPlan[];
  missing: { id: string; name: string; code: string; teamId: string | null }[];
  totals: { monetaryTarget: string; leadTarget: number };
}

export interface Preview extends PlanValidation {
  roster: { id: string; name: string }[];
}

export const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
export const cleanMoney = (v: string) => v.replace(/[₹,\s]/g, "");
export const isMoney = (v: string) => MONEY_RE.test(cleanMoney(v));
export const isCount = (v: string) => /^\d{1,6}$/.test(v.trim());

export function addDaysIso(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  if (!from || !to || from > to) return 0;
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}
