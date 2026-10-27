"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Divide, Pencil, Plus, RefreshCw, UsersRound } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Table, Td, Textarea, Th } from "@/components/ui";
import { MoneyCell, useReasonPrompt } from "@/components/shared";
import { useApp } from "@/components/app-context";
import { api, ApiClientError, refreshAll, useApi } from "@/lib/client";
import { formatDate, formatINR } from "@/lib/format";
import { useCanAssign } from "./individual-tab";
import { cleanMoney, isCount, isMoney, type Preview, type TargetsDay, type TeamPlan } from "./types";

const MODE_HELP = {
  ALLOCATED: "Mode 1 — the team target is distributed among members. Individual allocations must add up to the team target (unless an unallocated balance is explicitly allowed).",
  INDEPENDENT: "Mode 2 — the team target is a separate management goal. Members keep their own targets; company totals use individual targets only, so the team goal is never double-counted.",
};

export function TeamTab() {
  const { date, meta } = useApp();
  const canAssign = useCanAssign();
  const { data, error, isLoading, mutate } = useApi<TargetsDay>(`/api/targets?date=${date}`);
  const [editTeamId, setEditTeamId] = useState<string | null>(null);

  if (error) return <Card><ErrorState message={error.message} onRetry={() => mutate()} /></Card>;
  if (isLoading || !data) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>;

  const planned = new Set(data.teamPlans.map((p) => p.teamId));
  const unplanned = meta.teams.filter((t) => t.active && t.manageable && !planned.has(t.id));
  const editingPlan = data.teamPlans.find((p) => p.teamId === editTeamId) ?? null;

  return (
    <div className="space-y-4">
      {canAssign && unplanned.length > 0 && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm text-slate-600">No team target yet for {formatDate(date)}:</span>
            {unplanned.map((t) => (
              <Button key={t.id} size="sm" variant="secondary" onClick={() => setEditTeamId(t.id)}>
                <Plus className="h-3.5 w-3.5" /> {t.name}
              </Button>
            ))}
          </CardBody>
        </Card>
      )}

      {data.teamPlans.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersRound className="h-5 w-5" />}
            title="No team targets for this date"
            description={canAssign ? "Create a team plan to set a team target and distribute it among members." : "Team targets for this date have not been set."}
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.teamPlans.map((p) => (
            <PlanCard key={p.id} plan={p} onEdit={canAssign && p.manageable ? () => setEditTeamId(p.teamId) : undefined} />
          ))}
        </div>
      )}

      {canAssign && editTeamId && (
        <TeamPlanEditor teamId={editTeamId} plan={editingPlan} onClose={() => setEditTeamId(null)} />
      )}
    </div>
  );
}

