"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound, TrendingUp,
  Bell, BarChart3, Building2, CalendarRange, ChevronLeft, ChevronRight, ClipboardList, History, IndianRupee,
  LayoutDashboard, LogOut, Menu, Plus, Search, Settings, Target, UserPlus, Users, UsersRound, X,
} from "lucide-react";
import { useApp } from "@/components/app-context";
import { AchievementFormDialog } from "@/components/forms/achievement-form";
import { LeadFormDialog } from "@/components/forms/lead-form";
import { ChangePasswordDialog } from "@/components/change-password";
import { Badge, Button, Input } from "@/components/ui";
import { preload } from "swr";
import { api, qs, useApi } from "@/lib/client";
import { addDays } from "@/lib/dates";
import { formatDate, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

type Role = "SUPER_ADMIN" | "MANAGER" | "EMPLOYEE";
const NAV: { href: string; label: string; icon: React.ElementType; roles?: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/targets", label: "Daily Targets", icon: Target },
  { href: "/progress", label: "Daily Progress", icon: TrendingUp },
  { href: "/achievements", label: "Achievement Entry", icon: IndianRupee },
  { href: "/leads", label: "Lead Management", icon: UserPlus },
  { href: "/teams", label: "Teams", icon: UsersRound },
  { href: "/employees", label: "Employees", icon: Users, roles: ["SUPER_ADMIN", "MANAGER"] },
  { href: "/reports/daily", label: "Daily Reports", icon: ClipboardList },
  { href: "/reports/periodic", label: "Weekly / Monthly / Yearly", icon: CalendarRange },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["SUPER_ADMIN", "MANAGER"] },
  { href: "/audit-logs", label: "Audit Logs", icon: History, roles: ["SUPER_ADMIN"] },
];

function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#1d53f0" />
        <path d="M14 46V18h6l12 15 12-15h6v28h-7V30l-11 13-11-13v16z" fill="#fff" />
      </svg>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-bold tracking-tight text-navy">MNC Groups</span>
          <span className="block text-[10px] font-medium uppercase tracking-wider text-brand-600">Targets & Leads</span>
        </span>
      )}
    </Link>
  );
}

/**
 * The main data each page requests on open, keyed exactly as the page's own useApi calls so SWR can reuse
 * a preloaded response. Started on hover/focus of a menu link, so data is often ready before the click.
 */
function pageRequests(href: string, date: string): string[] {
  switch (href) {
    case "/dashboard":
      return [`/api/performance${qs({ from: date, to: date, includeIdle: true })}`, `/api/performance${qs({ from: addDays(date, -13), to: date })}`];
    case "/progress":
      return [`/api/performance${qs({ from: date, to: date, includeIdle: true })}`, `/api/reports/submissions?date=${date}`, "/api/teams"];
    case "/targets":
      return [`/api/targets?date=${date}`];
    case "/teams":
      return ["/api/teams", `/api/performance?from=${date}&to=${date}`];
    default:
      return [];
  }
}

function Sidebar({ collapsed, onToggle, mobileOpen, onClose }: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onClose: () => void }) {
  const { meta, date } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const items = NAV.filter((n) => !n.roles || n.roles.includes(meta.user.role));
  const warmed = useRef(new Map<string, number>());
  const warm = (href: string) => {
    const key = `${href}|${date}`;
    const last = warmed.current.get(key) ?? 0;
    if (Date.now() - last < 15_000) return; // don't refire on every hover
    warmed.current.set(key, Date.now());
    router.prefetch(href);
    for (const url of pageRequests(href, date)) preload(url, (u: string) => api(u)).catch(() => undefined);
  };
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-navy/40 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-white transition-all duration-200",
          collapsed ? "lg:w-[68px]" : "lg:w-60",
          mobileOpen ? "w-64 translate-x-0" : "w-64 -translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
          <Logo collapsed={collapsed && !mobileOpen} />
          <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={onClose}
                onMouseEnter={() => warm(n.href)}
                onFocus={() => warm(n.href)}
                onTouchStart={() => warm(n.href)}
                title={collapsed ? n.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-navy",
                  collapsed && !mobileOpen && "lg:justify-center lg:px-0",
                )}
              >
                <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand-600" : "text-slate-400")} />
                <span className={cn(collapsed && !mobileOpen && "lg:hidden")}>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          onClick={onToggle}
          className="hidden items-center justify-center gap-2 border-t border-slate-100 py-3 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-navy lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : (<><ChevronLeft className="h-4 w-4" /> Collapse</>)}
        </button>
      </aside>
    </>
  );
}

