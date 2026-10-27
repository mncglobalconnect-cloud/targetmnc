"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarOff, Layers, Lock, Pencil, Plus, Target, Trash2, UserX, Users } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Table, Td, Textarea, Th } from "@/components/ui";
import { KpiCard, MoneyCell, useReasonPrompt } from "@/components/shared";
import { useApp } from "@/components/app-context";
import { api, ApiClientError, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { cleanMoney, daysBetween, isCount, isMoney, type Allocation, type TargetsDay } from "./types";

interface TeamLite {
  id: string;
  name: string;
  members: { id: string; name: string }[];
}

interface BulkResult {
  created: number;
  updated: number;
  skipped: { date: string; employeeId: string; reason: string }[];
}

export function useCanAssign() {
  const { meta, isAdmin, isManager } = useApp();
  return isAdmin || (isManager && meta.permissions.managersCanAssignTargets);
}

export function IndividualTab() {
  const { date, meta, isEmployee } = useApp();
  const canAssign = useCanAssign();
  const { data, error, isLoading, mutate } = useApi<TargetsDay>(`/api/targets?date=${date}`);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [preselect, setPreselect] = useState<string[]>([]);
  const [editing, setEditing] = useState<Allocation | null>(null);
  const reason = useReasonPrompt();

  const remove = async (a: Allocation, withReason?: string) => {
    const r = withReason ?? (await reason.prompt(`Reason for removing ${a.employeeName}'s target`));
    if (!r) return;
    try {
      await api(`/api/targets/individual/${a.id}`, { method: "DELETE", body: { reason: r } });
      toast.success(`Target removed for ${a.employeeName}`);
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove target");
    }
  };

  if (error) return <Card><ErrorState message={error.message} onRetry={() => mutate()} /></Card>;
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const teamName = (id: string | null) => meta.teams.find((t) => t.id === id)?.name ?? "No team";
  return (
    <div className="space-y-4">
      {!data.working.working && (
        <Alert tone="amber" title={<span className="flex items-center gap-1.5"><CalendarOff className="h-4 w-4" /> {formatDate(date)} is a non-working day</span>}>
          {data.working.reason}. Targets can still be assigned, but bulk assignment skips non-working days by default.
        </Alert>
      )}
      {data.companyLocked && (
        <Alert tone="blue" title={<span className="flex items-center gap-1.5"><Lock className="h-4 w-4" /> The report for this date is locked</span>}>
          Changes are treated as corrections: a reason is required and every change is recorded in the audit log.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total assigned target" value={formatINR(data.totals.monetaryTarget)} icon={<Target className="h-4 w-4" />} sub="Sum of individual allocations" />
        <KpiCard label="Total lead target" value={formatNumber(data.totals.leadTarget)} icon={<Users className="h-4 w-4" />} tone="violet" />
        <KpiCard label="Employees with targets" value={formatNumber(data.allocations.length)} icon={<Layers className="h-4 w-4" />} tone="green" />
        {!isEmployee && <KpiCard label="Missing targets" value={formatNumber(data.missing.length)} icon={<UserX className="h-4 w-4" />} tone="amber" sub={data.missing.length ? "Active employees without a target" : "Everyone has a target"} />}
      </div>

      {!isEmployee && data.missing.length > 0 && (
        <Alert
          tone="amber"
          title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {data.missing.length} employee(s) have no target for {formatDate(date)}</span>}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {data.missing.map((m) => (
              <Badge key={m.id} tone="amber">{m.name} · {teamName(m.teamId)}</Badge>
            ))}
            {canAssign && (
              <Button size="sm" variant="outline" className="ml-1" onClick={() => { setPreselect(data.missing.map((m) => m.id)); setBulkOpen(true); }}>
                Assign targets
              </Button>
            )}
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader
          title={isEmployee ? "My targets" : "Individual targets"}
          description={`Assigned targets for ${formatDate(date)}`}
          action={canAssign && (
            <Button size="sm" onClick={() => { setPreselect([]); setBulkOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Assign / bulk assign
            </Button>
          )}
        />
        {data.allocations.length === 0 ? (
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title="No targets assigned for this date"
            description={isEmployee ? "Your manager has not assigned a target for this date yet." : "Assign individual targets or set a team target plan."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Team</Th>
                <Th align="right">Daily target</Th>
                <Th align="right">Lead target</Th>
                <Th>Source</Th>
                <Th>Notes</Th>
                {canAssign && <Th align="right">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {data.allocations.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50/60">
                  <Td>
                    <span className="font-medium">{a.employeeName}</span> <span className="text-xs text-slate-500">{a.employeeCode}</span>
                  </Td>
                  <Td>{a.teamName ?? <span className="text-slate-400">—</span>}</Td>
                  <Td align="right"><MoneyCell value={a.monetaryTarget} /></Td>
                  <Td align="right">{a.leadTarget}</Td>
                  <Td>{a.teamPlanId ? <Badge tone="blue">Team plan</Badge> : <Badge>Individual</Badge>}</Td>
                  <Td className="max-w-[260px] truncate text-slate-600">{a.notes ?? <span className="text-slate-400">—</span>}</Td>
                  {canAssign && (
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Edit ${a.employeeName}'s target`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => remove(a)} aria-label={`Remove ${a.employeeName}'s target`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
              <tr className="bg-brand-50/50 font-semibold">
                <Td>Company total</Td>
                <Td />
                <Td align="right"><MoneyCell value={data.totals.monetaryTarget} /></Td>
                <Td align="right">{data.totals.leadTarget}</Td>
                <Td colSpan={canAssign ? 3 : 2} className="text-xs font-normal text-slate-500">Team plan targets are never added on top of these totals.</Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>

      {canAssign && <BulkAssignDialog open={bulkOpen} onOpenChange={setBulkOpen} preselect={preselect} />}
      {canAssign && <EditAllocationDialog allocation={editing} onClose={() => setEditing(null)} />}
      {reason.element}
    </div>
  );
}

function EditAllocationDialog({ allocation, onClose }: { allocation: Allocation | null; onClose: () => void }) {
  const { date } = useApp();
  const [amount, setAmount] = useState("");
  const [leads, setLeads] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const reason = useReasonPrompt();

  if (allocation && loadedId !== allocation.id) {
    setLoadedId(allocation.id);
    setAmount(String(Number(allocation.monetaryTarget)));
    setLeads(String(allocation.leadTarget));
    setNotes(allocation.notes ?? "");
    setErrors({});
  }

  const save = async (withReason?: string) => {
    if (!allocation) return;
    const e: Record<string, string> = {};
    if (!isMoney(amount)) e.amount = "Enter a non-negative amount (max 2 decimals)";
    if (!isCount(leads)) e.leads = "Enter a whole number";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await api("/api/targets/individual", {
        body: {
          from: date,
          to: date,
          overwrite: true,
          skipNonWorking: false,
          reason: withReason ?? null,
          entries: [{ employeeId: allocation.employeeId, monetaryTarget: cleanMoney(amount), leadTarget: Number(leads), notes }],
        },
      });
      toast.success(`Target updated for ${allocation.employeeName}`);
      await refreshAll();
      setLoadedId(null);
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        const r = await reason.prompt();
        if (r) return save(r);
      } else toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={!!allocation}
        onOpenChange={(o) => { if (!o) { setLoadedId(null); onClose(); } }}
        title={`Edit target — ${allocation?.employeeName ?? ""}`}
        description={formatDate(date)}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setLoadedId(null); onClose(); }}>Cancel</Button>
            <Button loading={saving} onClick={() => save()}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          {allocation?.teamPlanId && (
            <Alert tone="amber">
              This allocation belongs to a team plan. Changing it here may leave the team plan unbalanced — prefer editing it in the <b>Team Targets</b> tab.
            </Alert>
          )}
          <Field label="Daily target (₹)" required error={errors.amount}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} autoFocus />
          </Field>
          <Field label="Daily lead target" required error={errors.leads}>
            <Input inputMode="numeric" value={leads} onChange={(e) => setLeads(e.target.value)} invalid={!!errors.leads} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </Dialog>
      {reason.element}
    </>
  );
}

function BulkAssignDialog({ open, onOpenChange, preselect }: { open: boolean; onOpenChange: (v: boolean) => void; preselect: string[] }) {
  const { meta, date } = useApp();
  const teams = useApi<TeamLite[]>(open ? "/api/teams" : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamFilter, setTeamFilter] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [amount, setAmount] = useState("");
  const [leads, setLeads] = useState("");
  const [notes, setNotes] = useState("");
  const [skipNonWorking, setSkipNonWorking] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { amount: string; leads: string }>>({});
  const [step, setStep] = useState<"form" | "preview" | "result">("form");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BulkResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  const reason = useReasonPrompt();

  // Reset when the dialog opens.
  if (open && !wasOpen) {
    setWasOpen(true);
    setSelected(new Set(preselect));
    setFrom(date);
    setTo(date);
    setStep("form");
    setResult(null);
    setErrors({});
    setOverrides({});
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const employees = meta.employees.filter((e) => e.active && e.role !== "SUPER_ADMIN");
  const teamOf = useMemo(() => {
    const m = new Map<string, string>();
    teams.data?.forEach((t) => t.members.forEach((mem) => m.set(mem.id, t.id)));
    return m;
  }, [teams.data]);
  const visible = employees.filter(
    (e) => (!teamFilter || teamOf.get(e.id) === teamFilter) && (!search || `${e.name} ${e.code}`.toLowerCase().includes(search.toLowerCase())),
  );
  const allVisibleSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const entries = employees
    .filter((e) => selected.has(e.id))
    .map((e) => ({
      employee: e,
      amount: overrides[e.id]?.amount !== undefined && overrides[e.id].amount !== "" ? overrides[e.id].amount : amount,
      leads: overrides[e.id]?.leads !== undefined && overrides[e.id].leads !== "" ? overrides[e.id].leads : leads,
    }));
  const days = daysBetween(from, to);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!selected.size) e.employees = "Select at least one employee";
    if (!from) e.from = "Start date is required";
    if (!to) e.to = "End date is required";
    if (from && to && from > to) e.to = "End date must be on or after the start date";
    else if (days > 62) e.to = "Bulk assignment is limited to 62 days";
    if (!isMoney(amount)) e.amount = "Enter a non-negative amount (max 2 decimals)";
    if (!isCount(leads)) e.leads = "Enter a whole number";
    for (const x of entries) {
      if (!isMoney(x.amount) || !isCount(x.leads)) e.overrides = `Check the override values for ${x.employee.name}`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (withReason?: string) => {
    setSaving(true);
    try {
      const res = await api<BulkResult>("/api/targets/individual", {
        body: {
          from,
          to,
          skipNonWorking,
          overwrite,
          reason: withReason ?? null,
          entries: entries.map((x) => ({ employeeId: x.employee.id, monetaryTarget: cleanMoney(x.amount), leadTarget: Number(x.leads), notes })),
        },
      });
      setResult(res);
      setStep("result");
      toast.success(`${res.created} created, ${res.updated} updated${res.skipped.length ? `, ${res.skipped.length} skipped` : ""}`);
      await refreshAll();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        const r = await reason.prompt();
        if (r) return save(r);
      } else toast.error(err instanceof Error ? err.message : "Could not assign targets");
    } finally {
      setSaving(false);
    }
  };

  const empName = (id: string) => employees.find((e) => e.id === id)?.name ?? id;
  const totalTarget = entries.reduce((s, x) => s + (isMoney(x.amount) ? Number(cleanMoney(x.amount)) : 0), 0);
  const totalLeads = entries.reduce((s, x) => s + (isCount(x.leads) ? Number(x.leads) : 0), 0);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        title={step === "result" ? "Assignment result" : step === "preview" ? "Preview targets" : "Assign individual targets"}
        description="One target per employee per date. Different employees can have different targets on the same date."
        footer={
          step === "form" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => validate() && setStep("preview")}>Preview ({selected.size})</Button>
            </>
          ) : step === "preview" ? (
            <>
              <Button variant="outline" onClick={() => setStep("form")}>Back</Button>
              <Button loading={saving} onClick={() => save()}>Confirm & save</Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )
        }
      >
        {step === "form" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" required error={errors.from}>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} invalid={!!errors.from} />
                </Field>
                <Field label="To" required error={errors.to}>
                  <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} invalid={!!errors.to} />
                </Field>
                <Field label="Daily target (₹)" required error={errors.amount}>
                  <Input inputMode="decimal" placeholder="50000" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} />
                </Field>
                <Field label="Daily lead target" required error={errors.leads}>
                  <Input inputMode="numeric" placeholder="5" value={leads} onChange={(e) => setLeads(e.target.value)} invalid={!!errors.leads} />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Optional notes shown with each target" />
              </Field>
              <div className="space-y-2">
                <Checkbox checked={skipNonWorking} onChange={setSkipNonWorking} label="Skip weekends and holidays" description="Uses the business calendar in Settings." />
                <Checkbox checked={overwrite} onChange={setOverwrite} label="Overwrite existing targets" description="Otherwise employees who already have a target on a date are skipped." />
              </div>
              {meta.permissions.managerMaxDailyTarget !== null && meta.user.role === "MANAGER" && (
                <Alert tone="blue">Manager limit: up to {formatINR(meta.permissions.managerMaxDailyTarget)} per employee per day.</Alert>
              )}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" className="max-w-[200px]" />
                <Select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="max-w-[180px]">
                  <option value="">All teams</option>
                  {meta.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <span className="text-xs text-slate-500">{selected.size} selected</span>
              </div>
              {errors.employees && <p className="mb-2 text-xs text-red-600">{errors.employees}</p>}
              {errors.overrides && <p className="mb-2 text-xs text-red-600">{errors.overrides}</p>}
              <div className="max-h-[360px] overflow-y-auto rounded-lg border border-slate-200">
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all visible"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600"
                          checked={allVisibleSelected}
                          onChange={(e) => setSelected((s) => { const n = new Set(s); visible.forEach((v) => (e.target.checked ? n.add(v.id) : n.delete(v.id))); return n; })}
                        />
                      </Th>
                      <Th>Employee</Th>
                      <Th align="right">Override ₹</Th>
                      <Th align="right">Override leads</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 && (
                      <tr><Td colSpan={4} className="py-6 text-center text-xs text-slate-500">No employees match.</Td></tr>
                    )}
                    {visible.map((e) => (
                      <tr key={e.id} className={selected.has(e.id) ? "bg-brand-50/40" : undefined}>
                        <Td>
                          <input type="checkbox" aria-label={`Select ${e.name}`} className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                        </Td>
                        <Td>
                          <span className="font-medium">{e.name}</span> <span className="text-xs text-slate-500">{e.code}</span>
                        </Td>
                        <Td align="right">
                          <Input
                            className="h-8 w-28 text-right"
                            inputMode="decimal"
                            placeholder={amount || "—"}
                            disabled={!selected.has(e.id)}
                            value={overrides[e.id]?.amount ?? ""}
                            onChange={(ev) => setOverrides((o) => ({ ...o, [e.id]: { amount: ev.target.value, leads: o[e.id]?.leads ?? "" } }))}
                          />
                        </Td>
                        <Td align="right">
                          <Input
                            className="h-8 w-20 text-right"
                            inputMode="numeric"
                            placeholder={leads || "—"}
                            disabled={!selected.has(e.id)}
                            value={overrides[e.id]?.leads ?? ""}
                            onChange={(ev) => setOverrides((o) => ({ ...o, [e.id]: { amount: o[e.id]?.amount ?? "", leads: ev.target.value } }))}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-slate-500">Leave override cells blank to use the default target.</p>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <Alert tone="blue">
              {entries.length} employee(s) × {days} day(s) ({formatDate(from)} → {formatDate(to)}). Per-day total: <b>{formatINR(totalTarget)}</b> and <b>{totalLeads}</b> leads.
              {skipNonWorking ? " Non-working days will be skipped." : ""} {overwrite ? " Existing targets will be overwritten." : " Existing targets will be kept."}
            </Alert>
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th align="right">Daily target</Th>
                  <Th align="right">Lead target</Th>
                  <Th align="right">Range total</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((x) => (
                  <tr key={x.employee.id}>
                    <Td className="font-medium">{x.employee.name}</Td>
                    <Td align="right"><MoneyCell value={cleanMoney(x.amount)} /></Td>
                    <Td align="right">{x.leads}</Td>
                    <Td align="right" className="text-slate-500">up to <MoneyCell value={Number(cleanMoney(x.amount)) * days} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label="Created" value={result.created} tone="green" />
              <KpiCard label="Updated" value={result.updated} tone="blue" />
              <KpiCard label="Skipped" value={result.skipped.length} tone="amber" />
            </div>
            {result.skipped.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <Table>
                  <thead>
                    <tr><Th>Date</Th><Th>Employee</Th><Th>Reason</Th></tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s, i) => (
                      <tr key={i}><Td>{formatDate(s.date)}</Td><Td>{empName(s.employeeId)}</Td><Td className="text-slate-600">{s.reason}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        )}
      </Dialog>
      {reason.element}
    </>
  );
}
