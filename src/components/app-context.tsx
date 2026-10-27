"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useApi } from "@/lib/client";
import { Alert, Button } from "@/components/ui";

export interface Meta {
  user: { id: string; name: string; email: string; role: "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE"; employeeId: string | null; ledTeamIds: string[] };
  today: string;
  timezone: string;
  permissions: { employeesCanRecordAchievements: boolean; employeesCanEditOwnSameDay: boolean; managersCanAssignTargets: boolean; managerMaxDailyTarget: number | null };
  workday: { start: string; end: string };
  employees: { id: string; name: string; code: string; active: boolean; departmentId: string | null; role: string | null }[];
  teams: { id: string; name: string; active: boolean; leaderId: string | null; departmentId: string | null; manageable: boolean }[];
  departments: { id: string; name: string }[];
  categories: { id: string; code: string; name: string; countsTowardTarget: boolean }[];
  storage: { provider: "mongodb" };
}

interface Ctx {
  meta: Meta;
  date: string;
  setDate: (d: string) => void;
  isAdmin: boolean;
  isManager: boolean;
  isEmployee: boolean;
  quickAdd: "achievement" | "lead" | null;
  setQuickAdd: (v: "achievement" | "lead" | null) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  // Lookup lists (employees, teams, departments) must not go stale when records change elsewhere.
  const { data: meta, error } = useApi<Meta>("/api/meta", { revalidateOnFocus: true, refreshInterval: 60_000 });
  const [date, setDateState] = useState<string>("");
  const [quickAdd, setQuickAdd] = useState<Ctx["quickAdd"]>(null);

  useEffect(() => {
    if (!meta || date) return;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem("business-date");
    } catch {
      /* ignore */
    }
    setDateState(stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : meta.today);
  }, [meta, date]);

  const setDate = (d: string) => {
    setDateState(d);
    try {
      sessionStorage.setItem("business-date", d);
    } catch {
      /* ignore */
    }
  };

  if (error) return (
    <div className="mx-auto max-w-2xl space-y-4 p-8">
      <Alert tone="red" title="Database connection needs attention">{error.message}</Alert>
      <p className="text-sm text-slate-600">Configure DATABASE_URL in .env with a reachable MongoDB replica set or Atlas database, then retry. Google Sheets and Apps Script are no longer used.</p>
      <Button onClick={() => window.location.reload()}>Retry connection</Button>
    </div>
  );
  if (!meta || !date) return <>{fallback}</>;
  return (
    <AppCtx.Provider
      value={{
        meta,
        date,
        setDate,
        isAdmin: meta.user.role === "SUPER_ADMIN",
        isManager: meta.user.role === "MANAGER",
        isEmployee: meta.user.role === "EMPLOYEE",
        quickAdd,
        setQuickAdd,
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
