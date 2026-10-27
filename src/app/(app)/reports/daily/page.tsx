"use client";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardList, IndianRupee, Lock, LockOpen, Send, Target, UserPlus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, Select, Skeleton, Table, Td, Textarea, Th } from "@/components/ui";
import { useApp } from "@/components/app-context";
import { KpiCard, LeadStatusBadge, MoneyCell, PageHeader, PctCell, StatusBadge, useReasonPrompt } from "@/components/shared";
import { api, LEAD_STATUS_META, LEAD_STATUSES, qs, refreshAll, STATUS_META, useApi } from "@/lib/client";
import { formatDate, formatDateTime, formatINR, formatNumber, formatPct } from "@/lib/format";
import type { PerformanceResult, PerfRow } from "@/lib/performance";
import { ExportButtons, ReportFilters, type ReportFilterValue } from "../report-ui";

type DailyRow = PerfRow & { newLeads: { id: string; companyName: string; status: string }[] };
type DailyReport = Omit<PerformanceResult, "rows"> & {
  rows: DailyRow[];
  submissions: { date: string; scopeKey: string; status: string; lockedAt: string | null; managerRemarks: string | null }[];
};

interface Submission {
  id: string;
  date: string;
  scope: "EMPLOYEE" | "TEAM" | "COMPANY";
  scopeKey: string;
  status: "SUBMITTED" | "LOCKED" | "REOPENED";
  remarks: string | null;
  managerRemarks: string | null;
  submittedAt: string | null;
  lockedAt: string | null;
  reopenReason: string | null;
  employee: { name: string } | null;
  team: { name: string } | null;
}

const SUB_TONE: Record<string, "green" | "blue" | "amber"> = { LOCKED: "green", SUBMITTED: "blue", REOPENED: "amber" };