function useClickAway(ref: React.RefObject<HTMLElement | null>, onAway: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onAway();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onAway]);
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useApi<{ leads: { id: string; companyName: string; contactPerson: string | null; status: string }[]; employees: { id: string; name: string; code: string }[]; teams: { id: string; name: string }[] }>(
    debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}` : null,
  );
  const empty = data && !data.leads.length && !data.employees.length && !data.teams.length;
  return (
    <div ref={ref} className="relative hidden w-full max-w-xs md:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search leads, employees, teams…" className="pl-9" aria-label="Search" />
      {open && debounced.length >= 2 && data && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {empty && <p className="px-3 py-4 text-center text-xs text-slate-500">No matches for “{debounced}”</p>}
          {data.leads.length > 0 && <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Leads</p>}
          {data.leads.map((l) => (
            <Link key={l.id} href={`/leads/${l.id}`} onClick={() => setOpen(false)} className="block rounded-md px-3 py-1.5 text-sm hover:bg-slate-50">
              {l.companyName} {l.contactPerson && <span className="text-xs text-slate-500">· {l.contactPerson}</span>}
            </Link>
          ))}
          {data.employees.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Employees</p>}
          {data.employees.map((e) => (
            <Link key={e.id} href={`/reports/daily?employeeId=${e.id}`} onClick={() => setOpen(false)} className="block rounded-md px-3 py-1.5 text-sm hover:bg-slate-50">
              {e.name} <span className="text-xs text-slate-500">· {e.code}</span>
            </Link>
          ))}
          {data.teams.length > 0 && <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Teams</p>}
          {data.teams.map((t) => (
            <Link key={t.id} href={`/teams#${t.id}`} onClick={() => setOpen(false)} className="block rounded-md px-3 py-1.5 text-sm hover:bg-slate-50">
              {t.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const { data } = useApi<{ notes: { id: string; level: string; title: string; body: string; href: string }[] }>("/api/notifications", { refreshInterval: 120_000 });
  const count = data?.notes.length ?? 0;
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} aria-label="Notifications" className="relative">
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{count}</span>}
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-xl">
          <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Notifications</p>
          <div className="max-h-96 overflow-y-auto p-2">
            {count === 0 && <p className="px-3 py-6 text-center text-xs text-slate-500">You&apos;re all caught up.</p>}
            {data?.notes.map((n) => (
              <Link key={n.id} href={n.href} onClick={() => setOpen(false)} className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.level === "danger" ? "bg-red-500" : n.level === "warning" ? "bg-amber-500" : "bg-brand-500")} />
                <span>
                  <span className="block text-sm font-medium text-navy">{n.title}</span>
                  <span className="block text-xs text-slate-500">{n.body}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { meta } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const initials = meta.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    router.replace("/login");
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-medium text-navy">{meta.user.name}</span>
          <span className="block text-[11px] text-slate-500">{titleCase(meta.user.role)}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-3 py-2">
            <p className="text-sm font-medium">{meta.user.name}</p>
            <p className="truncate text-xs text-slate-500">{meta.user.email}</p>
            <Badge tone="blue" className="mt-1.5">{titleCase(meta.user.role)}</Badge>
          </div>
          <button onClick={() => { setOpen(false); setPwOpen(true); }} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-navy hover:bg-slate-50">
            <KeyRound className="h-4 w-4" /> Change password
          </button>
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}

function QuickAdd() {
  const { setQuickAdd, meta, isEmployee } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const canAch = !isEmployee || meta.permissions.employeesCanRecordAchievements;
  return (
    <div ref={ref} className="relative">
      <Button size="md" onClick={() => setOpen((o) => !o)} aria-label="Quick add">
        <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Quick add</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {canAch && (
            <button onClick={() => { setQuickAdd("achievement"); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-50">
              <IndianRupee className="h-4 w-4 text-emerald-600" /> Record achievement
            </button>
          )}
          <button onClick={() => { setQuickAdd("lead"); setOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-50">
            <Building2 className="h-4 w-4 text-brand-600" /> Add new lead
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { date, setDate, meta, quickAdd, setQuickAdd } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  return (
    <div className="min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className={cn("transition-all duration-200", collapsed ? "lg:pl-[68px]" : "lg:pl-60")}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden sm:block lg:hidden">
            <Logo collapsed />
          </div>
          <div className="flex items-center gap-2">
            <label className="hidden text-xs font-medium text-slate-500 sm:block" htmlFor="global-date">
              Business date
            </label>
            <Input id="global-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-[136px] px-2 sm:w-[150px] sm:px-3" />
            {date !== meta.today && (
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setDate(meta.today)} title={`Today: ${formatDate(meta.today)}`}>
                Today
              </Button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 justify-center sm:px-2">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <QuickAdd />
            <Notifications />
            <ProfileMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
      </div>
      <AchievementFormDialog open={quickAdd === "achievement"} onOpenChange={(o) => setQuickAdd(o ? "achievement" : null)} />
      <LeadFormDialog open={quickAdd === "lead"} onOpenChange={(o) => setQuickAdd(o ? "lead" : null)} />
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <BarChart3 className="h-8 w-8 animate-pulse text-brand-500" />
        <p className="text-sm text-slate-500">Loading workspace…</p>
      </div>
    </div>
  );
}
