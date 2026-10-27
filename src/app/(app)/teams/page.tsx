"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, Building2, Crown, History, Pencil, Plus, UsersRound } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, Progress, Select, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/shared";
import { useApp } from "@/components/app-context";
import { api, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatINR, formatPct } from "@/lib/format";

interface Member {
  membershipId: string;
  id: string;
  name: string;
  code: string;
  designation: string | null;
  active: boolean;
  since: string;
  until?: string;
}

interface Team {
  id: string;
  name: string;
  active: boolean;
  archivedAt: string | null;
  createdAt: string;
  department: { id: string; name: string } | null;
  leader: { id: string; name: string; code: string } | null;
  members: Member[];
  history: Member[];
}

interface TeamPerf {
  teamId: string;
  goalTarget: string;
  achieved: string;
  goalPct: number | null;
  goalLeadTarget: number;
  leads: number;
  goalLeadPct: number | null;
  goalBalance: string;
  goalLeadBalance: number;
}

export default function TeamsPage() {
  const { date, isAdmin } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, isLoading, mutate } = useApi<Team[]>(`/api/teams${showArchived ? "?archived=true" : ""}`);
  const perf = useApi<{ byTeam: TeamPerf[] }>(`/api/performance?from=${date}&to=${date}`);
  const perfById = useMemo(() => new Map((perf.data?.byTeam ?? []).map((t) => [t.teamId, t])), [perf.data]);
  const [editing, setEditing] = useState<Team | "new" | null>(null);

  // Scroll to /teams#<id> links from search once data is loaded.
  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.classList.add("ring-2", "ring-brand-400");
    const t = setTimeout(() => el?.classList.remove("ring-2", "ring-brand-400"), 2500);
    return () => clearTimeout(t);
  }, [data]);

  const archive = async (t: Team) => {
    const msg = t.archivedAt ? `Restore ${t.name}?` : `Archive ${t.name}? Historical reports keep their data; the team disappears from active lists.`;
    if (!window.confirm(msg)) return;
    try {
      await api(`/api/teams/${t.id}`, { method: "PATCH", body: { archived: !t.archivedAt } });
      toast.success(t.archivedAt ? "Team restored" : "Team archived");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update team");
    }
  };

  return (
    <>
      <PageHeader
        title="Teams"
        description={`Team structure, members and progress for ${formatDate(date)}.`}
        actions={
          isAdmin && (
            <>
              <Checkbox checked={showArchived} onChange={setShowArchived} label="Show archived" />
              <Button onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" /> New team
              </Button>
            </>
          )
        }
      />
      <Alert tone="blue" className="mb-4">
        A team carries over from day to day until you change it. Daily targets are new for each date (set them on Daily Targets, or copy yesterday&apos;s). You can edit a team&apos;s name, leader and members at any time; member changes apply from the date you choose, and past reports keep the team as it was on each day.
      </Alert>

      {error ? (
        <Card><ErrorState message={error.message} onRetry={() => mutate()} /></Card>
      ) : isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No teams yet" description={isAdmin ? "Create a team and assign a leader and members." : "You are not a member of any team."} action={isAdmin && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New team</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.map((t) => {
            const p = perfById.get(t.id);
            return (
              <Card key={t.id} id={t.id} className="scroll-mt-24 transition-shadow">
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {t.name}
                      {t.archivedAt ? <Badge tone="slate">Archived</Badge> : t.active ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Inactive</Badge>}
                    </span>
                  }
                  description={
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1"><Crown className="h-3.5 w-3.5 text-amber-500" /> {t.leader?.name ?? "No leader"}</span>
                      <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {t.department?.name ?? "No department"}</span>
                      <span>Created {formatDate(t.createdAt)}</span>
                    </span>
                  }
                  action={
                    isAdmin && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}><Pencil className="h-3.5 w-3.5" /> Edit team</Button>
                        <Button size="sm" variant="ghost" onClick={() => archive(t)} aria-label={t.archivedAt ? "Restore team" : "Archive team"}><Archive className="h-3.5 w-3.5" /></Button>
                      </>
                    )
                  }
                />
                <CardBody className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ProgressBlock label="Target progress" value={p ? `${formatINR(p.achieved)} of ${formatINR(p.goalTarget)}` : "No target"} pct={p?.goalPct ?? null} sub={p ? `Remaining ${formatINR(p.goalBalance)}` : undefined} />
                    <ProgressBlock label="Lead progress" value={p ? `${p.leads} of ${p.goalLeadTarget} leads` : "No target"} pct={p?.goalLeadPct ?? null} sub={p ? `Remaining ${p.goalLeadBalance}` : undefined} />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Members ({t.members.length})</p>
                    {t.members.length === 0 ? (
                      <p className="text-sm text-slate-500">No current members.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                        {t.members.map((m) => (
                          <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                            <span>
                              <span className="font-medium">{m.name}</span> <span className="text-xs text-slate-500">{m.code}{m.designation ? ` · ${m.designation}` : ""}</span>
                              {t.leader?.id === m.id && <Badge tone="amber" className="ml-2">Leader</Badge>}
                              {!m.active && <Badge tone="slate" className="ml-2">Inactive</Badge>}
                            </span>
                            <span className="text-xs text-slate-500">since {formatDate(m.since)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {t.history.length > 0 && (
                    <details className="group rounded-lg border border-slate-100 px-3 py-2">
                      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                        <History className="h-3.5 w-3.5" /> Membership history ({t.history.length})
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs text-slate-600">
                        {t.history.map((m) => (
                          <li key={m.membershipId}>
                            <span className="font-medium text-navy">{m.name}</span> — {formatDate(m.since)} → {formatDate(m.until)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {isAdmin && editing && <TeamDialog team={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProgressBlock({ label, value, pct, sub }: { label: string; value: string; pct: number | null; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className="tabular text-xs font-semibold text-navy">{formatPct(pct)}</p>
      </div>
      <p className="tabular mt-0.5 text-sm font-semibold text-navy">{value}</p>
      <Progress value={pct} className="mt-2" />
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

interface EmployeeOption {
  id: string;
  name: string;
  code: string;
  department: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
}

/**
 * Create or edit a team: details, leader and members in one place. Membership is ongoing (it carries over
 * day to day); member changes apply from the effective date and close previous memberships, keeping history.
 */
function TeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { meta } = useApp();
  // Loaded live when the dialog opens, so newly added employees/departments always appear.
  const emp = useApi<{ rows: EmployeeOption[] }>("/api/employees?active=true&pageSize=200", { revalidateOnMount: true });
  const depts = useApi<{ id: string; name: string }[]>("/api/departments", { revalidateOnMount: true });
  const employees = emp.data?.rows ?? [];
  const currentIds = useMemo(() => new Set(team?.members.map((m) => m.id) ?? []), [team]);

  const [name, setName] = useState(team?.name ?? "");
  const [departmentId, setDepartmentId] = useState(team?.department?.id ?? "");
  const [leaderId, setLeaderId] = useState(team?.leader?.id ?? "");
  const [active, setActive] = useState(team?.active ?? true);
  const [memberIds, setMemberIds] = useState<Set<string>>(() => new Set(currentIds));
  const [effectiveDate, setEffectiveDate] = useState(meta.today);
  const [filter, setFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState(team?.department?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string, on: boolean) =>
    setMemberIds((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const chooseLeader = (id: string) => {
    setLeaderId(id);
    if (id) toggle(id, true); // a leader is normally part of the team; can be unticked
  };

  const toAdd = [...memberIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !memberIds.has(id));
  const transfers = employees.filter((e) => toAdd.includes(e.id) && e.teams.some((t) => t.id !== team?.id));
  const membersChanged = toAdd.length > 0 || toRemove.length > 0;

  const visible = employees.filter(
    (e) => (!deptFilter || e.department?.id === deptFilter) && (!filter || `${e.name} ${e.code}`.toLowerCase().includes(filter.toLowerCase())),
  );

  const save = async () => {
    setError(null);
    if (name.trim().length < 2) return setError("Team name must be at least 2 characters.");
    if (membersChanged && !effectiveDate) return setError("Choose the date member changes take effect.");
    setSaving(true);
    try {
      if (team) {
        await api(`/api/teams/${team.id}`, { method: "PATCH", body: { name: name.trim(), departmentId: departmentId || null, leaderId: leaderId || null, active } });
        if (toAdd.length) await api(`/api/teams/${team.id}/members`, { body: { action: "add", employeeIds: toAdd, effectiveDate } });
        if (toRemove.length) await api(`/api/teams/${team.id}/members`, { body: { action: "remove", employeeIds: toRemove, effectiveDate } });
        toast.success("Team updated", { description: membersChanged ? `${toAdd.length} added, ${toRemove.length} removed from ${formatDate(effectiveDate)}` : undefined });
      } else {
        await api("/api/teams", { body: { name: name.trim(), departmentId: departmentId || null, leaderId: leaderId || null, memberIds: [...memberIds], effectiveDate } });
        toast.success(`Team "${name.trim()}" created with ${memberIds.size} member(s)`);
      }
      await refreshAll();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save team");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={team ? `Edit ${team.name}` : "Create team"}
      description="Teams carry over from day to day. Daily targets are set separately for each date on the Daily Targets page."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={save} disabled={emp.isLoading}>{team ? "Save changes" : "Create team"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <Alert tone="red" className="sm:col-span-2">{error}</Alert>}
        {emp.error && <Alert tone="red" className="sm:col-span-2">Could not load employees: {emp.error.message}</Alert>}
        <Field label="Team name" required className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus placeholder="Sales Team A" />
        </Field>
        <Field label="Department">
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); if (!team) setDeptFilter(e.target.value); }}>
            <option value="">None</option>
            {(depts.data ?? meta.departments).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Team leader" hint="Choose any employee. The leader is added as a member automatically (you can untick).">
          <Select value={leaderId} onChange={(e) => chooseLeader(e.target.value)} disabled={emp.isLoading}>
            <option value="">{emp.isLoading ? "Loading employees…" : "None"}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.code}){e.department ? ` · ${e.department.name}` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label={team ? "Member changes effective from" : "Members effective from"} required={!team || membersChanged} hint={team ? "Only applies to members you add or remove now." : undefined}>
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        {team && (
          <div className="flex items-end pb-2">
            <Checkbox checked={active} onChange={setActive} label="Team is active" />
          </div>
        )}

        <div className="sm:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-700">
              Members ({memberIds.size} selected){team && membersChanged && <span className="ml-2 text-brand-700">+{toAdd.length} / −{toRemove.length}</span>}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => visible.forEach((e) => toggle(e.id, true))}>Select shown</Button>
              <Button size="sm" variant="ghost" onClick={() => visible.forEach((e) => toggle(e.id, false))}>Clear shown</Button>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name or ID…" />
            <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Filter by department">
              <option value="">All departments</option>
              {(depts.data ?? meta.departments).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {emp.isLoading && <Skeleton className="h-24" />}
            {!emp.isLoading && visible.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">{employees.length === 0 ? "No active employees yet. Add employees on the Employees page." : "No employees match the filter."}</p>
            )}
            {visible.map((e) => {
              const other = e.teams.filter((t) => t.id !== team?.id);
              return (
                <label key={e.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={memberIds.has(e.id)} onChange={(ev) => toggle(e.id, ev.target.checked)} />
                    <span>
                      <span className="font-medium text-navy">{e.name}</span> <span className="text-xs text-slate-500">{e.code}</span>
                      {leaderId === e.id && <Badge tone="amber" className="ml-2">Leader</Badge>}
                    </span>
                  </span>
                  <span className="text-right text-[11px] text-slate-500">
                    {e.department?.name ?? "No department"}
                    {other.length > 0 && <span className="block text-amber-700">In {other.map((t) => t.name).join(", ")}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {transfers.length > 0 && (
            <Alert tone="amber" className="mt-2">
              {transfers.map((e) => e.name).join(", ")} will move from their current team on {formatDate(effectiveDate)} (an employee belongs to one team at a time; history is kept).
            </Alert>
          )}
          {team && toRemove.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">Removed members&apos; last day in this team will be {formatDate(effectiveDate)} minus one day.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