function Detail({ date, employeeId }: { date: string; employeeId: string }) {
  const { data, error, isLoading } = useApi<{
    entries: { id: string; amount: string; countsTowardTarget: boolean; description: string | null; referenceNo: string | null; category: { name: string }; lead: { id: string; companyName: string } | null }[];
    leads: { id: string; companyName: string; contactPerson: string | null; phone: string; status: string; validation: string; mergedIntoId: string | null; countsTowardTarget: boolean; counted: boolean }[];
  }>(`/api/reports/detail${qs({ date, employeeId })}`);
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (error || !data) return <p className="text-xs text-red-600">{error?.message ?? "Could not load details"}</p>;
  const why = (l: (typeof data.leads)[number]) =>
    l.counted ? "Counted" : l.mergedIntoId ? "Merged duplicate" : l.validation === "PENDING_VALIDATION" ? "Awaiting validation" : l.validation === "REJECTED" ? "Rejected import" : "Excluded";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Achievement entries ({data.entries.length})</p>
        {data.entries.length === 0 ? (
          <p className="text-xs text-slate-500">No entries recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="min-w-0">
                  <span className="font-medium text-navy">{e.category.name}</span>
                  {e.description && <span className="text-slate-500"> · {e.description}</span>}
                  {e.referenceNo && <span className="text-slate-400"> · Ref {e.referenceNo}</span>}
                  {e.lead && (
                    <Link href={`/leads/${e.lead.id}`} className="text-brand-600 hover:underline"> · {e.lead.companyName}</Link>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {!e.countsTowardTarget && <Badge tone="amber">Not counted</Badge>}
                  <MoneyCell value={e.amount} className={e.countsTowardTarget ? "font-medium" : "text-slate-400 line-through"} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Leads credited ({data.leads.length})</p>
        {data.leads.length === 0 ? (
          <p className="text-xs text-slate-500">No leads credited on this date.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <Link href={`/leads/${l.id}`} className="min-w-0 truncate font-medium text-brand-700 hover:underline">
                  {l.companyName}
                  {l.contactPerson && <span className="font-normal text-slate-500"> · {l.contactPerson}</span>}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  <LeadStatusBadge status={l.status} />
                  <Badge tone={l.counted ? "green" : "slate"}>{why(l)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EndOfDay({ date, report }: { date: string; report: DailyReport }) {
  const { meta, isAdmin, isEmployee } = useApp();
  const subs = useApi<Submission[]>(`/api/reports/submissions?date=${date}`);
  const reason = useReasonPrompt();
  const [dialog, setDialog] = useState<null | { scope: "EMPLOYEE" | "TEAM" | "COMPANY"; teamId?: string; label: string }>(null);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const future = date > meta.today;

  const byKey = new Map((subs.data ?? []).map((s) => [s.scopeKey, s]));
  const mine = meta.user.employeeId ? byKey.get(`EMP:${meta.user.employeeId}`) : undefined;
  const manageableTeams = meta.teams.filter((t) => t.manageable);
  const company = byKey.get("COMPANY");

  const groups = {
    exceeded: report.rows.filter((r) => r.status === "OVERACHIEVED"),
    achieved: report.rows.filter((r) => r.status === "COMPLETED"),
    partial: report.rows.filter((r) => ["PARTIAL", "ON_TRACK", "AT_RISK"].includes(r.status)),
    none: report.rows.filter((r) => ["MISSED", "NOT_STARTED"].includes(r.status)),
  };

  const submit = async () => {
    if (!dialog) return;
    setSaving(true);
    try {
      await api("/api/reports/submissions", {
        body: {
          date,
          scope: dialog.scope,
          teamId: dialog.teamId,
          ...(dialog.scope === "EMPLOYEE" ? { remarks } : { managerRemarks: remarks }),
          lock: true,
        },
      });
      toast.success(dialog.scope === "EMPLOYEE" ? "Your day has been submitted" : `${dialog.label} locked`, {
        description: dialog.scope === "COMPANY" ? "The report is stored in MongoDB. Download Excel whenever needed." : "Further changes require a correction reason.",
      });
      setDialog(null);
      setRemarks("");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSaving(false);
    }
  };

  const reopen = async (s: Submission) => {
    const r = await reason.prompt(`Reopen ${s.scope === "COMPANY" ? "company day" : s.team?.name ?? s.employee?.name ?? "report"}`);
    if (!r) return;
    try {
      await api("/api/reports/reopen", { body: { date, scopeKey: s.scopeKey, reason: r } });
      toast.success("Report reopened for corrections");
      await refreshAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reopen");
    }
  };

  const Group = ({ title, rows, tone }: { title: string; rows: DailyRow[]; tone: "violet" | "green" | "amber" | "red" }) => (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{title}</p>
        <Badge tone={tone}>{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">None</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.employeeId} className="flex justify-between gap-2 text-xs">
              <span className="truncate">{r.employeeName}</span>
              <span className="tabular text-slate-500">{formatPct(r.pct ?? r.leadPct)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="End-of-day submission"
        description="Submitted reports are locked; corrections afterwards need authorization and are recorded in the audit log."
        action={
          !future && (
            <>
              {meta.user.employeeId && !isAdmin && (!mine || mine.status === "REOPENED") && (
                <Button size="sm" variant="secondary" onClick={() => setDialog({ scope: "EMPLOYEE", label: "My day" })}>
                  <Send className="h-3.5 w-3.5" /> Submit my day
                </Button>
              )}
              {!isEmployee &&
                manageableTeams.map((t) => {
                  const s = byKey.get(`TEAM:${t.id}`);
                  if (s && s.status === "LOCKED") return null;
                  return (
                    <Button key={t.id} size="sm" variant="outline" onClick={() => setDialog({ scope: "TEAM", teamId: t.id, label: t.name })}>
                      <Lock className="h-3.5 w-3.5" /> Submit & lock {t.name}
                    </Button>
                  );
                })}
              {isAdmin && (!company || company.status === "REOPENED") && (
                <Button size="sm" onClick={() => setDialog({ scope: "COMPANY", label: "Company day" })}>
                  <Lock className="h-3.5 w-3.5" /> Lock company day
                </Button>
              )}
            </>
          )
        }
      />
      <CardBody className="space-y-4">
        {future && <Alert tone="blue">Reports can be submitted on or after the business date.</Alert>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Group title="Exceeded target" rows={groups.exceeded} tone="violet" />
          <Group title="Achieved target" rows={groups.achieved} tone="green" />
          <Group title="Partially achieved" rows={groups.partial} tone="amber" />
          <Group title="No achievement" rows={groups.none} tone="red" />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Submissions</p>
          {subs.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : !subs.data?.length ? (
            <p className="text-xs text-slate-500">Nothing submitted for {formatDate(date)} yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {subs.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{s.scope === "COMPANY" ? "Company" : s.scope === "TEAM" ? s.team?.name : s.employee?.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {s.scope.toLowerCase()} · {s.lockedAt ? `locked ${formatDateTime(s.lockedAt)}` : s.submittedAt ? `submitted ${formatDateTime(s.submittedAt)}` : ""}
                    </span>
                    {(s.remarks || s.managerRemarks) && <span className="block text-xs text-slate-500">“{s.managerRemarks ?? s.remarks}”</span>}
                    {s.status === "REOPENED" && s.reopenReason && <span className="block text-xs text-amber-700">Reopened: {s.reopenReason}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={SUB_TONE[s.status]}>{s.status === "LOCKED" ? "Locked" : s.status === "SUBMITTED" ? "Submitted" : "Reopened"}</Badge>
                    {!isEmployee && s.status !== "REOPENED" && (s.scope !== "COMPANY" || isAdmin) && (
                      <Button size="sm" variant="ghost" onClick={() => reopen(s)}>
                        <LockOpen className="h-3.5 w-3.5" /> Reopen
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
      <Dialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.scope === "EMPLOYEE" ? "Submit my day" : `Submit & lock — ${dialog?.label}`}
        description={`${formatDate(date)} · the figures at this moment are snapshotted with the submission.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button loading={saving} onClick={submit}>
              <CheckCircle2 className="h-4 w-4" /> Confirm
            </Button>
          </>
        }
      >
        <Field label={dialog?.scope === "EMPLOYEE" ? "Remarks" : "Manager remarks"} hint="Optional">
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={2000} placeholder={dialog?.scope === "EMPLOYEE" ? "Key wins, blockers, follow-ups planned…" : "Team summary for management"} />
        </Field>
      </Dialog>
      {reason.element}
    </Card>
  );
}

function DailyReport() {
  const { date, meta } = useApp();
  const params = useSearchParams();
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [filters, setFilters] = useState<ReportFilterValue>({ teamId: "", departmentId: "", employeeId: params.get("employeeId") ?? "" });
  const [status, setStatus] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFrom(date);
    setTo(date);
  }, [date]);
  useEffect(() => {
    const e = params.get("employeeId");
    if (e) setFilters((f) => ({ ...f, employeeId: e }));
  }, [params]);

  const rangeOk = from && to && from <= to;
  const url = rangeOk ? `/api/reports/daily${qs({ from, to, ...filters, status, leadStatus })}` : null;
  const { data, error, isLoading, mutate } = useApi<DailyReport>(url);
  const single = from === to;
  const t = data?.totals;

  const toggle = (k: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const statusCounts = useMemo(() => Object.entries(data?.statusCounts ?? {}).sort((a, b) => b[1] - a[1]), [data]);

  return (
    <>
      <PageHeader
        title="Daily Reports"
        description={single ? `Performance for ${formatDate(from)}${from === meta.today ? " (today)" : ""}` : `Date-wise performance from ${formatDate(from)} to ${formatDate(to)}`}
        actions={rangeOk && <ExportButtons from={from} to={to} filters={filters} />}
      />

      <Card className="mb-6">
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" error={!rangeOk ? "End must be on/after start" : null}>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <ReportFilters value={filters} onChange={setFilters} />
          <Field label="Achievement status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Lead status">
            <Select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
              <option value="">Any</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>{LEAD_STATUS_META[s].label}</option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {error ? (
        <Card><ErrorState message={error.message} onRetry={() => mutate()} /></Card>
      ) : isLoading || !data || !t ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Assigned target" value={formatINR(t.target)} icon={<Target className="h-4 w-4" />} />
            <KpiCard label="Achieved" value={formatINR(t.achieved)} icon={<IndianRupee className="h-4 w-4" />} tone="green" pct={t.pct} sub={`${formatPct(t.pct)} of target`} />
            <KpiCard label="Remaining target" value={formatINR(t.balance)} tone="amber" />
            <KpiCard label="Target achievement" value={formatPct(t.pct)} tone="violet" pct={t.pct} />
            <KpiCard label="Lead target" value={formatNumber(t.leadTarget)} icon={<UserPlus className="h-4 w-4" />} />
            <KpiCard label="Leads generated" value={formatNumber(t.leads)} tone="green" pct={t.leadPct} sub={`${formatPct(t.leadPct)} of lead target`} />
            <KpiCard label="Remaining leads" value={formatNumber(t.leadBalance)} tone="amber" />
            <KpiCard label="Lead achievement" value={formatPct(t.leadPct)} tone="violet" pct={t.leadPct} />
          </div>

          {statusCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Status mix:</span>
              {statusCounts.map(([s, c]) => (
                <button key={s} onClick={() => setStatus(status === s ? "" : s)} className="inline-flex items-center gap-1">
                  <StatusBadge status={s} />
                  <span className="text-xs tabular text-slate-600">{c}</span>
                </button>
              ))}
            </div>
          )}

          {single && <EndOfDay date={from} report={data} />}

          <Card>
            <CardHeader title="Employee detail" description="Expand a row to inspect the entries and leads behind each total." />
            {data.rows.length === 0 ? (
              <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No records for this selection" description="Try a different date range or clear the filters." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-8" />
                    <Th>Date</Th>
                    <Th>Employee</Th>
                    <Th>Team</Th>
                    <Th align="right">Assigned target</Th>
                    <Th align="right">Actual achievement</Th>
                    <Th align="right">Remaining</Th>
                    <Th align="right">%</Th>
                    <Th align="right">Lead target</Th>
                    <Th align="right">Leads</Th>
                    <Th align="right">Remaining leads</Th>
                    <Th>New lead companies</Th>
                    <Th>Status</Th>
                    <Th>Submission</Th>
                    <Th>Manager remarks</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const k = `${r.date}|${r.employeeId}`;
                    const open = expanded.has(k);
                    return (
                      <Fragment key={k}>
                        <tr className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(k)}>
                          <Td>{open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</Td>
                          <Td>{formatDate(r.date)}</Td>
                          <Td>
                            <span className="font-medium">{r.employeeName}</span>
                            <span className="block text-[11px] text-slate-400">{r.employeeCode}</span>
                          </Td>
                          <Td className="text-slate-600">{r.teamName ?? "—"}</Td>
                          <Td align="right">{r.hasAllocation ? <MoneyCell value={r.target} /> : <Badge tone="amber">No target</Badge>}</Td>
                          <Td align="right"><MoneyCell value={r.achieved} className="font-medium" /></Td>
                          <Td align="right"><MoneyCell value={r.balance} /></Td>
                          <Td align="right"><PctCell value={r.pct} /></Td>
                          <Td align="right">{r.leadTarget}</Td>
                          <Td align="right">{r.leads}</Td>
                          <Td align="right">{r.leadBalance}</Td>
                          <Td className="max-w-[220px] whitespace-normal text-xs text-slate-600">{r.newLeads.length ? r.newLeads.map((l) => l.companyName).join(", ") : "—"}</Td>
                          <Td><StatusBadge status={r.status} /></Td>
                          <Td>{r.submissionStatus ? <Badge tone={SUB_TONE[r.submissionStatus]}>{r.submissionStatus.toLowerCase()}</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
                          <Td className="max-w-[200px] truncate text-xs text-slate-600">{r.managerRemarks ?? "—"}</Td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={15} className="border-b border-slate-100 bg-slate-50/70 px-6 py-4">
                              <Detail date={r.date} employeeId={r.employeeId} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

export default function DailyReportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <DailyReport />
    </Suspense>
  );
}