function PlanCard({ plan, onEdit }: { plan: TeamPlan; onEdit?: () => void }) {
  const v = plan.validation;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">{plan.teamName} <Badge tone={plan.mode === "ALLOCATED" ? "blue" : "violet"}>{plan.mode === "ALLOCATED" ? "Mode 1 · Allocated" : "Mode 2 · Independent"}</Badge></span>}
        description={plan.notes ?? undefined}
        action={onEdit && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit plan</Button>}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Team target" value={formatINR(plan.monetaryTarget)} />
          <Stat label="Allocated" value={formatINR(v.allocatedTarget)} />
          <Stat label="Team lead target" value={String(plan.leadTarget)} />
          <Stat label="Allocated leads" value={String(v.allocatedLeads)} />
        </div>
        {v.errors.length > 0 && <Alert tone="red" title="Allocation errors">{v.errors.map((e) => <p key={e}>{e}</p>)}</Alert>}
        {v.warnings.length > 0 && <Alert tone="amber">{v.warnings.map((w) => <p key={w}>{w}</p>)}</Alert>}
        {v.ok && v.errors.length === 0 && v.warnings.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Allocations balance with the team target.</p>
        )}
        {plan.allocations.length > 0 && (
          <Table>
            <thead>
              <tr><Th>Member</Th><Th align="right">Target</Th><Th align="right">Leads</Th></tr>
            </thead>
            <tbody>
              {plan.allocations.map((a) => (
                <tr key={a.employeeId}>
                  <Td>{a.employeeName}</Td>
                  <Td align="right"><MoneyCell value={a.monetaryTarget} /></Td>
                  <Td align="right">{a.leadTarget}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="tabular font-semibold text-navy">{value}</p>
    </div>
  );
}

interface Row {
  include: boolean;
  amount: string;
  leads: string;
}

/** Splits a total into n parts in paise so the parts always add up exactly. */
function splitEvenly(total: number, n: number): string[] {
  const paise = Math.round(total * 100);
  const base = Math.floor(paise / n);
  const rem = paise - base * n;
  return Array.from({ length: n }, (_, i) => ((base + (i < rem ? 1 : 0)) / 100).toFixed(2).replace(/\.00$/, ""));
}

function TeamPlanEditor({ teamId, plan, onClose }: { teamId: string; plan: TeamPlan | null; onClose: () => void }) {
  const { date, meta } = useApp();
  const team = meta.teams.find((t) => t.id === teamId);
  const [mode, setMode] = useState<"ALLOCATED" | "INDEPENDENT">(plan?.mode ?? "ALLOCATED");
  const [amount, setAmount] = useState(plan ? String(Number(plan.monetaryTarget)) : "");
  const [leads, setLeads] = useState(plan ? String(plan.leadTarget) : "");
  const [allowUnallocated, setAllowUnallocated] = useState(plan?.allowUnallocated ?? false);
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [roster, setRoster] = useState<{ id: string; name: string }[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reason = useReasonPrompt();
  const planRef = useRef(plan);

  const inputsValid = (amount === "" || isMoney(amount)) && (leads === "" || isCount(leads)) && Object.values(rows).every((r) => !r.include || ((r.amount === "" || isMoney(r.amount)) && (r.leads === "" || isCount(r.leads))));

  const payload = useCallback(
    (dryRun: boolean, withReason?: string) => ({
      date,
      teamId,
      mode,
      monetaryTarget: cleanMoney(amount || "0"),
      leadTarget: Number(leads || 0),
      allowUnallocated,
      notes,
      dryRun,
      reason: withReason ?? null,
      allocations: Object.entries(rows)
        .filter(([, r]) => r.include)
        .map(([employeeId, r]) => ({ employeeId, monetaryTarget: cleanMoney(r.amount || "0"), leadTarget: Number(r.leads || 0) })),
    }),
    [date, teamId, mode, amount, leads, allowUnallocated, notes, rows],
  );

  // Load roster (members on the date) via a dry run, then prefill rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ preview: Preview }>("/api/targets/team", {
          body: { date, teamId, mode: "INDEPENDENT", monetaryTarget: "0", leadTarget: 0, allowUnallocated: true, dryRun: true, allocations: [] },
        });
        if (cancelled) return;
        setRoster(res.preview.roster);
        const init: Record<string, Row> = {};
        for (const m of res.preview.roster) {
          const existing = planRef.current?.allocations.find((a) => a.employeeId === m.id);
          init[m.id] = existing
            ? { include: true, amount: String(Number(existing.monetaryTarget)), leads: String(existing.leadTarget) }
            : { include: !planRef.current, amount: "", leads: "" };
        }
        setRows(init);
      } catch (err) {
        if (!cancelled) setRosterError(err instanceof Error ? err.message : "Could not load team roster");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, teamId, plan?.id]);

  const runPreview = useCallback(async () => {
    if (!inputsValid) return;
    setPreviewing(true);
    try {
      const res = await api<{ preview: Preview }>("/api/targets/team", { body: payload(true) });
      setPreview(res.preview);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }, [inputsValid, payload]);

  // Debounced live preview.
  useEffect(() => {
    if (!roster) return;
    const t = setTimeout(runPreview, 600);
    return () => clearTimeout(t);
  }, [roster, runPreview]);

  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const split = () => {
    const ids = Object.entries(rows).filter(([, r]) => r.include).map(([id]) => id);
    if (!ids.length) return toast.warning("Include at least one member to split the target.");
    if (!isMoney(amount || "0") || !isCount(leads || "0")) return toast.warning("Enter a valid team target first.");
    const money = splitEvenly(Number(cleanMoney(amount || "0")), ids.length);
    const totalLeads = Number(leads || 0);
    const baseL = Math.floor(totalLeads / ids.length);
    const remL = totalLeads - baseL * ids.length;
    setRows((r) => {
      const n = { ...r };
      ids.forEach((id, i) => (n[id] = { ...n[id], amount: money[i], leads: String(baseL + (i < remL ? 1 : 0)) }));
      return n;
    });
  };

  const save = async (withReason?: string) => {
    if (!isMoney(amount)) return toast.error("Enter a valid team target amount.");
    if (!isCount(leads)) return toast.error("Enter a valid team lead target.");
    if (!inputsValid) return toast.error("Fix the highlighted member allocations.");
    setSaving(true);
    try {
      await api("/api/targets/team", { body: payload(false, withReason) });
      toast.success(`Team target saved for ${team?.name ?? "team"}`);
      await refreshAll();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        const r = await reason.prompt();
        if (r) return save(r);
      } else {
        const p = err instanceof ApiClientError ? (err.details as { preview?: Preview })?.preview : undefined;
        if (p) setPreview(p);
        toast.error(err instanceof Error ? err.message : "Could not save team target");
      }
    } finally {
      setSaving(false);
    }
  };

  const included = Object.values(rows).filter((r) => r.include);
  const sumAmount = included.reduce((s, r) => s + (isMoney(r.amount || "0") ? Number(cleanMoney(r.amount || "0")) : 0), 0);
  const sumLeads = included.reduce((s, r) => s + (isCount(r.leads || "0") ? Number(r.leads || 0) : 0), 0);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        size="xl"
        title={`${plan ? "Edit" : "Create"} team target — ${team?.name ?? ""}`}
        description={formatDate(date)}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="outline" onClick={runPreview} loading={previewing}><RefreshCw className="h-3.5 w-3.5" /> Preview</Button>
            <Button onClick={() => save()} loading={saving} disabled={!roster || (preview !== null && !preview.ok)}>Save team target</Button>
          </>
        }
      >
        {rosterError ? (
          <ErrorState message={rosterError} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <Field label="Allocation mode" required>
                <Select value={mode} onChange={(e) => setMode(e.target.value as "ALLOCATED" | "INDEPENDENT")}>
                  <option value="ALLOCATED">Mode 1: allocated team target</option>
                  <option value="INDEPENDENT">Mode 2: independent team goal</option>
                </Select>
              </Field>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{MODE_HELP[mode]}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Team target (₹)" required error={amount && !isMoney(amount) ? "Invalid amount" : null}>
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150000" invalid={!!amount && !isMoney(amount)} />
                </Field>
                <Field label="Team lead target" required error={leads && !isCount(leads) ? "Whole number" : null}>
                  <Input inputMode="numeric" value={leads} onChange={(e) => setLeads(e.target.value)} placeholder="15" invalid={!!leads && !isCount(leads)} />
                </Field>
              </div>
              {mode === "ALLOCATED" && (
                <Checkbox checked={allowUnallocated} onChange={setAllowUnallocated} label="Allow an unallocated balance" description="Authorised override: lets the team target exceed the sum of member allocations." />
              )}
              <Field label="Team notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
              </Field>

              {preview && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-500">Allocated / unallocated ₹</p><p className="tabular font-semibold">{formatINR(preview.allocatedTarget)} / {formatINR(preview.unallocatedTarget)}</p></div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-500">Allocated / unallocated leads</p><p className="tabular font-semibold">{preview.allocatedLeads} / {preview.unallocatedLeads}</p></div>
                  </div>
                  {preview.errors.length > 0 && <Alert tone="red" title="Fix before saving">{preview.errors.map((e) => <p key={e}>{e}</p>)}</Alert>}
                  {preview.warnings.length > 0 && <Alert tone="amber" title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Warnings</span>}>{preview.warnings.map((w) => <p key={w}>{w}</p>)}</Alert>}
                  {preview.ok && !preview.errors.length && !preview.warnings.length && <Alert tone="green">Allocations are valid.</Alert>}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Member allocations</p>
                <Button size="sm" variant="secondary" onClick={split}><Divide className="h-3.5 w-3.5" /> Split evenly</Button>
              </div>
              {!roster ? (
                <Skeleton className="h-48" />
              ) : roster.length === 0 ? (
                <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No members on this date" description="Add members to the team (Teams page) before allocating targets." />
              ) : (
                <div className="rounded-lg border border-slate-200">
                  <Table>
                    <thead>
                      <tr><Th className="w-8" /><Th>Member</Th><Th align="right">Target ₹</Th><Th align="right">Leads</Th></tr>
                    </thead>
                    <tbody>
                      {roster.map((m) => {
                        const r = rows[m.id] ?? { include: false, amount: "", leads: "" };
                        const badAmt = r.include && r.amount !== "" && !isMoney(r.amount);
                        const badLead = r.include && r.leads !== "" && !isCount(r.leads);
                        return (
                          <tr key={m.id} className={r.include ? undefined : "opacity-60"}>
                            <Td><input type="checkbox" aria-label={`Include ${m.name}`} className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={r.include} onChange={(e) => setRow(m.id, { include: e.target.checked })} /></Td>
                            <Td className="font-medium">{m.name}</Td>
                            <Td align="right"><Input className="h-8 w-28 text-right" inputMode="decimal" disabled={!r.include} value={r.amount} invalid={badAmt} onChange={(e) => setRow(m.id, { amount: e.target.value })} placeholder="0" /></Td>
                            <Td align="right"><Input className="h-8 w-20 text-right" inputMode="numeric" disabled={!r.include} value={r.leads} invalid={badLead} onChange={(e) => setRow(m.id, { leads: e.target.value })} placeholder="0" /></Td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-50 font-semibold">
                        <Td /><Td>Total allocated</Td>
                        <Td align="right"><MoneyCell value={sumAmount} /></Td>
                        <Td align="right">{sumLeads}</Td>
                      </tr>
                    </tbody>
                  </Table>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-500">Unchecked members get no allocation from this plan. Saving replaces this team&apos;s plan allocations for the date.</p>
            </div>
          </div>
        )}
      </Dialog>
      {reason.element}
    </>
  );
}
